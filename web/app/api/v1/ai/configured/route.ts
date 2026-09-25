// GET /api/v1/ai/configured — 检查 AI 服务是否已配置
// 输出：{ code: 200, message: "ok", data: { configured: boolean } }
//
// 供客户端组件（如任务详情页"AI 拆分子任务"按钮）在挂载时探测 AI 是否可用，
// 未配置时按钮置灰，避免点击后才收到 503。
//
// 仅返回布尔值，不泄露密钥；仍要求认证以避免匿名探测。

import { NextRequest, NextResponse } from "next/server";
import { getUserId, unauthorizedResponse, isAiConfigured } from "@/lib/ai/shared";
import { apiMsg } from "@/lib/api-messages";

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // isAiConfigured 检查 DEEPSEEK_API_KEY 或 OPENAI_API_KEY 是否存在，无 IO
  const configured = isAiConfigured();
  return NextResponse.json(
    { code: 200, message: apiMsg(req, "ok"), data: { configured } },
    { status: 200 },
  );
}
