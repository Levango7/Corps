"use client";

/**
 * 跨模块 AI 知识问答面板（多轮对话版）。
 *
 * 用户输入自然语言问题，调用 POST /api/v1/ai/knowledge-qa 流式接口，
 * AI 基于工作区跨模块上下文（任务/文档/会议/审批/工时/Wiki/决策/OKR/消息）
 * 逐字渲染 markdown 回答。支持多轮对话、追问建议、对话管理。
 *
 * 技术要点：
 *  - useChat（@ai-sdk/react v7）消费 toUIMessageStreamResponse 流
 *  - DefaultChatTransport + prepareSendMessagesRequest 适配后端自定义 body
 *    （{ wid, question, conversationId }），而非 AI SDK 默认 { messages }
 *  - conversationId 通过 ref + Resolvable body 函数实时读取，避免 transport 重建
 *  - AI 回答完成后调用 follow-up-suggestions API 获取 3 个追问建议
 *  - 追问建议可点击直接发送
 *  - "新建对话"按钮创建新对话并清空消息
 *  - 样式全走 design token（var(--*)），lucide-react 图标 size 14/16
 *
 * 来源：经验 2026-09-13-dashboard-widget-registry-multi-file-extension
 *       （组件 Props 统一 { wid: string }，数据通过 hook/API 加载）
 *       经验 2026-09-11-generic-empty-state-component-svg-illustration-migration
 *       （空状态处理 + design token 样式）
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type MouseEvent } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useTranslations } from "next-intl";
import { Brain, Send, Loader2, AlertTriangle, Square, Plus, MessageSquare, Trash2 } from "lucide-react";
import Markdown from "@/components/Markdown";
import { api } from "@/lib/api";
import { useToast } from "@/components/Toast";

interface KnowledgeQaPanelProps {
  /** 工作区 ID */
  wid: string;
}

/** 对话列表项（来自 GET /api/v1/ai/conversations） */
interface ConversationItem {
  id: string;
  title: string;
  scopes: unknown;
  createdAt: string;
  updatedAt: string;
  _count: { messages: number };
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
 * 从 UIMessage[] 提取最后的 user 问题文本。
 * 跳过末尾的 assistant 消息（regenerate 场景），找到最后的 user。
 */
function extractLastQuestion(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      return getMessageText(messages[i]);
    }
  }
  return "";
}

export function KnowledgeQaPanel({ wid }: KnowledgeQaPanelProps) {
  const t = useTranslations("ai.knowledgeQa");
  const { toast } = useToast();

  // 对话状态
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [showConversationList, setShowConversationList] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  // 用 ref 存 conversationId，使 transport 的 body Resolvable 函数始终读到最新值
  const convIdRef = useRef<string | null>(null);
  convIdRef.current = conversationId;

  // 追踪已获取追问建议的 message ID，避免重复请求
  const fetchedSuggestionsRef = useRef<Set<string>>(new Set());
  // 上一次的 status，用于检测 streaming → ready 转换
  const prevStatusRef = useRef<string>("ready");

  // 创建 transport（只创建一次）
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/v1/ai/knowledge-qa",
        // Resolvable 函数：每次请求时解析，读 ref 最新值
        body: () => ({ wid, conversationId: convIdRef.current }),
        // 将 AI SDK 标准的 { messages } 转为后端自定义的 { wid, question, conversationId }
        prepareSendMessagesRequest: ({ messages, body }) => {
          const question = extractLastQuestion(messages);
          return {
            body: {
              wid,
              question,
              conversationId: (body as { conversationId?: string | null } | undefined)?.conversationId ?? null,
            },
          };
        },
      }),
    [wid],
  );

  const { messages, sendMessage, status, error, setMessages, stop } = useChat({
    transport,
  });

  // 输入框状态
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
  }, [messages, status, suggestions]);

  /** 加载对话列表 */
  const loadConversations = useCallback(async () => {
    try {
      const data = await api<ConversationItem[]>(`/api/v1/ai/conversations?wid=${wid}`);
      setConversations(Array.isArray(data) ? data : []);
    } catch (e) {
      // 不静默失败，提示用户
      if (process.env.NODE_ENV === "development") {
        console.error("[KnowledgeQaPanel] loadConversations error:", e instanceof Error ? e.message : e);
      }
      toast("error", t("loadFailed"));
    }
  }, [wid, t, toast]);

  /** 创建新对话 */
  const handleNewConversation = useCallback(async () => {
    const title = t("newConversation");
    try {
      const data = await api<{ id: string }>("/api/v1/ai/conversations", {
        method: "POST",
        body: JSON.stringify({ wid, title }),
      });
      setConversationId(data.id);
      setMessages([]);
      setSuggestions([]);
      setShowConversationList(false);
      // P2-8: 创建成功后刷新对话列表，保证侧栏列表包含新对话
      void loadConversations();
    } catch (e) {
      if (process.env.NODE_ENV === "development") {
        console.error("[KnowledgeQaPanel] handleNewConversation error:", e instanceof Error ? e.message : e);
      }
      toast("error", t("createFailed"));
    }
  }, [wid, t, toast, setMessages, loadConversations]);

  /** 加载已有对话 */
  const handleLoadConversation = useCallback(
    async (convId: string) => {
      try {
        const data = await api<{ messages: Array<{ id: string; role: string; content: string; createdAt: string }> }>(
          `/api/v1/ai/conversations/${convId}?wid=${wid}`,
        );
        if (data) {
          setConversationId(convId);
          // 将 DB 消息转为 UIMessage 格式
          const dbMessages = data.messages ?? [];
          const uiMessages: UIMessage[] = dbMessages.map((m) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            parts: [{ type: "text" as const, text: m.content }],
          }));
          setMessages(uiMessages);
          setSuggestions([]);
          setShowConversationList(false);
        }
      } catch (e) {
        if (process.env.NODE_ENV === "development") {
          console.error("[KnowledgeQaPanel] handleLoadConversation error:", e instanceof Error ? e.message : e);
        }
        toast("error", t("loadFailed"));
      }
    },
    [wid, t, toast, setMessages],
  );

  /** 删除对话 */
  const handleDeleteConversation = useCallback(
    async (convId: string, e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      try {
        await api(`/api/v1/ai/conversations/${convId}?wid=${wid}`, {
          method: "DELETE",
        });
        if (convId === conversationId) {
          setConversationId(null);
          setMessages([]);
          setSuggestions([]);
        }
        await loadConversations();
      } catch (err) {
        if (process.env.NODE_ENV === "development") {
          console.error("[KnowledgeQaPanel] handleDeleteConversation error:", err instanceof Error ? err.message : err);
        }
        toast("error", t("deleteFailed"));
      }
    },
    [wid, t, toast, conversationId, setMessages, loadConversations],
  );

  /** 获取追问建议 */
  const fetchSuggestions = useCallback(
    async (question: string, answer: string, messageId: string) => {
      if (fetchedSuggestionsRef.current.has(messageId)) return;
      fetchedSuggestionsRef.current.add(messageId);
      setLoadingSuggestions(true);
      try {
        const data = await api<{ suggestions: string[] }>("/api/v1/ai/follow-up-suggestions", {
          method: "POST",
          body: JSON.stringify({ wid, question, answer }),
        });
        if (data?.suggestions) {
          setSuggestions(data.suggestions);
        }
      } catch (e) {
        if (process.env.NODE_ENV === "development") {
          console.error("[KnowledgeQaPanel] fetchSuggestions error:", e instanceof Error ? e.message : e);
        }
        // 追问建议失败不阻塞主流程，仅 dev 日志
      } finally {
        setLoadingSuggestions(false);
      }
    },
    [wid],
  );

  // 检测 streaming → ready 转换，获取追问建议
  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = status;

    // 当从 streaming 转为 ready，且有新的 assistant 消息时
    if (prevStatus === "streaming" && status === "ready" && messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role === "assistant") {
        const answer = getMessageText(lastMsg);
        // 找到对应的 user 问题（最后一条 user 消息）
        const question = extractLastQuestion(messages.slice(0, -1));
        if (answer && question) {
          void fetchSuggestions(question, answer, lastMsg.id);
        }
      }
    }
  }, [status, messages, fetchSuggestions]);

  // 发送消息
  const handleSend = useCallback(
    async (text?: string) => {
      const q = (text ?? input).trim();
      if (!q || isStreaming) return;

      // 如果没有 conversationId，先创建对话
      if (!convIdRef.current) {
        const title = q.slice(0, 50);
        try {
          const data = await api<{ id: string }>("/api/v1/ai/conversations", {
            method: "POST",
            body: JSON.stringify({ wid, title }),
          });
          setConversationId(data.id);
          convIdRef.current = data.id;
        } catch (e) {
          // 创建失败仍允许发送（走单次问答模式）
          if (process.env.NODE_ENV === "development") {
            console.error("[KnowledgeQaPanel] createConversation error:", e);
          }
        }
      }

      setInput("");
      setSuggestions([]);
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      try {
        await sendMessage({ text: q });
      } catch (e) {
        // useChat 会设置 error 状态
        if (process.env.NODE_ENV === "development") {
          console.error("[KnowledgeQaPanel] sendMessage error:", e);
        }
      }
    },
    [input, isStreaming, wid, sendMessage],
  );

  // 点击追问建议
  const handleSuggestionClick = useCallback(
    (suggestion: string) => {
      void handleSend(suggestion);
    },
    [handleSend],
  );

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

  // 中止当前请求（useChat v7 提供 stop 函数中止流式请求）
  const handleStop = () => {
    stop();
  };

  return (
    <div
      className="flex h-full flex-col bg-[var(--surface)]"
      aria-label={t("title")}
    >
      {/* 标题栏 */}
      <header className="flex items-center justify-between border-b border-[var(--border)] px-[var(--space-5)] py-[var(--space-3)]">
        <div className="flex items-center gap-[var(--space-2)]">
          <Brain size={16} className="text-[var(--accent)]" />
          <h1 className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            {t("title")}
          </h1>
        </div>
        <div className="flex items-center gap-[var(--space-1)]">
          {/* 对话列表按钮 */}
          <button
            type="button"
            onClick={() => {
              setShowConversationList(!showConversationList);
              if (!showConversationList) void loadConversations();
            }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            aria-label={t("conversations")}
            title={t("conversations")}
          >
            <MessageSquare size={16} />
          </button>
          {/* 新建对话按钮 */}
          <button
            type="button"
            onClick={() => void handleNewConversation()}
            disabled={isStreaming}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            aria-label={t("newConversation")}
            title={t("newConversation")}
          >
            <Plus size={16} />
          </button>
        </div>
      </header>

      {/* 对话列表侧栏 */}
      {showConversationList && (
        <div className="border-b border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-3)] py-[var(--space-2)]">
          {conversations.length === 0 ? (
            <p className="py-[var(--space-2)] text-center text-[length:var(--text-sm)] text-[var(--muted)]">
              {t("emptyState")}
            </p>
          ) : (
            <div className="flex flex-col gap-[var(--space-1)]">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => void handleLoadConversation(conv.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      void handleLoadConversation(conv.id);
                    }
                  }}
                  className={`group flex cursor-pointer items-center justify-between rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-2)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] ${
                    conv.id === conversationId ? "bg-[var(--surface-3)]" : ""
                  }`}
                >
                  <span className="flex-1 truncate text-[length:var(--text-sm)] text-[var(--fg-2)]">
                    {conv.title}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => void handleDeleteConversation(conv.id, e)}
                    className="ml-[var(--space-2)] inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] opacity-0 transition-opacity duration-[var(--motion-fast)] hover:text-[var(--danger)] group-hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                    aria-label={t("clear")}
                    title={t("clear")}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 内容区 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-[var(--space-5)] py-[var(--space-4)]"
      >
        {/* 错误提示 */}
        {hasError && (
          <div className="flex items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--danger)] bg-[var(--danger-soft)] px-[var(--space-3)] py-[var(--space-2)]">
            <AlertTriangle size={14} className="text-[var(--danger)]" />
            <span className="text-[length:var(--text-sm)] text-[var(--danger)]">
              {t("error")}
            </span>
          </div>
        )}

        {/* 消息列表 */}
        {messages.length > 0 ? (
          <div className="flex flex-col gap-[var(--space-3)]">
            {messages.map((message) => {
              const text = getMessageText(message);
              if (!text && message.role === "assistant" && isStreaming) {
                return null;
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
                        ? "max-w-[80%] rounded-[var(--radius-md)] bg-[var(--accent)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--on-accent)]"
                        : "max-w-[80%] rounded-[var(--radius-md)] bg-[var(--surface-2)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg-2)]"
                    }
                  >
                    {isUser ? (
                      <span className="whitespace-pre-wrap break-words">{text}</span>
                    ) : (
                      <div className="break-words [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_h1]:mt-[var(--space-4)] [&_h1]:mb-[var(--space-2)] [&_h1]:text-[length:var(--text-lg)] [&_h1]:font-[weight:var(--weight-semibold)] [&_h1]:text-[var(--fg)] [&_h2]:mt-[var(--space-4)] [&_h2]:mb-[var(--space-2)] [&_h2]:text-[length:var(--text-md)] [&_h2]:font-[weight:var(--weight-semibold)] [&_h2]:text-[var(--fg)] [&_h3]:mt-[var(--space-3)] [&_h3]:mb-[var(--space-1)] [&_h3]:font-[weight:var(--weight-medium)] [&_h3]:text-[var(--fg)] [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_code]:rounded-[var(--radius-sm)] [&_code]:bg-[var(--surface-2)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[length:var(--text-xs)] [&_pre]:rounded-[var(--radius-md)] [&_pre]:bg-[var(--surface-2)] [&_pre]:p-[var(--space-3)] [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--border)] [&_blockquote]:pl-[var(--space-3)] [&_blockquote]:text-[var(--muted)]">
                        <Markdown source={text} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Typing indicator */}
            {isStreaming && (
              <div className="flex items-start">
                <div className="flex items-center gap-1 rounded-[var(--radius-md)] bg-[var(--surface-2)] px-[var(--space-3)] py-[var(--space-3)]">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--meta)]" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--meta)] [animation-delay:200ms]" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--meta)] [animation-delay:400ms]" />
                </div>
              </div>
            )}

            {/* 追问建议 */}
            {!isStreaming && suggestions.length > 0 && (
              <div className="flex flex-col gap-[var(--space-2)]">
                <div className="flex items-center gap-[var(--space-2)] text-[var(--muted)]">
                  <Brain size={14} />
                  <span className="text-[length:var(--text-sm)]">{t("followUp")}</span>
                </div>
                <div className="flex flex-wrap gap-[var(--space-2)]">
                  {suggestions.map((suggestion, idx) => (
                    <button
                      key={`${suggestion}_${idx}`}
                      type="button"
                      onClick={() => handleSuggestionClick(suggestion)}
                      disabled={isStreaming}
                      className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] hover:border-[var(--accent)] hover:bg-[var(--surface-3)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 追问建议加载中 */}
            {loadingSuggestions && (
              <div className="flex items-center gap-[var(--space-2)] text-[var(--muted)]">
                <Loader2 size={14} className="animate-spin" />
                <span className="text-[length:var(--text-sm)]">{t("followUp")}</span>
              </div>
            )}
          </div>
        ) : (
          /* 空状态提示 */
          !hasError && (
            <div className="flex items-center gap-[var(--space-2)] text-[var(--muted)]">
              <Brain size={14} />
              <span className="text-[length:var(--text-sm)]">{t("hint")}</span>
            </div>
          )
        )}
      </div>

      {/* 输入区 */}
      <footer className="border-t border-[var(--border)] px-[var(--space-5)] py-[var(--space-3)]">
        <div className="flex items-end gap-[var(--space-2)]">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={t("placeholder")}
            rows={2}
            disabled={isStreaming}
            className="flex-1 resize-none rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg)] placeholder:text-[var(--muted)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:opacity-40"
            aria-label={t("placeholder")}
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={handleStop}
              className="inline-flex items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            >
              <Square size={14} />
              {t("asking")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!canSend}
              className="inline-flex items-center gap-[var(--space-2)] rounded-[var(--radius-md)] bg-[var(--accent)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--on-accent)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            >
              <Send size={14} />
              {t("ask")}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
