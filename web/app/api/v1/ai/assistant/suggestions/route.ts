// GET /api/v1/ai/assistant/suggestions — AI 助理建议能力列表
//
// 输入：?phase=in_progress（query param，默认 in_progress）
// 流程：
//   1. 认证
//   2. 按 phase 返回建议能力列表（getSuggestionsForPhase）
//
// 用途：前端在任务详情页根据当前阶段展示 AI 助理可用的能力入口。
//
// 来源：P2 后端任务 318（AI 助理编排引擎 + 对话 API）

import { NextRequest, NextResponse } from "next/server";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import {
  getSuggestionsForPhase,
  type TaskPhase,
} from "@/lib/ai/assistant/orchestrator";

/** 合法阶段集合（与 orchestrator.ts TaskPhase 保持一致） */
const VALID_PHASES = new Set<TaskPhase>([
  "created",
  "in_progress",
  "review",
  "completed",
  "blocked",
]);

/** GET /api/v1/ai/assistant/suggestions — 按任务阶段返回建议能力 */
export async function GET(req: NextRequest) {
  // 1) 认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // P1-fix: 速率限制——每分钟 60 次，防止前端轮询/滥用
  const limited = await checkRateLimit(req, "ai-assistant-suggestions", {
    windowMs: 60_000,
    max: 60,
  });
  if (limited) return limited;

  // 2) 解析 phase query param（默认 in_progress，非法值降级为 in_progress）
  const rawPhase = req.nextUrl.searchParams.get("phase") ?? "in_progress";
  const phase: TaskPhase = VALID_PHASES.has(rawPhase as TaskPhase)
    ? (rawPhase as TaskPhase)
    : "in_progress";

  // 3) 返回建议能力列表
  const suggestions = getSuggestionsForPhase(phase);

  return NextResponse.json({ code: 0, data: { phase, suggestions } });
}