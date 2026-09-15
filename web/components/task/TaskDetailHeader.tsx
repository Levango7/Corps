"use client";

// 任务详情头部：标题 + 描述 + 星标 + 自动保存指示。
// 拆分自 task/[id]/page.tsx 第 554-610 行。

import { useEffect, type RefObject } from "react";
import { Loader2, Star } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Task } from "./types";

interface TaskDetailHeaderProps {
  task: Task;
  titleDraft: string;
  setTitleDraft: (v: string) => void;
  descDraft: string;
  setDescDraft: (v: string) => void;
  dirty: boolean;
  setDirty: (v: boolean) => void;
  onPatch: (data: Partial<Record<string, unknown>>) => void;
  saving: boolean;
  starred: boolean;
  onToggleFavorite: () => void;
  titleRef: RefObject<HTMLTextAreaElement | null>;
}

export function TaskDetailHeader({
  task,
  titleDraft,
  setTitleDraft,
  descDraft,
  setDescDraft,
  dirty,
  setDirty,
  onPatch,
  saving,
  starred,
  onToggleFavorite,
  titleRef,
}: TaskDetailHeaderProps) {
  const t = useTranslations("task");

  // ── 标题 textarea 自动高度 ──
  useEffect(() => {
    const el = titleRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    }
  }, [titleDraft, titleRef]);

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-[var(--space-5)]">
      <div className="flex items-start gap-[var(--space-2)]">
        <textarea
          ref={titleRef}
          value={titleDraft}
          onChange={(e) => {
            setTitleDraft(e.target.value);
            setDirty(true);
          }}
          onBlur={() => {
            if (dirty && titleDraft.trim() && titleDraft !== task.title) {
              onPatch({ title: titleDraft.trim() });
            }
          }}
          rows={1}
          className="flex-1 overflow-hidden resize-none bg-transparent text-[length:var(--text-xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] rounded-[var(--radius-sm)] tracking-[var(--tracking-tight)] leading-snug transition-shadow duration-[var(--motion-fast)]"
        />
        <button
          type="button"
          onClick={onToggleFavorite}
          aria-label={starred ? t("unstar") : t("star")}
          title={starred ? t("unstar") : t("star")}
          className="shrink-0 mt-1 p-1.5 rounded-[var(--radius-md)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
        >
          {starred ? (
            <Star size={18} className="text-[var(--warn)] fill-[var(--warn)]" />
          ) : (
            <Star size={18} className="text-[var(--meta)]" />
          )}
        </button>
      </div>

      <textarea
        value={descDraft}
        onChange={(e) => {
          setDescDraft(e.target.value);
          setDirty(true);
        }}
        onBlur={() => {
          if (descDraft !== (task.description ?? "")) onPatch({ description: descDraft });
        }}
        rows={4}
        placeholder={t("detailDescriptionPlaceholder")}
        className="mt-[var(--space-3)] w-full resize-y bg-transparent text-[length:var(--text-base)] text-[var(--fg-2)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] rounded-[var(--radius-sm)] leading-[var(--leading-relaxed)] placeholder:text-[var(--meta)] transition-shadow duration-[var(--motion-fast)]"
      />

      <div className="mt-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--meta)]">
        {saving ? (
          <span className="inline-flex items-center gap-1">
            <Loader2 size={11} className="animate-spin" />
            {t("saving")}
          </span>
        ) : (
          t("autosave")
        )}
      </div>
    </div>
  );
}