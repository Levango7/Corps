// GET /api/v1/ai/push/records — 获取推送记录列表
//
// 查询参数：
//   wid=<uuid>         必填，工作区 ID
//   unread=true        可选，仅返回未读记录
//   capability=<str>   可选，按能力过滤
//   cursor=<uuid>      可选，游标分页（上一页最后一条 id）
//   limit=<number>     可选，每页条数（默认 20，最大 50）

import { NextRequest, NextResponse } from "next/server";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";

/** 默认每页条数 */
const DEFAULT_LIMIT = 20;
/** 最大每页条数 */
const MAX_LIMIT = 50;

/** GET /api/v1/ai/push/records — 推送记录列表（支持未读过滤 + 游标分页） */
export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  const limited = await checkRateLimit(req, "ai-push-records-list", {
    windowMs: 60_000,
    max: 30,
  });
  if (limited) return limited;

  const url = new URL(req.url);
  const wid = url.searchParams.get("wid");
  if (!wid) {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidParams"), data: null },
      { status: 400 },
    );
  }

  const unread = url.searchParams.get("unread") === "true";
  const capability = url.searchParams.get("capability") ?? undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limitParam = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(1, limitParam), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  try {
    const records = await runWithWorkspace(
      wid,
      (tx) =>
        tx.aiPushRecord.findMany({
          where: {
            workspaceId: wid,
            userId: ctx.payload.sub,
            ...(unread ? { read: false } : {}),
            ...(capability ? { capability } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: limit + 1, // 多取 1 条判断是否有下一页
          ...(cursor
            ? {
                cursor: { id: cursor },
                skip: 1, // 跳过 cursor 自身
              }
            : {}),
        }),
      ctx.payload.sub,
    );

    const hasNext = records.length > limit;
    const items = hasNext ? records.slice(0, limit) : records;
    const nextCursor = hasNext ? items[items.length - 1]?.id : null;

    return NextResponse.json({
      code: 200,
      data: { items, nextCursor, hasMore: hasNext },
    });
  } catch (error) {
    console.error("[GET ai/push/records] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}
