"use client";

/**
 * 收藏按钮组件（可嵌入任何模块）。
 *
 * 交互流程：
 *  1. 挂载时调用 GET /api/v1/favorites/check 检查收藏状态
 *  2. 未收藏：显示空心星标 + "收藏"，点击弹出备注输入框（可选）→ POST 收藏
 *  3. 已收藏：显示实心星标 + "已收藏"，点击直接取消收藏 → DELETE
 *
 * Design token 样式 + lucide-react 图标（Star）size 14/16。
 * Props: { workspaceId, targetType, targetId, size? }
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Star, X, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/Toast";

/** 收藏检查结果 */
interface CheckResult {
  favorited: boolean;
  favoriteId: string | null;
}

/** 收藏记录 */
interface FavoriteRecord {
  id: string;
  targetType: string;
  targetId: string;
  note: string | null;
  createdAt: string;
}

/** FavoriteButton Props */
interface FavoriteButtonProps {
  /** 工作区 ID */
  workspaceId: string;
  /** 收藏目标类型：task | document | message | wiki | whiteboard | form | meeting */
  targetType: string;
  /** 收藏目标 ID */
  targetId: string;
  /** 按钮尺寸 */
  size?: "sm" | "md";
}

export default function FavoriteButton({
  workspaceId,
  targetType,
  targetId,
  size = "md",
}: FavoriteButtonProps) {
  const t = useTranslations("common.favorite");
  const { toast } = useToast();

  const [favorited, setFavorited] = useState(false);
  const [favoriteId, setFavoriteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // 备注输入框展开状态（点击收藏时展开）
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [note, setNote] = useState("");

  // AbortController：组件卸载时中止进行中的请求
  const abortRef = useRef<AbortController | null>(null);

  /** 尺寸相关样式 */
  const iconSize = size === "sm" ? 14 : 16;
  const btnHeight = size === "sm" ? "h-7" : "h-8";
  const btnPadding = size === "sm" ? "px-2" : "px-2.5";
  const textSize =
    size === "sm"
      ? "text-[length:var(--text-xs)]"
      : "text-[length:var(--text-sm)]";

  /** 加载收藏状态 */
  async function loadStatus() {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    try {
      const data = await api<CheckResult>(
        `/api/v1/favorites/check?wid=${encodeURIComponent(workspaceId)}&type=${encodeURIComponent(targetType)}&targetId=${encodeURIComponent(targetId)}`,
        { signal: ac.signal },
      );
      if (ac.signal.aborted) return;
      setFavorited(data.favorited);
      setFavoriteId(data.favoriteId);
    } catch (e) {
      if (ac.signal.aborted || (e instanceof Error && e.name === "AbortError"))
        return;
      if (process.env.NODE_ENV === "development")
        console.error("[FavoriteButton] loadStatus error:", e);
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
    return () => {
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, targetType, targetId]);

  /** 确认收藏（带备注） */
  async function confirmFavorite() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const created = await api<FavoriteRecord>("/api/v1/favorites", {
        method: "POST",
        body: JSON.stringify({
          wid: workspaceId,
          targetType,
          targetId,
          note: note.trim() || undefined,
        }),
      });
      setFavorited(true);
      setFavoriteId(created.id);
      setShowNoteInput(false);
      setNote("");
      toast("success", t("added"));
    } catch (e) {
      if (process.env.NODE_ENV === "development")
        console.error("[FavoriteButton] confirmFavorite error:", e);
      toast("error", t("error"));
    } finally {
      setSubmitting(false);
    }
  }

  /** 取消收藏 */
  async function removeFavorite() {
    if (submitting || !favoriteId) return;
    setSubmitting(true);
    try {
      await api(
        `/api/v1/favorites/${favoriteId}?wid=${encodeURIComponent(workspaceId)}`,
        { method: "DELETE" },
      );
      setFavorited(false);
      setFavoriteId(null);
      toast("success", t("removed"));
    } catch (e) {
      if (process.env.NODE_ENV === "development")
        console.error("[FavoriteButton] removeFavorite error:", e);
      toast("error", t("error"));
    } finally {
      setSubmitting(false);
    }
  }

  /** 点击按钮主操作 */
  function handleClick() {
    if (loading || submitting) return;
    if (favorited) {
      // 已收藏 → 直接取消
      removeFavorite();
    } else {
      // 未收藏 → 展开备注输入框
      setShowNoteInput(true);
    }
  }

  /** 取消备注输入 */
  function cancelNoteInput() {
    setShowNoteInput(false);
    setNote("");
  }

  // 加载态
  if (loading) {
    return (
      <button
        type="button"
        disabled
        className={`inline-flex items-center gap-1.5 ${btnHeight} ${btnPadding} border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[var(--muted)] ${textSize} cursor-not-allowed`}
        aria-label={t("title")}
      >
        <Loader2 size={iconSize} className="animate-spin" />
      </button>
    );
  }

  return (
    <div className="relative inline-flex">
      {/* 主按钮 */}
      <button
        type="button"
        onClick={handleClick}
        disabled={submitting}
        className={`inline-flex items-center gap-1.5 ${btnHeight} ${btnPadding} rounded-[var(--radius-md)] ${textSize} font-[weight:var(--weight-medium)] transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:opacity-50 disabled:cursor-not-allowed ${
          favorited
            ? "bg-[var(--accent-soft)] text-[var(--accent-fg)] border border-[var(--accent)]"
            : "bg-[var(--surface)] text-[var(--fg)] border border-[var(--border)] hover:bg-[var(--surface-2)]"
        }`}
        aria-pressed={favorited}
        aria-label={favorited ? t("remove") : t("add")}
      >
        <Star
          size={iconSize}
          className={favorited ? "text-[var(--accent)]" : ""}
          fill={favorited ? "currentColor" : "none"}
        />
        <span>{favorited ? t("remove") : t("add")}</span>
      </button>

      {/* 备注输入弹层 */}
      {showNoteInput && (
        <div
          className="absolute top-full left-0 mt-1 z-10 w-64 p-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-md)]"
          role="dialog"
          aria-label={t("note")}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
              {t("add")}
            </span>
            <button
              type="button"
              onClick={cancelNoteInput}
              className="shrink-0 opacity-60 hover:opacity-100 transition-opacity text-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] rounded-[var(--radius-sm)]"
              aria-label={t("cancel")}
            >
              <X size={14} />
            </button>
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            placeholder={t("notePlaceholder")}
            rows={2}
            className="w-full px-2.5 py-2 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)] resize-none"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                confirmFavorite();
              }
              if (e.key === "Escape") {
                cancelNoteInput();
              }
            }}
          />
          <div className="flex items-center justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={cancelNoteInput}
              className="inline-flex items-center h-7 px-2.5 rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={confirmFavorite}
              disabled={submitting}
              className="inline-flex items-center gap-1 h-7 px-2.5 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            >
              {submitting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Star size={14} fill="currentColor" />
              )}
              {t("save")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}