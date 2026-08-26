import { NextRequest, NextResponse } from "next/server";
import { authenticate, runWithAuthOp, withGuc } from "@/lib/auth";
import { z } from "zod";
import { randomUUID } from "crypto";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * POST /api/v1/events — 客户端批量上报分析事件。
 *
 * 设计：
 *  - 批量写入（一次最多 50 条），减少往返。
 *  - 不要求工作区上下文（register 事件在 wid 建立前发生）。
 *  - 已认证用户从 access_token 解析 userId；未认证事件（register 前的 page_view）允许匿名。
 *  - 事件名白名单：防止任意字符串注入 + 控制事件维度爆炸。
 *  - props 不存 PII，仅存匿名化字段（taskId/role/plan/view 等）。
 *
 * P2 数据埋点：注册/激活/留存/转化漏斗。
 */

/** 事件名白名单：与 SPEC P2 漏斗关键路径对齐。 */
const ALLOWED_EVENT_NAMES = new Set([
  // 注册激活漏斗
  "register_view",
  "register_submit",
  "register_success",
  "login_view",
  "login_submit",
  "login_success",
  "onboarding_start",
  "onboarding_complete",
  "onboarding_skip",
  // 核心激活
  "create_task",
  "invite_member",
  "create_decision",
  "create_comment",
  "task_status_change",
  // 留存信号
  "page_view",
  "workspace_switch",
  // 转化
  "billing_view",
  "billing_checkout",
  "billing_success",
  "billing_cancel",
]);

const eventSchema = z.object({
  name: z.string().max(64),
  props: z.record(z.unknown()).default({}),
  sessionId: z.string().max(64).optional(),
  workspaceId: z.string().uuid().optional(),
});

const batchSchema = z.object({
  events: z.array(eventSchema).min(1).max(50),
});

export async function POST(req: NextRequest) {
  // 限流：单 IP 每分钟最多 120 次（批量上报场景放宽，仍拦异常洪泛）
  const limited = await checkRateLimit(req, "events", { windowMs: 60_000, max: 120 });
  if (limited) return limited;

  try {
    const body = await req.json();
    const validated = batchSchema.parse(body);

    // 已认证用户从 token 解析 userId；未认证事件允许匿名（userId=null）
    const payload = await authenticate(req);
    const userId = payload?.sub ?? null;
    // 优先从 token 取 wid；事件自带 workspaceId 用于跨工作区事件（workspace_switch）
    const tokenWid = payload?.wid ?? null;

    // 过滤白名单外事件，避免无效写入
    const validEvents = validated.events.filter((e) => ALLOWED_EVENT_NAMES.has(e.name));
    if (validEvents.length === 0) {
      return NextResponse.json({ code: 200, data: { accepted: 0 } });
    }

    // 批量写入：用 provision 逃生口（事件写入不依赖 RLS，显式 workspace_id）
    // 已认证时注入 user_id GUC，便于未来按用户审计
    const accepted = await runWithAuthOp(
      "provision",
      async (tx) => {
        const rows = validEvents.map((e) => ({
          id: randomUUID(),
          userId,
          workspaceId: e.workspaceId ?? tokenWid ?? null,
          name: e.name,
          props: e.props as object,
          sessionId: e.sessionId ?? null,
        }));
        await tx.analyticsEvent.createMany({ data: rows });
        return rows.length;
      },
      userId ?? undefined,
    );

    return NextResponse.json({ code: 200, data: { accepted } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: "Validation error", errors: error.errors },
        { status: 400 },
      );
    }
    console.error("[POST events] error:", error);
    return NextResponse.json({ code: 500, message: "Internal server error" }, { status: 500 });
  }
}

/**
 * GET /api/v1/events — 调试用：列出当前用户最近事件（仅 dev 环境）。
 * 生产环境分析数据通过 /workspaces/:wid/analytics/overview 读取。
 */
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ code: 403, message: "Forbidden in production" }, { status: 403 });
  }
  const payload = await authenticate(req);
  if (!payload) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

  try {
    const events = await withGuc({ user_id: payload.sub }, (tx) =>
      tx.analyticsEvent.findMany({
        where: { userId: payload.sub },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    );
    return NextResponse.json({ code: 200, data: events });
  } catch (error) {
    console.error("[GET events] error:", error);
    return NextResponse.json({ code: 500, message: "Internal server error" }, { status: 500 });
  }
}
