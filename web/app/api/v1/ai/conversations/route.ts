// GET  /api/v1/ai/conversations?wid=xxx — 列出当前用户在工作区的 AI 对话
// POST /api/v1/ai/conversations — 创建新对话 { wid, title, scopes? }
//
// 认证模式：getUserId → getWorkspaceContext → runWithWorkspace（RLS 事务）

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";

/** 列表查询参数 */
const listSchema = z.object({
  wid: z.string().uuid(),
});

/** 创建请求体 */
const createSchema = z.object({
  wid: z.string().uuid(),
  title: z.string().min(1).max(200),
  scopes: z.array(z.string()).optional(),
});

/**
 * GET /api/v1/ai/conversations?wid=xxx
 *
 * 列出当前用户在指定工作区的 AI 对话（按更新时间倒序，最多 50 条）。
 */
export async function GET(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // P2-1: 速率限制 — 列表查询 20/min
  const limited = await checkRateLimit(req, "ai-conversations-list", {
    windowMs: 60_000,
    max: 20,
  });
  if (limited) return limited;

  // 2) 查询参数校验
  const url = new URL(req.url);
  const parsed = listSchema.safeParse({ wid: url.searchParams.get("wid") });
  if (!parsed.success) {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidParams"), data: null },
      { status: 400 },
    );
  }
  const { wid } = parsed.data;

  // 3) 工作区成员资格认证 + 查询
  try {
    const ctx = await getWorkspaceContext(req, wid);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    const conversations = await runWithWorkspace(
      wid,
      (tx) =>
        tx.aiConversation.findMany({
          where: { workspaceId: wid, userId: ctx.payload.sub },
          orderBy: { updatedAt: "desc" },
          take: 50,
          select: {
            id: true,
            title: true,
            scopes: true,
            createdAt: true,
            updatedAt: true,
            _count: { select: { messages: true } },
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 200, data: conversations });
  } catch (error) {
    console.error("[ai-conversations] GET 失败:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}

/**
 * POST /api/v1/ai/conversations
 *
 * 创建新 AI 对话。title 默认可由前端取用户首问前 50 字符。
 */
export async function POST(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // P2-1: 速率限制 — 创建对话 10/min
  const limited = await checkRateLimit(req, "ai-conversations-create", {
    windowMs: 60_000,
    max: 10,
  });
  if (limited) return limited;

  // 2) body 校验
  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json());
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
      { code: 400, message: apiMsg(req, "invalidBody"), data: null },
      { status: 400 },
    );
  }

  // 3) 工作区成员资格认证 + 创建
  try {
    const ctx = await getWorkspaceContext(req, body.wid);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    const conversation = await runWithWorkspace(
      body.wid,
      (tx) =>
        tx.aiConversation.create({
          data: {
            workspaceId: body.wid,
            userId: ctx.payload.sub,
            title: body.title,
            scopes: body.scopes ?? [],
          },
          select: {
            id: true,
            title: true,
            scopes: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
      ctx.payload.sub,
    );

    // P2-2: status 200 与 code 字段一致（其他 API 均用 code 字段区分状态）
    return NextResponse.json({ code: 200, data: conversation }, { status: 200 });
  } catch (error) {
    console.error("[ai-conversations] POST 失败:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}
