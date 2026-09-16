"use client";

/**
 * AI 文档问答面板（RAG 简化版）。
 *
 * 用户输入自然语言问题，可选择文档范围（Wiki 页面），调用
 * POST /api/v1/ai/doc-qa 流式接口，AI 基于检索到的项目文档
 * 逐字渲染 markdown 回答，并展示引用的来源文档标题列表。
 *
 * 技术要点：
 *  - useChat（@ai-sdk/react v7）消费 toUIMessageStreamResponse 流
 *  - DefaultChatTransport + prepareSendMessagesRequest 适配后端自定义 body
 *    （{ wid, question, docIds }），而非 AI SDK 默认 { messages }
 *  - docIds 通过 ref + Resolvable body 函数实时读取，避免 transport 重建
 *  - AI 回答末尾包含"## 来源"段落，前端解析提取来源文档标题列表
 *  - 历史问答保存在组件状态（最近 5 条），不持久化到 DB
 *  - 样式全走 design token（var(--*)），lucide-react 图标 size 14/16
 *
 * 来源：经验 2026-09-13-toolbar-button-group-style-helper-design-token
 *       （design token 样式约定 + lucide-react 图标 size 14/16）
 *       经验 2026-09-11-generic-empty-state-component-svg-illustration-migration
 *       （空状态处理 + design token 样式）
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useTranslations } from "next-intl";
import {
  MessageSquare,
  FileText,
  Send,
  Loader2,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Trash2,
} from "lucide-react";
import Markdown from "@/components/Markdown";
import { api } from "@/lib/api";

interface DocQaPanelProps {
  /** 工作区 ID */
  wid: string;
}

/** Wiki 页面列表项（扁平化后，用于文档范围选择） */
interface WikiPageItem {
  id: string;
  title: string;
}

/** 历史问答项（保存在组件状态，最近 5 条） */
interface HistoryItem {
  id: string;
  question: string;
  answer: string;
  sources: string[];
  createdAt: number;
}

/** Wiki 页面树形节点（GET /api/v1/workspaces/{wid}/wiki 返回） */
interface WikiPageNode {
  id: string;
  title: string;
  children?: WikiPageNode[];
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
 * 跳过末尾的 assistant 消息，找到最后的 user。
 */
function extractLastQuestion(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      return getMessageText(messages[i]);
    }
  }
  return "";
}

/**
 * 从回答文本中解析 "## 来源" 段落，提取文档标题列表。
 *
 * AI 在回答末尾以 "## 来源" 段落列出引用的文档标题（每行 `- 文档标题`）。
 * 本函数分离回答正文与来源列表，供前端分别渲染。
 *
 * @returns { answer: 回答正文, sources: 来源文档标题列表 }
 */
function parseSources(text: string): { answer: string; sources: string[] } {
  const sourceMarker = "\n## 来源\n";
  const idx = text.indexOf(sourceMarker);
  if (idx === -1) return { answer: text, sources: [] };
  const answer = text.slice(0, idx).trimEnd();
  const sourceSection = text.slice(idx + sourceMarker.length);
  const sources = sourceSection
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter((s) => s.length > 0);
  return { answer, sources };
}

/** 将树形 Wiki 页面扁平化为 { id, title } 列表（用于文档范围多选） */
function flattenWikiPages(nodes: WikiPageNode[]): WikiPageItem[] {
  const result: WikiPageItem[] = [];
  for (const node of nodes) {
    result.push({ id: node.id, title: node.title });
    if (Array.isArray(node.children)) {
      result.push(...flattenWikiPages(node.children));
    }
  }
  return result;
}

/** Markdown 渲染容器样式（复用 KnowledgeQaPanel 的 markdown 样式约定） */
const MARKDOWN_STYLES =
  "break-words [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_h1]:mt-[var(--space-4)] [&_h1]:mb-[var(--space-2)] [&_h1]:text-[length:var(--text-lg)] [&_h1]:font-[weight:var(--weight-semibold)] [&_h1]:text-[var(--fg)] [&_h2]:mt-[var(--space-4)] [&_h2]:mb-[var(--space-2)] [&_h2]:text-[length:var(--text-md)] [&_h2]:font-[weight:var(--weight-semibold)] [&_h2]:text-[var(--fg)] [&_h3]:mt-[var(--space-3)] [&_h3]:mb-[var(--space-1)] [&_h3]:font-[weight:var(--weight-medium)] [&_h3]:text-[var(--fg)] [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_code]:rounded-[var(--radius-sm)] [&_code]:bg-[var(--surface-2)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[length:var(--text-xs)] [&_pre]:rounded-[var(--radius-md)] [&_pre]:bg-[var(--surface-2)] [&_pre]:p-[var(--space-3)] [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--border)] [&_blockquote]:pl-[var(--space-3)] [&_blockquote]:text-[var(--muted)]";

export function DocQaPanel({ wid }: DocQaPanelProps) {
  const t = useTranslations("ai.docQa");

  // 文档列表（用于文档范围选择）
  const [docList, setDocList] = useState<WikiPageItem[]>([]);
  const [docListLoading, setDocListLoading] = useState(false);
  // 选中的文档 ID 集合
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  // 文档选择下拉展开状态
  const [showDocSelect, setShowDocSelect] = useState(false);

  // 历史问答（最近 5 条，保存在组件状态）
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // 用 ref 存选中的文档 ID，使 transport 的 body Resolvable 函数始终读到最新值
  const selectedDocIdsRef = useRef<Set<string>>(new Set());
  selectedDocIdsRef.current = selectedDocIds;

  // 创建 transport（只创建一次）
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/v1/ai/doc-qa",
        // Resolvable 函数：每次请求时解析，读 ref 最新值
        body: () => ({
          wid,
          docIds:
            selectedDocIdsRef.current.size > 0
              ? [...selectedDocIdsRef.current]
              : undefined,
        }),
        // 将 AI SDK 标准的 { messages } 转为后端自定义的 { wid, question, docIds }
        prepareSendMessagesRequest: ({ messages, body }) => {
          const question = extractLastQuestion(messages);
          return {
            body: {
              wid,
              question,
              docIds: (body as { docIds?: string[] } | undefined)?.docIds,
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
  }, [messages, status]);

  // 加载文档列表（Wiki 页面树 → 扁平化）
  useEffect(() => {
    let cancelled = false;
    setDocListLoading(true);
    api<WikiPageNode[]>(`/api/v1/workspaces/${wid}/wiki`)
      .then((data) => {
        if (cancelled) return;
        setDocList(flattenWikiPages(Array.isArray(data) ? data : []));
      })
      .catch(() => {
        if (cancelled) return;
        setDocList([]);
      })
      .finally(() => {
        if (!cancelled) setDocListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [wid]);

  // 检测 streaming → ready 转换，保存历史问答
  const prevStatusRef = useRef<string>("ready");
  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = status;

    if (prevStatus === "streaming" && status === "ready" && messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role === "assistant") {
        const rawAnswer = getMessageText(lastMsg);
        if (rawAnswer) {
          const { answer, sources } = parseSources(rawAnswer);
          const question = extractLastQuestion(messages.slice(0, -1));
          setHistory((prev) =>
            [
              {
                id: lastMsg.id,
                question,
                answer,
                sources,
                createdAt: Date.now(),
              },
              ...prev,
            ].slice(0, 5),
          );
        }
      }
    }
  }, [status, messages]);

  // 发送消息
  const handleSend = useCallback(
    async (text?: string) => {
      const q = (text ?? input).trim();
      if (!q || isStreaming) return;
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      try {
        await sendMessage({ text: q });
      } catch (e) {
        if (process.env.NODE_ENV === "development") {
          console.error("[DocQaPanel] sendMessage error:", e);
        }
      }
    },
    [input, isStreaming, sendMessage],
  );

  // 文档选择切换
  const toggleDoc = useCallback((docId: string) => {
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  }, []);

  // 清空历史
  const handleClearHistory = useCallback(() => {
    setHistory([]);
    setMessages([]);
  }, [setMessages]);

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

  // 当前回答（流式或已完成）
  const currentAnswer =
    messages.length > 0 && messages[messages.length - 1]?.role === "assistant"
      ? getMessageText(messages[messages.length - 1])
      : "";
  const { answer: displayAnswer, sources: currentSources } = useMemo(
    () => parseSources(currentAnswer),
    [currentAnswer],
  );

  return (
    <div
      className="flex h-full flex-col bg-[var(--surface)]"
      aria-label={t("title")}
    >
      {/* 标题栏 */}
      <header className="flex items-center justify-between border-b border-[var(--border)] px-[var(--space-5)] py-[var(--space-3)]">
        <div className="flex items-center gap-[var(--space-2)]">
          <BookOpen size={16} className="text-[var(--accent)]" />
          <h1 className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            {t("title")}
          </h1>
        </div>
        {history.length > 0 && (
          <button
            type="button"
            onClick={handleClearHistory}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            aria-label={t("clearHistory")}
            title={t("clearHistory")}
          >
            <Trash2 size={16} />
          </button>
        )}
      </header>

      {/* 内容区 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-[var(--space-5)] py-[var(--space-4)]"
      >
        {/* 错误提示 */}
        {hasError && (
          <div className="mb-[var(--space-3)] flex items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--danger)] bg-[var(--danger-soft)] px-[var(--space-3)] py-[var(--space-2)]">
            <span className="text-[length:var(--text-sm)] text-[var(--danger)]">
              {t("error")}
            </span>
          </div>
        )}

        {/* 当前回答 */}
        {displayAnswer ? (
          <div className="mb-[var(--space-4)]">
            <div
              className={`rounded-[var(--radius-md)] bg-[var(--surface-2)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg-2)] ${MARKDOWN_STYLES}`}
            >
              <Markdown source={displayAnswer} />
            </div>
            {/* 来源文档 */}
            {currentSources.length > 0 && (
              <div className="mt-[var(--space-2)]">
                <div className="flex items-center gap-[var(--space-2)] text-[var(--muted)]">
                  <FileText size={14} />
                  <span className="text-[length:var(--text-sm)]">
                    {t("sources")}
                  </span>
                </div>
                <ul className="mt-[var(--space-1)] flex flex-wrap gap-[var(--space-2)]">
                  {currentSources.map((src, i) => (
                    <li
                      key={`${src}_${i}`}
                      className="rounded-[var(--radius-sm)] bg-[var(--surface-2)] px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--fg-2)]"
                    >
                      {src}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : isStreaming ? (
          /* Typing indicator */
          <div className="flex items-center gap-[var(--space-2)] rounded-[var(--radius-md)] bg-[var(--surface-2)] px-[var(--space-3)] py-[var(--space-3)]">
            <Loader2 size={14} className="animate-spin text-[var(--muted)]" />
            <span className="text-[length:var(--text-sm)] text-[var(--muted)]">
              {t("asking")}
            </span>
          </div>
        ) : !hasError && history.length === 0 ? (
          /* 空状态 */
          <div className="flex items-center gap-[var(--space-2)] text-[var(--muted)]">
            <MessageSquare size={14} />
            <span className="text-[length:var(--text-sm)]">
              {t("noAnswer")}
            </span>
          </div>
        ) : null}

        {/* 历史问答 */}
        {history.length > 0 && (
          <div className="mt-[var(--space-4)]">
            <div className="mb-[var(--space-2)] flex items-center gap-[var(--space-2)] text-[var(--muted)]">
              <MessageSquare size={14} />
              <span className="text-[length:var(--text-sm)]">
                {t("history")}
              </span>
            </div>
            <div className="flex flex-col gap-[var(--space-2)]">
              {history.map((item) => (
                <div
                  key={item.id}
                  className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-3)] py-[var(--space-2)]"
                >
                  <div className="mb-[var(--space-1)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                    {item.question}
                  </div>
                  <div
                    className={`text-[length:var(--text-xs)] text-[var(--fg-2)] ${MARKDOWN_STYLES}`}
                  >
                    <Markdown source={item.answer} />
                  </div>
                  {item.sources.length > 0 && (
                    <div className="mt-[var(--space-1)] flex flex-wrap gap-[var(--space-1)]">
                      {item.sources.map((src, i) => (
                        <span
                          key={`${src}_${i}`}
                          className="rounded-[var(--radius-sm)] bg-[var(--surface-3)] px-[var(--space-1)] py-0.5 text-[length:var(--text-xs)] text-[var(--muted)]"
                        >
                          {src}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 输入区 */}
      <footer className="border-t border-[var(--border)] px-[var(--space-5)] py-[var(--space-3)]">
        {/* 文档范围选择 */}
        <div className="mb-[var(--space-2)]">
          <button
            type="button"
            onClick={() => setShowDocSelect(!showDocSelect)}
            disabled={isStreaming}
            className="inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-3)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          >
            <FileText size={14} />
            <span>
              {selectedDocIds.size === 0 ? t("allDocs") : t("selectDocs")}
            </span>
            {showDocSelect ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {selectedDocIds.size > 0 && (
              <span className="rounded-full bg-[var(--accent)] px-1.5 text-[var(--on-accent)]">
                {selectedDocIds.size}
              </span>
            )}
          </button>
          {showDocSelect && (
            <div className="mt-[var(--space-1)] max-h-40 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-2)] py-[var(--space-1)]">
              {docListLoading ? (
                <div className="flex items-center gap-[var(--space-2)] py-[var(--space-2)] text-[var(--muted)]">
                  <Loader2 size={14} className="animate-spin" />
                  <span className="text-[length:var(--text-xs)]">
                    {t("noSources")}
                  </span>
                </div>
              ) : docList.length === 0 ? (
                <p className="py-[var(--space-2)] text-center text-[length:var(--text-xs)] text-[var(--muted)]">
                  {t("noSources")}
                </p>
              ) : (
                <ul className="flex flex-col gap-[var(--space-1)]">
                  {docList.map((doc) => (
                    <li key={doc.id}>
                      <label className="flex cursor-pointer items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] px-[var(--space-1)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--fg-2)] hover:bg-[var(--surface-3)]">
                        <input
                          type="checkbox"
                          checked={selectedDocIds.has(doc.id)}
                          onChange={() => toggleDoc(doc.id)}
                          className="accent-[var(--accent)]"
                        />
                        <span className="truncate">{doc.title}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* 输入框 + 发送按钮 */}
        <div className="flex items-end gap-[var(--space-2)]">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={t("questionPlaceholder")}
            rows={2}
            disabled={isStreaming}
            className="flex-1 resize-none rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg)] placeholder:text-[var(--muted)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:opacity-40"
            aria-label={t("questionLabel")}
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={() => stop()}
              className="inline-flex items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            >
              <Loader2 size={14} className="animate-spin" />
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