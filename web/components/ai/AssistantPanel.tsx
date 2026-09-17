"use client";

/**
 * AI 助理对话面板 · AssistantPanel
 *
 * 类 ChatGPT 界面，但能调用项目内 AI 能力（语义搜索/邮件助手/会议纪要…）。
 * 后端通过 /api/v1/ai/assistant/chat 路由协调多能力，按 phase 推进对话阶段。
 *
 * 数据流：
 *  - 进入时拉 /api/v1/ai/assistant/conversations?wid=… 获取历史对话列表
 *  - 拉 /api/v1/ai/assistant/suggestions?phase=… 获取建议卡片
 *  - 用户发送消息 → POST /chat（带 conversationId）→ 返回 content + capabilityId +
 *    suggestions + nextPhase + recommendedNext + conversationId
 *  - 阶段（phase）变化会重新拉建议卡片
 *  - 切换历史对话 → GET /conversations?wid=…&id=… 加载该对话消息
 *
 * 样式：design token（var(--*)），无裸 hex；lucide-react 图标 size 14/16
 * i18n：useTranslations("assistant")
 *
 * 来源：M1-B 前端任务 325（AI 助理前端深化）
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  Send,
  Sparkles,
  Loader2,
  Plus,
  History,
  MessageSquare,
  ChevronRight,
} from "lucide-react";
import { logger } from "@/lib/logger";

/**
 * 生成唯一消息 ID。
 * 优先用 crypto.randomUUID()（Web Crypto API，现代浏览器均支持），
 * 不可用时回退到时间戳 + 随机数。
 */
function genMessageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 按 Unicode 码点安全截断字符串，避免截断 emoji 代理对（surrogate pair）。
 *
 * 原生 String.prototype.slice 按 UTF-16 码元切分，遇到由两个码元组成的
 * emoji（如 😀 = \uD83D\uDE00）时可能从中间截断，产生乱码。
 * Array.from 按码点迭代，确保每个 emoji 作为整体保留。
 *
 * @param str 原始字符串
 * @param maxLen 最大码点数（不是 UTF-16 码元数）
 * @param ellipsis 截断后追加的省略号，默认 "…"
 */
function truncateSafe(str: string, maxLen: number, ellipsis = "…"): string {
  const chars = Array.from(str);
  if (chars.length <= maxLen) return str;
  return chars.slice(0, maxLen).join("") + ellipsis;
}

/** 单条对话消息 */
interface Message {
  /** 唯一 ID，用作 React list key（避免用数组索引导致渲染异常） */
  id: string;
  role: "user" | "assistant";
  content: string;
  /** 命中的 AI 能力 ID（仅 assistant 消息） */
  capability?: string;
  /** 跟进建议（点击填入输入框） */
  suggestions?: string[];
  /** 推荐的下一步能力（任务全流程串联，来自后端 recommendedNext） */
  recommendedNext?: { nextCapability: string; reason: string };
  /** 时间戳（错误消息用于强制刷新） */
  ts?: number;
}

/** 建议卡片项 */
interface SuggestionItem {
  id: string;
  /** 旧格式：直接展示的标签文本 */
  label?: string;
  /** 新格式：i18n key（优先于 label） */
  labelKey?: string;
  description: string;
}

/** 历史对话项（与后端 conversations API 返回结构对齐） */
interface ConversationItem {
  id: string;
  createdAt: string;
  updatedAt: string;
  _count: { messages: number };
}

export function AssistantPanel({ wid }: { wid: string }) {
  const t = useTranslations("assistant");
  const tt = useTranslations("time");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<string>("in_progress");
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  /** 当前对话 ID（null 表示新对话，首次发送后由后端创建并回填） */
  const [conversationId, setConversationId] = useState<string | null>(null);
  /** 历史对话列表 */
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  /** 历史下拉面板展开状态 */
  const [showHistory, setShowHistory] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  /** 相对时间格式化（复用 time 命名空间 i18n key） */
  const formatRelativeTime = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diff / 60_000);
    if (min < 1) return tt("justNow");
    if (min < 60) return tt("minutesAgo", { count: min });
    const hr = Math.floor(min / 60);
    if (hr < 24) return tt("hoursAgo", { count: hr });
    const day = Math.floor(hr / 24);
    return tt("daysAgo", { count: day });
  };

  /** 拉取历史对话列表 */
  const loadConversations = useCallback(() => {
    fetch(`/api/v1/ai/assistant/conversations?wid=${wid}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.data?.conversations) setConversations(json.data.conversations);
      })
      .catch(() => {
        // 静默失败，不影响主流程
      });
  }, [wid]);

  // 进入时拉历史对话列表
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // 拉取建议卡片（按阶段）
  useEffect(() => {
    fetch(`/api/v1/ai/assistant/suggestions?phase=${phase}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.data?.suggestions) setSuggestions(json.data.suggestions);
      })
      .catch(() => {
        // 静默失败，不影响主流程
      });
  }, [phase]);

  // 消息列表自动滚动到底部
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /** 发送消息 */
  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const userMessage: Message = {
      id: genMessageId(),
      role: "user",
      content: input.trim(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/v1/ai/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wid,
          message: userMessage.content,
          phase,
          conversationId: conversationId ?? undefined,
        }),
      });
      const json = await res.json();
      if (!json.data) {
        // HTTP 错误状态码区分：429 限流 vs 其他错误
        const errorMsg = res.status === 429 ? t("rateLimited") : t("error");
        setMessages((prev) => [
          ...prev,
          {
            id: genMessageId(),
            role: "assistant",
            content: errorMsg,
            ts: Date.now(),
          },
        ]);
        return;
      }
      const assistantMessage: Message = {
        id: genMessageId(),
        role: "assistant",
        content: json.data.content,
        capability: json.data.capabilityId,
        suggestions: json.data.suggestions,
        recommendedNext: json.data.recommendedNext,
      };
      setMessages((prev) => [...prev, assistantMessage]);
      // 回填 conversationId（新对话首次发送时由后端创建）
      if (json.data.conversationId) setConversationId(json.data.conversationId);
      if (json.data.nextPhase) setPhase(json.data.nextPhase);
      // 刷新历史对话列表（新对话会出现在列表顶部）
      loadConversations();
    } catch (e) {
      logger.warn("AssistantPanel: chat request failed", {
        error: e instanceof Error ? e.message : String(e),
      });
      setMessages((prev) => [
        ...prev,
        { id: genMessageId(), role: "assistant", content: t("error") },
      ]);
    } finally {
      setLoading(false);
    }
  };

  /** 切换到历史对话（加载该对话的消息列表） */
  const handleSwitchConversation = async (convId: string) => {
    if (convId === conversationId) {
      setShowHistory(false);
      return;
    }
    setConversationId(convId);
    setShowHistory(false);
    setMessages([]);
    setLoading(true);
    try {
      const res = await fetch(
        `/api/v1/ai/assistant/conversations?wid=${wid}&id=${convId}`,
      );
      const json = await res.json();
      if (json.data?.messages) {
        // 后端返回的消息可能没有 id 字段，逐条生成唯一 id 用作 React key
        setMessages(
          (json.data.messages as Omit<Message, "id">[]).map((msg) => ({
            ...msg,
            id: genMessageId(),
          })),
        );
      }
    } catch (e) {
      // 加载失败则保持空消息列表，用户可继续发起新消息
      logger.warn("AssistantPanel: load conversation failed", {
        convId,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  };

  /** 开始新对话（清空当前对话状态） */
  const handleNewChat = () => {
    setConversationId(null);
    setMessages([]);
    setShowHistory(false);
    setInput("");
  };

  return (
    <div
      className="flex h-full flex-col"
      style={{ height: "calc(100dvh - var(--space-16))" }}
    >
      {/* ─── 顶部工具栏：标题 + 历史对话 + 新对话 ─── */}
      <div
        className="relative flex items-center justify-between border-b border-[var(--border)]"
        style={{ padding: "var(--space-3) var(--space-4)" }}
      >
        <div className="flex items-center gap-2">
          <Sparkles size={16} strokeWidth={2} className="text-[var(--accent)]" />
          <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
            {t("welcome")}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* 历史对话按钮 */}
          <button
            type="button"
            aria-label={t("history")}
            onClick={() => setShowHistory((v) => !v)}
            className="flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-[var(--muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]"
          >
            <History size={14} strokeWidth={2} />
            <span className="text-[length:var(--text-xs)]">{t("history")}</span>
          </button>
          {/* 新对话按钮 */}
          <button
            type="button"
            aria-label={t("newChat")}
            onClick={handleNewChat}
            className="flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-[var(--muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]"
          >
            <Plus size={14} strokeWidth={2} />
            <span className="text-[length:var(--text-xs)]">{t("newChat")}</span>
          </button>
        </div>

        {/* 历史对话下拉面板 */}
        {showHistory && (
          <div
            className="absolute right-0 top-full z-10 mt-1 w-72 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] shadow-lg"
            style={{ maxHeight: "320px" }}
          >
            {conversations.length === 0 ? (
              <div
                className="text-center text-[length:var(--text-xs)] text-[var(--muted)]"
                style={{ padding: "var(--space-4)" }}
              >
                {t("historyEmpty")}
              </div>
            ) : (
              conversations.map((conv) => (
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => handleSwitchConversation(conv.id)}
                  className="flex w-full items-center gap-2 border-b border-[var(--border)] text-left transition-colors last:border-b-0 hover:bg-[var(--surface-hover)]"
                  style={{ padding: "var(--space-2) var(--space-3)" }}
                  aria-current={conv.id === conversationId ? "true" : undefined}
                >
                  <MessageSquare
                    size={14}
                    strokeWidth={2}
                    className={
                      conv.id === conversationId
                        ? "text-[var(--accent)]"
                        : "text-[var(--muted)]"
                    }
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[length:var(--text-xs)] text-[var(--fg)]">
                      {t("msgCount", { count: conv._count.messages })}
                    </span>
                    <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
                      {formatRelativeTime(conv.updatedAt)}
                    </span>
                  </div>
                  {conv.id === conversationId && (
                    <ChevronRight
                      size={12}
                      strokeWidth={2}
                      className="text-[var(--accent)]"
                    />
                  )}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* ─── 消息列表 ─── */}
      <div className="flex-1 overflow-y-auto" style={{ padding: "var(--space-4)" }}>
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Sparkles size={32} strokeWidth={1.5} className="text-[var(--accent)]" />
            <p className="text-[length:var(--text-lg)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
              {t("welcome")}
            </p>
            <p className="text-[length:var(--text-sm)] text-[var(--muted)]">
              {t("welcomeDesc")}
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className="mb-4 flex flex-col gap-2">
            <div
              className="rounded-[var(--radius-lg)] px-4 py-3"
              style={{
                alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "80%",
                background:
                  msg.role === "user" ? "var(--accent)" : "var(--surface)",
                color: msg.role === "user" ? "var(--accent-fg)" : "var(--fg)",
                border: msg.role === "user" ? "none" : "1px solid var(--border)",
              }}
            >
              {/* 能力标签：assistant 消息且命中能力时在内容上方展示 */}
              {msg.capability && (
                <div
                  className="mb-1 flex items-center gap-1"
                  style={{ marginBottom: "var(--space-1)" }}
                >
                  <span className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--surface-hover)] px-1.5 py-0.5 text-[length:var(--text-xs)] text-[var(--meta)]">
                    <Sparkles size={10} strokeWidth={2} />
                    {t("capability")}: {msg.capability}
                  </span>
                </div>
              )}
              <p className="whitespace-pre-wrap text-[length:var(--text-sm)] leading-[var(--leading-relaxed)]">
                {/* 超长消息安全截断：按 Unicode 码点切分，避免截断 emoji 代理对 */}
                {msg.content.length > 10000
                  ? truncateSafe(msg.content, 10000)
                  : msg.content}
              </p>
              {/* 跟进建议（点击填入输入框） */}
              {msg.suggestions && msg.suggestions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {msg.suggestions.map((s, j) => (
                    <button
                      key={`${msg.id}-s-${j}`}
                      type="button"
                      onClick={() => setInput(s)}
                      className="rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1 text-[length:var(--text-xs)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-hover)]"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
              {/* 阶段流转：推荐的下一步能力按钮 */}
              {msg.recommendedNext && (
                <button
                  type="button"
                  onClick={() => setInput(msg.recommendedNext!.reason)}
                  className="mt-2 flex w-full items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--accent)] bg-transparent px-2 py-1.5 text-left transition-colors hover:bg-[var(--accent)] hover:text-[var(--accent-fg)]"
                  style={{ marginTop: "var(--space-2)" }}
                >
                  <Sparkles
                    size={14}
                    strokeWidth={2}
                    className="text-[var(--accent)]"
                  />
                  <span className="text-[length:var(--text-xs)] text-[var(--accent)]">
                    {t("nextStep")}:
                  </span>
                  <span className="flex-1 text-[length:var(--text-xs)] text-[var(--fg)]">
                    {msg.recommendedNext.reason}
                  </span>
                  <ChevronRight size={12} strokeWidth={2} className="text-[var(--muted)]" />
                </button>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-[var(--muted)]">
            <Loader2 size={16} strokeWidth={2} className="animate-spin" />
            <span className="text-[length:var(--text-sm)]">{t("thinking")}</span>
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      {/* ─── 建议卡片（仅空对话时展示） ─── */}
      {suggestions.length > 0 && messages.length === 0 && (
        <div
          className="flex flex-wrap gap-2"
          style={{ padding: "0 var(--space-4) var(--space-2)" }}
        >
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setInput(s.description)}
              className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 transition-colors hover:bg-[var(--surface-hover)]"
            >
              <Sparkles size={14} strokeWidth={2} className="text-[var(--accent)]" />
              <span className="text-[length:var(--text-sm)] text-[var(--fg)]">
                {s.labelKey ? t(s.labelKey) : s.label}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* ─── 输入框 ─── */}
      <div
        className="flex gap-2 border-t border-[var(--border)]"
        style={{ padding: "var(--space-3) var(--space-4)" }}
      >
        <input
          type="text"
          aria-label={t("placeholder")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder={t("placeholder")}
          disabled={loading}
          className="flex-1 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
        />
        <button
          type="button"
          aria-label={t("send")}
          onClick={handleSend}
          disabled={loading || !input.trim()}
          className="flex items-center justify-center rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 py-2 text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
        >
          <Send size={16} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
