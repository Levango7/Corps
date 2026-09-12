"use client";

/**
 * TipTap 富文本编辑器（Phase 1a）。
 *
 * 设计取舍（对应 design/FEATURE-DESIGN-cloud-doc.md §2.1）：
 * - 富文本模式用 TipTap v2（StarterKit + Placeholder + TaskList/TaskItem），
 *   所见即所得；Markdown 源码模式保留现有 textarea + MarkdownToolbar + useEditorKeys
 *   体验，两种模式一键切换。
 * - 数据模型：对外始终以 markdown 字符串收发（与 DocumentEditor 现有 API 一致、
 *   后端 publishedMarkdown 逻辑不动）。富文本内部用 ProseMirror JSON doc，
 *   通过轻量自实现转换器 markdownToHtml / tiptapToMarkdown 桥接。
 *   未引入 markdown-it / turndown 等额外依赖，转换覆盖 StarterKit 支持的语法子集，
 *   未覆盖语法优雅降级为纯文本，不丢用户内容。
 * - 自动保存：onBlur 触发（与现有 DocumentEditor 一致），避免每键保存风暴。
 * - 父组件通过 ref 调 insertMarkdown(md) 在光标处插入内容（模板/图表复用）。
 * - 所有样式走 design token（var(--*)），无裸 hex。
 * - "use client" 隔离 TipTap（ProseMirror 仅浏览器端）。
 *
 * i18n 说明：受迁移约束（不修改 en.json/zh.json），工具栏复用现有 editor.* 键；
 * 任务列表 / 撤销 / 重做 / 删除线 / 模式切换无现成键，暂用中文硬编码兜底，
 * 后续 Phase 1b 补齐 i18n 键。
 */

import {
  useState,
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
  type RefObject,
  type KeyboardEvent,
} from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { useTranslations } from "next-intl";
import {
  Bold,
  Italic,
  Strikethrough,
  Heading2,
  List,
  ListOrdered,
  Quote,
  Code,
  ListChecks,
  Undo2,
  Redo2,
  FileCode,
  Eye,
} from "lucide-react";
import { MarkdownToolbar, useEditorKeys } from "@/components/MarkdownToolbar";
import Markdown from "@/components/Markdown";

// ── ProseMirror JSON doc 子集类型 ──────────────────────────────────────────
// 自定义而非导入 @tiptap/core 的 JSONContent，避免 pnpm 严格解析耦合；
// 结构与 TipTap getJSON() 返回值兼容，遍历只用到这几个字段。
interface DocNode {
  type?: string;
  content?: DocNode[];
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

// ── markdown → HTML（用于初始化 TipTap content）───────────────────────────
// 按行扫描的状态机，覆盖：标题 H1-H3、粗体/斜体/删除线/行内代码/链接、
// 无序/有序/任务列表、引用、代码块、分割线、段落。未覆盖语法降级为纯文本。
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 行内标记 → HTML（先转义，再按顺序替换；行内代码内容不再二次处理） */
function inlineMdToHtml(s: string): string {
  // 先把行内代码提取占位，避免内容被后续规则破坏
  const codes: string[] = [];
  let r = escapeHtml(s).replace(/`([^`]+)`/g, (_m, code) => {
    codes.push(code);
    return `\u0000CODE${codes.length - 1}\u0000`;
  });
  r = r.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  r = r.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  r = r.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  r = r.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  // 还原行内代码
  r = r.replace(/\u0000CODE(\d+)\u0000/g, (_m, idx) => `<code>${codes[Number(idx)]}</code>`);
  return r;
}

function markdownToHtml(md: string): string {
  if (!md.trim()) return "<p></p>";
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  let inCode = false;
  let codeBuf: string[] = [];
  let listOpen: "ul" | "ol" | "task" | null = null;
  let quoteBuf: string[] = [];

  const flushQuote = () => {
    if (quoteBuf.length) {
      out.push(`<blockquote><p>${quoteBuf.map(inlineMdToHtml).join("<br>")}</p></blockquote>`);
      quoteBuf = [];
    }
  };
  const flushList = () => {
    if (listOpen === "task") out.push("</ul>");
    else if (listOpen) out.push(`</${listOpen}>`);
    listOpen = null;
  };

  while (i < lines.length) {
    const line = lines[i];

    // 代码块围栏
    if (/^```/.test(line)) {
      if (!inCode) {
        flushQuote();
        flushList();
        inCode = true;
        codeBuf = [];
      } else {
        out.push(`<pre><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
        inCode = false;
      }
      i++;
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      i++;
      continue;
    }

    // 空行：结束当前块
    if (line.trim() === "") {
      flushQuote();
      flushList();
      i++;
      continue;
    }

    // 分割线
    if (/^(---|\*\*\*|___)\s*$/.test(line)) {
      flushQuote();
      flushList();
      out.push("<hr>");
      i++;
      continue;
    }

    // 标题 H1-H3
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      flushQuote();
      flushList();
      const lvl = h[1].length;
      out.push(`<h${lvl}>${inlineMdToHtml(h[2])}</h${lvl}>`);
      i++;
      continue;
    }

    // 引用
    const q = line.match(/^>\s?(.*)$/);
    if (q) {
      flushList();
      quoteBuf.push(q[1]);
      i++;
      continue;
    }
    flushQuote();

    // 任务列表项
    const tl = line.match(/^[-*]\s+\[([ xX])\]\s+(.*)$/);
    if (tl) {
      if (listOpen !== "task") {
        flushList();
        out.push('<ul data-type="taskList">');
        listOpen = "task";
      }
      const checked = tl[1].toLowerCase() === "x";
      out.push(
        `<li data-type="taskItem" data-checked="${checked}"><p>${inlineMdToHtml(tl[2])}</p></li>`,
      );
      i++;
      continue;
    }

    // 无序列表项
    const ul = line.match(/^[-*]\s+(.*)$/);
    if (ul) {
      if (listOpen !== "ul") {
        flushList();
        out.push("<ul>");
        listOpen = "ul";
      }
      out.push(`<li><p>${inlineMdToHtml(ul[1])}</p></li>`);
      i++;
      continue;
    }

    // 有序列表项
    const ol = line.match(/^\d+\.\s+(.*)$/);
    if (ol) {
      if (listOpen !== "ol") {
        flushList();
        out.push("<ol>");
        listOpen = "ol";
      }
      out.push(`<li><p>${inlineMdToHtml(ol[1])}</p></li>`);
      i++;
      continue;
    }

    // 普通段落
    flushList();
    out.push(`<p>${inlineMdToHtml(line)}</p>`);
    i++;
  }

  // 未闭合代码块兜底
  if (inCode) out.push(`<pre><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
  flushQuote();
  flushList();
  return out.join("");
}

// ── TipTap JSON doc → markdown ─────────────────────────────────────────────
/** 行内 marks → markdown 包裹 */
function inlineToMd(node: DocNode): string {
  const text = node.text ?? "";
  if (!node.marks || node.marks.length === 0) return text;
  return node.marks.reduce((acc, mark) => {
    switch (mark.type) {
      case "bold":
        return `**${acc}**`;
      case "italic":
        return `*${acc}*`;
      case "strike":
        return `~~${acc}~~`;
      case "code":
        return `\`${acc}\``;
      case "link": {
        const href = String(mark.attrs?.href ?? "");
        return href ? `[${acc}](${href})` : acc;
      }
      default:
        return acc;
    }
  }, text);
}

/** 递归把节点序列化为 markdown 片段 */
function nodeToMd(node: DocNode, depth = 0): string {
  const inline = (n: DocNode): string =>
    n.content?.map(inlineToMd).join("") ?? inlineToMd(n);

  switch (node.type) {
    case "heading": {
      const level = Number(node.attrs?.level ?? 1);
      return `${"#".repeat(Math.min(level, 3))} ${inline(node)}\n\n`;
    }
    case "paragraph":
      return `${inline(node)}\n\n`;
    case "bulletList":
      return (node.content ?? []).map((n) => listItemToMd(n, "- ")).join("");
    case "orderedList":
      return (node.content ?? [])
        .map((n, idx) => listItemToMd(n, `${idx + 1}. `))
        .join("");
    case "taskList":
      return (node.content ?? []).map((n) => taskItemToMd(n)).join("");
    case "blockquote":
      return (
        (node.content ?? [])
          .map((n) => nodeToMd(n, depth + 1).trimEnd())
          .join("\n")
          .split("\n")
          .map((l) => `> ${l}`)
          .join("\n") + "\n\n"
      );
    case "codeBlock": {
      const code = node.content?.[0]?.text ?? "";
      return "```\n" + code + "\n```\n\n";
    }
    case "horizontalRule":
      return "---\n\n";
    case "hardBreak":
      return "\n";
    case "text":
      return inlineToMd(node);
    default:
      return inline(node);
  }
}

function listItemToMd(node: DocNode, marker: string): string {
  // listItem.content 通常是 paragraph[]
  const inner = (node.content ?? [])
    .map((n) => nodeToMd(n).trimEnd())
    .join("\n");
  return `${marker}${inner.replace(/\n/g, "\n  ")}\n`;
}

function taskItemToMd(node: DocNode): string {
  const checked = Boolean(node.attrs?.checked);
  const inner = (node.content ?? [])
    .map((n) => nodeToMd(n).trimEnd())
    .join("\n");
  return `- [${checked ? "x" : " "}] ${inner}\n`;
}

/** TipTap JSON doc → markdown 字符串 */
function tiptapToMarkdown(doc: DocNode): string {
  const raw = (doc.content ?? []).map((n) => nodeToMd(n)).join("");
  // 收敛连续空行（最多保留一个空行），去首尾空白
  return raw.replace(/\n{3,}/g, "\n\n").trim();
}

// ── 组件 ───────────────────────────────────────────────────────────────────

export interface RichTextEditorHandle {
  /** 在光标处插入 markdown 片段（模板/图表复用） */
  insertMarkdown: (md: string) => void;
  /** 聚焦编辑器 */
  focus: () => void;
}

interface RichTextEditorProps {
  /** markdown 字符串（受控值；富文本模式非反向同步，仅初始化与模式切换时消费） */
  value: string;
  /** 内容变更回调（始终传出 markdown 字符串） */
  onChange: (md: string) => void;
  /** 失焦回调（自动保存触发） */
  onBlur: () => void;
  /** 分屏模式：编辑与预览并排 */
  split?: boolean;
  /** 占位文案 */
  placeholder?: string;
  /** 容器附加类名 */
  className?: string;
}

/** 工具栏按钮基础类名（design token，与 MarkdownToolbar 风格一致） */
const TOOLBAR_BTN =
  "p-1.5 rounded-[var(--radius-sm)] text-[var(--fg-2)] hover:bg-[var(--surface)] hover:text-[var(--fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]";
const TOOLBAR_BTN_ACTIVE = "bg-[var(--surface)] text-[var(--accent)]";

export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(
  function RichTextEditor({ value, onChange, onBlur, split, placeholder, className }, ref) {
    const t = useTranslations("editor");
    /** 编辑模式：richtext（TipTap）| markdown（源码 textarea） */
    const [mode, setMode] = useState<"richtext" | "markdown">("richtext");
    /** TipTap 重挂载 key：markdown→richtext 切换时递增，用最新 value 重新初始化 */
    const [richtextKey, setRichtextKey] = useState(0);

    // 回调 ref：useEditor 的 onUpdate/onBlur 闭包只捕获一次，
    // 用 ref 始终调最新回调，避免父组件每次 render 新函数导致的 stale closure。
    const onChangeRef = useRef(onChange);
    const onBlurRef = useRef(onBlur);
    const valueRef = useRef(value);
    useEffect(() => {
      onChangeRef.current = onChange;
    });
    useEffect(() => {
      onBlurRef.current = onBlur;
    });
    useEffect(() => {
      valueRef.current = value;
    });

    // ── Markdown 源码模式 textarea ──
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const handleKeyDown = useEditorKeys({
      textareaRef,
      value,
      onChange,
    });

    // ── TipTap 编辑器 ──
    // 仅在 richtextKey 变化时重新构造（模式切换回富文本时重新初始化）。
    // content 用 markdownToHtml(valueRef.current) —— 闭包捕获挂载时刻的 value。
    const editor = useEditor(
      {
        extensions: [
          StarterKit.configure({
            heading: { levels: [1, 2, 3] },
            // StarterKit 默认含 codeBlock（无语法高亮），符合任务要求
          }),
          Placeholder.configure({
            placeholder: placeholder ?? "",
            emptyEditorClass: "is-editor-empty",
          }),
          TaskList,
          TaskItem.configure({ nested: true }),
        ],
        content: markdownToHtml(valueRef.current),
        editorProps: {
          attributes: {
            class:
              "tiptap-prose min-h-[60dvh] p-[var(--space-4)] outline-none text-[var(--fg)] text-[length:var(--text-sm)] leading-[var(--leading-normal)]",
          },
        },
        onUpdate: ({ editor }) => {
          onChangeRef.current(tiptapToMarkdown(editor.getJSON() as DocNode));
        },
      },
      [richtextKey],
    );

    // 监听 TipTap blur 触发自动保存（editorProps 无 handleBlur，用事件系统）
    useEffect(() => {
      if (!editor) return;
      const handler = () => onBlurRef.current();
      editor.on("blur", handler);
      return () => {
        editor.off("blur", handler);
      };
    }, [editor]);

    // 暴露 ref API 给父组件
    useImperativeHandle(
      ref,
      (): RichTextEditorHandle => ({
        insertMarkdown: (md: string) => {
          if (mode === "richtext" && editor) {
            // 富文本模式：转 HTML 插入光标处
            const html = markdownToHtml(md);
            editor.chain().focus().insertContent(html).run();
          } else {
            // Markdown 源码模式：在 textarea 光标处插入纯文本
            const ta = textareaRef.current;
            if (ta) {
              const start = ta.selectionStart ?? value.length;
              const end = ta.selectionEnd ?? value.length;
              const next = value.slice(0, start) + md + value.slice(end);
              onChange(next);
              requestAnimationFrame(() => {
                ta.focus();
                const pos = start + md.length;
                ta.setSelectionRange(pos, pos);
              });
            } else {
              // 无光标信息：追加
              const sep = value.endsWith("\n") || value === "" ? "" : "\n\n";
              onChange(value + sep + md);
            }
          }
        },
        focus: () => {
          if (mode === "richtext" && editor) {
            editor.commands.focus();
          } else {
            textareaRef.current?.focus();
          }
        },
      }),
      [editor, mode, value, onChange],
    );

    // ── 模式切换 ──
    function switchMode(next: "richtext" | "markdown") {
      if (next === mode) return;
      if (next === "richtext") {
        // markdown→richtext：用当前 value 重新初始化 TipTap
        valueRef.current = value;
        setRichtextKey((k) => k + 1);
      }
      setMode(next);
    }

    // ── 工具栏按钮（富文本模式）──
    const btn = (active: boolean) => `${TOOLBAR_BTN} ${active ? TOOLBAR_BTN_ACTIVE : ""}`;

    const richtextToolbar = editor ? (
      <div
        className="flex flex-nowrap items-center gap-0.5 p-1 rounded-[var(--radius-md)] bg-[var(--surface-2)] border border-[var(--border-soft)] overflow-x-auto scrollbar-hide"
        role="toolbar"
        aria-label={t("toolbarAria")}
      >
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleBold().run()}
          disabled={!editor.can().toggleBold()}
          className={btn(editor.isActive("bold"))}
          title={`${t("bold")} (Ctrl+B)`}
          aria-label={t("bold")}
          aria-pressed={editor.isActive("bold")}
        >
          <Bold size={15} />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          disabled={!editor.can().toggleItalic()}
          className={btn(editor.isActive("italic"))}
          title={`${t("italic")} (Ctrl+I)`}
          aria-label={t("italic")}
          aria-pressed={editor.isActive("italic")}
        >
          <Italic size={15} />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          disabled={!editor.can().toggleStrike()}
          className={btn(editor.isActive("strike"))}
          title="删除线"
          aria-label="删除线"
          aria-pressed={editor.isActive("strike")}
        >
          <Strikethrough size={15} />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={btn(editor.isActive("heading", { level: 2 }))}
          title={t("heading")}
          aria-label={t("heading")}
          aria-pressed={editor.isActive("heading", { level: 2 })}
        >
          <Heading2 size={15} />
        </button>
        <span className="mx-0.5 h-4 w-px bg-[var(--border)]" aria-hidden="true" />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={btn(editor.isActive("bulletList"))}
          title={t("bulletList")}
          aria-label={t("bulletList")}
          aria-pressed={editor.isActive("bulletList")}
        >
          <List size={15} />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={btn(editor.isActive("orderedList"))}
          title={t("numberedList")}
          aria-label={t("numberedList")}
          aria-pressed={editor.isActive("orderedList")}
        >
          <ListOrdered size={15} />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          className={btn(editor.isActive("taskList"))}
          title="任务列表"
          aria-label="任务列表"
          aria-pressed={editor.isActive("taskList")}
        >
          <ListChecks size={15} />
        </button>
        <span className="mx-0.5 h-4 w-px bg-[var(--border)]" aria-hidden="true" />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={btn(editor.isActive("blockquote"))}
          title={t("quote")}
          aria-label={t("quote")}
          aria-pressed={editor.isActive("blockquote")}
        >
          <Quote size={15} />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          className={btn(editor.isActive("codeBlock"))}
          title={t("codeBlock")}
          aria-label={t("codeBlock")}
          aria-pressed={editor.isActive("codeBlock")}
        >
          <Code size={15} />
        </button>
        <span className="mx-0.5 h-4 w-px bg-[var(--border)]" aria-hidden="true" />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          className={TOOLBAR_BTN}
          title="撤销 (Ctrl+Z)"
          aria-label="撤销"
        >
          <Undo2 size={15} />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          className={TOOLBAR_BTN}
          title="重做 (Ctrl+Y)"
          aria-label="重做"
        >
          <Redo2 size={15} />
        </button>
      </div>
    ) : null;

    // ── 模式切换按钮 ──
    const modeToggle = (
      <div className="flex items-center gap-0.5 p-0.5 rounded-[var(--radius-md)] bg-[var(--surface-2)] border border-[var(--border-soft)]">
        <button
          type="button"
          onClick={() => switchMode("richtext")}
          aria-pressed={mode === "richtext"}
          title="富文本模式"
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] ${
            mode === "richtext"
              ? "bg-[var(--surface)] text-[var(--fg)] shadow-[var(--elev-sm)]"
              : "text-[var(--muted)] hover:text-[var(--fg-2)]"
          }`}
        >
          <Eye size={13} />
          富文本
        </button>
        <button
          type="button"
          onClick={() => switchMode("markdown")}
          aria-pressed={mode === "markdown"}
          title="Markdown 源码"
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] ${
            mode === "markdown"
              ? "bg-[var(--surface)] text-[var(--fg)] shadow-[var(--elev-sm)]"
              : "text-[var(--muted)] hover:text-[var(--fg-2)]"
          }`}
        >
          <FileCode size={13} />
          Markdown
        </button>
      </div>
    );

    // ── 编辑器主体 ──
    const editorSurface =
      mode === "richtext" && editor ? (
        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          <EditorContent editor={editor} />
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => onBlur()}
          placeholder={placeholder}
          className="w-full h-[60dvh] p-[var(--space-4)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] font-[family-name:var(--font-mono)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)] resize-y"
        />
      );

    // 工具栏区（随模式切换）
    const toolbar =
      mode === "richtext" ? (
        richtextToolbar
      ) : (
        <MarkdownToolbar textareaRef={textareaRef} value={value} onChange={onChange} />
      );

    return (
      <div className={className}>
        {/* 顶栏：模式切换 + 格式化工具栏 */}
        <div className="mb-2 flex items-center gap-2 flex-wrap">
          {modeToggle}
          <div className="flex-1 min-w-0">{toolbar}</div>
        </div>

        {/* 编辑/分屏 */}
        {split ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
            {editorSurface}
            <div className="prose prose-sm max-w-none rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)] min-h-[60dvh] overflow-y-auto lg:max-h-[calc(60dvh+2rem)]">
              <Markdown source={value} />
            </div>
          </div>
        ) : (
          editorSurface
        )}
      </div>
    );
  },
);