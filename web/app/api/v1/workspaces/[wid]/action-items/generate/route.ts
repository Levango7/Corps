// POST /api/v1/workspaces/{wid}/action-items/generate — AI 行动项自动生成
// 输入：{ decisionMarkdown: string, decisionId?: string }
// 输出：{ code: 200, data: { actionItems: ParsedActionItem[] } }
// 当 decisionId 提供时，为每个行动项创建 Task 记录并通过 DecisionActionItem
// 关联到该决策；未提供时仅返回生成的行动项列表供前端预览。
// DEEPSEEK_API_KEY 未配置时返回 503（无 fallback，行动项生成强依赖 LLM）。

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { generateText } from "ai";
import { defaultModel } from "@/lib/ai/deepseek";
import { isAiConfigured, aiNotConfiguredResponse } from "@/lib/ai/shared";

const schema = z.object({
  decisionMarkdown: z.string().min(10).max(20_000),
  decisionId: z.string().uuid().optional(),
});

interface ParsedActionItem {
  title: string;
  description: string;
  suggestedAssignee: string | null;
  suggestedDueDate: string | null;
}

/** 清理 LLM 返回的 JSON 文本：去掉 ```json ... ``` 代码块包裹 */
function cleanJsonResponse(text: string): string {
  let t = text.trim();
  const fenceMatch = t.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/);
  if (fenceMatch && fenceMatch[1]) {
    t = fenceMatch[1].trim();
  }
  return t;
}

/** 尝试把 LLM 返回的日期字符串解析为 Date；无效时返回 null */
function parseDueDate(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

/** LLM 生成行动项：用 DeepSeek default 模型根据决策内容生成可执行任务 */
async function generateActionItems(decisionMarkdown: string): Promise<ParsedActionItem[] | null> {
  const prompt = `你是行动项生成助手。根据决策内容，自动生成可执行的行动项（任务）。

要求：
1. 从决策内容中识别需要执行的具体行动
2. 每个行动项包含：title（任务标题）、description（任务描述）、suggestedAssignee（建议负责人，如果文本中提到）、suggestedDueDate（建议截止日期，如果文本中提到）
3. 行动项应当具体、可执行、有明确的完成标准
4. 输出 JSON 数组格式：[{ "title": string, "description": string, "suggestedAssignee": string | null, "suggestedDueDate": string | null }]

决策内容：
${decisionMarkdown}`;

  const result = await generateText({
    model: defaultModel,
    prompt,
  });

  const cleaned = cleanJsonResponse(result.text);
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) return null;

  const items: ParsedActionItem[] = [];
  for (const item of parsed) {
    if (item == null || typeof item !== "object") continue;
    if (typeof item.title !== "string" || typeof item.description !== "string") continue;
    items.push({
      // Task.title 为 VarChar(255)，截断防超长
      title: item.title.slice(0, 255),
      description: item.description,
      suggestedAssignee: typeof item.suggestedAssignee === "string" ? item.suggestedAssignee : null,
      suggestedDueDate: typeof item.suggestedDueDate === "string" ? item.suggestedDueDate : null,
    });
  }
  return items;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });
  // 仅 member 及以上可生成行动项
  if (!["owner", "admin", "member"].includes(ctx.member.role)) {
    return NextResponse.json({ code: 403, message: apiMsg(req, "noPermission"), data: null }, { status: 403 });
  }

  // AI 服务配置检查（未配置时无 fallback，直接 503）
  if (!isAiConfigured()) return aiNotConfiguredResponse();

  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: e.issues[0]?.message ?? apiMsg(req, "validationFailed"), data: null },
        { status: 400 },
      );
    }
    return NextResponse.json({ code: 400, message: apiMsg(req, "invalidBody"), data: null }, { status: 400 });
  }

  // 1) LLM 生成行动项
  let actionItems: ParsedActionItem[];
  try {
    const result = await generateActionItems(body.decisionMarkdown);
    if (result === null) {
      return NextResponse.json(
        { code: 500, message: apiMsg(req, "internalError"), data: null },
        { status: 500 },
      );
    }
    actionItems = result;
  } catch (error) {
    console.error("[POST action-items/generate] LLM error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }

  // 2) 如果提供 decisionId，为每个行动项创建 Task 并通过 DecisionActionItem 关联到决策
  if (body.decisionId) {
    const decisionId = body.decisionId;
    const userId = ctx.payload.sub;

    try {
      // 验证决策存在且属于当前工作区
      const decision = await runWithWorkspace(
        wid,
        (tx) =>
          tx.decision.findUnique({
            where: { id: decisionId },
            select: { id: true, workspaceId: true },
          }),
        userId,
      );
      if (!decision || decision.workspaceId !== wid) {
        return NextResponse.json(
          { code: 404, message: apiMsg(req, "decisionNotFound"), data: null },
          { status: 404 },
        );
      }

      // 为每个行动项创建 Task + DecisionActionItem（单事务，任一失败整体回滚）
      await runWithWorkspace(
        wid,
        async (tx) => {
          for (let i = 0; i < actionItems.length; i++) {
            const item = actionItems[i];
            const dueDate = parseDueDate(item.suggestedDueDate);

            const task = await tx.task.create({
              data: {
                workspaceId: wid,
                title: item.title,
                description: item.description,
                status: "todo",
                createdBy: userId,
                dueDate,
              },
            });

            await tx.decisionActionItem.create({
              data: {
                decisionId,
                taskId: task.id,
                lineIndex: i,
                title: item.title,
                dueDate,
              },
            });
          }
        },
        userId,
      );
    } catch (error) {
      console.error("[POST action-items/generate] persist error:", error);
      return NextResponse.json(
        { code: 500, message: apiMsg(req, "internalError"), data: null },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    code: 200,
    data: { actionItems },
  });
}