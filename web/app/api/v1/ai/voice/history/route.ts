// GET /api/v1/ai/voice/history?wid=xxx[&intent=...][&page=1][&pageSize=20]
// 获取当前用户的语音命令历史（支持分页 + intent 过滤）
//
// 认证模式：getUserId → getWorkspaceContext → runWithWorkspace（RLS 事务）
// 安全：通过 workspaceId + userId 过滤确保用户只能访问自己的命令历史
// 约定：{ code, data, message }；data = { items, total, page, pageSize }

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";

/** 合法意图类型枚举（与 voice-intent-parse.ts 对齐） */
const INTENT_VALUES = [
  "create_task",
  "query_schedule",
  "send_message",
  "generate_report",
  "search_knowledge",
  "open_page",
  "unknown",
] as const;

/** GET 查询参数 schema */
const listQuerySchema = z.object({
  wid: z.string().uuid(),
  intent: z.enum(INTENT_VALUES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** 历史记录项（返回给前端） */
interface HistoryItem {
  id: string;
  transcript: string;
  intent: string | null;
  parameters: unknown;
  executed: boolean;
  result: unknown;
  createdAt: string;
}

/** 分页结果 */
interface PaginatedHistory {
  items: HistoryItem[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * GET /api/v1/ai/voice/history?wid=xxx[&intent=...][&page=1][&pageSize=20]
 *
 * 返回当前用户在指定工作区的语音命令历史（按创建时间降序）。
 */
export async function GET(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：60s 内最多 60 次
  const limited = await checkRateLimit(req, "ai-voice-history", {
    windowMs: 60_000,
    max: 60,
  });
  if (limited) return limited;

  // 2) 查询参数校验
  const url = new URL(req.url);
  const parsed = listQuerySchema.safeParse({
    wid: url.searchParams.get("wid") ?? undefined,
    intent: url.searchParams.get("intent") ?? undefined,
    page: url.searchParams.get("page") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      {
        code: 400,
        message: parsed.error.issues[0]?.message ?? apiMsg(req, "invalidParams"),
        data: null,
      },
      { status: 400 },
    );
  }
  const { wid, intent, page, pageSize } = parsed.data;

  // 3) 工作区成员资格认证 + 查询
  try {
    const ctx = await getWorkspaceContext(req, wid);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    // 并行查询总数 + 当前页数据
    const [items, total] = await runWithWorkspace(
      wid,
      async (tx) => {
        const where = {
          workspaceId: wid,
          userId: ctx.payload.sub,
          ...(intent ? { intent } : {}),
        };
        const [rows, count] = await Promise.all([
          tx.aiVoiceCommand.findMany({
            where,
            select: {
              id: true,
              transcript: true,
              intent: true,
              parameters: true,
              executed: true,
              result: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
          tx.aiVoiceCommand.count({ where }),
        ]);
        return [rows, count] as const;
      },
      ctx.payload.sub,
    );

    const data: PaginatedHistory = {
      items: items.map((r) => ({
        id: r.id,
        transcript: r.transcript,
        intent: r.intent,
        parameters: r.parameters,
        executed: r.executed,
        result: r.result,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };

    return NextResponse.json({ code: 200, data, message: "OK" });
  } catch (error) {
    console.error("[GET ai/voice/history] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
