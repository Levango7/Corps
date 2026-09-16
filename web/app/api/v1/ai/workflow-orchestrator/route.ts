// POST /api/v1/ai/workflow-orchestrator — AI 工作流编排（非流式）
// 输入：{ wid, description, existingWorkflows? }
// 输出：{ code: 0, data: WorkflowDefinition, message: "..." }
//
// 流程：
// 1. 认证 → AI 配置检查 → 限流 → body 校验 → 工作区上下文
// 2. 用 defaultModel（deepseek-chat）将自然语言描述生成结构化工作流定义 JSON
// 3. cleanJsonResponse + normalizeWorkflowDefinition 校验规范化
// 4. 返回工作流定义（trigger + nodes + edges + explanation）
//
// 认证链顺序（来源：2026-09-16-ai-api-route-auth-chain-order-config-check-before-rate-limit）：
//   getUserId → isAiConfigured → checkRateLimit → zod parse → getWorkspaceContext
//   - isAiConfigured 在 checkRateLimit 之前：AI 未配置时所有请求注定 503，不应消耗限流配额
//   - checkRateLimit 在 zod parse 之前：超限请求不应再消耗 CPU 解析 body
//   - getWorkspaceContext 在最后：含 DB 查询（member.findFirst），最昂贵

import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { z } from "zod";
import { defaultModel, withCoT } from "@/lib/ai/deepseek";
import {
  getUserId,
  unauthorizedResponse,
  aiNotConfiguredResponse,
  isAiConfigured,
} from "@/lib/ai/shared";
import { withUsageTracking } from "@/lib/ai/usage-middleware";
import { checkRateLimit } from "@/lib/rate-limit";
import { getWorkspaceContext } from "@/lib/auth";
import { cleanJsonResponse } from "@/lib/ai/orchestrator";
import { apiMsg } from "@/lib/api-messages";
import {
  buildWorkflowOrchestratorSystemPrompt,
  buildWorkflowOrchestratorUserPrompt,
  type ExistingWorkflowSummary,
} from "@/lib/ai/prompts/workflow-orchestrator";

// ── 请求体 schema ──

const schema = z.object({
  wid: z.string().uuid(),
  description: z.string().trim().min(1).max(2000),
  existingWorkflows: z
    .array(
      z.object({
        name: z.string().max(200),
        triggerEvent: z.string().max(100),
        nodeCount: z.number().int().min(0).max(100),
      }),
    )
    .max(20)
    .optional(),
});

// ── 响应类型定义 ──

/** 工作流触发器 */
interface WorkflowTrigger {
  event: string;
  conditions: string[];
}

/** 节点类型枚举 */
type WorkflowNodeType = "action" | "condition" | "loop" | "parallel" | "approval";

/** 工作流节点 */
interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  name: string;
  config: Record<string, unknown>;
}

/** 工作流连接关系 */
interface WorkflowEdge {
  from: string;
  to: string;
  label?: string;
}

/** 完整工作流定义 */
interface WorkflowDefinition {
  trigger: WorkflowTrigger;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  explanation: string;
}

// ── 校验常量 ──

/** 合法节点类型集合 */
const VALID_NODE_TYPES = new Set<WorkflowNodeType>([
  "action",
  "condition",
  "loop",
  "parallel",
  "approval",
]);

/** 节点最大数量 */
const MAX_NODES = 10;
/** explanation 最大长度 */
const MAX_EXPLANATION_LEN = 500;
/** 单个字符串字段最大长度 */
const MAX_STR_LEN = 200;
/** conditions 最大数量 */
const MAX_CONDITIONS = 10;

/**
 * 按 Unicode 码点安全截断字符串（避免截断代理对，如 emoji）。
 */
function safeSlice(s: string, max: number): string {
  return Array.from(s).slice(0, max).join("");
}

/**
 * 校验并规范化 LLM 返回的工作流定义。
 *
 * 校验规则：
 * - trigger：必填对象，event 为非空字符串，conditions 为字符串数组
 * - nodes：数组，1-10 个，每个节点 id 唯一、type 合法、name 非空
 * - edges：数组，from/to 引用存在的节点 id，label 可选字符串
 * - explanation：非空字符串，截断至 500 字符
 *
 * @param raw JSON.parse 后的原始对象
 * @returns 规范化后的 WorkflowDefinition，校验失败返回 null
 */
function normalizeWorkflowDefinition(raw: unknown): WorkflowDefinition | null {
  if (raw == null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  // ── trigger ──
  const triggerRaw = obj.trigger;
  if (triggerRaw == null || typeof triggerRaw !== "object") return null;
  const triggerObj = triggerRaw as Record<string, unknown>;
  if (typeof triggerObj.event !== "string" || !triggerObj.event.trim()) return null;

  const conditions: string[] = [];
  if (Array.isArray(triggerObj.conditions)) {
    for (const c of triggerObj.conditions) {
      if (conditions.length >= MAX_CONDITIONS) break;
      if (typeof c === "string" && c.trim()) {
        conditions.push(safeSlice(c, MAX_STR_LEN));
      }
    }
  }

  // ── nodes ──
  if (!Array.isArray(obj.nodes) || obj.nodes.length === 0) return null;
  const nodeIdSet = new Set<string>();
  const nodes: WorkflowNode[] = [];
  for (const item of obj.nodes) {
    if (nodes.length >= MAX_NODES) break;
    if (item == null || typeof item !== "object") continue;
    const n = item as Record<string, unknown>;
    if (typeof n.id !== "string" || !n.id.trim()) continue;
    if (nodeIdSet.has(n.id)) continue; // 去重
    if (typeof n.type !== "string" || !VALID_NODE_TYPES.has(n.type as WorkflowNodeType))
      continue;
    if (typeof n.name !== "string" || !n.name.trim()) continue;

    const nodeId = safeSlice(n.id, 50);
    nodeIdSet.add(nodeId);
    nodes.push({
      id: nodeId,
      type: n.type as WorkflowNodeType,
      name: safeSlice(n.name, MAX_STR_LEN),
      config:
        n.config != null && typeof n.config === "object"
          ? (n.config as Record<string, unknown>)
          : {},
    });
  }
  if (nodes.length === 0) return null;

  // ── edges ──
  const edges: WorkflowEdge[] = [];
  if (Array.isArray(obj.edges)) {
    for (const item of obj.edges) {
      if (item == null || typeof item !== "object") continue;
      const e = item as Record<string, unknown>;
      if (typeof e.from !== "string" || typeof e.to !== "string") continue;
      // from/to 必须引用存在的节点 id
      if (!nodeIdSet.has(e.from) || !nodeIdSet.has(e.to)) continue;
      edges.push({
        from: e.from,
        to: e.to,
        label:
          typeof e.label === "string" && e.label.trim()
            ? safeSlice(e.label, MAX_STR_LEN)
            : undefined,
      });
    }
  }

  // ── explanation ──
  if (typeof obj.explanation !== "string" || !obj.explanation.trim()) return null;
  const explanation = safeSlice(obj.explanation, MAX_EXPLANATION_LEN);

  return {
    trigger: {
      event: safeSlice(triggerObj.event, MAX_STR_LEN),
      conditions,
    },
    nodes,
    edges,
    explanation,
  };
}

// ── 路由处理 ──

export async function POST(req: NextRequest) {
  // 1) 认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) AI 服务配置检查（O(1) 纯内存，在限流之前）
  if (!isAiConfigured()) return aiNotConfiguredResponse(req);

  // 3) 速率限制：每分钟 10 次（比 JSON 解析廉价，在 zod parse 之前）
  const limited = await checkRateLimit(req, "ai-workflow-orchestrator", {
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

  // 5) 工作区上下文（含 DB 查询，最昂贵，放最后）
  //    getWorkspaceContext 同时完成 workspace 归属校验 + 角色加载
  const ctx = await getWorkspaceContext(req, body.wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  // 6) LLM 生成工作流定义（非流式，defaultModel）
  let workflow: WorkflowDefinition;
  try {
    const llmResult = await withUsageTracking(
      {
        workspaceId: body.wid,
        userId: ctx.payload.sub,
        capability: "workflow-orchestrator",
        model: defaultModel.modelId,
      },
      async () => {
        const res = await generateText({
          model: defaultModel,
          system: withCoT(
            buildWorkflowOrchestratorSystemPrompt(
              body.existingWorkflows as ExistingWorkflowSummary[] | undefined,
            ),
            defaultModel,
          ),
          prompt: buildWorkflowOrchestratorUserPrompt(body.description),
        });
        return {
          result: res,
          usage: res.usage
            ? {
                inputTokens: res.usage.inputTokens ?? 0,
                outputTokens: res.usage.outputTokens ?? 0,
              }
            : undefined,
        };
      },
    );

    // 7) 解析 + 校验规范化
    const cleaned = cleanJsonResponse(llmResult.text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error(
        "[ai/workflow-orchestrator] JSON.parse 失败:",
        e,
        "raw:",
        cleaned.slice(0, 200),
      );
      return NextResponse.json(
        { code: 500, message: apiMsg(req, "internalError"), data: null },
        { status: 500 },
      );
    }

    const normalized = normalizeWorkflowDefinition(parsed);
    if (!normalized) {
      console.error(
        "[ai/workflow-orchestrator] normalizeWorkflowDefinition 返回 null, raw:",
        cleaned.slice(0, 200),
      );
      return NextResponse.json(
        { code: 500, message: apiMsg(req, "internalError"), data: null },
        { status: 500 },
      );
    }
    workflow = normalized;
  } catch (error) {
    console.error("[ai/workflow-orchestrator] LLM error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }

  // 8) 返回工作流定义
  return NextResponse.json({
    code: 0,
    data: workflow,
    message: apiMsg(req, "ok"),
  });
}