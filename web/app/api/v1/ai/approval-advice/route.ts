// POST /api/v1/ai/approval-advice — AI 审批风控建议（流式 + 阶段化进度）
// 输入：{ wid, approvalInstanceId }
// 输出：text/event-stream（Vercel AI SDK UI Message Stream）
//   - data-progress part：{ stage, message } 阶段化进度
//   - data-result part：{ riskLevel, riskFactors, suggestion, similarCases } 最终结果
//
// 使用 deepseek-reasoner 推理模型分析审批内容 + 同类型历史审批，
// 为审批人提供风险等级、风险因素、建议和相似案例参考。
// 不替审批人做决定，仅提供分析参考。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { reasonerModel, withCoT } from "@/lib/ai/deepseek";
import {
  getUserId,
  unauthorizedResponse,
  aiNotConfiguredResponse,
  isAiConfigured,
} from "@/lib/ai/shared";
import { checkRateLimit } from "@/lib/rate-limit";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { cleanJsonResponse } from "@/lib/ai/orchestrator";
import { apiMsg } from "@/lib/api-messages";
import { buildApprovalAdviceSystemPrompt, buildUserPrompt } from "@/lib/ai/prompts/approval-advice";
import { createAiJsonProgressStream } from "@/lib/ai/stream";

const schema = z.object({
  wid: z.string().uuid(),
  approvalInstanceId: z.string().uuid(),
});

/** AI 返回的风控建议结构 */
interface ApprovalAdvice {
  riskLevel: "low" | "medium" | "high";
  riskFactors: string[];
  suggestion: string;
  similarCases: {
    title: string;
    result: "approved" | "rejected";
    amount: number;
  }[];
}


/** 日期 → YYYY-MM-DD */
function dateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

/**
 * 将审批实例 + 历史审批聚合成 markdown 上下文供 LLM 使用。
 */
function buildContext(
  instance: {
    title: string;
    description: string | null;
    content: unknown;
    status: string;
    templateId: string | null;
    submittedAt: Date;
  },
  history: {
    title: string;
    status: string;
    content: unknown;
    submittedAt: Date;
  }[],
): string {
  const sections: string[] = [];

  // 当前审批
  sections.push(
    [
      "## 当前审批",
      `- 标题: ${instance.title}`,
      `- 描述: ${instance.description ?? "无"}`,
      `- 状态: ${instance.status}`,
      `- 提交时间: ${dateStr(instance.submittedAt)}`,
      `- 审批内容: ${JSON.stringify(instance.content)}`,
    ].join("\n"),
  );

  // 历史审批
  if (history.length > 0) {
    const lines = history.map(
      (h) =>
        `- ${h.title} (结果: ${h.status === "approved" ? "通过" : "驳回"}, 提交: ${dateStr(h.submittedAt)})`,
    );
    sections.push(
      `## 同类型历史审批（最近 ${history.length} 条）\n${lines.join("\n")}`,
    );
  } else {
    sections.push("## 同类型历史审批\n无");
  }

  return sections.join("\n\n");
}

export async function POST(req: NextRequest) {
  // 1) 认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) AI 服务配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 3) 速率限制：每分钟 10 次
  const limited = await checkRateLimit(req, "ai-approval-advice", {
    windowMs: 60_000,
    max: 10,
  });
  if (limited) return limited;

  // 4) body 校验
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

  // 5) 工作区认证（RLS 成员资格校验）
  const ctx = await getWorkspaceContext(req, body.wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  try {
    // 6) 流式生成审批建议（带阶段化进度反馈）
    //    buildPrompt 封装审批实例查询 + 历史审批聚合 + 上下文构建，
    //    让进度阶段有真实时序：
    //    阶段 1（聚合审批数据）→ 查询+聚合 → 阶段 2（分析风险）→ 阶段 3（生成建议）→ LLM → 结果 data part
    return createAiJsonProgressStream<ApprovalAdvice>(
      {
        model: reasonerModel,
        system: withCoT(buildApprovalAdviceSystemPrompt(), reasonerModel),
        buildPrompt: async () => {
          try {
            const data = await runWithWorkspace(
              body.wid,
              async (tx) => {
                const inst = await tx.approvalInstance.findFirst({
                  where: { id: body.approvalInstanceId, workspaceId: body.wid },
                  select: {
                    title: true,
                    description: true,
                    content: true,
                    status: true,
                    templateId: true,
                    submittedAt: true,
                  },
                });

                if (!inst) return null;

                // 同类型历史审批：相同 templateId，排除当前实例，最近 20 条已处理
                const hist = await tx.approvalInstance.findMany({
                  where: {
                    workspaceId: body.wid,
                    id: { not: body.approvalInstanceId },
                    status: { in: ["approved", "rejected"] },
                    ...(inst.templateId ? { templateId: inst.templateId } : {}),
                  },
                  take: 20,
                  orderBy: { submittedAt: "desc" },
                  select: {
                    title: true,
                    status: true,
                    content: true,
                    submittedAt: true,
                  },
                });

                return { instance: inst, history: hist };
              },
              // 用 JWT payload.sub 而非 getUserId 返回值，与 daily-report/project-insight 一致
              ctx.payload.sub,
            );

            if (!data) {
              // 审批实例不存在，抛异常 → stream error part → 前端显示错误
              throw new Error("approval instance not found");
            }

            const context = buildContext(data.instance, data.history);
            return buildUserPrompt(context);
          } catch (e) {
            // 内部错误不泄露给前端（可能包含 Prisma 错误消息等敏感信息）
            if (
              e instanceof Error &&
              e.message === "approval instance not found"
            ) {
              throw new Error("审批实例不存在");
            }
            throw new Error("获取审批数据失败");
          }
        },
        parseResult: (text: string): ApprovalAdvice => {
          try {
            const parsed = JSON.parse(cleanJsonResponse(text)) as Partial<ApprovalAdvice>;
            return {
              riskLevel: parsed.riskLevel ?? "low",
              riskFactors: Array.isArray(parsed.riskFactors)
                ? parsed.riskFactors.filter(
                    (f): f is string => typeof f === "string",
                  )
                : [],
              suggestion:
                typeof parsed.suggestion === "string" ? parsed.suggestion : "",
              similarCases: Array.isArray(parsed.similarCases)
                ? parsed.similarCases.filter(
                    (c): c is ApprovalAdvice["similarCases"][number] =>
                      c != null &&
                      typeof c.title === "string" &&
                      (c.result === "approved" || c.result === "rejected") &&
                      typeof c.amount === "number",
                  )
                : [],
            };
          } catch {
            // JSON 解析失败，返回降级空建议
            return {
              riskLevel: "low",
              riskFactors: [],
              suggestion: "",
              similarCases: [],
            };
          }
        },
      },
      {
        context: "正在聚合审批数据…",
        analyzing: "正在分析审批风险…",
        generating: "正在生成审批建议…",
      },
    );
  } catch (error) {
    console.error("[ai/approval-advice] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}