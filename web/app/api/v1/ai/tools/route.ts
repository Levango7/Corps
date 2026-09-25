// GET /api/v1/ai/tools — 列出所有已注册 AI 工具
// 输出：{ code: 0, data: { tools: [{ name, description, parameters }] }, message }
//
// 返回工具元信息（name + description + JSON Schema parameters）供前端渲染
// 工具面板或供 AI 模型构造工具调用。不暴露 execute 回调（不可序列化）。

import { NextRequest, NextResponse } from "next/server";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import { toolRegistry } from "@/lib/ai/tools/registry";
// 触发内置工具自注册（模块 import 时 registerBuiltinTools() 执行）
import "@/lib/ai/tools/builtins";

export async function GET(req: NextRequest) {
  // 1) 认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) 限流：60s 内最多 60 次（列表接口轻量，配额放宽）
  const limited = await checkRateLimit(req, "ai-tools-list", {
    windowMs: 60_000,
    max: 60,
  });
  if (limited) return limited;

  // 3) 返回工具元信息（剥离 execute 回调，仅保留可序列化字段）
  const tools = toolRegistry.list().map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }));

  return NextResponse.json({
    code: 0,
    data: { tools },
    message: apiMsg(req, "ok"),
  });
}
