"use client";

/**
 * AI 助理对话面板 · AssistantPanel
 *
 * 类 ChatGPT 界面，但能调用项目内 AI 能力（语义搜索/邮件助手/会议纪要…）。
 * 后端通过 /api/v1/ai/assistant/chat 路由协调多能力，按 phase 推进对话阶段。
 *
 * 数据流：
 *  - 进入时拉 /api/v1/ai/assistant/suggestions?phase=… 获取建议卡片
 *  - 用户发送消息 → POST /chat → 返回 content + capabilityId + suggestions + nextPhase
 *  - 阶段（phase）变化会重新拉建议卡片
 *
 * 样式：design token（var(--*)），无裸 hex；lucide-react 图标 size 16
 * i18n：useTranslations("assistant")
 */

import { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Send, Sparkles, Loader2 } from "lucide-react";

/** 单条对话消息 */
interface Message {
  role: "user" | "assistant";
  content: string;
  /** 命中的 AI 能力 ID（仅 assistant 消息） */
  capability?: string;
  /** 跟进建议（点击填入输入框） */
  suggestions?: string[];
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

export function AssistantPanel({ wid }: { wid: string }) {
  const t = useTranslations("assistant");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<string>("in_progress");
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

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
    const userMessage: Message = { role: "user", content: input.trim() };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/v1/ai/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wid, message: userMessage.content, phase }),
      });
      const json = await res.json();
      if (!json.data) {
        // HTTP 错误状态码区分：429 限流 vs 其他错误
        const errorMsg = res.status === 429 ? t("rateLimited") : t("error");
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: errorMsg, ts: Date.now() },
        ]);
        return;
      }
      const assistantMessage: Message = {
        role: "assistant",
        content: json.data.content,
        capability: json.data.capabilityId,
        suggestions: json.data.suggestions,
      };
      setMessages((prev) => [...prev, assistantMessage]);
      if (json.data.nextPhase) setPhase(json.data.nextPhase);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: t("error") }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col" style={{ height: "calc(100dvh - var(--space-16))" }}>
      {/* ─── 消息列表 ─── */}
      <div className="flex-1 overflow-y-auto" style={{ padding: "var(--space-4)" }}>
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Sparkles size={32} strokeWidth={1.5} className="text-[var(--accent)]" />
            <p className="text-[length:var(--text-lg)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
              {t("welcome")}
            </p>
            <p className="text-[length:var(--text-sm)] text-[var(--muted)]">{t("welcomeDesc")}</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className="mb-4 flex flex-col gap-2">
            <div
              className="rounded-[var(--radius-lg)] px-4 py-3"
              style={{
                alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "80%",
                background: msg.role === "user" ? "var(--accent)" : "var(--surface)",
                color: msg.role === "user" ? "var(--accent-fg)" : "var(--fg)",
                border: msg.role === "user" ? "none" : "1px solid var(--border)",
              }}
            >
              {msg.capability && (
                <p className="mb-1 text-[length:var(--text-xs)] opacity-70">
                  {t("capability")}: {msg.capability}
                </p>
              )}
              <p className="whitespace-pre-wrap text-[length:var(--text-sm)] leading-[var(--leading-relaxed)]">
                {msg.content}
              </p>
              {msg.suggestions && msg.suggestions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {msg.suggestions.map((s, j) => (
                    <button
                      key={j}
                      type="button"
                      onClick={() => setInput(s)}
                      className="rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1 text-[length:var(--text-xs)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-hover)]"
                    >
                      {s}
                    </button>
                  ))}
                </div>
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
        <div className="flex flex-wrap gap-2" style={{ padding: "0 var(--space-4) var(--space-2)" }}>
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