// POST /api/v1/ai/knowledge/extract — 从指定来源提取知识图谱节点与关系（非流式）
// 输入：{ wid, sourceType: "document"|"meeting"|"chat"|"task", sourceId: string }
// 输出：{ code: 200, data: { nodes: KnowledgeNode[], edges: KnowledgeEdge[] } }
//
// 流程：
//   1. 认证 + AI 配置检查 + 限流 + body 校验 + 工作区上下文校验
//   2. 根据 sourceType 在 RLS 事务内读取源内容（文档 markdown / 会议纪要 / 聊天记录 / 任务描述）
//   3. generateText（defaultModel + withCoT）生成 JSON 知识提取结果
//   4. cleanJsonResponse + JSON.parse 解析
//   5. 去重写入 KnowledgeNode + KnowledgeEdge（同 label 更新，新 label 创建）
//   6. withUsageTracking 包装，记录使用量

import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { defaultModel, withCoT } from "@/lib/ai/deepseek";
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
import { buildKnowledgeExtractPrompt } from "@/lib/ai/prompts/knowledge-extract";
import { apiMsg } from "@/lib/api-messages";

const schema = z.object({
  wid: z.string().uuid(),
  sourceType: z.enum(["document", "meeting", "chat", "task"]),
  sourceId: z.string().uuid(),
});

/** 合法节点类型白名单 */
const VALID_NODE_TYPES = new Set(["concept", "entity", "fact", "procedure"]);
/** 合法关系类型白名单 */
const VALID_RELATIONS = new Set([
  "depends_on",
  "relates_to",
  "part_of",
  "authored_by",
]);

/** 提取结果 JSON 契约 */
interface ExtractedNode {
  type: string;
  label: string;
  content: string;
}
interface ExtractedEdge {
  sourceLabel: string;
  targetLabel: string;
  relation: string;
  weight: number;
}
interface ExtractedResult {
  nodes: ExtractedNode[];
  edges: ExtractedEdge[];
}

/**
 * 根据 sourceType 在 RLS 事务内读取源内容。
 * @returns 源内容字符串；不存在时返回 null
 */
async function fetchSourceContent(
  wid: string,
  sourceType: "document" | "meeting" | "chat" | "task",
  sourceId: string,
  tx: Prisma.TransactionClient,
): Promise<string | null> {
  switch (sourceType) {
    case "document": {
      const doc = await tx.document.findFirst({
        where: { id: sourceId, workspaceId: wid },
        select: { title: true, markdown: true },
      });
      if (!doc) return null;
      return `# ${doc.title}\n\n${doc.markdown ?? ""}`;
    }
    case "meeting": {
      // 会议纪要：优先 MeetingMinutes.content，回退 Meeting.description
      const minutes = await tx.meetingMinutes.findFirst({
        where: { id: sourceId, workspaceId: wid },
        select: { title: true, content: true },
      });
      if (minutes) return `# ${minutes.title}\n\n${minutes.content}`;
      const meeting = await tx.meeting.findFirst({
        where: { id: sourceId, workspaceId: wid },
        select: { title: true, description: true },
      });
      if (!meeting) return null;
      return `# ${meeting.title}\n\n${meeting.description ?? ""}`;
    }
    case "chat": {
      // 聊天记录：读取会话最近 50 条消息拼接
      const messages = await tx.message.findMany({
        where: { conversationId: sourceId, workspaceId: wid },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { authorId: true, body: true, createdAt: true },
      });
      if (messages.length === 0) return null;
      return messages
        .slice()
        .reverse()
        .map((m) => `[${m.authorId ?? "unknown"}] ${m.body}`)
        .join("\n");
    }
    case "task": {
      const task = await tx.task.findFirst({
        where: { id: sourceId, workspaceId: wid },
        select: { title: true, description: true },
      });
      if (!task) return null;
      return `# ${task.title}\n\n${task.description ?? ""}`;
    }
    default:
      return null;
  }
}

/**
 * 校验并规范化 LLM 返回的提取结果。
 * - 过滤非法 type/relation
 * - 截断超长 label/content
 * - clamp weight 到 [0, 1]
 */
function normalizeExtractResult(raw: unknown): ExtractedResult {
  if (raw == null || typeof raw !== "object") {
    return { nodes: [], edges: [] };
  }
  const obj = raw as Record<string, unknown>;

  const nodes: ExtractedNode[] = [];
  if (Array.isArray(obj.nodes)) {
    for (const n of obj.nodes) {
      if (n == null || typeof n !== "object") continue;
      const node = n as Record<string, unknown>;
      if (
        typeof node.type !== "string" ||
        !VALID_NODE_TYPES.has(node.type) ||
        typeof node.label !== "string" ||
        node.label.trim() === "" ||
        typeof node.content !== "string"
      ) {
        continue;
      }
      nodes.push({
        type: node.type,
        label: node.label.slice(0, 200),
        content: node.content.slice(0, 2000),
      });
    }
  }

  const edges: ExtractedEdge[] = [];
  if (Array.isArray(obj.edges)) {
    for (const e of obj.edges) {
      if (e == null || typeof e !== "object") continue;
      const edge = e as Record<string, unknown>;
      if (
        typeof edge.sourceLabel !== "string" ||
        edge.sourceLabel.trim() === "" ||
        typeof edge.targetLabel !== "string" ||
        edge.targetLabel.trim() === "" ||
        typeof edge.relation !== "string" ||
        !VALID_RELATIONS.has(edge.relation)
      ) {
        continue;
      }
      const rawWeight =
        typeof edge.weight === "number" ? edge.weight : 1.0;
      edges.push({
        sourceLabel: edge.sourceLabel.slice(0, 200),
        targetLabel: edge.targetLabel.slice(0, 200),
        relation: edge.relation,
        weight: Math.max(0, Math.min(1, rawWeight)),
      });
    }
  }

  return { nodes, edges };
}

export async function POST(req: NextRequest) {
  // 1) 认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) AI 服务配置检查
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 3) 速率限制：每分钟 5 次
  const limited = await checkRateLimit(req, "ai-knowledge-extract", {
    windowMs: 60_000,
    max: 5,
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

  // 5) 工作区上下文校验
  const ctx = await getWorkspaceContext(req, body.wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  // 6) 读取源内容 + AI 提取 + 写入图谱
  try {
    // 6.1) 在 RLS 事务内读取源内容
    const sourceContent = await runWithWorkspace(
      body.wid,
      (tx) => fetchSourceContent(body.wid, body.sourceType, body.sourceId, tx),
      ctx.payload.sub,
    );

    if (!sourceContent || sourceContent.trim().length === 0) {
      return NextResponse.json(
        {
          code: 404,
          message: apiMsg(req, "documentNotFound"),
          data: null,
        },
        { status: 404 },
      );
    }

    // 6.2) AI 提取（非流式，withUsageTracking 包装）
    const systemPrompt = buildKnowledgeExtractPrompt(
      body.sourceType,
      sourceContent,
    );

    const extractResult = await withUsageTracking(
      {
        workspaceId: body.wid,
        userId: ctx.payload.sub,
        capability: "knowledge-extract",
        model: defaultModel.modelId,
      },
      async () => {
        const llmResult = await generateText({
          model: defaultModel,
          system: withCoT(systemPrompt, defaultModel),
          prompt: "请提取上述内容中的知识点并输出 JSON。",
        });
        return {
          result: llmResult.text,
          usage: {
            inputTokens: llmResult.usage.inputTokens ?? 0,
            outputTokens: llmResult.usage.outputTokens ?? 0,
          },
        };
      },
    );

    // 6.3) 解析 JSON
    const cleaned = cleanJsonResponse(extractResult);
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error(
        "[ai/knowledge/extract] JSON.parse 失败:",
        e,
        "raw:",
        cleaned.slice(0, 200),
      );
      return NextResponse.json(
        { code: 500, message: apiMsg(req, "internalError"), data: null },
        { status: 500 },
      );
    }

    const normalized = normalizeExtractResult(parsed);

    // 6.4) 去重写入 KnowledgeNode + KnowledgeEdge
    const result = await runWithWorkspace(
      body.wid,
      async (tx) => {
        // 节点去重：同 workspaceId + label 更新，新 label 创建
        const nodeMap = new Map<string, string>(); // label -> nodeId
        const createdNodes: {
          id: string;
          type: string;
          label: string;
          content: string;
        }[] = [];

        for (const node of normalized.nodes) {
          // 查询是否已存在同 label 节点
          const existing = await tx.knowledgeNode.findFirst({
            where: { workspaceId: body.wid, label: node.label },
            select: { id: true, type: true, label: true, content: true },
          });

          if (existing) {
            // 更新已有节点（合并 type/content）
            const updated = await tx.knowledgeNode.update({
              where: { id: existing.id },
              data: {
                type: node.type,
                content: node.content,
                sourceType: body.sourceType,
                sourceId: body.sourceId,
              },
              select: { id: true, type: true, label: true, content: true },
            });
            nodeMap.set(updated.label, updated.id);
            createdNodes.push(updated);
          } else {
            // 创建新节点
            const created = await tx.knowledgeNode.create({
              data: {
                workspaceId: body.wid,
                type: node.type,
                label: node.label,
                content: node.content,
                sourceType: body.sourceType,
                sourceId: body.sourceId,
              },
              select: { id: true, type: true, label: true, content: true },
            });
            nodeMap.set(created.label, created.id);
            createdNodes.push(created);
          }
        }

        // 边去重：同 sourceNodeId + targetNodeId + relation 更新，新关系创建
        const createdEdges: {
          id: string;
          sourceNodeId: string;
          targetNodeId: string;
          relation: string;
          weight: number;
        }[] = [];

        for (const edge of normalized.edges) {
          const sourceNodeId = nodeMap.get(edge.sourceLabel);
          const targetNodeId = nodeMap.get(edge.targetLabel);
          if (!sourceNodeId || !targetNodeId) continue;
          if (sourceNodeId === targetNodeId) continue; // 自环跳过

          // 查询是否已存在同 (source, target, relation) 边
          const existingEdge = await tx.knowledgeEdge.findFirst({
            where: {
              workspaceId: body.wid,
              sourceNodeId,
              targetNodeId,
              relation: edge.relation,
            },
            select: {
              id: true,
              sourceNodeId: true,
              targetNodeId: true,
              relation: true,
              weight: true,
            },
          });

          if (existingEdge) {
            // 更新权重（取较大值，保留更强关系）
            const updated = await tx.knowledgeEdge.update({
              where: { id: existingEdge.id },
              data: { weight: Math.max(existingEdge.weight, edge.weight) },
              select: {
                id: true,
                sourceNodeId: true,
                targetNodeId: true,
                relation: true,
                weight: true,
              },
            });
            createdEdges.push(updated);
          } else {
            const created = await tx.knowledgeEdge.create({
              data: {
                workspaceId: body.wid,
                sourceNodeId,
                targetNodeId,
                relation: edge.relation,
                weight: edge.weight,
              },
              select: {
                id: true,
                sourceNodeId: true,
                targetNodeId: true,
                relation: true,
                weight: true,
              },
            });
            createdEdges.push(created);
          }
        }

        return { nodes: createdNodes, edges: createdEdges };
      },
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 200, data: result });
  } catch (error) {
    console.error("[ai/knowledge/extract] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}