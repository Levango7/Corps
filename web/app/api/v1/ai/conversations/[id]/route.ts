// GET    /api/v1/ai/conversations/[id] — 获取对话详情 + 消息列表
// DELETE /api/v1/ai/conversations/[id] — 删除对话（级联删除消息）
//
// 认证模式：getUserId → getWorkspaceContext → runWithWorkspace（RLS 事务）
// 安全：通过 workspaceId + userId 双重过滤确保用户只能访问自己的对话

import { NextRequest, NextResponse } from "next/server";
import {
  getUserId,
  unauthorizedResponse,
} from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";

/** 从 URL 路径提取对话 ID，并校验是否为合法 UUID */
function extractId(req: NextRequest): string | null {
  const segments = new URL(req.url).pathname.split("/");
  const id = segments[segments.length - 1];
  // P2-3: 校验 UUID 格式，非法 ID 直接返回 null（400）
  if (
    !id ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    return null;
  }
  return id;
}

/**
 * GET /api/v1/ai/conversations/[id]?wid=xxx
 *
 * 返回对话详情 + 所有消息（按创建时间升序）。
 */
export async function GET(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：60s 内最多 20 次
  const limited = await checkRateLimit(req, "ai-conversation-get", { windowMs: 60_000, max: 20 });
  if (limited) return limited;

  // 2) 参数提取
  const id = extractId(req);
  const wid = new URL(req.url).searchParams.get("wid");
  if (!id || !wid) {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidParams"), data: null },
      { status: 400 },
    );
  }

  // 3) 工作区成员资格认证 + 查询
  try {
    const ctx = await getWorkspaceContext(req, wid);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    // 双重过滤：workspaceId + userId 确保只能访问自己的对话
    const conversation = await runWithWorkspace(
      wid,
      (tx) =>
        tx.aiConversation.findUnique({
          where: { id },
          include: {
            messages: {
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                role: true,
                content: true,
                metadata: true,
                createdAt: true,
              },
            },
          },
        }),
      ctx.payload.sub,
    );

    // 二次校验：对话不属于该用户或不在该工作区
    if (!conversation || conversation.workspaceId !== wid || conversation.userId !== ctx.payload.sub) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "itemNotFound"), data: null },
        { status: 404 },
      );
    }

    return NextResponse.json({ code: 200, data: conversation });
  } catch (error) {
    console.error("[ai-conversation] GET 失败:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/v1/ai/conversations/[id]?wid=xxx
 *
 * 删除对话（级联删除所有消息）。
 */
export async function DELETE(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：60s 内最多 10 次
  const limited = await checkRateLimit(req, "ai-conversation-delete", { windowMs: 60_000, max: 10 });
  if (limited) return limited;

  // 2) 参数提取
  const id = extractId(req);
  const wid = new URL(req.url).searchParams.get("wid");
  if (!id || !wid) {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidParams"), data: null },
      { status: 400 },
    );
  }

  // 3) 工作区成员资格认证 + 删除
  try {
    const ctx = await getWorkspaceContext(req, wid);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    // P2-4: 原子化删除——单步 deleteMany 带 userId + workspaceId 条件，
    // 避免先查询再删除的并发竞态（中间可能有并发删除）
    const result = await runWithWorkspace(
      wid,
      (tx) =>
        tx.aiConversation.deleteMany({
          where: { id, workspaceId: wid, userId: ctx.payload.sub },
        }),
      ctx.payload.sub,
    );

    if (result.count === 0) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "itemNotFound"), data: null },
        { status: 404 },
      );
    }

    return NextResponse.json({ code: 200, data: null });
  } catch (error) {
    console.error("[ai-conversation] DELETE 失败:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}