// PATCH  /api/v1/ai/agents/[id]?wid=xxx — 更新 Agent
//        Body: { name?, role?, capabilities?, systemPrompt?, model?, enabled?, metadata? }
// DELETE /api/v1/ai/agents/[id]?wid=xxx — 删除 Agent
//
// 认证模式：getUserId → getWorkspaceContext → runWithWorkspace（RLS 事务）
// 安全：通过 workspaceId + id 双重过滤确保用户只能操作当前工作区的 Agent
// 约定：{ code, data, message }；capabilities/metadata 用 as Prisma.InputJsonValue 转换。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import {
  getUserId,
  unauthorizedResponse,
} from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";

/** 合法角色枚举（与 schema 注释保持一致） */
const ROLE_VALUES = [
  "task_breaker",
  "doc_writer",
  "follow_upper",
  "analyst",
] as const;

/** 合法模型枚举（与 deepseek.ts 保持一致） */
const MODEL_VALUES = ["deepseek-chat", "deepseek-reasoner"] as const;

/** PATCH 更新 Agent schema（所有字段可选） */
const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.enum(ROLE_VALUES).optional(),
  capabilities: z.array(z.string().min(1).max(50)).max(20).optional(),
  systemPrompt: z.string().min(1).max(8000).optional(),
  model: z.enum(MODEL_VALUES).optional(),
  enabled: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

/** UUID 正则校验 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 从 URL 路径提取 Agent ID，并校验是否为合法 UUID */
function extractId(req: NextRequest): string | null {
  const segments = new URL(req.url).pathname.split("/");
  const id = segments[segments.length - 1];
  if (!id || !UUID_RE.test(id)) return null;
  return id;
}

/**
 * PATCH /api/v1/ai/agents/[id]?wid=xxx
 *
 * 更新指定 Agent 的部分字段（所有字段可选，仅更新传入字段）。
 */
export async function PATCH(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：60s 内最多 20 次
  const limited = await checkRateLimit(req, "ai-agents-update", {
    windowMs: 60_000,
    max: 20,
  });
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

  // 3) body 校验
  let body: z.infer<typeof updateSchema>;
  try {
    body = updateSchema.parse(await req.json());
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

  // 4) 工作区成员资格认证 + 更新
  try {
    const ctx = await getWorkspaceContext(req, wid);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    // 构建更新数据（仅包含传入字段）
    const data: Prisma.AiAgentUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.role !== undefined) data.role = body.role;
    if (body.capabilities !== undefined) {
      data.capabilities = body.capabilities as Prisma.InputJsonValue;
    }
    if (body.systemPrompt !== undefined) data.systemPrompt = body.systemPrompt;
    if (body.model !== undefined) data.model = body.model;
    if (body.enabled !== undefined) data.enabled = body.enabled;
    if (body.metadata !== undefined) {
      data.metadata = body.metadata as Prisma.InputJsonValue;
    }

    // 原子化更新：带 workspaceId 条件，避免先查询再更新的并发竞态
    const result = await runWithWorkspace(
      wid,
      (tx) =>
        tx.aiAgent.updateMany({
          where: { id, workspaceId: wid },
          data,
        }),
      ctx.payload.sub,
    );

    if (result.count === 0) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "itemNotFound"), data: null },
        { status: 404 },
      );
    }

    // 查询更新后的 Agent 返回给前端
    const updated = await runWithWorkspace(
      wid,
      (tx) =>
        tx.aiAgent.findUnique({
          where: { id },
          select: {
            id: true,
            name: true,
            role: true,
            capabilities: true,
            systemPrompt: true,
            model: true,
            enabled: true,
            metadata: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 0, data: updated, message: "OK" });
  } catch (error) {
    console.error("[PATCH ai/agents/[id]] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/v1/ai/agents/[id]?wid=xxx
 *
 * 删除指定 Agent（级联删除相关消息）。
 */
export async function DELETE(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：60s 内最多 10 次
  const limited = await checkRateLimit(req, "ai-agents-delete", {
    windowMs: 60_000,
    max: 10,
  });
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

    // 原子化删除：带 workspaceId 条件，避免先查询再删除的并发竞态
    const result = await runWithWorkspace(
      wid,
      (tx) =>
        tx.aiAgent.deleteMany({
          where: { id, workspaceId: wid },
        }),
      ctx.payload.sub,
    );

    if (result.count === 0) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "itemNotFound"), data: null },
        { status: 404 },
      );
    }

    return NextResponse.json({ code: 0, data: null, message: "OK" });
  } catch (error) {
    console.error("[DELETE ai/agents/[id]] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}