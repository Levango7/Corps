"use client";

/**
 * Markdown 编辑器工具栏（v0.4 队列第 5 项）。
 *
 * 设计：
 *  - 与 textarea 解耦——通过 ref 直接操作光标选区做插入/包裹，
 *    插入后 onChange 由父组件受控同步（input 事件手动 dispatch）。
 *  - 通用插入（标题/列表/引用/代码/表格/mermaid）：在光标处插入模板片段，
 *    选中文本时优先包裹（如粗体/斜体/行内代码）。
 *  - 模板库：三类决策模板（方案对比/事故复盘/立项决议）整体插入。
 */

import { useRef, type RefObject } from "react";
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

export function MarkdownToolbar({ textareaRef, value, onChange }: MarkdownToolbarProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const t = useTranslations("editor");

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
    onClick: () => void;
  }[] = [
    { key: "bold", icon: Bold, label: t("bold"), onClick: () => wrap("**") },
    { key: "italic", icon: Italic, label: t("italic"), onClick: () => wrap("*") },
    {
      key: "code",
      icon: Code,
      label: t("inlineCode"),
      onClick: () => wrap("`"),
    },
    {
      key: "h2",
      icon: Heading2,
      label: t("heading"),
      onClick: () => insert("## "),
    },
    {
      key: "ul",
      icon: List,
      label: t("bulletList"),
      onClick: () => insert("- "),
    },
    {
      key: "ol",
      icon: ListOrdered,
      label: t("numberedList"),
      onClick: () => insert("1. "),
    },
    {
      key: "quote",
      icon: Quote,
      label: t("quote"),
      onClick: () => insert("> "),
    },
    {
      key: "codeblock",
      icon: Code,
      label: t("codeBlock"),
      onClick: () => insert("```\n\n```", 4),
    },
    {
      key: "table",
      icon: Table,
      label: t("table"),
      onClick: () => insert("| 列A | 列B |\n| --- | --- |\n|  |  |\n"),
    },
    {
      key: "mermaid",
      icon: GitBranch,
      label: t("mermaid"),
      onClick: () => insert("```mermaid\ngraph TD\n  A[起点] --> B[终点]\n```\n", 17),
    },
  ];

  const templates: { key: string; label: string; content: string }[] = [
    {
      key: "compare",
      label: t("templateCompare"),
      content:
        "## 方案对比\n\n**背景：**\n\n**方案 A：**\n- 优点：\n- 缺点：\n\n**方案 B：**\n- 优点：\n- 缺点：\n\n**结论：** 选择方案 __，因为 __\n",
    },
    {
      key: "retro",
      label: t("templateRetro"),
      content:
        "## 事故复盘\n\n**影响：**\n\n**时间线：**\n- \n\n**根因：**\n\n**改进项：**\n- [ ] \n",
    },
    {
      key: "proposal",
      label: t("templateProposal"),
      content:
        "## 立项决议\n\n**目标：**\n\n**范围：**\n- 包含：\n- 不包含：\n\n**负责人与排期：**\n\n**决议：**\n",
    },
  ];

  return (
    <div
      ref={menuRef}
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
            onClick={b.onClick}
            title={b.label}
            aria-label={b.label}
            className="p-1.5 rounded-[var(--radius-sm)] text-[var(--fg-2)] hover:bg-[var(--surface)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
          >
            <Icon size={15} />
          </button>
        );
      })}
      <span className="mx-1 h-4 w-px bg-[var(--border)]" aria-hidden="true" />
      {templates.map((tpl) => (
        <button
          key={tpl.key}
          type="button"
          onClick={() => insert(tpl.content)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] text-[var(--fg-2)] hover:bg-[var(--surface)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
          title={t("templateInsert")}
        >
          <ClipboardList size={13} />
          {tpl.label}
        </button>
      ))}
    </div>
  );
}
