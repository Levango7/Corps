import { NextRequest, NextResponse } from "next/server";
import { authenticate, runWithAuthOp, withGuc } from "@/lib/auth";
import { z } from "zod";
import { randomUUID } from "crypto";
import { checkRateLimit } from "@/lib/rate-limit";
import { ALLOWED_EVENT_NAMES } from "@/lib/analytics-whitelist";

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

// 白名单已抽至 web/lib/analytics-whitelist.ts 单一事实源（FUNNEL-METRICS §4.3）。
// 此处直接 import ALLOWED_EVENT_NAMES，避免双源漂移。

const eventSchema = z.object({
  name: z.string().max(64),
  props: z.record(z.unknown()).default({}),
  sessionId: z.string().max(64).optional(),
  workspaceId: z.string().uuid().optional(),
});

const batchSchema = z.object({
  events: z.array(eventSchema).min(1).max(50),
});

// 单条事件 props 的序列化体积上限：超出视为异常/脏数据，整条丢弃
const MAX_PROPS_BYTES = 4096;

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
    // 优先从 token 取 wid（服务端签发，可信）；事件自带 workspaceId 仅作候选
    const tokenWid = payload?.wid ?? null;

    // 过滤白名单外事件 + props 超限事件，避免无效写入
    const validEvents = validated.events.filter(
      (e) =>
        ALLOWED_EVENT_NAMES.has(e.name) && JSON.stringify(e.props ?? {}).length <= MAX_PROPS_BYTES,
    );
    if (validEvents.length === 0) {
      return NextResponse.json({ code: 200, data: { accepted: 0 } });
    }

    // 批量写入：用 provision 逃生口（事件写入不依赖 RLS，显式 workspace_id）
    // 已认证时注入 user_id GUC，便于未来按用户审计
    const accepted = await runWithAuthOp(
      "provision",
      async (tx) => {
        // 客户端自带 workspaceId 只在本人确为该工作区成员时采信，
        // 防止伪造 wid 污染其他工作区的分析数据；未认证事件不带 wid
        const claimedWids = [
          ...new Set(validEvents.map((e) => e.workspaceId).filter((v): v is string => Boolean(v))),
        ];
        const allowedWids = new Set<string>();
        if (userId && claimedWids.length > 0) {
          const memberships = await tx.member.findMany({
            where: { userId, workspaceId: { in: claimedWids } },
            select: { workspaceId: true },
          });
          for (const m of memberships) allowedWids.add(m.workspaceId);
        }

        const rows = validEvents.map((e) => ({
          id: randomUUID(),
          userId,
          workspaceId:
            (e.workspaceId && allowedWids.has(e.workspaceId) ? e.workspaceId : tokenWid) ?? null,
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
