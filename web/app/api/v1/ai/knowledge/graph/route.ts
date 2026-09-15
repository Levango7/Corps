// GET /api/v1/ai/knowledge/graph — 获取知识图谱（节点 + 边）
// 查询参数：?wid=xxx&type=concept&limit=100
// 输出：{ code: 200, data: { nodes: KnowledgeNode[], edges: KnowledgeEdge[] } }
//
// 安全：通过 getWorkspaceContext 校验工作区成员资格，runWithWorkspace 注入 RLS

import { NextRequest, NextResponse } from "next/server";
import {
  getUserId,
  unauthorizedResponse,
} from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";

/** 合法节点类型白名单 */
const VALID_NODE_TYPES = new Set(["concept", "entity", "fact", "procedure"]);

/** 从查询参数解析 limit，限制在 [1, 500] */
function parseLimit(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 100;
  return Math.max(1, Math.min(500, Math.floor(n)));
}

export async function GET(req: NextRequest) {
  // 1) 认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：60s 内最多 30 次
  const limited = await checkRateLimit(req, "ai-knowledge-graph", {
    windowMs: 60_000,
    max: 30,
  });
  if (limited) return limited;

  // 2) 参数提取
  const url = new URL(req.url);
  const wid = url.searchParams.get("wid");
  const type = url.searchParams.get("type");
  const limit = parseLimit(url.searchParams.get("limit"));

  if (!wid) {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidParams"), data: null },
      { status: 400 },
    );
  }

  // 3) 工作区上下文校验
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  // 4) 查询图谱
  try {
    const data = await runWithWorkspace(
      wid,
      async (tx) => {
        // 节点过滤条件
        const nodeWhere: {
          workspaceId: string;
          type?: string;
        } = { workspaceId: wid };
        if (type && VALID_NODE_TYPES.has(type)) {
          nodeWhere.type = type;
        }

        // 查询节点
        const nodes = await tx.knowledgeNode.findMany({
          where: nodeWhere,
          take: limit,
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            workspaceId: true,
            type: true,
            label: true,
            content: true,
            sourceType: true,
            sourceId: true,
            metadata: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        if (nodes.length === 0) {
          return { nodes: [], edges: [] };
        }

        // 查询这些节点关联的所有边
        const nodeIds = nodes.map((n) => n.id);
        const edges = await tx.knowledgeEdge.findMany({
          where: {
            workspaceId: wid,
            OR: [
              { sourceNodeId: { in: nodeIds } },
              { targetNodeId: { in: nodeIds } },
            ],
          },
          select: {
            id: true,
            workspaceId: true,
            sourceNodeId: true,
            targetNodeId: true,
            relation: true,
            weight: true,
            metadata: true,
            createdAt: true,
          },
        });

        return { nodes, edges };
      },
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 200, data });
  } catch (error) {
    console.error("[ai/knowledge/graph] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}