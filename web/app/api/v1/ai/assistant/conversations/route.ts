// GET /api/v1/ai/assistant/conversations — AI 助理对话历史
//
// 两种用法：
//   1. GET ?wid=xxx            → 返回用户在该工作区的历史对话列表（最近 20 条）
//   2. GET ?wid=xxx&id=convId  → 返回指定对话的消息列表（切换对话时加载历史消息）
//
// 流程：
//   1. 认证 + 速率限制
//   2. id 存在 → 查询单对话消息（按 conversation.userId + workspaceId 守卫）
//      id 缺失 → 查询对话列表（按 userId + workspaceId 过滤，等价 RLS）
//
// 来源：M1-B 前端任务 325（AI 助理前端深化 — 对话历史展示）

import { NextRequest, NextResponse } from "next/server";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/** GET /api/v1/ai/assistant/conversations — 对话历史列表 / 单对话消息 */
export async function GET(req: NextRequest) {
  // 1) 认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) 速率限制：每分钟 30 次
  const limited = await checkRateLimit(req, "ai-assistant-conversations", {
    windowMs: 60_000,
    max: 30,
  });
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const wid = searchParams.get("wid");
  const convId = searchParams.get("id");

  // wid 必填
  if (!wid) {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidBody"), data: null },
      { status: 400 },
    );
  }

  try {
    // 模式一：单对话消息列表（id 存在时，用于切换对话加载历史）
    if (convId) {
      const messages = await prisma.assistantMessage.findMany({
        where: {
          conversationId: convId,
          conversation: { userId, workspaceId: wid },
        },
        orderBy: { createdAt: "asc" },
        select: {
          role: true,
          content: true,
          capabilityUsed: true,
          createdAt: true,
        },
      });

      // 仅保留 user/assistant 消息（防御性过滤，与 chat route 一致）
      const filtered = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
          capability: m.capabilityUsed ?? undefined,
        }));

      return NextResponse.json({ code: 0, data: { messages: filtered } });
    }

    // 模式二：对话列表（id 缺失时，返回最近 20 条对话）
    const conversations = await prisma.assistantConversation.findMany({
      where: { userId, workspaceId: wid },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { messages: true } },
      },
    });

    return NextResponse.json({ code: 0, data: { conversations } });
  } catch (error) {
    logger.warn("[GET ai/assistant/conversations] error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}
