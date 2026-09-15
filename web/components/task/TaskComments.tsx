"use client";

// 任务评论区：评论列表 + 输入框 + @提及自动补全。
// 拆分自 task/[id]/page.tsx 第 838-923 行。
// 子组件自管 draft / sending / mention / isMobile 等 UI 状态；
// 评论提交通过 onSend 回调交由父组件执行 API 调用与状态更新。

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { MessageSquare, Send, Loader2, AtSign } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Comment, Person } from "./types";

interface TaskCommentsProps {
  comments: Comment[];
  members: Person[];
  onSend: (body: string, mentions: string[]) => Promise<boolean>;
  relTime: (iso: string) => string;
}

export function TaskComments({ comments, members, onSend, relTime }: TaskCommentsProps) {
  const t = useTranslations("task");

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const draftRef = useRef<HTMLTextAreaElement>(null);

  // ── 评论 @提及自动补全 ──
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionStart, setMentionStart] = useState(-1);

  // ── 视口尺寸（< sm 视为移动端，用于评论 placeholder 缩短）──
  // 640px = Tailwind sm 断点；isMobile = 视口宽度 < 640px
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const update = () => setIsMobile(!mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // ── 评论 textarea 自动高度 ──
  useEffect(() => {
    const el = draftRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    }
  }, [draft]);

  // @提及候选列表（按 name/email 过滤）
  const mentionCandidates = useMemo(() => {
    if (!mentionOpen) return [];
    const q = mentionQuery.toLowerCase();
    return members.filter((m) => {
      const name = (m.name ?? "").toLowerCase();
      const email = m.email.toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [mentionOpen, mentionQuery, members]);

  const addComment = useCallback(async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      // 解析 @username 提取 mentions 数组传给 API（用于通知记录）
      const mentions = Array.from(draft.matchAll(/@(\S+)/g)).map((m) => m[1]);
      const ok = await onSend(draft.trim(), mentions);
      if (ok) {
        setDraft("");
        setMentionOpen(false);
      }
    } finally {
      setSending(false);
    }
  }, [draft, sending, onSend]);

  // 评论输入：检测光标前的 @ 触发自动补全
  function handleDraftChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setDraft(val);

    const el = e.target;
    const caret = el.selectionStart ?? val.length;
    const before = val.slice(0, caret);
    const atIdx = before.lastIndexOf("@");
    if (atIdx === -1) {
      setMentionOpen(false);
      return;
    }
    // @ 前必须是空格/行首（避免邮箱地址里的 @ 误触发）
    const charBefore = atIdx === 0 ? "" : before[atIdx - 1];
    if (charBefore && !/\s/.test(charBefore)) {
      setMentionOpen(false);
      return;
    }
    // @ 后到光标的文本作为查询词（遇空格即终止）
    const query = before.slice(atIdx + 1);
    if (/\s/.test(query)) {
      setMentionOpen(false);
      return;
    }
    setMentionQuery(query);
    setMentionStart(atIdx);
    setMentionIndex(0);
    setMentionOpen(true);
  }

  // 评论键盘：↑↓ 选择候选，Enter/Tab 确认，Esc 关闭，⌘/Ctrl+Enter 发送
  function handleDraftKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      addComment();
      return;
    }
    if (!mentionOpen || mentionCandidates.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMentionIndex((i) => (i + 1) % mentionCandidates.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setMentionIndex((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      insertMention(mentionCandidates[mentionIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setMentionOpen(false);
    }
  }

  // 插入选中的提及：将 @query 替换为 @handle 并在后面补一个空格
  function insertMention(person: Person) {
    const handle = person.name || person.email.split("@")[0];
    const before = draft.slice(0, mentionStart);
    const after = draft.slice(mentionStart + 1 + mentionQuery.length);
    const newText = `${before}@${handle} ${after}`;
    setDraft(newText);
    setMentionOpen(false);
    // 恢复光标到 @handle 后的空格之后
    requestAnimationFrame(() => {
      const el = draftRef.current;
      if (el) {
        const pos = before.length + handle.length + 2; // '@' + handle + ' '
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    });
  }

  return (
    <section className="mt-[var(--space-8)]">
      <h2 className="flex items-center gap-[var(--space-2)] mb-[var(--space-3)] text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
        <MessageSquare size={16} className="text-[var(--muted)]" />
        {t("discussionTitle")}
        {comments.length > 0 && (
          <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-regular)] text-[var(--meta)]">
            {comments.length}
          </span>
        )}
      </h2>

      <div className="divide-y divide-[var(--border-soft)]">
        {comments.map((c) => (
          <div
            key={c.id}
            className="flex gap-[var(--space-3)] px-[var(--space-2)] py-1.5 rounded-[var(--radius-md)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
          >
            <div className="w-7 h-7 sm:w-8 sm:h-8 shrink-0 rounded-full bg-[var(--surface-3)] text-[var(--fg-2)] flex items-center justify-center text-[length:var(--text-xs)] font-[weight:var(--weight-medium)]">
              {(c.author
                ? c.author.name || c.author.email
                : t("deletedUser"))[0]?.toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-[var(--space-2)]">
                <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                  {c.author
                    ? c.author.name || c.author.email.split("@")[0]
                    : t("deletedUser")}
                </span>
                <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
                  {relTime(c.createdAt)}
                </span>
              </div>
              <div className="mt-0.5 text-[length:var(--text-base)] text-[var(--fg-2)] leading-[var(--leading-relaxed)] whitespace-pre-wrap break-words">
                {c.body}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-[var(--space-4)] flex items-start gap-[var(--space-2)]">
        <div className="relative flex-1">
          <textarea
            ref={draftRef}
            value={draft}
            onChange={handleDraftChange}
            onKeyDown={handleDraftKeyDown}
            onBlur={() => {
              // 延迟关闭，让浮层 mousedown 有机会触发
              setTimeout(() => setMentionOpen(false), 150);
            }}
            rows={2}
            placeholder={isMobile ? t("commentPlaceholderMobile") : t("commentPlaceholder")}
            className="w-full px-[var(--space-3)] py-[var(--space-2)] overflow-hidden resize-none border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-base)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:border-[var(--accent)] placeholder:text-[var(--meta)] transition-colors duration-[var(--motion-fast)]"
          />
          {mentionOpen && mentionCandidates.length > 0 && (
            <div className="absolute top-full left-0 mt-[var(--space-1)] z-[var(--z-dropdown)] bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-md)] shadow-[var(--elev-md)] py-[var(--space-1)] min-w-[200px] max-h-60 overflow-y-auto">
              {mentionCandidates.map((m, i) => (
                <button
                  key={m.id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertMention(m);
                  }}
                  className={`h-9 px-[var(--space-3)] w-full flex items-center gap-[var(--space-2)] text-left ${i === mentionIndex ? "bg-[var(--surface-2)]" : ""}`}
                >
                  <AtSign size={14} className="text-[var(--meta)] shrink-0" />
                  <span className="truncate text-[length:var(--text-sm)] text-[var(--fg)]">
                    {m.name || m.email}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={addComment}
          disabled={!draft.trim() || sending}
          className="h-9 px-[var(--space-3)] shrink-0 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
        >
          {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          {t("send")}
        </button>
      </div>
    </section>
  );
}