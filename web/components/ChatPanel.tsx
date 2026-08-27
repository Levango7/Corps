"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Send, Loader2, MessageCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useTranslations } from "next-intl";

interface Person {
  id: string;
  name: string | null;
  email: string;
  image?: string | null;
}

interface Message {
  id: string;
  body: string;
  createdAt: string;
  author: Person | null;
}

/** 轮询间隔（毫秒）—— MVP 采用轮询方案，后续可升级 SSE */
const POLL_INTERVAL_MS = 5000;
/** 消息体最大长度（与 API zod schema 对齐） */
const MAX_BODY_LENGTH = 10000;

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}

/**
 * 任务级即时聊天面板（v2 F1：IM 轻沟通 MVP）
 *
 * 方案：轮询增量拉取（5s 间隔 + ?since= 游标）
 * 升级路径：轮询 → SSE → WebSocket（API 的 ?since= 参数设计兼容无缝升级）
 */
export default function ChatPanel({
  wid,
  taskId,
}: {
  wid: string;
  taskId: string;
}) {
  const t = useTranslations("chat");
  const base = `/api/v1/workspaces/${wid}/tasks/${taskId}/messages`;

  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);

  const draftRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // 增量游标：记录最后一条消息的 createdAt，用于轮询时 ?since= 参数
  const sinceRef = useRef<string | null>(null);
  // 防止 StrictMode 双调用导致重复轮询
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 首次加载全部消息
  const loadInitial = useCallback(async () => {
    try {
      const data = await api<Message[]>(base);
      setMessages(data);
      if (data.length > 0) {
        sinceRef.current = data[data.length - 1].createdAt;
      }
    } catch {
      // 静默失败，不阻塞页面
    } finally {
      setLoading(false);
    }
  }, [base]);

  // 增量拉取新消息
  const pollNew = useCallback(async () => {
    if (!sinceRef.current) return;
    try {
      const data = await api<Message[]>(`${base}?since=${encodeURIComponent(sinceRef.current)}`);
      if (data.length > 0) {
        setMessages((prev) => [...prev, ...data]);
        sinceRef.current = data[data.length - 1].createdAt;
      }
    } catch {
      // 轮询失败静默重试
    }
  }, [base]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  // 启动轮询
  useEffect(() => {
    pollingRef.current = setInterval(pollNew, POLL_INTERVAL_MS);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [pollNew]);

  // 自动滚动到底部（消息变化时）
  useEffect(() => {
    const el = listRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // 输入框自动高度
  useEffect(() => {
    const el = draftRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    }
  }, [draft]);

  async function send() {
    const trimmed = draft.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      const created = await api<Message>(base, {
        method: "POST",
        body: JSON.stringify({ body: trimmed }),
      });
      setMessages((prev) => [...prev, created]);
      sinceRef.current = created.createdAt;
      setDraft("");
    } catch {
      // 发送失败：保留草稿让用户重试
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      send();
    }
  }

  return (
    <section className="mt-[var(--space-6)]">
      <h2 className="flex items-center gap-[var(--space-2)] mb-[var(--space-3)] text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--fg)]">
        <MessageCircle size={16} className="text-[var(--muted)]" />
        {t("title")}
        {messages.length > 0 && (
          <span className="text-[length:var(--text-sm)] font-[var(--weight-regular)] text-[var(--meta)]">
            {messages.length}
          </span>
        )}
      </h2>

      {/* 消息列表 */}
      <div
        ref={listRef}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-[var(--space-3)] h-[320px] overflow-y-auto space-y-[var(--space-2)]"
      >
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={18} className="animate-spin text-[var(--muted)]" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-[length:var(--text-sm)] text-[var(--meta)]">
              {t("empty")}
            </p>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="flex gap-[var(--space-2)]">
              <div className="w-6 h-6 shrink-0 rounded-full bg-[var(--surface-3)] text-[var(--fg-2)] flex items-center justify-center text-[length:var(--text-xs)] font-[var(--weight-medium)]">
                {(m.author ? m.author.name || m.author.email : "?")[0]?.toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-[var(--space-2)]">
                  <span className="text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--fg)]">
                    {m.author ? m.author.name || m.author.email.split("@")[0] : t("unknownUser")}
                  </span>
                  <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
                    {relTime(m.createdAt)}
                  </span>
                </div>
                <div className="mt-0.5 text-[length:var(--text-sm)] text-[var(--fg-2)] leading-[1.6] whitespace-pre-wrap break-words">
                  {m.body}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 输入区 */}
      <div className="mt-[var(--space-2)] flex items-end gap-[var(--space-2)]">
        <textarea
          ref={draftRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MAX_BODY_LENGTH))}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder={t("placeholder")}
          className="flex-1 px-[var(--space-3)] py-[var(--space-2)] overflow-hidden resize-none border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:border-[var(--accent)] placeholder:text-[var(--meta)] transition-colors duration-[var(--motion-fast)]"
        />
        <button
          onClick={send}
          disabled={!draft.trim() || sending}
          className="h-9 px-[var(--space-3)] shrink-0 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] font-[var(--weight-medium)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] flex items-center gap-1.5"
        >
          {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          {t("send")}
        </button>
      </div>
    </section>
  );
}