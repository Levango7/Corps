"use client";

/**
 * AI 选中文本浮工具栏（AiToolbar）。
 *
 * 功能：
 * - 用户在编辑器中选中文本时，在选区上方显示浮工具栏。
 * - 三个按钮：摘要 / 翻译 / 格式化。
 *   - 摘要：选中文本 → `/api/v1/ai/summarize` → 流式结果替换选区。
 *   - 翻译：展开子菜单（中文/英文/日文）→ `/api/v1/ai/translate`
 *     body 含 `targetLang` → 流式结果替换选区。
 *   - 格式化：选中文本 → `/api/v1/ai/format` → 流式结果替换选区。
 * - 流式期间按钮显示 spinner；完成后用 ProseMirror transaction 替换选区文本。
 * - 选区消失时隐藏工具栏。
 *
 * 技术要点：
 * - "use client" 隔离客户端逻辑。
 * - i18n 走 `ai.toolbar` 与 `ai.translate` 命名空间。
 * - 流式消费走 `consumeAiStream`（见 aiStream.ts）。
 * - 浮层用 `getBoundingClientRect` + `coordsAtPos` 定位，`position: fixed`。
 * - 所有样式走 design token（var(--*)），无裸 hex。
 * - lucide-react 图标 size=16。
 * - 尊重 prefers-reduced-motion（spinner 用 motion-reduce 变体）。
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { Editor } from "@tiptap/core";
import { useTranslations } from "next-intl";
import { Sparkles, Languages, Wand2, Loader2, ChevronDown } from "lucide-react";
import { consumeAiStream } from "./aiStream";

interface AiToolbarProps {
  editor: Editor | null;
}

type Action = "summarize" | "translate" | "format";
type TargetLang = "zh" | "en" | "ja";

/** 浮层定位（viewport 相对，配 position: fixed） */
interface ToolbarPos {
  top: number;
  left: number;
}

const TARGET_LANGS: TargetLang[] = ["zh", "en", "ja"];

/** 按钮基础类名（design token，与 RichTextEditor 工具栏风格一致） */
const BTN_CLASS =
  "inline-flex items-center gap-1 px-2 py-1 rounded-[var(--radius-sm)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--hover-soft)] hover:text-[var(--fg)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]";

export function AiToolbar({ editor }: AiToolbarProps) {
  const t = useTranslations("ai.toolbar");
  const tTrans = useTranslations("ai.translate");

  const [pos, setPos] = useState<ToolbarPos | null>(null);
  const [loading, setLoading] = useState<Action | null>(null);
  const [showTranslateMenu, setShowTranslateMenu] = useState(false);
  /** 翻译子菜单节点 ref（外部点击关闭判定） */
  const menuRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /** 执行 AI 操作：调流式 API，完成后用结果替换选区 */
  const runAction = useCallback(
    async (action: Action, targetLang?: TargetLang) => {
      if (!editor) return;
      const { from, to, empty } = editor.state.selection;
      if (empty) return;
      const text = editor.state.doc.textBetween(from, to, "\n");
      if (!text.trim()) return;

      if (abortRef.current) abortRef.current.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(action);
      setShowTranslateMenu(false);

      const url = `/api/v1/ai/${action}`;
      const body: Record<string, unknown> = { text };
      if (action === "translate" && targetLang) {
        body.targetLang = targetLang;
      }

      let result = "";
      try {
        result = await consumeAiStream(url, body, { signal: ac.signal });
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        // 静默失败：不替换、不阻断
        return;
      } finally {
        setLoading(null);
        if (abortRef.current === ac) abortRef.current = null;
      }

      // 用 ProseMirror transaction 替换选区为 AI 结果（纯文本插入）
      if (result && editor && !editor.isDestroyed) {
        const tr = editor.state.tr.delete(from, to).insertText(result, from);
        editor.view.dispatch(tr);
        editor.commands.focus();
      }
    },
    [editor],
  );

  /** 根据选区更新浮层位置 */
  const updatePos = useCallback(() => {
    if (!editor) return;
    const { empty, from, to } = editor.state.selection;
    if (empty) {
      setPos(null);
      setShowTranslateMenu(false);
      return;
    }
    const text = editor.state.doc.textBetween(from, to, "\n");
    if (!text.trim()) {
      setPos(null);
      return;
    }
    try {
      const startCoords = editor.view.coordsAtPos(from);
      const endCoords = editor.view.coordsAtPos(to);
      // 选区上方 36px（约一行高 + 间距），水平居中
      const top = Math.min(startCoords.top, endCoords.top) - 36;
      const left = (startCoords.left + endCoords.right) / 2;
      setPos({ top, left });
    } catch {
      setPos(null);
    }
  }, [editor]);

  // 监听选区变化更新浮层
  useEffect(() => {
    if (!editor) return;
    const handler = () => updatePos();
    editor.on("selectionUpdate", handler);
    return () => {
      editor.off("selectionUpdate", handler);
    };
  }, [editor, updatePos]);

  // 编辑器失焦时隐藏（但点击工具栏按钮的 mousedown 会 preventDefault，不失焦）
  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      // 延迟检查，允许点击工具栏后选区仍存在
      requestAnimationFrame(() => {
        if (editor.isDestroyed || editor.state.selection.empty) {
          setPos(null);
          setShowTranslateMenu(false);
        }
      });
    };
    editor.on("blur", handler);
    return () => {
      editor.off("blur", handler);
    };
  }, [editor]);

  // 外部点击关闭翻译子菜单
  useEffect(() => {
    if (!showTranslateMenu) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(target)) {
        setShowTranslateMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showTranslateMenu]);

  // 卸载清理
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  if (!pos) return null;

  const isLoading = loading !== null;

  return (
    <div
      role="toolbar"
      aria-label={t("summarize")}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        transform: "translateX(-50%)",
        zIndex: "var(--z-dropdown)",
      }}
      className="flex items-center gap-0.5 p-1 rounded-[var(--radius-sm)] bg-[var(--surface)] border border-[var(--border)] shadow-[var(--elev-md)]"
      // 防止点击工具栏时编辑器失焦（选区消失）
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        type="button"
        className={BTN_CLASS}
        disabled={isLoading}
        onClick={() => runAction("summarize")}
        title={t("summarize")}
        aria-label={t("summarize")}
      >
        {loading === "summarize" ? (
          <Loader2 size={16} className="animate-spin motion-reduce:animate-none" />
        ) : (
          <Sparkles size={16} />
        )}
        {t("summarize")}
      </button>

      <button
        type="button"
        className={BTN_CLASS}
        disabled={isLoading}
        onClick={() => setShowTranslateMenu((v) => !v)}
        title={t("translate")}
        aria-label={t("translate")}
        aria-expanded={showTranslateMenu}
      >
        {loading === "translate" ? (
          <Loader2 size={16} className="animate-spin motion-reduce:animate-none" />
        ) : (
          <Languages size={16} />
        )}
        {t("translate")}
        <ChevronDown size={14} aria-hidden="true" />
      </button>

      <button
        type="button"
        className={BTN_CLASS}
        disabled={isLoading}
        onClick={() => runAction("format")}
        title={t("format")}
        aria-label={t("format")}
      >
        {loading === "format" ? (
          <Loader2 size={16} className="animate-spin motion-reduce:animate-none" />
        ) : (
          <Wand2 size={16} />
        )}
        {t("format")}
      </button>

      {showTranslateMenu && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={tTrans("tooltip")}
          className="absolute top-full left-0 mt-1 p-1 rounded-[var(--radius-sm)] bg-[var(--surface)] border border-[var(--border)] shadow-[var(--elev-md)] flex flex-col gap-0.5 min-w-[140px]"
        >
          {TARGET_LANGS.map((lang) => (
            <button
              key={lang}
              type="button"
              role="menuitem"
              className={BTN_CLASS}
              disabled={isLoading}
              onClick={() => runAction("translate", lang)}
            >
              {lang === "zh"
                ? tTrans("targetZh")
                : lang === "en"
                  ? tTrans("targetEn")
                  : tTrans("targetJa")}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}