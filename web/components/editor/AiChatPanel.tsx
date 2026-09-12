"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useTranslations } from "next-intl";
import { Send, X, Trash2, RotateCcw } from "lucide-react";
import Markdown from "@/components/Markdown";

/**
 * AI 问答侧边栏
 *
 * 连接 POST /api/v1/ai/chat 流式接口，针对当前文档内容进行问答。
 *
 * 技术要点：
 *  - useChat（@ai-sdk/react v7）消费 toUIMessageStreamResponse 流
 *  - DefaultChatTransport + prepareSendMessagesRequest 适配后端自定义 body
 *    （{ question, documentContent, history }），而非 AI SDK 默认 { messages }
 *  - documentContent 通过 ref + Resolvable body 函数实时读取，避免 transport 重建
 *  - AI 消息用项目内置 Markdown 组件渲染（零依赖、安全）
 *  - 样式全走 design token（var(--*)），尊重 prefers-reduced-motion（全局降级块）
 *
 * 来源：经验 2026-09-11-prefers-reduced-motion-global-block-and-max-duration
 *       （动画用 --motion-* token，全局降级块自动收敛）
 */

interface AiChatPanelProps {
  /** 当前文档纯文本或 markdown，作为 AI 问答上下文 */
  documentContent: string;
  /** 关闭面板回调 */
  onClose?: () => void;
}

/** 后端 history 条目格式 */
interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
}

/**
 * 从 UIMessage 提取纯文本（拼接所有 text part）。
 * v7 的 UIMessage 用 parts 数组而非顶层 content 字符串。
 */
function getMessageText(message: UIMessage): string {
  let text = "";
  for (const part of message.parts) {
    if (part.type === "text") text += part.text;
  }
  return text;
}

/**
 * 将 UIMessage[] 转换为后端期望的 { question, history } 格式。
 *
 * question = 最后一条 user 消息的文本；
 * history  = question 之前的所有 user/assistant 消息。
 *
 * 处理 regenerate 场景：末尾可能有 assistant 消息，需跳过找到最后的 user。
 */
function extractQuestionAndHistory(messages: UIMessage[]): {
  question: string;
  history: HistoryEntry[];
} {
  const mapped: HistoryEntry[] = [];
  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const content = getMessageText(m);
    if (!content) continue;
    mapped.push({ role: m.role, content });
  }

  // 跳过末尾的 assistant 消息（regenerate 场景），找到最后的 user
  let end = mapped.length;
  while (end > 0 && mapped[end - 1].role === "assistant") end--;

  if (end === 0) return { question: "", history: [] };

  return {
    question: mapped[end - 1].content,
    history: mapped.slice(0, end - 1),
  };
}

export default function AiChatPanel({ documentContent, onClose }: AiChatPanelProps) {
  const t = useTranslations("ai.chat");
  const tBtn = useTranslations("button");

  // 用 ref 存 documentContent，使 transport 的 body Resolvable 函数始终读到最新值，
  // 而 transport 实例本身只需创建一次（避免重建丢失 chat 状态）。
  const docContentRef = useRef(documentContent);
  docContentRef.current = documentContent;

  // 创建 transport（只创建一次）
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/v1/ai/chat",
        // Resolvable 函数：每次请求时解析，读 ref 最新值
        body: () => ({ documentContent: docContentRef.current }),
        // 将 AI SDK 标准的 { messages } 转为后端自定义的 { question, documentContent, history }
        prepareSendMessagesRequest: ({ messages, body }) => {
          const { question, history } = extractQuestionAndHistory(messages);
          return {
            body: {
              question,
              documentContent: (body as { documentContent?: string } | undefined)?.documentContent ?? "",
              history,
            },
          };
        },
      }),
    [],
  );

  const { messages, sendMessage, status, error, setMessages, regenerate } = useChat({
    transport,
  });

  // 输入框状态（v7 useChat 不再内置 input 状态，自行管理）
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isStreaming = status === "streaming" || status === "submitted";
  const hasError = status === "error" || error != null;
  const canSend = input.trim().length > 0 && !isStreaming;

  // 消息列表自动滚动到底部
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  // 发送消息
  const handleSend = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    // 重置 textarea 高度
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    try {
      await sendMessage({ text });
    } catch {
      // useChat 会设置 error 状态，此处仅防止未处理的 Promise rejection
    }
  };

  // Enter 发送 / Shift+Enter 换行
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  // textarea 自动调整高度
  const handleInput = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.currentTarget.value);
    const el = e.currentTarget;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  // 清空对话
  const handleClear = () => {
    setMessages([]);
  };

  // 重试：重新生成最后一条回复
  const handleRetry = () => {
    void regenerate();
  };

  return (
    <aside
      className="flex h-full w-[400px] flex-col border-l border-[var(--border)] bg-[var(--surface)]"
      aria-label={t("title")}
    >
      {/* 标题栏 */}
      <header className="flex items-center justify-between px-[var(--space-4)] py-[var(--space-3)]">
        <h2 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          {t("title")}
        </h2>
        <div className="flex items-center gap-[var(--space-1)]">
          {/* 清空对话 */}
          <button
            type="button"
            onClick={handleClear}
            disabled={messages.length === 0 || isStreaming}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            aria-label={t("clear")}
            title={t("clear")}
          >
            <Trash2 size={16} />
          </button>
          {/* 关闭面板 */}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              aria-label={tBtn("close")}
              title={tBtn("close")}
            >
              <X size={16} />
            </button>
          )}
        </div>
      </header>

      {/* 消息列表 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-[var(--space-3)] py-[var(--space-2)]"
      >
        {messages.length === 0 ? (
          /* 空状态 */
          <div className="flex h-full flex-col items-center justify-center gap-[var(--space-2)] text-center">
            <p className="text-[length:var(--text-sm)] text-[var(--meta)]">
              {t("emptyState")}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-[var(--space-3)]">
            {messages.map((message) => {
              const text = getMessageText(message);
              if (!text && message.role === "assistant" && status === "streaming") {
                return null; // 空的流式 assistant 消息由 typing indicator 处理
              }
              const isUser = message.role === "user";
              return (
                <div
                  key={message.id}
                  className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}
                >
                  <div
                    className={
                      isUser
                        ? // 用户消息：accent 背景、右对齐
                          "max-w-[80%] rounded-[var(--radius-md)] bg-[var(--accent)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--on-accent)]"
                        : // AI 消息：surface-2 背景、左对齐、markdown 渲染
                          "max-w-[80%] rounded-[var(--radius-md)] bg-[var(--surface-2)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg-2)]"
                    }
                  >
                    {isUser ? (
                      <span className="whitespace-pre-wrap break-words">{text}</span>
                    ) : (
                      <div className="break-words [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
                        <Markdown source={text} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Typing indicator：AI 正在思考 */}
            {isStreaming && (
              <div className="flex items-start">
                <div className="flex items-center gap-1 rounded-[var(--radius-md)] bg-[var(--surface-2)] px-[var(--space-3)] py-[var(--space-3)]">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--meta)]" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--meta)] [animation-delay:200ms]" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--meta)] [animation-delay:400ms]" />
                </div>
              </div>
            )}

            {/* 错误提示 + 重试 */}
            {hasError && (
              <div className="flex items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--danger)] bg-[var(--danger-soft)] px-[var(--space-3)] py-[var(--space-2)]">
                <span className="text-[length:var(--text-sm)] text-[var(--danger)]">
                  {t("error")}
                </span>
                <button
                  type="button"
                  onClick={handleRetry}
                  className="ml-auto inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-[length:var(--text-xs)] text-[var(--danger)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                >
                  <RotateCcw size={14} />
                  {tBtn("retry")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 输入区 */}
      <footer className="border-t border-[var(--border)] p-[var(--space-3)]">
        <div className="flex items-end gap-[var(--space-2)]">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={t("placeholder")}
            rows={1}
            disabled={isStreaming}
            className="flex-1 resize-none rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg)] placeholder:text-[var(--meta)] transition-colors duration-[var(--motion-fast)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)] disabled:opacity-50"
            style={{ maxHeight: "120px" }}
            aria-label={t("placeholder")}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className="inline-flex h-[var(--control-h)] w-[var(--control-h)] shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--on-accent)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            aria-label={t("send")}
            title={t("send")}
          >
            <Send size={16} />
          </button>
        </div>
      </footer>
    </aside>
  );
}