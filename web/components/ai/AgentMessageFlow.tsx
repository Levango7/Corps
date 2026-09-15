"use client";

/**
 * Agent 消息流可视化（方向 D）。
 *
 * 展示 Agent 间通信记录：
 *  - 每条消息卡片：from Agent → to Agent（或"广播"），content，type 标签，时间
 *  - from→to 用箭头连接，type 用不同颜色标签
 *  - 支持按 type 过滤
 *
 * Design token 样式 + lucide-react 图标（ArrowRight / Radio 等）size 14/16。
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  MessageSquare,
  ArrowRight,
  Radio,
  Loader2,
  AlertCircle,
  X,
  Filter,
} from "lucide-react";
import { api } from "@/lib/api";

/** Agent 消息类型（与后端 AiAgentMessage 一致） */
interface AgentMessage {
  id: string;
  fromAgentId: string;
  toAgentId: string | null;
  content: string;
  type: string;
  metadata: unknown;
  createdAt: string;
}

/** Agent 简要信息（用于显示名称） */
interface Agent {
  id: string;
  name: string;
}

/** 消息列表响应 */
interface MessageListResponse {
  items: AgentMessage[];
  total: number;
  skip: number;
  take: number;
}

/** 合法消息类型 */
const MESSAGE_TYPES = [
  "request",
  "response",
  "notification",
  "handoff",
] as const;

/** type → 颜色样式映射（design token） */
const TYPE_STYLES: Record<string, string> = {
  request:
    "bg-[var(--accent-soft)] text-[var(--accent-fg)] border-[var(--accent)]",
  response:
    "bg-[var(--success-soft)] text-[var(--success-fg)] border-[var(--success-fg)]",
  notification:
    "bg-[var(--warning-soft)] text-[var(--warning-fg)] border-[var(--warning-fg)]",
  handoff:
    "bg-[var(--surface-2)] text-[var(--fg-2)] border-[var(--border)]",
};

/** 格式化时间显示 */
function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** AgentMessageFlow Props */
interface AgentMessageFlowProps {
  /** 工作区 ID */
  wid: string;
  /** Agent ID */
  agentId?: string;
}

export default function AgentMessageFlow({
  wid,
  agentId,
}: AgentMessageFlowProps) {
  const t = useTranslations("ai.aiAgent");

  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [agents, setAgents] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  // AbortController
  const abortRef = useRef<AbortController | null>(null);

  /** 加载消息列表 */
  async function loadMessages() {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError("");
    try {
      // 并行加载消息和 Agent 列表（用于名称映射）
      const [messageData, agentList] = await Promise.all([
        agentId
          ? api<MessageListResponse>(
              `/api/v1/ai/agents/${agentId}/messages?wid=${encodeURIComponent(wid)}&take=100`,
              { signal: ac.signal },
            )
          : api<MessageListResponse>(
              `/api/v1/ai/agents?wid=${encodeURIComponent(wid)}`,
              { signal: ac.signal },
            ).then(async (agents) => {
              // 无 agentId 时聚合所有 Agent 的消息
              if (!Array.isArray(agents) || agents.length === 0) {
                return { items: [], total: 0, skip: 0, take: 100 };
              }
              const allMessages = await Promise.all(
                (agents as Agent[]).map((a) =>
                  api<MessageListResponse>(
                    `/api/v1/ai/agents/${a.id}/messages?wid=${encodeURIComponent(wid)}&take=50`,
                    { signal: ac.signal },
                  ).catch(() => ({ items: [], total: 0, skip: 0, take: 50 })),
                ),
              );
              const items = allMessages
                .flatMap((m) => m.items)
                .sort(
                  (a, b) =>
                    new Date(b.createdAt).getTime() -
                    new Date(a.createdAt).getTime(),
                )
                .slice(0, 100);
              return { items, total: items.length, skip: 0, take: 100 };
            }),
        api<Agent[]>(`/api/v1/ai/agents?wid=${encodeURIComponent(wid)}`, {
          signal: ac.signal,
        }).catch(() => [] as Agent[]),
      ]);

      if (ac.signal.aborted) return;
      setMessages(messageData.items);
      // 构建 Agent ID → name 映射
      const map = new Map<string, string>();
      (agentList as Agent[]).forEach((a) => map.set(a.id, a.name));
      setAgents(map);
    } catch (e) {
      if (ac.signal.aborted || (e instanceof Error && e.name === "AbortError"))
        return;
      if (process.env.NODE_ENV === "development")
        console.error("[AgentMessageFlow] loadMessages error:", e);
      setError(t("loadFailed"));
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    loadMessages();
    return () => {
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wid, agentId]);

  /** 获取 Agent 名称 */
  function agentName(id: string): string {
    return agents.get(id) ?? id.slice(0, 8);
  }

  /** 过滤后的消息 */
  const filteredMessages = typeFilter
    ? messages.filter((m) => m.type === typeFilter)
    : messages;

  return (
    <div
      className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-sm)]"
      aria-label={t("messages")}
    >
      {/* ── 头部 ── */}
      <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
        <h2 className="flex items-center gap-2 text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          <MessageSquare size={16} className="text-[var(--accent)]" />
          {t("messages")}
        </h2>
        {/* type 过滤 */}
        <div className="flex items-center gap-1.5">
          <Filter size={14} className="text-[var(--muted)]" />
          <button
            type="button"
            onClick={() => setTypeFilter(null)}
            className={`px-2 py-0.5 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] ${
              typeFilter === null
                ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                : "text-[var(--muted)] hover:bg-[var(--surface-2)]"
            }`}
          >
            {t("type")}
          </button>
          {MESSAGE_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() =>
                setTypeFilter(typeFilter === type ? null : type)
              }
              className={`px-2 py-0.5 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] ${
                typeFilter === type
                  ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                  : "text-[var(--muted)] hover:bg-[var(--surface-2)]"
              }`}
            >
              {t(type)}
            </button>
          ))}
        </div>
      </header>

      {/* ── 正文 ── */}
      <div className="px-5 py-4 space-y-[var(--space-2)]">
        {/* 错误态 */}
        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={() => setError("")}
              className="shrink-0 opacity-60 hover:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] rounded-[var(--radius-sm)]"
              aria-label="close"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* 加载态 */}
        {loading && (
          <div className="flex items-center justify-center py-8 text-[var(--muted)] text-[length:var(--text-sm)]">
            <Loader2 size={16} className="animate-spin mr-2" />
            {t("loadFailed")}
          </div>
        )}

        {/* 空态 */}
        {!loading && filteredMessages.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--muted)] text-[length:var(--text-sm)] gap-2">
            <MessageSquare size={32} className="opacity-40" />
            <p>{t("noMessages")}</p>
          </div>
        )}

        {/* 消息列表 */}
        {!loading && filteredMessages.length > 0 && (
          <ul className="space-y-2">
            {filteredMessages.map((msg) => (
              <li
                key={msg.id}
                className="p-2.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]"
              >
                {/* 消息头：from → to + type + time */}
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-1.5 text-[length:var(--text-xs)] min-w-0">
                    {/* from Agent */}
                    <span className="font-[weight:var(--weight-medium)] text-[var(--fg)] truncate">
                      {agentName(msg.fromAgentId)}
                    </span>
                    {/* 箭头 */}
                    <ArrowRight
                      size={12}
                      className="text-[var(--muted)] shrink-0"
                    />
                    {/* to Agent 或广播 */}
                    {msg.toAgentId ? (
                      <span className="font-[weight:var(--weight-medium)] text-[var(--fg)] truncate">
                        {agentName(msg.toAgentId)}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5 text-[var(--accent)] shrink-0">
                        <Radio size={12} />
                        {t("broadcast")}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* type 标签 */}
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] border ${TYPE_STYLES[msg.type] ?? TYPE_STYLES.notification}`}
                    >
                      {t(msg.type)}
                    </span>
                    {/* 时间 */}
                    <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
                      {formatTime(msg.createdAt)}
                    </span>
                  </div>
                </div>
                {/* 消息内容 */}
                <p className="text-[length:var(--text-sm)] text-[var(--fg)] whitespace-pre-wrap break-words">
                  {msg.content}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}