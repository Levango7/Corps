// GET /api/v1/ai/agents/[id]/messages?wid=xxx[&from=agentId][&to=agentId][&type=xxx][&take=50][&skip=0]
//
// 获取 Agent 消息历史（支持按 from/to/type 过滤 + 分页）。
//
// 认证模式：getUserId → getWorkspaceContext → runWithWorkspace（RLS 事务）
// 安全：通过 workspaceId + id 双重过滤确保用户只能访问当前工作区 Agent 的消息
// 约定：{ code, data, message }

import { NextRequest, NextResponse } from "next/server";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";

/** UUID 正则校验 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 合法消息类型枚举（与 schema 注释保持一致） */
const VALID_TYPES = new Set(["request", "response", "notification", "handoff"]);

/** 从 URL 路径提取 Agent ID（倒数第二段，因为最后一段是 messages） */
function extractAgentId(req: NextRequest): string | null {
  const segments = new URL(req.url).pathname.split("/");
  // 路径形如 /api/v1/ai/agents/<id>/messages
  // segments: ['', 'api', 'v1', 'ai', 'agents', '<id>', 'messages']
  const id = segments[segments.length - 2];
  if (!id || !UUID_RE.test(id)) return null;
  return id;
}

/**
 * GET /api/v1/ai/agents/[id]/messages
 *
 * 查询参数：
 *  - wid: 工作区 ID（必填）
 *  - from: 发送方 Agent ID（可选，过滤 fromAgentId）
 *  - to: 接收方 Agent ID（可选，过滤 toAgentId；传 "null" 表示广播消息）
 *  - type: 消息类型（可选，过滤 type）
 *  - take: 每页数量（可选，默认 50，最大 100）
 *  - skip: 跳过数量（可选，默认 0）
 *
 * 返回：{ items, total, skip, take }
 */
export async function GET(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：60s 内最多 60 次
  const limited = await checkRateLimit(req, "ai-agent-messages-list", {
    windowMs: 60_000,
    max: 60,
  });
  if (limited) return limited;

  // 2) 参数提取
  const agentId = extractAgentId(req);
  const url = new URL(req.url);
  const wid = url.searchParams.get("wid");
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;
  const type = url.searchParams.get("type") ?? undefined;
  const takeRaw = url.searchParams.get("take");
  const skipRaw = url.searchParams.get("skip");

  if (!agentId || !wid) {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidParams"), data: null },
      { status: 400 },
    );
  }

  // 校验 from/to 为合法 UUID（若传入）
  if (from && !UUID_RE.test(from)) {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidParams"), data: null },
      { status: 400 },
    );
  }
  if (to && to !== "null" && !UUID_RE.test(to)) {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidParams"), data: null },
      { status: 400 },
    );
  }
  // 校验 type 为合法枚举（若传入）
  if (type && !VALID_TYPES.has(type)) {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidParams"), data: null },
      { status: 400 },
    );
  }

  // 分页参数解析
  const take = takeRaw ? Math.min(Math.max(parseInt(takeRaw, 10) || 50, 1), 100) : 50;
  const skip = skipRaw ? Math.max(parseInt(skipRaw, 10) || 0, 0) : 0;

  // 3) 工作区成员资格认证 + 查询
  try {
    const ctx = await getWorkspaceContext(req, wid);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    // 构建查询条件：当前 Agent 参与的消息（作为发送方或接收方）
    // + 可选的 from/to/type 过滤
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      workspaceId: wid,
      OR: [{ fromAgentId: agentId }, { toAgentId: agentId }],
    };
    if (from) where.fromAgentId = from;
    if (to === "null") {
      where.toAgentId = null;
    } else if (to) {
      where.toAgentId = to;
    }
    if (type) where.type = type;

    const [items, total] = await runWithWorkspace(
      wid,
      async (tx) => {
        const [rows, count] = await Promise.all([
          tx.aiAgentMessage.findMany({
            where,
            select: {
              id: true,
              fromAgentId: true,
              toAgentId: true,
              content: true,
              type: true,
              metadata: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
            skip,
            take,
          }),
          tx.aiAgentMessage.count({ where }),
        ]);
        return [rows, count] as const;
      },
      ctx.payload.sub,
    );

    return NextResponse.json({
      code: 0,
      data: { items, total, skip, take },
      message: "OK",
    });
  } catch (error) {
    console.error("[GET ai/agents/[id]/messages] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
