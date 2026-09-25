// GET  /api/v1/ai/agents?wid=xxx — 获取当前工作区的 Agent 列表
// POST /api/v1/ai/agents — 创建 Agent
//      Body: { wid, name, role, capabilities, systemPrompt, model, enabled?, metadata? }
//
// 认证模式：getUserId → getWorkspaceContext → runWithWorkspace（RLS 事务）
// 安全：通过 workspaceId 过滤确保用户只能访问当前工作区的 Agent
// 约定：{ code, data, message }；capabilities/metadata 用 as Prisma.InputJsonValue 转换。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";

/** 合法角色枚举（与 schema 注释保持一致） */
const ROLE_VALUES = ["task_breaker", "doc_writer", "follow_upper", "analyst"] as const;

/** 合法模型枚举（与 deepseek.ts 保持一致） */
const MODEL_VALUES = ["deepseek-chat", "deepseek-reasoner"] as const;

/** GET 查询参数 schema */
const listQuerySchema = z.object({
  wid: z.string().uuid(),
  enabled: z.enum(["true", "false"]).optional(),
});

/** POST 创建 Agent schema */
const createSchema = z.object({
  wid: z.string().uuid(),
  name: z.string().min(1).max(100),
  role: z.enum(ROLE_VALUES),
  capabilities: z.array(z.string().min(1).max(50)).max(20).default([]),
  systemPrompt: z.string().min(1).max(8000),
  model: z.enum(MODEL_VALUES).default("deepseek-chat"),
  enabled: z.boolean().default(true),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * GET /api/v1/ai/agents?wid=xxx[&enabled=true]
 *
 * 返回当前工作区的 Agent 列表（按创建时间升序）。
 * enabled 参数可选过滤启用/禁用状态。
 */
export async function GET(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：60s 内最多 60 次
  const limited = await checkRateLimit(req, "ai-agents-list", {
    windowMs: 60_000,
    max: 60,
  });
  if (limited) return limited;

  // 2) 查询参数校验
  const url = new URL(req.url);
  const parsed = listQuerySchema.safeParse({
    wid: url.searchParams.get("wid") ?? undefined,
    enabled: url.searchParams.get("enabled") ?? undefined,
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
  const { wid, enabled } = parsed.data;

  // 3) 工作区成员资格认证 + 查询
  try {
    const ctx = await getWorkspaceContext(req, wid);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    const agents = await runWithWorkspace(
      wid,
      (tx) =>
        tx.aiAgent.findMany({
          where: {
            workspaceId: wid,
            ...(enabled === "true"
              ? { enabled: true }
              : enabled === "false"
                ? { enabled: false }
                : {}),
          },
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
          orderBy: { createdAt: "asc" },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 0, data: agents, message: "OK" });
  } catch (error) {
    console.error("[GET ai/agents] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * POST /api/v1/ai/agents — 创建 Agent
 *
 * 在指定工作区创建一个新 Agent。
 */
export async function POST(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：60s 内最多 20 次
  const limited = await checkRateLimit(req, "ai-agents-create", {
    windowMs: 60_000,
    max: 20,
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

    const agent = await runWithWorkspace(
      body.wid,
      (tx) =>
        tx.aiAgent.create({
          data: {
            workspaceId: body.wid,
            name: body.name,
            role: body.role,
            capabilities: body.capabilities as Prisma.InputJsonValue,
            systemPrompt: body.systemPrompt,
            model: body.model,
            enabled: body.enabled,
            metadata: body.metadata as Prisma.InputJsonValue | undefined,
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 0, data: agent, message: "OK" }, { status: 201 });
  } catch (error) {
    console.error("[POST ai/agents] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
