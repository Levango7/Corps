// POST /api/v1/ai/meetings/sessions/[id]/analyze — 实时分析会议转录
//      Body: { wid }
//
// 流程：
//   1. 认证 + AI 配置检查 + 速率限制
//   2. 在 RLS 事务内读取 session.transcript + 工作区成员名单
//   3. 格式化转录文本 → 构建 prompt
//   4. withUsageTracking 包装 generateText（reasonerModel，非流式）
//   5. cleanJsonResponse + JSON.parse 解析 JSON 结果
//   6. 规范化提取 summary / actionItems / decisions
//   7. 在 RLS 事务内写入 DB（更新 summary + 创建 actionItems + decisions）
//   8. 返回分析结果
//
// 来源：
//  - 经验 2026-09-15-usage-tracking-per-call-site-integration-by-mode（withUsageTracking 非流式包装）
//  - 经验 2026-09-15-ai-route-unified-pattern-audit-checklist（checkRateLimit + try-catch）

import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireReasonerModel, withCoT } from "@/lib/ai/deepseek";
import {
  getUserId,
  unauthorizedResponse,
  aiNotConfiguredResponse,
  isAiConfigured,
} from "@/lib/ai/shared";
import { withUsageTracking } from "@/lib/ai/usage-middleware";
import { cleanJsonResponse } from "@/lib/ai/orchestrator";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import {
  buildMeetingAnalysisSystemPrompt,
  buildMeetingAnalysisPrompt,
} from "@/lib/ai/prompts/meeting-transcript-analysis";

/** UUID 正则校验 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 从 URL 路径提取会话 ID */
function extractSessionId(req: NextRequest): string | null {
  const segments = new URL(req.url).pathname.split("/");
  const idx = segments.indexOf("sessions");
  if (idx === -1 || idx + 1 >= segments.length) return null;
  const id = segments[idx + 1];
  if (!id || !UUID_RE.test(id)) return null;
  return id;
}

/** POST analyze schema */
const analyzeSchema = z.object({
  wid: z.string().uuid(),
});

/** 规范化后的行动项 */
interface NormalizedActionItem {
  content: string;
  assigneeId: null;
  dueDate: Date | null;
  confidence: number;
}

/** 规范化后的决策 */
interface NormalizedDecision {
  content: string;
  context: string | null;
  participants: Prisma.InputJsonValue;
}

/** 分析结果（返回给前端） */
interface AnalysisResult {
  summary: string;
  actionItems: NormalizedActionItem[];
  decisions: NormalizedDecision[];
}

/**
 * 将 transcript JSON 数组格式化为可读文本。
 *
 * 每行格式："说话人: 内容"，按数组顺序排列。
 */
function formatTranscript(transcript: unknown): string {
  if (!Array.isArray(transcript)) return "";
  return transcript
    .map((entry, i) => {
      if (typeof entry !== "object" || entry === null) return "";
      const e = entry as { speaker?: string; text?: string };
      const speaker = e.speaker ?? `说话人${i + 1}`;
      const text = e.text ?? "";
      return `${speaker}: ${text}`;
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * 规范化 AI 返回的分析结果。
 *
 * 校验 summary 为字符串，actionItems/decisions 为数组且每项含必填字段。
 * 截断超长字段至 DB 列长度限制。
 */
function normalizeAnalysisResult(raw: unknown): AnalysisResult | null {
  if (raw == null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const summary =
    typeof obj.summary === "string" ? obj.summary.slice(0, 5000) : "";

  const actionItems: NormalizedActionItem[] = [];
  if (Array.isArray(obj.actionItems)) {
    for (const item of obj.actionItems) {
      if (item == null || typeof item !== "object") continue;
      const a = item as Record<string, unknown>;
      if (typeof a.content !== "string" || !a.content.trim()) continue;
      // 解析截止日期
      let dueDate: Date | null = null;
      if (typeof a.dueDate === "string" && a.dueDate.trim()) {
        const parsed = new Date(a.dueDate);
        if (!isNaN(parsed.getTime())) dueDate = parsed;
      }
      // 解析置信度
      let confidence = 0;
      if (typeof a.confidence === "number") {
        confidence = Math.max(0, Math.min(1, a.confidence));
      }
      actionItems.push({
        content: a.content.slice(0, 5000),
        assigneeId: null, // AI 提取的 assignee 为姓名字符串，暂不映射到用户 ID
        dueDate,
        confidence,
      });
      if (actionItems.length >= 20) break; // 最多 20 条
    }
  }

  const decisions: NormalizedDecision[] = [];
  if (Array.isArray(obj.decisions)) {
    for (const item of obj.decisions) {
      if (item == null || typeof item !== "object") continue;
      const d = item as Record<string, unknown>;
      if (typeof d.content !== "string" || !d.content.trim()) continue;
      const context =
        typeof d.context === "string" ? d.context.slice(0, 5000) : null;
      const participants = Array.isArray(d.participants)
        ? (d.participants.filter((p) => typeof p === "string") as string[])
        : [];
      decisions.push({
        content: d.content.slice(0, 5000),
        context,
        participants: participants as Prisma.InputJsonValue,
      });
      if (decisions.length >= 20) break; // 最多 20 条
    }
  }

  return { summary, actionItems, decisions };
}

/**
 * POST /api/v1/ai/meetings/sessions/[id]/analyze
 *
 * 读取会话转录 → 调用 AI 分析 → 提取行动项+决策+摘要 → 写入 DB → 返回结果。
 */
export async function POST(req: NextRequest) {
  // 1) 认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) AI 服务配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 3) 速率限制：每分钟 5 次（AI 分析较重）
  const limited = await checkRateLimit(req, "ai-meeting-analyze", {
    windowMs: 60_000,
    max: 5,
  });
  if (limited) return limited;

  // 4) 提取会话 ID
  const sessionId = extractSessionId(req);
  if (!sessionId) {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidParams"), data: null },
      { status: 400 },
    );
  }

  // 5) body 校验
  let body: z.infer<typeof analyzeSchema>;
  try {
    body = analyzeSchema.parse(await req.json());
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

  // 6) 工作区守卫
  const ctx = await getWorkspaceContext(req, body.wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  try {
    // 7) 在 RLS 事务内读取 session + 成员名单
    const sessionData = await runWithWorkspace(
      body.wid,
      (tx) =>
        tx.aiMeetingSession.findFirst({
          where: {
            id: sessionId,
            workspaceId: body.wid,
            userId: ctx.payload.sub,
          },
          select: {
            id: true,
            title: true,
            transcript: true,
            participantCount: true,
          },
        }),
      ctx.payload.sub,
    );

    if (!sessionData) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "sessionNotFound"), data: null },
        { status: 404 },
      );
    }

    // 8) 格式化转录文本
    const transcriptText = formatTranscript(sessionData.transcript);
    if (!transcriptText.trim()) {
      return NextResponse.json(
        {
          code: 400,
          message: apiMsg(req, "invalidBody"),
          data: null,
        },
        { status: 400 },
      );
    }

    // 工作区上下文（会话标题 + 参与人数，辅助 AI 识别人名）
    const workspaceContext = `会议标题: ${sessionData.title}\n参与人数: ${sessionData.participantCount}`;

    // 9) withUsageTracking 包装 AI 调用
    const systemPrompt = withCoT(
      buildMeetingAnalysisSystemPrompt(),
      requireReasonerModel(),
    );
    const userPrompt = buildMeetingAnalysisPrompt(
      transcriptText,
      workspaceContext,
    );

    const analysisResult = await withUsageTracking(
      {
        workspaceId: body.wid,
        userId: ctx.payload.sub,
        capability: "meeting-analyze",
        model: requireReasonerModel().modelId,
      },
      async () => {
        const llmResult = await generateText({
          model: requireReasonerModel(),
          system: systemPrompt,
          prompt: userPrompt,
        });

        // 解析 JSON 结果
        const cleaned = cleanJsonResponse(llmResult.text);
        let parsed: unknown;
        try {
          parsed = JSON.parse(cleaned);
        } catch (e) {
          console.error(
            "[ai/meetings/analyze] JSON.parse 失败:",
            e,
            "raw:",
            cleaned.slice(0, 200),
          );
          throw new Error("AI 返回结果解析失败", { cause: e });
        }

        const normalized = normalizeAnalysisResult(parsed);
        if (!normalized) {
          throw new Error("AI 返回结果规范化失败");
        }

        return {
          result: normalized,
          usage: llmResult.usage
            ? {
                inputTokens: llmResult.usage.inputTokens ?? 0,
                outputTokens: llmResult.usage.outputTokens ?? 0,
              }
            : undefined,
        };
      },
    );

    // 10) 写入 DB：更新 summary + 清除旧 actionItems/decisions + 创建新的
    const persisted = await runWithWorkspace(
      body.wid,
      async (tx) => {
        // 更新会话摘要
        await tx.aiMeetingSession.update({
          where: { id: sessionId },
          data: { summary: analysisResult.summary },
        });

        // 清除旧的分析结果（避免重复分析累积）
        await tx.aiMeetingActionItem.deleteMany({
          where: {
            sessionId,
            extractedBy: "ai",
          },
        });
        await tx.aiMeetingDecision.deleteMany({
          where: { sessionId },
        });

        // 创建新的行动项
        const actionItems = await Promise.all(
          analysisResult.actionItems.map((item) =>
            tx.aiMeetingActionItem.create({
              data: {
                sessionId,
                workspaceId: body.wid,
                content: item.content,
                assigneeId: item.assigneeId,
                dueDate: item.dueDate,
                confidence: item.confidence,
                extractedBy: "ai",
              },
            }),
          ),
        );

        // 创建新的决策
        const decisions = await Promise.all(
          analysisResult.decisions.map((d) =>
            tx.aiMeetingDecision.create({
              data: {
                sessionId,
                workspaceId: body.wid,
                content: d.content,
                context: d.context,
                participants: d.participants,
              },
            }),
          ),
        );

        return { summary: analysisResult.summary, actionItems, decisions };
      },
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 0, data: persisted, message: "OK" });
  } catch (error) {
    console.error("[POST ai/meetings/sessions/[id]/analyze] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}