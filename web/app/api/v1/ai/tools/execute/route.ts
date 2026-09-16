// POST /api/v1/ai/tools/execute — 执行指定 AI 工具
// 输入：{ toolName, args, workspaceId }
// 输出：{ code: 0, data: { result: ToolResult }, message }
//
// AI 安全约束：工具执行结果返回给 AI 供参考，不自动执行有副作用的操作。
// create_task 等有副作用的工具在 AI 编排场景应由人工确认后才调用此端点。
//
// 执行流程：
//  1) 认证 + 限流
//  2) zod 校验请求体
//  3) getWorkspaceContext 验证工作区成员资格（wid 守卫 + RLS）
//  4) runWithWorkspace 在 RLS 事务内执行工具，注入 tx 上下文
//  5) 返回 ToolResult（success / data / error）

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { checkRateLimit } from "@/lib/rate-limit";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";
import { toolRegistry } from "@/lib/ai/tools/registry";
// 触发内置工具自注册
import "@/lib/ai/tools/builtins";

const schema = z.object({
  toolName: z.string().min(1).max(100),
  args: z.record(z.unknown()).default({}),
  workspaceId: z.string().uuid(),
});

export async function POST(req: NextRequest) {
  // 1) 认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) 限流：60s 内最多 30 次（工具执行可能触发 DB 写入，配额适中）
  const limited = await checkRateLimit(req, "ai-tools-execute", {
    windowMs: 60_000,
    max: 30,
  });
  if (limited) return limited;

  // 3) body 校验
  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
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

  // 4) 工具存在性预检（在打开事务前短路，避免无效 DB 连接开销）
  const tool = toolRegistry.get(body.toolName);
  if (!tool) {
    return NextResponse.json(
      // P2-fix: 硬编码中文 → apiMsg 双语
      { code: 404, message: apiMsg(req, "toolNotFound"), data: null },
      { status: 404 },
    );
  }

  // 5) 工作区成员资格认证（wid 守卫 + RLS）
  const ctx = await getWorkspaceContext(req, body.workspaceId);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  // 6) 在 RLS 事务内执行工具
  try {
    const result = await runWithWorkspace(
      body.workspaceId,
      (tx) =>
        toolRegistry.execute(body.toolName, body.args, {
          workspaceId: body.workspaceId,
          userId: ctx.payload.sub,
          tx,
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({
      code: 0,
      data: { result },
      message: apiMsg(req, "ok"),
    });
  } catch (error) {
    console.error(`[ai/tools/execute] 工具 ${body.toolName} 执行失败:`, error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}