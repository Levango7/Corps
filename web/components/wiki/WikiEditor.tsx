"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Save, Eye, Edit3, Loader2, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { WikiViewer } from "./WikiViewer";

/** Wiki 页面数据（编辑器所需字段） */
export interface WikiPageData {
  id: string;
  title: string;
  slug: string;
  content: string;
  parentId: string | null;
  sortOrder: number;
  updatedAt: string;
}

interface WikiEditorProps {
  wid: string;
  page: WikiPageData;
  /** 保存成功后通知父组件（用于刷新侧边栏） */
  onSaved?: () => void;
  /** 删除成功后通知父组件 */
  onDeleted?: () => void;
}

/** 自动保存防抖间隔（ms） */
const AUTOSAVE_DEBOUNCE_MS = 2000;

export function WikiEditor({ wid, page, onSaved, onDeleted }: WikiEditorProps) {
  const t = useTranslations("wiki");
  const [title, setTitle] = useState(page.title);
  const [content, setContent] = useState(page.content);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  // 跟踪是否有未保存的改动
  const dirtyRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    setDirty(true);
  }, []);

  // 页面切换时重置状态
  useEffect(() => {
    setTitle(page.title);
    setContent(page.content);
    setSaveStatus("idle");
    setError("");
    dirtyRef.current = false;
    setDirty(false);
  }, [page.id, page.title, page.content]);

  /** 执行保存请求 */
  const doSave = useCallback(async () => {
    if (!dirtyRef.current) return;
    setSaveStatus("saving");
    setError("");
    try {
      await api(`/api/v1/workspaces/${wid}/wiki/${page.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title, content }),
      });
      dirtyRef.current = false;
      setDirty(false);
      setSaveStatus("saved");
      onSaved?.();
      // 2 秒后清除"已保存"提示
      setTimeout(() => setSaveStatus((s) => (s === "saved" ? "idle" : s)), 2000);
    } catch (e) {
      setSaveStatus("error");
      setError(e instanceof Error ? e.message : t("saveError"));
    }
  }, [wid, page.id, title, content, onSaved, t]);

  // 自动保存：debounce 2s
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => {
      void doSave();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [dirty, title, content, doSave]);

  /** 手动保存按钮 */
  function handleManualSave() {
    void doSave();
  }

  /** 删除页面 */
  async function handleDelete() {
    if (!window.confirm(t("deleteConfirm"))) return;
    try {
      await api(`/api/v1/workspaces/${wid}/wiki/${page.id}`, { method: "DELETE" });
      onDeleted?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveError"));
    }
  }

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 px-[var(--space-4)] py-[var(--space-2)] border-b border-[var(--border-soft)]">
        {/* 编辑/预览切换 */}
        <div className="inline-flex items-center rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
          <button
            type="button"
            onClick={() => setMode("edit")}
            className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] transition-colors duration-[var(--motion-fast)] ${
              mode === "edit"
                ? "bg-[var(--surface)] text-[var(--fg)] shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--fg)]"
            }`}
          >
            <Edit3 size={14} />
            {t("edit")}
          </button>
          <button
            type="button"
            onClick={() => setMode("preview")}
            className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] transition-colors duration-[var(--motion-fast)] ${
              mode === "preview"
                ? "bg-[var(--surface)] text-[var(--fg)] shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--fg)]"
            }`}
          >
            <Eye size={14} />
            {t("preview")}
          </button>
        </div>

        <div className="flex-1" />

        {/* 保存状态指示 */}
        <div className="flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--muted)]">
          {saveStatus === "saving" && (
            <>
              <Loader2 size={14} className="animate-spin" />
              {t("saving")}
            </>
          )}
          {saveStatus === "saved" && !dirty && (
            <span className="text-[var(--accent)]">{t("saved")}</span>
          )}
          {saveStatus === "error" && <span className="text-[var(--danger)]">{t("saveError")}</span>}
        </div>

        {/* 手动保存 */}
        <button
          type="button"
          onClick={handleManualSave}
          disabled={!dirty || saveStatus === "saving"}
          className="inline-flex items-center gap-1 h-8 px-3 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)]"
        >
          <Save size={14} />
          {t("save")}
        </button>

        {/* 删除 */}
        <button
          type="button"
          onClick={handleDelete}
          className="inline-flex items-center justify-center w-8 h-8 rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] transition-colors duration-[var(--motion-fast)]"
          aria-label={t("delete")}
          title={t("delete")}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {error && (
        <p className="px-[var(--space-4)] py-2 text-[length:var(--text-sm)] text-[var(--danger)]">
          {error}
        </p>
      )}

      {/* 编辑区 / 预览区 */}
      <div className="flex-1 overflow-y-auto px-[var(--space-4)] py-[var(--space-3)]">
        {mode === "edit" ? (
          <div className="flex flex-col gap-[var(--space-3)] h-full">
            {/* 标题输入 */}
            <input
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                markDirty();
              }}
              placeholder={t("titlePlaceholder")}
              className="w-full h-10 px-3 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)] placeholder:text-[var(--muted)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            />
            {/* 内容 textarea */}
            <textarea
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                markDirty();
              }}
              placeholder={t("contentPlaceholder")}
              className="flex-1 w-full p-3 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] font-[family-name:var(--font-mono)] leading-[var(--leading-relaxed)] placeholder:text-[var(--muted)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] resize-none"
              spellCheck={false}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-[var(--space-3)]">
            <h1 className="text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)]">
              {title || t("titlePlaceholder")}
            </h1>
            <WikiViewer content={content} />
          </div>
        )}
      </div>
    </div>
  );
}
