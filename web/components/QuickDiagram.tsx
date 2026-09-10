"use client";

/**
 * 快速图表对话框（v0.6 增补：CMD 制图收尾件）
 *
 * 定位：mermaid 引擎与图表模板已有，缺的是"不进编辑器正文也能快速出图"
 * 的入口。场景：讨论中随手画一张架构草图/流程，确认后一键插入正文
 * （决策记录或文档），或仅复制代码。
 *
 * 设计：
 *  - 图型选择复用 MarkdownToolbar 的六种模板（同一事实源 DIAGRAM_KEYS + getDiagramCode，
 *    顺带把下拉的模板表从组件里抽出来共享）
 *  - 左码右览（lg+）/上下堆叠（移动端）——移动端是本功能的一等公民
 *  - 预览走 Mermaid 组件（同引擎同主题，渲染即所得）；预览失败显示
 *    语法错误提示（Mermaid 组件自身会降级代码块，这里再加一行引导）
 *  - 产出两种：插入回调（父组件把 ```mermaid 块接进正文）或复制到剪贴板
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { X, Copy, Check, ArrowDownToLine } from "lucide-react";
import { Mermaid } from "@/components/Mermaid";
import { useToast } from "@/components/Toast";

/** 图型 key 列表（与 MarkdownToolbar 图表下拉共享同一事实源；模板正文走 i18n） */
export const DIAGRAM_KEYS = [
  "mindmap",
  "flow",
  "sequence",
  "gantt",
  "pie",
  "quadrant",
] as const;

/** 根据 key 与翻译函数返回 mermaid 模板代码（正文已 i18n，mermaid 语法在消息文件中维护） */
export function getDiagramCode(
  key: string,
  t: ReturnType<typeof useTranslations>,
): string {
  switch (key) {
    case "mindmap":
      return t("diagramMindmapCode");
    case "flow":
      return t("diagramFlowCode");
    case "sequence":
      return t("diagramSequenceCode");
    case "gantt":
      return t("diagramGanttCode");
    case "pie":
      return t("diagramPieCode");
    case "quadrant":
      return t("diagramQuadrantCode");
    default:
      return "";
  }
}

interface QuickDiagramProps {
  /** 打开态由父组件持有 */
  open: boolean;
  onClose: () => void;
  /** 把生成的 ```mermaid 代码块插入父编辑器正文 */
  onInsert: (mermaidBlock: string) => void;
}

export function QuickDiagram({ open, onClose, onInsert }: QuickDiagramProps) {
  const t = useTranslations("diagramQuick");
  const te = useTranslations("editor");
  const { toast } = useToast();
  const [kind, setKind] = useState("mindmap");
  const [code, setCode] = useState(() => getDiagramCode("mindmap", te));
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  // M11 修复：焦点陷阱——记录打开前的焦点，对话框内循环 Tab
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const firstFocusableRef = useRef<HTMLButtonElement>(null);
  // R8B-10：最后一个可聚焦元素 ref，用于 Tab 循环
  const lastFocusableRef = useRef<HTMLButtonElement>(null);

  // 切图型 = 重置为该图型模板（未保存的编辑会被覆盖——对话框语义如此）
  function pickKind(k: string) {
    setKind(k);
    setCode(getDiagramCode(k, te));
  }

  // 打开时重置为默认图型；Esc 关闭
  useEffect(() => {
    if (open) {
      setKind("mindmap");
      setCode(getDiagramCode("mindmap", te));
      setCopied(false);
      // M11 修复：记录打开前焦点，对话框打开后焦点移入
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      // 延迟一帧让对话框渲染后再聚焦
      requestAnimationFrame(() => {
        firstFocusableRef.current?.focus();
      });
    } else if (previousFocusRef.current) {
      // 关闭时恢复焦点
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, [open, te]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // R8B-10：Tab 焦点循环——在最后一个可聚焦元素按 Tab 跳回第一个，
      // 在第一个按 Shift+Tab 跳到最后一个，防止焦点逃逸到背景页面
      if (e.key === "Tab") {
        const first = firstFocusableRef.current;
        const last = lastFocusableRef.current;
        if (!first || !last) return;
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const block = "```mermaid\n" + code + "```\n";

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("title")}
      className="fixed inset-0 z-[var(--z-modal)] flex items-end sm:items-center justify-center bg-[var(--overlay)] p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-3xl max-h-[100dvh] sm:max-h-[85dvh] flex flex-col bg-[var(--surface)] sm:rounded-[var(--radius-lg)] border border-[var(--border)] shadow-[var(--elev-lg)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <header className="flex items-center justify-between px-[var(--space-4)] py-[var(--space-3)] border-b border-[var(--border-soft)]">
          <h3 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            {t("title")}
          </h3>
          <button
            ref={firstFocusableRef}
            onClick={onClose}
            aria-label={te("close") || "Close"}
            className="p-1.5 rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors"
          >
            <X size={16} />
          </button>
        </header>

        {/* 图型选择 */}
        <div className="flex flex-wrap gap-1.5 px-[var(--space-4)] py-[var(--space-2)] border-b border-[var(--border-soft)]">
          {DIAGRAM_KEYS.map((dKey) => (
            <button
              key={dKey}
              type="button"
              onClick={() => pickKind(dKey)}
              aria-pressed={kind === dKey}
              className={`px-2.5 py-1 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] transition-colors ${
                kind === dKey
                  ? "bg-[var(--accent)] text-[var(--accent-fg)] font-[weight:var(--weight-medium)]"
                  : "text-[var(--fg-2)] hover:bg-[var(--surface-2)]"
              }`}
            >
              {te("diagram" + dKey.charAt(0).toUpperCase() + dKey.slice(1))}
            </button>
          ))}
        </div>

        {/* 码/览双栏：lg 并排，移动端上下（预览优先视觉确认） */}
        <div className="flex-1 grid grid-rows-2 lg:grid-rows-1 lg:grid-cols-2 min-h-0">
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-label={t("codeLabel")}
            spellCheck={false}
            className="w-full h-full min-h-[30dvh] p-[var(--space-3)] bg-[var(--surface-2)] font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none border-b lg:border-b-0 lg:border-r border-[var(--border-soft)] resize-none"
          />
          <div className="h-full min-h-[30dvh] overflow-auto p-[var(--space-3)] bg-[var(--surface)]">
            {code.trim() ? (
              <Mermaid code={code} />
            ) : (
              <p className="text-[length:var(--text-sm)] text-[var(--meta)]">{t("emptyPreview")}</p>
            )}
          </div>
        </div>

        {/* 底部操作 */}
        <footer className="flex items-center justify-between gap-2 px-[var(--space-4)] py-[var(--space-3)] border-t border-[var(--border-soft)] pb-safe">
          <span className="text-[length:var(--text-xs)] text-[var(--meta)] hidden sm:inline">
            {t("hint")}
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={async () => {
                // M6 修复：复制失败时给出 Toast 提示而非静默吞错
                try {
                  await navigator.clipboard.writeText(block);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {
                  toast("error", t("copyFailed"));
                }
              }}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] border border-[var(--border)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? t("copied") : t("copy")}
            </button>
            <button
              ref={lastFocusableRef}
              type="button"
              onClick={() => {
                onInsert(block);
                onClose();
              }}
              disabled={!code.trim()}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
            >
              <ArrowDownToLine size={14} />
              {t("insert")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
