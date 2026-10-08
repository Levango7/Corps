// GET /api/v1/ai/usage/logs — AI 使用日志（分页）
// 查询参数：workspaceId（必填）、capability（可选）、limit（默认 50，最大 200）、offset（默认 0）
// 返回：{ logs: AiUsageLog[], total: number }

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import { getWorkspaceContextV2, runWithWorkspace } from "@/lib/auth";
import { authFailure } from "@/lib/auth-response";

const querySchema = z.object({
  workspaceId: z.string().uuid(),
  capability: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  const rateLimited = await checkRateLimit(req, "ai-usage-logs", {
    windowMs: 60_000,
    max: 60,
  });
  if (rateLimited) return rateLimited;

  // 解析查询参数
  const url = new URL(req.url);
  const params = Object.fromEntries(url.searchParams.entries());
  let parsed: z.infer<typeof querySchema>;
  try {
    parsed = querySchema.parse(params);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        {
          code: 400,
          message: e.issues[0]?.message ?? apiMsg(req, "validationFailed"),
          data: null,
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidParams"), data: null },
      { status: 400 },
    );
  }

  // 工作区归属校验（P0-3：防止越权访问其他工作区）
  const ctx = await getWorkspaceContextV2(req, parsed.workspaceId);
  if (!ctx)
    // V2 契约上从不返回 null（见 lib/auth.ts 的 WorkspaceContextV2 文档：
    // "调用方遇到 null 应按 500 处理（fail-closed，不可当作 401 重试）"）。
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  if (!ctx.ok) return authFailure(ctx, req);

  try {
    // 普通用户只能看自己的日志；owner/admin 可看全部
    const isManager = ctx.member.role === "owner" || ctx.member.role === "admin";

    const where: { workspaceId: string; capability?: string; userId?: string } = {
      workspaceId: parsed.workspaceId,
    };
    if (!isManager) where.userId = userId;
    if (parsed.capability) where.capability = parsed.capability;

    const [logs, total] = await runWithWorkspace(
      parsed.workspaceId,
      (tx) =>
        Promise.all([
          tx.aiUsageLog.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: parsed.limit,
            skip: parsed.offset,
          }),
          tx.aiUsageLog.count({ where }),
        ]),
      userId,
    );

    return NextResponse.json({ code: 0, data: { logs, total }, message: "OK" });
  } catch (error) {
    console.error("[ai-usage/logs] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
