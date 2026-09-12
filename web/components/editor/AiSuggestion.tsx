"use client";

/**
 * AI 续写浮层（AiSuggestion）。
 *
 * 功能：
 * - 监听编辑器内容更新，用户停止输入 1.5s 后自动调用
 *   `/api/v1/ai/completion`，请求体 `{ text: 光标前文本 }`。
 * - 流式响应实时渲染为灰色斜体 ghost text，浮在光标右侧。
 * - Tab 接受续写（用 ProseMirror transaction 插入纯文本）；Esc 拒绝。
 * - 输入时取消进行中请求（AbortController）并重新 debounce。
 * - 仅在光标处于当前块末尾时显示，避免覆盖后续文字。
 *
 * 技术要点：
 * - "use client" 隔离客户端逻辑。
 * - i18n 走 next-intl 的 `ai.completion` 命名空间。
 * - 流式消费走 `consumeAiStream`（见 aiStream.ts），未引入 `@ai-sdk/react`。
 * - 光标坐标用 `editor.view.coordsAtPos`（viewport 相对），配 `position: fixed`。
 * - 所有样式走 design token（var(--*)），无裸 hex。
 * - 尊重 prefers-reduced-motion（spinner 用 motion-reduce 变体）。
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { Editor } from "@tiptap/core";
import { useTranslations } from "next-intl";
import { consumeAiStream } from "./aiStream";

interface AiSuggestionProps {
  editor: Editor | null;
}

/** 停止输入后触发续写的延迟（毫秒） */
const DEBOUNCE_MS = 1500;
/** 光标前文本最小长度，低于此不触发（避免空文档/过短上下文） */
const MIN_TEXT_LEN = 5;

/** ProseMirror coordsAtPos 返回的 viewport 坐标 */
interface ViewportCoords {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

export function AiSuggestion({ editor }: AiSuggestionProps) {
  const t = useTranslations("ai.completion");
  const [ghost, setGhost] = useState("");
  const [loading, setLoading] = useState(false);
  const [coords, setCoords] = useState<ViewportCoords | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** ghost 文本 ref：keydown handler 需同步读取最新值，避免 stale closure */
  const ghostRef = useRef("");

  /** 接受续写：用 ProseMirror transaction 在光标处插入纯文本 */
  const accept = useCallback(() => {
    if (!editor || !ghostRef.current) return;
    const pos = editor.state.selection.head;
    const tr = editor.state.tr.insertText(ghostRef.current, pos);
    editor.view.dispatch(tr);
    editor.commands.focus();
    ghostRef.current = "";
    setGhost("");
    setCoords(null);
  }, [editor]);

  /** 拒绝续写：清空 ghost、取消请求与 debounce */
  const dismiss = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    ghostRef.current = "";
    setGhost("");
    setLoading(false);
    setCoords(null);
  }, []);

  /** 触发续写请求（debounce 后调用） */
  const trigger = useCallback(async () => {
    if (!editor) return;
    const { selection, doc } = editor.state;
    // 仅光标态（非选区）触发
    if (!selection.empty) return;
    const $head = selection.$head;
    // 仅在当前块末尾触发，避免 ghost 覆盖后续文字
    if ($head.parentOffset !== $head.parent.content.size) return;
    const textBefore = doc.textBetween(0, selection.head, "\n");
    if (textBefore.length < MIN_TEXT_LEN) return;

    // 取消进行中请求
    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);

    // 计算光标 viewport 坐标（用于 fixed 定位浮层）
    try {
      const c = editor.view.coordsAtPos(selection.head);
      setCoords({ top: c.top, left: c.left, right: c.right, bottom: c.bottom });
    } catch {
      setCoords(null);
    }

    try {
      ghostRef.current = "";
      const full = await consumeAiStream(
        "/api/v1/ai/completion",
        { text: textBefore },
        {
          signal: ac.signal,
          onDelta: (delta) => {
            ghostRef.current += delta;
            setGhost(ghostRef.current);
          },
        },
      );
      ghostRef.current = full;
      setGhost(full);
    } catch (e) {
      // abort 不视为错误
      if ((e as Error).name === "AbortError") return;
      // 其他错误静默失败（不阻断编辑）
      ghostRef.current = "";
      setGhost("");
      setCoords(null);
    } finally {
      setLoading(false);
      if (abortRef.current === ac) abortRef.current = null;
    }
  }, [editor]);

  // 监听 editor update：输入时取消旧请求/ghost，重新 debounce
  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      if (abortRef.current) abortRef.current.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      ghostRef.current = "";
      setGhost("");
      setLoading(false);
      setCoords(null);
      debounceRef.current = setTimeout(trigger, DEBOUNCE_MS);
    };
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [editor, trigger]);

  // 光标移动（非内容变化）时 dismiss 当前 ghost
  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      if (ghostRef.current || loading) dismiss();
    };
    editor.on("selectionUpdate", handler);
    return () => {
      editor.off("selectionUpdate", handler);
    };
  }, [editor, dismiss, loading]);

  // 监听 Tab/Esc：capture 阶段确保先于 ProseMirror 处理
  useEffect(() => {
    if (!editor) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Tab" && ghostRef.current) {
        event.preventDefault();
        event.stopPropagation();
        accept();
      } else if (event.key === "Escape" && (ghostRef.current || loading)) {
        event.preventDefault();
        event.stopPropagation();
        dismiss();
      }
    };
    editor.view.dom.addEventListener("keydown", handler, true);
    return () => editor.view.dom.removeEventListener("keydown", handler, true);
  }, [editor, accept, dismiss, loading]);

  // 卸载清理
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // 无内容且非加载中不渲染
  if (!ghost && !loading) return null;
  if (!coords) return null;

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      style={{
        position: "fixed",
        top: coords.top,
        left: coords.right,
        pointerEvents: "none",
        color: "var(--meta)",
        fontStyle: "italic",
        fontSize: "var(--text-sm)",
        lineHeight: "var(--leading-normal)",
        zIndex: "var(--z-dropdown)",
        maxWidth: "calc(100vw - var(--space-4))",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {loading && !ghost ? (
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          {t("loading")}
        </span>
      ) : (
        <>
          {ghost}
          <span
            style={{
              marginLeft: "var(--space-2)",
              fontSize: "var(--text-xs)",
              fontStyle: "normal",
              opacity: 0.7,
              whiteSpace: "nowrap",
            }}
          >
            {t("accept")} · {t("dismiss")}
          </span>
        </>
      )}
    </div>
  );
}