"use client";

/**
 * 快速图表对话框（v0.6 增补：CMD 制图收尾件）
 *
 * 定位：mermaid 引擎与图表模板已有，缺的是"不进编辑器正文也能快速出图"
 * 的入口。场景：讨论中随手画一张架构草图/流程，确认后一键插入正文
 * （决策记录或文档），或仅复制代码。
 *
 * 设计：
 *  - 图型选择复用 MarkdownToolbar 的六种模板（同一事实源 DIAGRAM_TEMPLATES，
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

/** 图型模板（与 MarkdownToolbar 图表下拉共享同一事实源） */
export const DIAGRAM_TEMPLATES: { key: string; code: string }[] = [
  {
    key: "mindmap",
    code: "mindmap\n  root((主题))\n    一级分支\n      二级要点\n    另一分支\n",
  },
  {
    key: "flow",
    code: "graph TD\n  A[开始] --> B{判断}\n  B -- 是 --> C[执行]\n  B -- 否 --> D[结束]\n",
  },
  {
    key: "sequence",
    code: "sequenceDiagram\n  participant U as 用户\n  participant S as 系统\n  U->>S: 请求\n  S-->>U: 响应\n",
  },
  {
    key: "gantt",
    code: "gantt\n  title 排期\n  dateFormat YYYY-MM-DD\n  section 阶段一\n  调研 :a1, 2026-01-01, 7d\n  开发 :after a1, 10d\n",
  },
  {
    key: "pie",
    code: 'pie showData\n  title 占比\n  "A" : 55\n  "B" : 30\n  "C" : 15\n',
  },
  {
    key: "quadrant",
    code: "quadrantChart\n  title 优先级矩阵\n  x-axis 低成本 --> 高成本\n  y-axis 低收益 --> 高收益\n  任务A: [0.7, 0.8]\n  任务B: [0.3, 0.35]\n",
  },
];

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
  const [kind, setKind] = useState("mindmap");
  const [code, setCode] = useState(DIAGRAM_TEMPLATES[0].code);
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // 切图型 = 重置为该图型模板（未保存的编辑会被覆盖——对话框语义如此）
  function pickKind(k: string) {
    setKind(k);
    setCode(DIAGRAM_TEMPLATES.find((d) => d.key === k)?.code ?? "");
  }

  // 打开时重置为默认图型；Esc 关闭
  useEffect(() => {
    if (open) {
      setKind("mindmap");
      setCode(DIAGRAM_TEMPLATES[0].code);
      setCopied(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
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
          <h3 className="text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--fg)]">
            {t("title")}
          </h3>
          <button
            onClick={onClose}
            aria-label={te("close") || "Close"}
            className="p-1.5 rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors"
          >
            <X size={16} />
          </button>
        </header>

        {/* 图型选择 */}
        <div className="flex flex-wrap gap-1.5 px-[var(--space-4)] py-[var(--space-2)] border-b border-[var(--border-soft)]">
          {DIAGRAM_TEMPLATES.map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => pickKind(d.key)}
              aria-pressed={kind === d.key}
              className={`px-2.5 py-1 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] transition-colors ${
                kind === d.key
                  ? "bg-[var(--accent)] text-[var(--accent-fg)] font-[var(--weight-medium)]"
                  : "text-[var(--fg-2)] hover:bg-[var(--surface-2)]"
              }`}
            >
              {te("diagram" + d.key.charAt(0).toUpperCase() + d.key.slice(1))}
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
                await navigator.clipboard.writeText(block).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] border border-[var(--border)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? t("copied") : t("copy")}
            </button>
            <button
              type="button"
              onClick={() => {
                onInsert(block);
                onClose();
              }}
              disabled={!code.trim()}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors"
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
