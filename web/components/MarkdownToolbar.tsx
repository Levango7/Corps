"use client";

/**
 * Markdown 编辑器工具栏（v0.4 队列第 5 项；v0.6 增强：图表下拉 + 快捷键层）。
 *
 * 设计：
 *  - 与 textarea 解耦——通过 ref 直接操作光标选区做插入/包裹，
 *    插入后 onChange 由父组件受控同步（input 事件手动 dispatch）。
 *  - 通用插入（标题/列表/引用/代码/表格/mermaid）：在光标处插入模板片段，
 *    选中文本时优先包裹（如粗体/斜体/行内代码）。
 *  - 模板库：三类决策模板（方案对比/事故复盘/立项决议）整体插入。
 *  - 图表下拉（v0.6）：mermaid 引擎原生支持 15+ 种图——此前工具栏只暴露
 *    流程图一种模板，用户无从发现思维导图/时序图等能力。收口为下拉菜单，
 *    六种高频图型一键插入可运行模板（决策/文档/评论三处编辑器共用）。
 *  - 快捷键层（v0.6，Typora 式肌肉记忆）：Ctrl/⌘+B/I/K 包裹、Tab 列表
 *    缩进、Enter 列表自动续行、空列表项 Backspace 删标记。挂在工具栏
 *    而非各编辑器——工具栏已持有 textareaRef，一处实现三处生效。
 *  - 模板内容 i18n（v0.6 修复）：表格表头与三类决策模板此前硬编码中文，
 *    /en 用户插入的是中文模板——改为 t() 键渲染。
 */

import { useState, type RefObject, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Quote,
  Code,
  Table,
  GitBranch,
  Heading2,
  ClipboardList,
  Link2,
  ChevronDown,
  Network,
  GitFork,
  BarChart3,
  PieChart,
  MessagesSquare,
  LayoutGrid,
  ClipboardCheck,
} from "lucide-react";

interface MarkdownToolbarProps {
  /** 受控 textarea 的 ref（父组件持有） */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** 当前文本（用于插入计算） */
  value: string;
  /** 受控更新回调 */
  onChange: (next: string) => void;
}

/** 对 textarea 执行文本变换：包裹选中区或在光标处插入，并恢复焦点/选区 */
function applyTransform(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  value: string,
  onChange: (v: string) => void,
  transform: (selected: string) => { text: string; selectStart: number; selectEnd: number },
) {
  const el = textareaRef.current;
  if (!el) return;
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? value.length;
  const selected = value.slice(start, end);
  const { text, selectStart, selectEnd } = transform(selected);
  const next = value.slice(0, start) + text + value.slice(end);
  onChange(next);
  // React 受控更新后恢复焦点与选区（插回后选中刚插入的内容便于连续编辑）
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(start + selectStart, start + selectEnd);
  });
}

/** 当前行信息（含行首在全文中的偏移），供列表续行/缩进判断 */
function currentLine(el: HTMLTextAreaElement, value: string) {
  const caret = el.selectionStart ?? 0;
  const lineStart = value.lastIndexOf("\n", caret - 1) + 1;
  const lineEndIdx = value.indexOf("\n", caret);
  const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
  return { caret, lineStart, lineEnd, text: value.slice(lineStart, lineEnd) };
}

/** 列表标记匹配："- " / "* " / "1. " 形态（含缩进前缀），返回标记长度 */
function listMarkerLen(line: string): { marker: string; rest: string } | null {
  const m = line.match(/^(\s*(?:[-*]\s+|\d+\.\s+))(.*)$/);
  return m ? { marker: m[1], rest: m[2] } : null;
}

/**
 * Typora 式键盘处理（v0.6）：挂到 textarea 的 onKeyDown。
 *  - Ctrl/⌘+B/I/K：粗体/斜体/链接包裹（与工具栏按钮同语义）
 *  - Tab / Shift+Tab：列表行缩进/回退两级空格
 *  - Enter：列表/引用行尾自动续行标记；空列表项 Enter 删除标记（退出列表）
 *  - Backspace：行首且列表标记为空时，删除标记退出列表
 * 返回 true 表示已处理（阻止默认行为），false 交给浏览器。
 */
export function useEditorKeys(props: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (v: string) => void;
}) {
  const { textareaRef, value, onChange } = props;

  function replaceRange(start: number, end: number, text: string, caret: number) {
    const next = value.slice(0, start) + text + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(caret, caret);
      }
    });
  }

  return function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const el = textareaRef.current;
    if (!el) return;
    const mod = e.ctrlKey || e.metaKey;

    // ── 快捷键：Ctrl/⌘+B/I/K ──
    if (mod && !e.shiftKey && !e.altKey) {
      const key = e.key.toLowerCase();
      const caret = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? 0;
      const selected = value.slice(caret, end) || "";
      if (key === "b") {
        e.preventDefault();
        replaceRange(caret, end, `**${selected}**`, caret + (selected ? 2 + selected.length : 2));
        return;
      }
      if (key === "i") {
        e.preventDefault();
        replaceRange(caret, end, `*${selected}*`, caret + (selected ? 1 + selected.length : 1));
        return;
      }
      if (key === "k") {
        e.preventDefault();
        // 无选中时插入空链接，光标落在 [] 内（Typora 习惯）
        const label = selected || "";
        replaceRange(caret, end, `[${label}](url)`, caret + 1 + label.length);
        return;
      }
      return;
    }

    const { caret, lineStart, lineEnd, text: line } = currentLine(el, value);

    // ── Tab / Shift+Tab：列表缩进 ──
    if (e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey) {
        // 回退一级缩进（行首有两空格才动）
        if (line.startsWith("  ")) {
          replaceRange(lineStart, lineEnd, line.slice(2), Math.max(lineStart, caret - 2));
        }
      } else {
        replaceRange(lineStart, lineEnd, "  " + line, caret + 2);
      }
      return;
    }

    // ── Enter：列表续行 / 空项退出 ──
    if (e.key === "Enter" && !e.shiftKey) {
      const ml = listMarkerLen(line);
      if (ml) {
        e.preventDefault();
        if (ml.rest.trim() === "") {
          // 空列表项：删标记退出列表（Typora 核心顺手感）
          replaceRange(lineStart, lineEnd, ml.rest, lineStart);
        } else {
          const marker = ml.marker.replace(/\d+\./, () => {
            const n = Number.parseInt(ml.marker.match(/\d+/)?.[0] ?? "1", 10);
            return `${n + 1}.`;
          });
          const insert = `\n${marker}`;
          replaceRange(caret, caret, insert, caret + insert.length);
        }
        return;
      }
      // 引用续行：> 行尾 Enter 自动补 ">"
      if (/^>\s?/.test(line) && line.replace(/^>\s?/, "").trim() !== "") {
        e.preventDefault();
        const insert = "\n> ";
        replaceRange(caret, caret, insert, caret + insert.length);
        return;
      }
      return;
    }

    // ── Backspace：空列表标记处删除标记而非字符 ──
    if (e.key === "Backspace") {
      const ml = listMarkerLen(line);
      if (ml && ml.rest === "" && caret === lineStart + ml.marker.length) {
        e.preventDefault();
        replaceRange(lineStart, lineEnd, "", lineStart);
      }
      return;
    }
  };
}

/** mermaid 图表模板（v0.6 图表下拉）——每个模板插入即可渲染 */
function diagramTemplates(t: ReturnType<typeof useTranslations>) {
  return [
    {
      key: "mindmap",
      icon: Network,
      label: t("diagramMindmap"),
      code: "mindmap\n  root((主题))\n    一级分支\n      二级要点\n    另一分支\n",
    },
    {
      key: "flow",
      icon: GitFork,
      label: t("diagramFlow"),
      code: "graph TD\n  A[开始] --> B{判断}\n  B -- 是 --> C[执行]\n  B -- 否 --> D[结束]\n",
    },
    {
      key: "sequence",
      icon: MessagesSquare,
      label: t("diagramSequence"),
      code: "sequenceDiagram\n  participant U as 用户\n  participant S as 系统\n  U->>S: 请求\n  S-->>U: 响应\n",
    },
    {
      key: "gantt",
      icon: BarChart3,
      label: t("diagramGantt"),
      code: "gantt\n  title 排期\n  dateFormat YYYY-MM-DD\n  section 阶段一\n  调研 :a1, 2026-01-01, 7d\n  开发 :after a1, 10d\n",
    },
    {
      key: "pie",
      icon: PieChart,
      label: t("diagramPie"),
      code: 'pie showData\n  title 占比\n  "A" : 55\n  "B" : 30\n  "C" : 15\n',
    },
    {
      key: "quadrant",
      icon: LayoutGrid,
      label: t("diagramQuadrant"),
      code: "quadrantChart\n  title 优先级矩阵\n  x-axis 低成本 --> 高成本\n  y-axis 低收益 --> 高收益\n  任务A: [0.7, 0.8]\n  任务B: [0.3, 0.35]\n",
    },
  ];
}

export function MarkdownToolbar({ textareaRef, value, onChange }: MarkdownToolbarProps) {
  const t = useTranslations("editor");
  const [diagramOpen, setDiagramOpen] = useState(false);

  function wrap(before: string, after = before) {
    applyTransform(textareaRef, value, onChange, (sel) => ({
      text: before + (sel || t("placeholderText")) + after,
      selectStart: before.length,
      selectEnd: before.length + (sel || t("placeholderText")).length,
    }));
  }

  function insert(block: string, cursorOffsetIntoBlock = 0) {
    applyTransform(textareaRef, value, onChange, (sel) => {
      const text = sel ? sel + "\n\n" + block : block;
      const base = sel ? sel.length + 2 : 0;
      return { text, selectStart: base + cursorOffsetIntoBlock, selectEnd: base + block.length };
    });
  }

  const buttons: {
    key: string;
    icon: typeof Bold;
    label: string;
    title: string;
    onClick: () => void;
  }[] = [
    { key: "bold", icon: Bold, label: t("bold"), title: "Ctrl+B", onClick: () => wrap("**") },
    { key: "italic", icon: Italic, label: t("italic"), title: "Ctrl+I", onClick: () => wrap("*") },
    {
      key: "code",
      icon: Code,
      label: t("inlineCode"),
      title: "",
      onClick: () => wrap("`"),
    },
    {
      key: "h2",
      icon: Heading2,
      label: t("heading"),
      title: "",
      onClick: () => insert("## "),
    },
    {
      key: "ul",
      icon: List,
      label: t("bulletList"),
      title: "",
      onClick: () => insert("- "),
    },
    {
      key: "ol",
      icon: ListOrdered,
      label: t("numberedList"),
      title: "",
      onClick: () => insert("1. "),
    },
    {
      key: "quote",
      icon: Quote,
      label: t("quote"),
      title: "",
      onClick: () => insert("> "),
    },
    {
      key: "codeblock",
      icon: Code,
      label: t("codeBlock"),
      title: "",
      onClick: () => insert("```\n\n```", 4),
    },
    {
      key: "table",
      icon: Table,
      label: t("table"),
      title: "",
      onClick: () => insert(t("tableTemplate")),
    },
    {
      key: "link",
      icon: Link2,
      label: t("link"),
      title: "Ctrl+K",
      onClick: () => {
        const el = textareaRef.current;
        if (!el) return;
        const start = el.selectionStart ?? value.length;
        const end = el.selectionEnd ?? value.length;
        const selected = value.slice(start, end) || t("linkText");
        applyTransform(textareaRef, value, onChange, () => ({
          text: `[${selected}](url)`,
          selectStart: selected.length + 3,
          selectEnd: selected.length + 6,
        }));
      },
    },
  ];

  // 决策模板（v0.6 i18n 修复：内容此前硬编码中文，/en 用户插入中文模板）
  const templates: { key: string; label: string; content: string }[] = [
    { key: "compare", label: t("templateCompare"), content: t("tplCompare") },
    { key: "retro", label: t("templateRetro"), content: t("tplRetro") },
    { key: "proposal", label: t("templateProposal"), content: t("tplProposal") },
  ];

  // 图表下拉数据
  const diagrams = diagramTemplates(t);

  return (
    <div
      className="flex flex-wrap items-center gap-0.5 p-1 rounded-[var(--radius-md)] bg-[var(--surface-2)] border border-[var(--border-soft)]"
      role="toolbar"
      aria-label={t("toolbarAria")}
    >
      {buttons.map((b) => {
        const Icon = b.icon;
        return (
          <button
            key={b.key}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={b.onClick}
            title={b.title ? `${b.label} (${b.title})` : b.label}
            aria-label={b.label}
            aria-keyshortcuts={b.title || undefined}
            className="p-1.5 rounded-[var(--radius-sm)] text-[var(--fg-2)] hover:bg-[var(--surface)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
          >
            <Icon size={15} />
          </button>
        );
      })}

      {/* 图表下拉：mermaid 六种图型（引擎 v0.4 已全支持，此处仅暴露入口） */}
      <div className="relative">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setDiagramOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={diagramOpen}
          aria-label={t("diagramMenu")}
          title={t("diagramMenuHint")}
          className="inline-flex items-center gap-0.5 p-1.5 rounded-[var(--radius-sm)] text-[var(--fg-2)] hover:bg-[var(--surface)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
        >
          <GitBranch size={15} />
          <ChevronDown size={12} />
        </button>
        {diagramOpen && (
          <>
            {/* 点击外部关闭 */}
            <div className="fixed inset-0 z-10" onClick={() => setDiagramOpen(false)} />
            <div
              role="menu"
              className="absolute left-0 top-full mt-1 z-20 min-w-40 py-1 rounded-[var(--radius-md)] bg-[var(--surface)] border border-[var(--border)] shadow-[var(--elev-md)]"
            >
              <div className="px-3 pt-1.5 pb-1 text-[length:var(--text-xs)] text-[var(--meta)] select-none">
                {t("diagramMenuHint")}
              </div>
              {diagrams.map((d) => {
                const Icon = d.icon;
                return (
                  <button
                    key={d.key}
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setDiagramOpen(false);
                      insert("```mermaid\n" + d.code + "```\n");
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors"
                  >
                    <Icon size={14} className="shrink-0 text-[var(--muted)]" />
                    {d.label}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      <span className="mx-1 h-4 w-px bg-[var(--border)]" aria-hidden="true" />
      {templates.map((tpl) => (
        <button
          key={tpl.key}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => insert(tpl.content)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] text-[var(--fg-2)] hover:bg-[var(--surface)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
          title={t("templateInsert")}
        >
          <ClipboardList size={13} />
          {tpl.label}
        </button>
      ))}
      <span className="ml-auto hidden sm:flex items-center gap-1 pr-1 text-[length:var(--text-xs)] text-[var(--meta)] select-none">
        <ClipboardCheck size={12} aria-hidden="true" />
        {t("shortcutsHint")}
      </span>
    </div>
  );
}
