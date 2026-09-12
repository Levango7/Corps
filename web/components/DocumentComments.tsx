"use client";

/**
 * DocumentComments · 文档评论组件（云文档 Phase 1 §2.4）
 *
 * 功能：
 *  - 评论列表（按锚点行号分组，未解决优先）
 *  - 添加评论（行号锚点 + 内容输入）
 *  - 解决/取消解决评论
 *  - 编辑/删除评论
 *  - 回复线程（首条评论 + 回复）
 *  - 评论计数徽章
 *  - 筛选：全部 / 未解决 / 已解决
 *
 * 数据流：useEffect 拉 GET /comments；CRUD 调对应 REST 端点。
 *
 * Design token 规范：所有色值/间距/圆角/字号走 var(--*)。
 * 图标：lucide-react，尺寸 14/16。
 */

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { api, ApiError } from "@/lib/api";
import {
  Check,
  CheckCheck,
  Loader2,
  MessageSquare,
  Pencil,
  Reply,
  Trash2,
  X,
} from "lucide-react";

// ── 类型定义（对应设计文档 §2.4.1 Prisma schema）──

interface CommentAuthor {
  id: string | null;
  name: string | null;
  email: string;
  image: string | null;
}

interface DocumentComment {
  id: string;
  anchorPath: string;
  anchorText: string;
  body: string;
  mentions: string[];
  parentId: string | null;
  resolved: boolean;
  resolvedAt: string | null;
  author: CommentAuthor | null;
  resolver: CommentAuthor | null;
  replies: DocumentComment[];
  createdAt: string;
  updatedAt: string;
}

// ── 工具函数 ──

/** 相对时间格式化 */
function formatRelative(dateStr: string, locale: string): string {
  const date = new Date(dateStr);
  const now = Date.now();
  const diffMin = Math.floor((now - date.getTime()) / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return locale.startsWith("zh") ? "刚刚" : "just now";
  if (diffMin < 60) return locale.startsWith("zh") ? `${diffMin} 分钟前` : `${diffMin}m ago`;
  if (diffHr < 24) return locale.startsWith("zh") ? `${diffHr} 小时前` : `${diffHr}h ago`;
  if (diffDay < 7) return locale.startsWith("zh") ? `${diffDay} 天前` : `${diffDay}d ago`;
  return date.toLocaleDateString(locale.startsWith("zh") ? "zh-CN" : "en-US");
}

/** 用户显示名 */
function displayName(author: CommentAuthor | null, fallback: string): string {
  if (!author) return fallback;
  return author.name || author.email || fallback;
}

/** 用户首字母（用于头像占位） */
function initials(name: string): string {
  return name.charAt(0).toUpperCase();
}

// ── 主组件 ──

interface DocumentCommentsProps {
  wid: string;
  docId: string;
  onClose: () => void;
}

export function DocumentComments({ wid, docId, onClose }: DocumentCommentsProps) {
  const t = useTranslations("document");
  const locale = typeof window !== "undefined" ? document.documentElement.lang : "en";

  const [comments, setComments] = useState<DocumentComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 筛选
  const [filter, setFilter] = useState<"all" | "open" | "resolved">("open");

  // 添加评论
  const [newAnchorPath, setNewAnchorPath] = useState("");
  const [newAnchorText, setNewAnchorText] = useState("");
  const [newBody, setNewBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 回复状态
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");

  // 编辑状态
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");

  // ── 加载评论 ──
  const loadComments = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api<DocumentComment[]>(
        `/api/v1/workspaces/${wid}/documents/${docId}/comments`,
      );
      setComments(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("commentLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [wid, docId, t]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  // ── 添加评论 ──
  async function addComment(e: FormEvent) {
    e.preventDefault();
    if (!newBody.trim() || !newAnchorPath.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const newComment = await api<DocumentComment>(
        `/api/v1/workspaces/${wid}/documents/${docId}/comments`,
        {
          method: "POST",
          body: JSON.stringify({
            anchorPath: newAnchorPath.trim(),
            anchorText: newAnchorText.trim(),
            body: newBody.trim(),
          }),
        },
      );
      setComments((prev) => [newComment, ...prev]);
      setNewBody("");
      setNewAnchorPath("");
      setNewAnchorText("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("commentAddFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  // ── 回复 ──
  async function addReply(parentId: string, e: FormEvent) {
    e.preventDefault();
    if (!replyBody.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const reply = await api<DocumentComment>(
        `/api/v1/workspaces/${wid}/documents/${docId}/comments`,
        {
          method: "POST",
          body: JSON.stringify({
            parentId,
            anchorPath: "",
            anchorText: "",
            body: replyBody.trim(),
          }),
        },
      );
      setComments((prev) =>
        prev.map((c) =>
          c.id === parentId ? { ...c, replies: [...c.replies, reply] } : c,
        ),
      );
      setReplyBody("");
      setReplyingTo(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("commentReplyFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  // ── 解决/重新打开 ──
  async function toggleResolve(comment: DocumentComment) {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const endpoint = comment.resolved ? "reopen" : "resolve";
      const updated = await api<DocumentComment>(
        `/api/v1/workspaces/${wid}/documents/${docId}/comments/${comment.id}/${endpoint}`,
        { method: "POST" },
      );
      setComments((prev) => prev.map((c) => (c.id === comment.id ? updated : c)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("commentResolveFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  // ── 编辑评论 ──
  async function saveEdit(commentId: string, e: FormEvent) {
    e.preventDefault();
    if (!editBody.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const updated = await api<DocumentComment>(
        `/api/v1/workspaces/${wid}/documents/${docId}/comments/${commentId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ body: editBody.trim() }),
        },
      );
      setComments((prev) => prev.map((c) => (c.id === commentId ? updated : c)));
      setEditingId(null);
      setEditBody("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("commentEditFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  // ── 删除评论 ──
  async function deleteComment(commentId: string) {
    if (submitting) return;
    if (!window.confirm(t("commentDeleteConfirm"))) return;
    setSubmitting(true);
    setError("");
    try {
      await api(`/api/v1/workspaces/${wid}/documents/${docId}/comments/${commentId}`, {
        method: "DELETE",
      });
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("commentDeleteFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  // ── 筛选 + 排序 ──
  const filteredComments = comments
    .filter((c) => {
      if (filter === "open") return !c.resolved;
      if (filter === "resolved") return c.resolved;
      return true;
    })
    .sort((a, b) => {
      // 未解决优先
      if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
      // 同状态按时间倒序
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const openCount = comments.filter((c) => !c.resolved).length;
  const totalCount = comments.length;

  // ── 渲染 ──

  return (
    <div className="fixed inset-y-0 right-0 w-[360px] max-w-[90vw] border-l border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-lg)] z-[var(--z-modal)] flex flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-[var(--border)] px-[var(--space-4)] py-[var(--space-3)]">
        <div className="flex items-center gap-2">
          <MessageSquare size={16} className="text-[var(--muted)]" />
          <h3 className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            {t("comments")}
          </h3>
          {/* 评论计数徽章 */}
          {openCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[var(--accent)] text-[length:var(--text-xs)] text-[var(--accent-fg)] font-[weight:var(--weight-medium)]">
              {openCount}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-[var(--radius-sm)] text-[var(--meta)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
          aria-label={t("close")}
        >
          <X size={16} />
        </button>
      </div>

      {/* 筛选标签 */}
      <div className="flex items-center gap-1 px-[var(--space-4)] py-[var(--space-2)] border-b border-[var(--border-soft)]">
        {(["open", "all", "resolved"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`h-7 px-2.5 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] transition-colors duration-[var(--motion-fast)] ${
              filter === f
                ? "bg-[var(--surface-2)] text-[var(--fg)]"
                : "text-[var(--meta)] hover:text-[var(--fg-2)]"
            }`}
          >
            {f === "open" ? t("commentFilterOpen") : f === "all" ? t("commentFilterAll") : t("commentFilterResolved")}
          </button>
        ))}
      </div>

      {/* 添加评论表单 */}
      <form
        onSubmit={addComment}
        className="px-[var(--space-4)] py-[var(--space-3)] border-b border-[var(--border-soft)] space-y-[var(--space-2)]"
      >
        <div className="flex gap-2">
          <input
            value={newAnchorPath}
            onChange={(e) => setNewAnchorPath(e.target.value)}
            placeholder={t("commentAnchorPlaceholder")}
            disabled={submitting}
            className="w-20 h-8 px-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-xs)] text-[var(--fg-2)] outline-none focus-visible:border-[var(--accent)] focus-visible:ring-[var(--focus-ring)] placeholder:text-[var(--meta)] font-mono"
          />
          <input
            value={newAnchorText}
            onChange={(e) => setNewAnchorText(e.target.value)}
            placeholder={t("commentAnchorTextPlaceholder")}
            disabled={submitting}
            className="flex-1 h-8 px-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-xs)] text-[var(--fg-2)] outline-none focus-visible:border-[var(--accent)] focus-visible:ring-[var(--focus-ring)] placeholder:text-[var(--meta)]"
          />
        </div>
        <div className="flex gap-2">
          <input
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            placeholder={t("commentBodyPlaceholder")}
            disabled={submitting}
            className="flex-1 h-8 px-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:border-[var(--accent)] focus-visible:ring-[var(--focus-ring)] placeholder:text-[var(--meta)]"
          />
          <button
            type="submit"
            disabled={submitting || !newBody.trim() || !newAnchorPath.trim()}
            className="inline-flex items-center justify-center h-8 w-8 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-fg)] hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)]"
            aria-label={t("commentAdd")}
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Reply size={14} />}
          </button>
        </div>
      </form>

      {/* 错误提示 */}
      {error && (
        <div className="mx-[var(--space-4)] mt-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-sm)] bg-[var(--danger-soft)] text-[length:var(--text-xs)] text-[var(--danger)]">
          {error}
        </div>
      )}

      {/* 评论列表 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-[var(--space-12)] text-[var(--muted)]">
            <Loader2 size={16} className="animate-spin mr-2" />
            <span className="text-[length:var(--text-sm)]">{t("loading")}</span>
          </div>
        ) : filteredComments.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center px-[var(--space-4)] py-[var(--space-12)]">
            <MessageSquare size={36} className="text-[var(--meta)] opacity-50 mb-[var(--space-3)]" />
            <p className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
              {totalCount === 0 ? t("commentEmpty") : t("commentNoMatch")}
            </p>
            <p className="mt-1 text-[length:var(--text-xs)] text-[var(--meta)]">
              {totalCount === 0 ? t("commentEmptyHint") : ""}
            </p>
          </div>
        ) : (
          <ul>
            {filteredComments.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                locale={locale}
                t={t}
                submitting={submitting}
                replyingTo={replyingTo}
                replyBody={replyBody}
                editingId={editingId}
                editBody={editBody}
                onSetReplyingTo={(id) => {
                  setReplyingTo(id);
                  setReplyBody("");
                }}
                onSetReplyBody={setReplyBody}
                onReply={addReply}
                onToggleResolve={toggleResolve}
                onSetEditing={(id, body) => {
                  setEditingId(id);
                  setEditBody(body);
                }}
                onSetEditBody={setEditBody}
                onSaveEdit={saveEdit}
                onDelete={deleteComment}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── 评论项 ──

function CommentItem({
  comment,
  locale,
  t,
  submitting,
  replyingTo,
  replyBody,
  editingId,
  editBody,
  onSetReplyingTo,
  onSetReplyBody,
  onReply,
  onToggleResolve,
  onSetEditing,
  onSetEditBody,
  onSaveEdit,
  onDelete,
}: {
  comment: DocumentComment;
  locale: string;
  t: ReturnType<typeof useTranslations>;
  submitting: boolean;
  replyingTo: string | null;
  replyBody: string;
  editingId: string | null;
  editBody: string;
  onSetReplyingTo: (id: string | null) => void;
  onSetReplyBody: (body: string) => void;
  onReply: (parentId: string, e: FormEvent) => void;
  onToggleResolve: (comment: DocumentComment) => void;
  onSetEditing: (id: string | null, body: string) => void;
  onSetEditBody: (body: string) => void;
  onSaveEdit: (commentId: string, e: FormEvent) => void;
  onDelete: (commentId: string) => void;
}) {
  const authorName = displayName(comment.author, t("unknownAuthor"));
  const isEditing = editingId === comment.id;
  const isReplying = replyingTo === comment.id;

  return (
    <li className="border-b border-[var(--border-soft)] p-[var(--space-3)]">
      {/* 头像 + 用户名 + 时间 */}
      <div className="flex items-center gap-[var(--space-2)]">
        <Avatar name={authorName} />
        <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
          {authorName}
        </span>
        <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
          {formatRelative(comment.createdAt, locale)}
        </span>
        {comment.resolved && (
          <span className="inline-flex items-center gap-1 ml-auto text-[length:var(--text-xs)] text-[var(--success)]">
            <CheckCheck size={14} />
            {t("commentResolved")}
          </span>
        )}
      </div>

      {/* 锚点原文引用 */}
      {comment.anchorText && (
        <blockquote className="mt-[var(--space-2)] border-l-2 border-[var(--warn)] pl-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--muted)]">
          {comment.anchorText}
        </blockquote>
      )}

      {/* 评论内容 / 编辑输入 */}
      {isEditing ? (
        <form onSubmit={(e) => onSaveEdit(comment.id, e)} className="mt-[var(--space-2)] flex gap-2">
          <input
            value={editBody}
            onChange={(e) => onSetEditBody(e.target.value)}
            disabled={submitting}
            className="flex-1 h-8 px-2 rounded-[var(--radius-sm)] border border-[var(--accent)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-[var(--focus-ring)]"
          />
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center justify-center h-8 w-8 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-fg)] disabled:opacity-50"
          >
            <Check size={14} />
          </button>
          <button
            type="button"
            onClick={() => onSetEditing(null, "")}
            className="inline-flex items-center justify-center h-8 w-8 rounded-[var(--radius-sm)] border border-[var(--border)] text-[var(--meta)] hover:text-[var(--fg)]"
          >
            <X size={14} />
          </button>
        </form>
      ) : (
        <p className="mt-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg-2)] whitespace-pre-wrap break-words">
          {comment.body}
        </p>
      )}

      {/* 回复线程 */}
      {comment.replies.length > 0 && (
        <ul className="ml-[var(--space-4)] mt-[var(--space-2)] space-y-[var(--space-2)]">
          {comment.replies.map((reply) => {
            const replyAuthor = displayName(reply.author, t("unknownAuthor"));
            const isEditingReply = editingId === reply.id;
            return (
              <li key={reply.id} className="border-l-2 border-[var(--border-soft)] pl-[var(--space-2)]">
                <div className="flex items-center gap-[var(--space-2)]">
                  <Avatar name={replyAuthor} size="sm" />
                  <span className="text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
                    {replyAuthor}
                  </span>
                  <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
                    {formatRelative(reply.createdAt, locale)}
                  </span>
                </div>
                {isEditingReply ? (
                  <form onSubmit={(e) => onSaveEdit(reply.id, e)} className="mt-1 flex gap-2">
                    <input
                      value={editBody}
                      onChange={(e) => onSetEditBody(e.target.value)}
                      disabled={submitting}
                      className="flex-1 h-7 px-2 rounded-[var(--radius-sm)] border border-[var(--accent)] bg-[var(--surface)] text-[length:var(--text-xs)] text-[var(--fg)] outline-none focus-visible:ring-[var(--focus-ring)]"
                    />
                    <button type="submit" disabled={submitting} className="text-[var(--accent)]">
                      <Check size={14} />
                    </button>
                  </form>
                ) : (
                  <p className="mt-1 text-[length:var(--text-xs)] text-[var(--fg-2)] whitespace-pre-wrap break-words">
                    {reply.body}
                  </p>
                )}
                {/* 回复操作 */}
                {!isEditingReply && (
                  <div className="mt-1 flex gap-[var(--space-3)]">
                    <button
                      type="button"
                      onClick={() => onSetEditing(reply.id, reply.body)}
                      className="text-[length:var(--text-xs)] text-[var(--meta)] hover:text-[var(--accent)] transition-colors duration-[var(--motion-fast)]"
                    >
                      <Pencil size={14} className="inline" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(reply.id)}
                      className="text-[length:var(--text-xs)] text-[var(--meta)] hover:text-[var(--danger)] transition-colors duration-[var(--motion-fast)]"
                    >
                      <Trash2 size={14} className="inline" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* 回复输入框 */}
      {isReplying && (
        <form onSubmit={(e) => onReply(comment.id, e)} className="mt-[var(--space-2)] flex gap-2">
          <input
            value={replyBody}
            onChange={(e) => onSetReplyBody(e.target.value)}
            placeholder={t("commentReplyPlaceholder")}
            disabled={submitting}
            autoFocus
            className="flex-1 h-8 px-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:border-[var(--accent)] focus-visible:ring-[var(--focus-ring)] placeholder:text-[var(--meta)]"
          />
          <button
            type="submit"
            disabled={submitting || !replyBody.trim()}
            className="inline-flex items-center justify-center h-8 px-3 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-xs)] disabled:opacity-50"
          >
            {t("commentReply")}
          </button>
          <button
            type="button"
            onClick={() => onSetReplyingTo(null)}
            className="inline-flex items-center justify-center h-8 w-8 rounded-[var(--radius-sm)] text-[var(--meta)] hover:text-[var(--fg)]"
          >
            <X size={14} />
          </button>
        </form>
      )}

      {/* 操作按钮 */}
      {!isEditing && (
        <div className="mt-[var(--space-2)] flex gap-[var(--space-3)]">
          <button
            type="button"
            onClick={() => onSetReplyingTo(isReplying ? null : comment.id)}
            className="inline-flex items-center gap-1 text-[length:var(--text-xs)] text-[var(--meta)] hover:text-[var(--accent)] transition-colors duration-[var(--motion-fast)]"
          >
            <Reply size={14} />
            {t("commentReply")}
          </button>
          <button
            type="button"
            onClick={() => onToggleResolve(comment)}
            className={`inline-flex items-center gap-1 text-[length:var(--text-xs)] transition-colors duration-[var(--motion-fast)] ${
              comment.resolved
                ? "text-[var(--meta)] hover:text-[var(--warn)]"
                : "text-[var(--meta)] hover:text-[var(--success)]"
            }`}
          >
            <Check size={14} />
            {comment.resolved ? t("commentReopen") : t("commentResolve")}
          </button>
          <button
            type="button"
            onClick={() => onSetEditing(comment.id, comment.body)}
            className="text-[length:var(--text-xs)] text-[var(--meta)] hover:text-[var(--accent)] transition-colors duration-[var(--motion-fast)]"
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            onClick={() => onDelete(comment.id)}
            className="text-[length:var(--text-xs)] text-[var(--meta)] hover:text-[var(--danger)] transition-colors duration-[var(--motion-fast)]"
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </li>
  );
}

// ── 头像组件（首字母占位）──

function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const dim = size === "sm" ? "w-5 h-5 text-[10px]" : "w-6 h-6 text-[length:var(--text-xs)]";
  return (
    <span
      className={`inline-flex items-center justify-center shrink-0 rounded-full bg-[var(--surface-2)] text-[var(--fg-2)] font-[weight:var(--weight-medium)] ${dim}`}
    >
      {initials(name)}
    </span>
  );
}