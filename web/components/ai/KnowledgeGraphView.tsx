"use client";

/**
 * AI 知识图谱可视化组件。
 *
 * 功能：
 *  - 用原生 SVG 绘制节点-边图（力导向简化布局：圆形排列 + 弹簧松弛）
 *  - 节点按 type 用不同颜色（concept: --accent, entity: --success, fact: --warning, procedure: --info）
 *  - 边按 relation 用不同线型（depends_on: 实线箭头, relates_to: 虚线, part_of: 实线, authored_by: 点线）
 *  - 支持点击节点查看详情、按类型过滤、搜索
 *  - 样式全走 design token（var(--*)），lucide-react 图标 size 14/16
 *
 * 数据来源：GET /api/v1/ai/knowledge/graph?wid=xxx
 * 删除节点：DELETE /api/v1/ai/knowledge/nodes/[id]?wid=xxx
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Brain,
  Search,
  Filter,
  Trash2,
  X,
  Loader2,
  AlertTriangle,
  Network,
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/Toast";

interface KnowledgeGraphViewProps {
  /** 工作区 ID */
  wid: string;
}

/** 知识图谱节点（与后端 KnowledgeNode 对齐） */
interface KnowledgeNode {
  id: string;
  workspaceId: string;
  type: string; // concept | entity | fact | procedure
  label: string;
  content: string;
  sourceType: string;
  sourceId: string;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
}

/** 知识图谱边（与后端 KnowledgeEdge 对齐） */
interface KnowledgeEdge {
  id: string;
  workspaceId: string;
  sourceNodeId: string;
  targetNodeId: string;
  relation: string; // depends_on | relates_to | part_of | authored_by
  weight: number;
  metadata: unknown;
  createdAt: string;
}

/** 节点类型 → design token 颜色映射 */
const NODE_COLOR: Record<string, string> = {
  concept: "var(--accent)",
  entity: "var(--success)",
  fact: "var(--warning)",
  procedure: "var(--info)",
};

/** 关系类型 → SVG stroke-dasharray 线型映射 */
const EDGE_DASH: Record<string, string> = {
  depends_on: "none", // 实线
  relates_to: "6 4", // 虚线
  part_of: "none", // 实线
  authored_by: "2 3", // 点线
};

/** 节点类型列表（用于过滤） */
const NODE_TYPES = ["concept", "entity", "fact", "procedure"] as const;

/** 布局后的节点位置 */
interface PositionedNode {
  node: KnowledgeNode;
  x: number;
  y: number;
}

/** SVG 视口常量 */
const SVG_WIDTH = 800;
const SVG_HEIGHT = 600;
const NODE_RADIUS = 24;

/**
 * 简化力导向布局：圆形初始排列 + 几轮弹簧松弛。
 * 不引入外部图库，用原生数学计算。
 */
function computeLayout(
  nodes: KnowledgeNode[],
  edges: KnowledgeEdge[],
): PositionedNode[] {
  if (nodes.length === 0) return [];

  const n = nodes.length;
  const cx = SVG_WIDTH / 2;
  const cy = SVG_HEIGHT / 2;
  const radius = Math.min(SVG_WIDTH, SVG_HEIGHT) / 2 - NODE_RADIUS * 3;

  // 初始：圆形排列
  const positions: PositionedNode[] = nodes.map((node, i) => ({
    node,
    x: cx + radius * Math.cos((2 * Math.PI * i) / n),
    y: cy + radius * Math.sin((2 * Math.PI * i) / n),
  }));

  // 构建邻接表
  const adj = new Map<string, Set<string>>();
  for (const node of nodes) adj.set(node.id, new Set());
  for (const edge of edges) {
    adj.get(edge.sourceNodeId)?.add(edge.targetNodeId);
    adj.get(edge.targetNodeId)?.add(edge.sourceNodeId);
  }

  // 弹簧松弛迭代（简化版：连接的节点相互吸引，所有节点相互排斥）
  const iterations = 30;
  const posMap = new Map(positions.map((p) => [p.node.id, p]));

  for (let iter = 0; iter < iterations; iter++) {
    const forces = new Map<string, { x: number; y: number }>();
    for (const p of positions) forces.set(p.node.id, { x: 0, y: 0 });

    // 排斥力（所有节点对）
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i];
        const b = positions[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = 2000 / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        forces.get(a.node.id)!.x -= fx;
        forces.get(a.node.id)!.y -= fy;
        forces.get(b.node.id)!.x += fx;
        forces.get(b.node.id)!.y += fy;
      }
    }

    // 吸引力（连接的节点对）
    for (const p of positions) {
      const neighbors = adj.get(p.node.id);
      if (!neighbors) continue;
      for (const neighborId of neighbors) {
        const q = posMap.get(neighborId);
        if (!q) continue;
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = dist * 0.05;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        forces.get(p.node.id)!.x += fx;
        forces.get(p.node.id)!.y += fy;
      }
    }

    // 应用力（带阻尼）
    const damping = 0.5;
    for (const p of positions) {
      const f = forces.get(p.node.id)!;
      p.x += f.x * damping;
      p.y += f.y * damping;
      // 边界约束
      p.x = Math.max(NODE_RADIUS * 2, Math.min(SVG_WIDTH - NODE_RADIUS * 2, p.x));
      p.y = Math.max(NODE_RADIUS * 2, Math.min(SVG_HEIGHT - NODE_RADIUS * 2, p.y));
    }
  }

  return positions;
}

export function KnowledgeGraphView({ wid }: KnowledgeGraphViewProps) {
  const t = useTranslations("ai.aiKnowledge");
  const { toast } = useToast();

  const [nodes, setNodes] = useState<KnowledgeNode[]>([]);
  const [edges, setEdges] = useState<KnowledgeEdge[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [selectedNode, setSelectedNode] = useState<KnowledgeNode | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTypes, setActiveTypes] = useState<Set<string>>(
    new Set(NODE_TYPES),
  );
  const [deleting, setDeleting] = useState(false);

  /** 加载知识图谱 */
  const loadGraph = useCallback(async () => {
    setLoading(true);
    setHasError(false);
    try {
      const data = await api<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }>(
        `/api/v1/ai/knowledge/graph?wid=${wid}&limit=200`,
      );
      setNodes(data?.nodes ?? []);
      setEdges(data?.edges ?? []);
    } catch (e) {
      if (process.env.NODE_ENV === "development") {
        console.error("[KnowledgeGraphView] loadGraph error:", e instanceof Error ? e.message : e);
      }
      setHasError(true);
      toast("error", t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [wid, t, toast]);

  useEffect(() => {
    void loadGraph();
  }, [loadGraph]);

  /** 删除节点 */
  const handleDeleteNode = useCallback(async () => {
    if (!selectedNode) return;
    setDeleting(true);
    try {
      await api(`/api/v1/ai/knowledge/nodes/${selectedNode.id}?wid=${wid}`, {
        method: "DELETE",
      });
      setNodes((prev) => prev.filter((n) => n.id !== selectedNode.id));
      setEdges((prev) =>
        prev.filter(
          (e) =>
            e.sourceNodeId !== selectedNode.id && e.targetNodeId !== selectedNode.id,
        ),
      );
      setSelectedNode(null);
      toast("success", t("deleted"));
    } catch (e) {
      if (process.env.NODE_ENV === "development") {
        console.error("[KnowledgeGraphView] deleteNode error:", e instanceof Error ? e.message : e);
      }
      toast("error", t("error"));
    } finally {
      setDeleting(false);
    }
  }, [selectedNode, wid, t, toast]);

  /** 过滤后的节点 */
  const filteredNodes = useMemo(() => {
    return nodes.filter((n) => {
      if (!activeTypes.has(n.type)) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          n.label.toLowerCase().includes(q) ||
          n.content.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [nodes, activeTypes, searchQuery]);

  /** 过滤后的节点 ID 集合 */
  const filteredNodeIds = useMemo(
    () => new Set(filteredNodes.map((n) => n.id)),
    [filteredNodes],
  );

  /** 过滤后的边 */
  const filteredEdges = useMemo(() => {
    return edges.filter(
      (e) =>
        filteredNodeIds.has(e.sourceNodeId) && filteredNodeIds.has(e.targetNodeId),
    );
  }, [edges, filteredNodeIds]);

  /** 布局计算 */
  const positionedNodes = useMemo(
    () => computeLayout(filteredNodes, filteredEdges),
    [filteredNodes, filteredEdges],
  );
  const positionMap = useMemo(
    () => new Map(positionedNodes.map((p) => [p.node.id, p])),
    [positionedNodes],
  );

  /** 切换类型过滤 */
  const toggleType = (type: string) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  /** 选中节点的关联边 */
  const selectedNodeEdges = useMemo(() => {
    if (!selectedNode) return [];
    return edges.filter(
      (e) => e.sourceNodeId === selectedNode.id || e.targetNodeId === selectedNode.id,
    );
  }, [selectedNode, edges]);

  return (
    <div
      className="flex h-full flex-col bg-[var(--surface)]"
      aria-label={t("title")}
    >
      {/* 标题栏 */}
      <header className="flex items-center justify-between border-b border-[var(--border)] px-[var(--space-5)] py-[var(--space-3)]">
        <div className="flex items-center gap-[var(--space-2)]">
          <Network size={16} className="text-[var(--accent)]" />
          <h1 className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            {t("title")}
          </h1>
        </div>
        <button
          type="button"
          onClick={() => void loadGraph()}
          disabled={loading}
          className="inline-flex h-8 items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] px-[var(--space-2)] text-[var(--muted)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          aria-label={t("graph")}
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Brain size={14} />}
          <span className="text-[length:var(--text-sm)]">{t("graph")}</span>
        </button>
      </header>

      {/* 工具栏：搜索 + 类型过滤 */}
      <div className="flex flex-wrap items-center gap-[var(--space-2)] border-b border-[var(--border)] px-[var(--space-5)] py-[var(--space-2)]">
        {/* 搜索框 */}
        <div className="relative flex-1 min-w-[200px]">
          <Search
            size={14}
            className="absolute left-[var(--space-2)] top-1/2 -translate-y-1/2 text-[var(--muted)]"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.currentTarget.value)}
            placeholder={t("search")}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] py-[var(--space-1)] pl-[var(--space-7)] pr-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-ring)]"
          />
        </div>

        {/* 类型过滤 */}
        <div className="flex items-center gap-[var(--space-1)]">
          <Filter size={14} className="text-[var(--muted)]" />
          <span className="text-[length:var(--text-sm)] text-[var(--muted)]">
            {t("filterByType")}:
          </span>
          {NODE_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => toggleType(type)}
              className={`inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] border px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--text-xs)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] ${
                activeTypes.has(type)
                  ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--fg)]"
                  : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-2)]"
              }`}
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: `var(${NODE_COLOR[type]})` }}
              />
              {type}
            </button>
          ))}
        </div>
      </div>

      {/* 主体：图谱 + 详情侧栏 */}
      <div className="flex flex-1 overflow-hidden">
        {/* SVG 图谱 */}
        <div className="flex-1 overflow-auto p-[var(--space-3)]">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 size={24} className="animate-spin text-[var(--muted)]" />
            </div>
          ) : hasError ? (
            <div className="flex h-full flex-col items-center justify-center gap-[var(--space-2)] text-[var(--muted)]">
              <AlertTriangle size={24} className="text-[var(--danger)]" />
              <p className="text-[length:var(--text-sm)]">{t("loadFailed")}</p>
            </div>
          ) : filteredNodes.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[var(--muted)]">
              <p className="text-[length:var(--text-sm)]">{t("noData")}</p>
            </div>
          ) : (
            <svg
              viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
              className="h-full w-full"
              preserveAspectRatio="xMidYMid meet"
            >
              {/* 绘制边 */}
              <defs>
                <marker
                  id="arrowhead"
                  markerWidth="8"
                  markerHeight="6"
                  refX="8"
                  refY="3"
                  orient="auto"
                >
                  <polygon
                    points="0 0, 8 3, 0 6"
                    fill="var(--muted)"
                  />
                </marker>
              </defs>
              {filteredEdges.map((edge) => {
                const source = positionMap.get(edge.sourceNodeId);
                const target = positionMap.get(edge.targetNodeId);
                if (!source || !target) return null;
                return (
                  <line
                    key={edge.id}
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    stroke="var(--muted)"
                    strokeWidth={1 + edge.weight}
                    strokeDasharray={EDGE_DASH[edge.relation] ?? "none"}
                    markerEnd={
                      edge.relation === "depends_on" ? "url(#arrowhead)" : undefined
                    }
                    opacity={0.6}
                  />
                );
              })}

              {/* 绘制节点 */}
              {positionedNodes.map(({ node, x, y }) => (
                <g
                  key={node.id}
                  transform={`translate(${x}, ${y})`}
                  className="cursor-pointer"
                  onClick={() => setSelectedNode(node)}
                >
                  <circle
                    r={NODE_RADIUS}
                    fill={`var(${NODE_COLOR[node.type] ?? "var(--accent)"})`}
                    fillOpacity={0.2}
                    stroke={`var(${NODE_COLOR[node.type] ?? "var(--accent)"})`}
                    strokeWidth={2}
                  />
                  <text
                    textAnchor="middle"
                    dy="0.35em"
                    className="pointer-events-none select-none"
                    fontSize="10"
                    fill="var(--fg)"
                  >
                    {node.label.length > 8
                      ? node.label.slice(0, 8) + "…"
                      : node.label}
                  </text>
                </g>
              ))}
            </svg>
          )}
        </div>

        {/* 节点详情侧栏 */}
        {selectedNode && (
          <aside className="flex w-80 flex-col border-l border-[var(--border)] bg-[var(--surface-2)]">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)]">
              <h2 className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
                {t("nodeDetail")}
              </h2>
              <button
                type="button"
                onClick={() => setSelectedNode(null)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-3)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                aria-label="close"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-[var(--space-3)]">
              <dl className="flex flex-col gap-[var(--space-3)]">
                <div>
                  <dt className="text-[length:var(--text-xs)] text-[var(--muted)]">
                    {t("type")}
                  </dt>
                  <dd className="flex items-center gap-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--fg)]">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{
                        backgroundColor: `var(${NODE_COLOR[selectedNode.type] ?? "var(--accent)"})`,
                      }}
                    />
                    {selectedNode.type}
                  </dd>
                </div>
                <div>
                  <dt className="text-[length:var(--text-xs)] text-[var(--muted)]">
                    {t("label")}
                  </dt>
                  <dd className="text-[length:var(--text-sm)] text-[var(--fg)]">
                    {selectedNode.label}
                  </dd>
                </div>
                <div>
                  <dt className="text-[length:var(--text-xs)] text-[var(--muted)]">
                    {t("content")}
                  </dt>
                  <dd className="whitespace-pre-wrap text-[length:var(--text-sm)] text-[var(--fg-2)]">
                    {selectedNode.content}
                  </dd>
                </div>
                <div>
                  <dt className="text-[length:var(--text-xs)] text-[var(--muted)]">
                    {t("source")}
                  </dt>
                  <dd className="text-[length:var(--text-sm)] text-[var(--fg-2)]">
                    {selectedNode.sourceType}
                  </dd>
                </div>
                <div>
                  <dt className="text-[length:var(--text-xs)] text-[var(--muted)]">
                    {t("relations")}
                  </dt>
                  <dd>
                    {selectedNodeEdges.length === 0 ? (
                      <span className="text-[length:var(--text-sm)] text-[var(--muted)]">
                        —
                      </span>
                    ) : (
                      <ul className="flex flex-col gap-[var(--space-1)]">
                        {selectedNodeEdges.map((edge) => {
                          const otherId =
                            edge.sourceNodeId === selectedNode.id
                              ? edge.targetNodeId
                              : edge.sourceNodeId;
                          const otherNode = nodes.find((n) => n.id === otherId);
                          const direction =
                            edge.sourceNodeId === selectedNode.id ? "→" : "←";
                          return (
                            <li
                              key={edge.id}
                              className="text-[length:var(--text-sm)] text-[var(--fg-2)]"
                            >
                              {direction} {edge.relation}: {otherNode?.label ?? otherId.slice(0, 8)}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </dd>
                </div>
              </dl>
            </div>
            {/* 删除按钮 */}
            <div className="border-t border-[var(--border)] p-[var(--space-3)]">
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(t("confirmDelete"))) {
                    void handleDeleteNode();
                  }
                }}
                disabled={deleting}
                className="inline-flex w-full items-center justify-center gap-[var(--space-1)] rounded-[var(--radius-sm)] border border-[var(--danger)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--danger)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--danger)] hover:text-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              >
                {deleting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
                {t("deleteNode")}
              </button>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}