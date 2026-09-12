"use client";

/**
 * slashMenuExtension — TipTap Slash 命令面板扩展（Phase 1b）。
 *
 * 设计取舍：
 * - 用 @tiptap/suggestion 的 Suggestion 工具实现 `/` 触发 + 浮层定位；
 *   Suggestion 自带 InputRule + decoration + floating-ui mount，比自实现
 *   InputRule + floating UI 更稳定，且与 TipTap v3 内核对齐。
 * - 命令文案由父组件（RichTextEditor）通过 `labels` 注入已翻译字符串，
 *   扩展本身不调 next-intl（next-intl 仅在 React 组件树内可用），
 *   保持扩展纯逻辑、可单测、与 i18n 解耦。
 * - 决策标记 / 任务嵌入两条命令不直接插入节点（需要先选择具体决策/任务），
 *   而是通过 `onInsertDecision` / `onInsertTask` 回调交给父组件打开选择器，
 *   父组件拿到选择结果后再用 editor.chain().insertContent(...) 插入节点。
 *   这样把「数据获取 UI」留在 React 层，扩展只负责「唤起」。
 * - 键盘导航：Suggestion 的 onKeyDown 由本扩展实现，↑↓ 改 selectedIndex、
 *   Enter 触发选中命令、Esc 关闭浮层（return true 阻止 ProseMirror 默认行为）。
 * - 浮层用 ReactRenderer 挂载 SlashMenu 组件，onExit 销毁 renderer + unmount。
 * - 所有样式由 SlashMenu 组件承担（design token），本扩展只管逻辑。
 * - 尊重 prefers-reduced-motion：动画时长由 CSS token 控制，扩展无 JS 动画。
 *
 * 命令执行流程：
 * 1. Suggestion 检测到 `/query`，调 items({query}) → 返回过滤后命令列表
 * 2. 用户选中（点击 / Enter）→ Suggestion 调 command({editor, range, props: item})
 * 3. command 先 deleteRange(range) 删除 `/query`，再调 item.command() 执行编辑
 * 4. item.command() 由 buildCommands 构造，只做 toggleHeading/insertTable 等，
 *    不再 deleteRange（避免双重删除）
 */

import { Extension, type Editor, type Range } from "@tiptap/core";
import { Suggestion, type SuggestionProps, type SuggestionKeyDownProps } from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import {
  Heading1,
  Heading2,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Code,
  Minus,
  Table,
  Image,
  Gavel,
  ListTodo,
  type LucideIcon,
} from "lucide-react";
import { SlashMenu, type SlashCommandItem } from "./SlashMenu";

/** 命令键枚举（与 i18n editor.slashMenu.* 后缀对齐） */
export type SlashCommandKey =
  | "h1"
  | "h2"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "quote"
  | "codeBlock"
  | "divider"
  | "table"
  | "image"
  | "decision"
  | "task";

/** 单条命令的文案（由父组件通过 labels 注入已翻译字符串） */
export interface SlashCommandLabel {
  label: string;
  description?: string;
}

/** 扩展配置：父组件注入文案 + 决策/任务插入回调 */
export interface SlashMenuOptions {
  /** 命令文案映射（key → { label, description }） */
  labels: Record<SlashCommandKey, SlashCommandLabel>;
  /** 无结果文案（已翻译，支持 {query} 占位） */
  emptyText: string;
  /** 触发插入决策标记（打开决策选择器，由父组件实现） */
  onInsertDecision?: () => void;
  /** 触发插入任务嵌入（打开任务选择器，由父组件实现） */
  onInsertTask?: () => void;
}

/** 模糊匹配：query 与 item.keywords 的子串匹配（大小写不敏感） */
function fuzzyMatch(query: string, keywords: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const k = keywords.toLowerCase();
  return k.includes(q);
}

/**
 * 构造命令列表。
 *
 * 注意：item.command 只做实际编辑操作（toggleHeading 等），
 * deleteRange 由 Suggestion 的 command 配置统一处理，避免双重删除。
 */
function buildCommands(editor: Editor, options: SlashMenuOptions): SlashCommandItem[] {
  const { labels, onInsertDecision, onInsertTask } = options;

  return [
    {
      key: "h1",
      label: labels.h1.label,
      description: labels.h1.description,
      keywords: "h1 heading1 标题1 title big",
      icon: Heading1 as LucideIcon,
      command: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      key: "h2",
      label: labels.h2.label,
      description: labels.h2.description,
      keywords: "h2 heading2 标题2 subtitle",
      icon: Heading2 as LucideIcon,
      command: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      key: "bulletList",
      label: labels.bulletList.label,
      description: labels.bulletList.description,
      keywords: "bullet list ul 无序列表 unordered",
      icon: List as LucideIcon,
      command: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      key: "orderedList",
      label: labels.orderedList.label,
      description: labels.orderedList.description,
      keywords: "ordered list ol 有序列表 numbered",
      icon: ListOrdered as LucideIcon,
      command: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      key: "taskList",
      label: labels.taskList.label,
      description: labels.taskList.description,
      keywords: "task list checklist 任务列表 todo",
      icon: ListChecks as LucideIcon,
      command: () => editor.chain().focus().toggleTaskList().run(),
    },
    {
      key: "quote",
      label: labels.quote.label,
      description: labels.quote.description,
      keywords: "quote blockquote 引用 block",
      icon: Quote as LucideIcon,
      command: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      key: "codeBlock",
      label: labels.codeBlock.label,
      description: labels.codeBlock.description,
      keywords: "code codeblock 代码块 pre",
      icon: Code as LucideIcon,
      command: () => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      key: "divider",
      label: labels.divider.label,
      description: labels.divider.description,
      keywords: "divider hr 分割线 horizontal rule line",
      icon: Minus as LucideIcon,
      command: () => editor.chain().focus().setHorizontalRule().run(),
    },
    {
      key: "table",
      label: labels.table.label,
      description: labels.table.description,
      keywords: "table 表格 grid",
      icon: Table as LucideIcon,
      command: () =>
        editor
          .chain()
          .focus()
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
    {
      key: "image",
      label: labels.image.label,
      description: labels.image.description,
      keywords: "image picture 图片 photo img",
      icon: Image as LucideIcon,
      command: () => {
        // 触发原生文件选择对话框，选中的图片由父组件上传逻辑处理
        // 这里仅发出一个自定义事件，RichTextEditor 可监听并打开上传对话框
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("richtext:insert-image"));
        }
      },
    },
    {
      key: "decision",
      label: labels.decision.label,
      description: labels.decision.description,
      keywords: "decision 决策 mark gavel",
      icon: Gavel as LucideIcon,
      command: () => onInsertDecision?.(),
    },
    {
      key: "task",
      label: labels.task.label,
      description: labels.task.description,
      keywords: "task 任务 embed todo insert",
      icon: ListTodo as LucideIcon,
      command: () => onInsertTask?.(),
    },
  ];
}

/** SlashMenu React 组件 props（注入到 ReactRenderer） */
interface SlashMenuRendererProps {
  items: SlashCommandItem[];
  selectedIndex: number;
  onSelect: (item: SlashCommandItem) => void;
  onHover: (idx: number) => void;
  query: string;
  emptyText: string;
}

/** Suggestion render 工厂：管理 ReactRenderer + 键盘导航选中索引 */
function renderSlashMenu() {
  let component: ReactRenderer<null, SlashMenuRendererProps> | null = null;
  let unmount: (() => void) | null = null;
  let selectedIndex = 0;
  let currentItems: SlashCommandItem[] = [];
  // 上一次 SuggestionProps，onKeyDown 时复用其 command/query
  let lastProps: SuggestionProps<SlashCommandItem> | null = null;

  /** 安全更新选中索引（夹紧到 [0, items.length-1]） */
  const clampIndex = (idx: number, len: number): number => {
    if (len === 0) return 0;
    return ((idx % len) + len) % len;
  };

  /** 构造注入 SlashMenu 的 props */
  const buildProps = (props: SuggestionProps<SlashCommandItem>): SlashMenuRendererProps => ({
    items: currentItems,
    selectedIndex,
    onSelect: (item: SlashCommandItem) => {
      // 选中命令：调 Suggestion 的 command，由其 deleteRange + item.command()
      props.command(item);
    },
    onHover: (idx: number) => {
      if (idx === selectedIndex) return;
      selectedIndex = idx;
      if (component && lastProps) {
        component.updateProps(buildProps(lastProps));
      }
    },
    query: props.query,
    emptyText:
      (props.editor.storage as { slashMenuEmptyText?: string }).slashMenuEmptyText ??
      "No results",
  });

  return {
    onBeforeStart: (props: SuggestionProps<SlashCommandItem>) => {
      lastProps = props;
      currentItems = props.items;
      selectedIndex = 0;
      component = new ReactRenderer<null, SlashMenuRendererProps>(SlashMenu, {
        editor: props.editor,
        props: buildProps(props),
        as: "div",
      });

      if (props.mount && component.element) {
        unmount = props.mount(component.element);
      }
    },

    onStart: (props: SuggestionProps<SlashCommandItem>) => {
      lastProps = props;
      currentItems = props.items;
      selectedIndex = clampIndex(selectedIndex, currentItems.length);
      component?.updateProps(buildProps(props));
    },

    onBeforeUpdate: (props: SuggestionProps<SlashCommandItem>) => {
      lastProps = props;
      currentItems = props.items;
      selectedIndex = clampIndex(selectedIndex, currentItems.length);
    },

    onUpdate: (props: SuggestionProps<SlashCommandItem>) => {
      lastProps = props;
      component?.updateProps(buildProps(props));
    },

    onKeyDown: (props: SuggestionKeyDownProps): boolean => {
      if (!lastProps) return false;
      if (props.event.key === "ArrowUp") {
        selectedIndex = clampIndex(selectedIndex - 1, currentItems.length);
        component?.updateProps(buildProps(lastProps));
        return true;
      }
      if (props.event.key === "ArrowDown") {
        selectedIndex = clampIndex(selectedIndex + 1, currentItems.length);
        component?.updateProps(buildProps(lastProps));
        return true;
      }
      if (props.event.key === "Enter") {
        const item = currentItems[selectedIndex];
        if (item) {
          // 调 Suggestion 的 command：deleteRange + item.command()
          lastProps.command(item);
        }
        return true;
      }
      if (props.event.key === "Escape") {
        // Suggestion 自动监听 Esc 触发 onExit，返回 true 阻止 ProseMirror 默认行为
        return true;
      }
      return false;
    },

    onExit: () => {
      unmount?.();
      unmount = null;
      component?.destroy();
      component = null;
      lastProps = null;
      currentItems = [];
      selectedIndex = 0;
    },
  };
}

/**
 * SlashMenu 扩展：在富文本中输入 `/` 唤起命令面板。
 *
 * 用法：
 * ```ts
 * SlashMenuExtension.configure({
 *   labels: { h1: { label: "标题1" }, ... },
 *   emptyText: "无匹配命令",
 *   onInsertDecision: () => setDecisionPickerOpen(true),
 *   onInsertTask: () => setTaskPickerOpen(true),
 * })
 * ```
 */
export const SlashMenuExtension = Extension.create<SlashMenuOptions>({
  name: "slashMenu",

  addOptions() {
    return {
      labels: {} as Record<SlashCommandKey, SlashCommandLabel>,
      emptyText: "No matching command",
      onInsertDecision: undefined,
      onInsertTask: undefined,
    };
  },

  addStorage() {
    return {
      slashMenuEmptyText: "No matching command",
    };
  },

  onBeforeCreate() {
    // 把 emptyText 同步到 storage，render 时通过 editor.storage 读取
    (this.editor.storage as { slashMenuEmptyText?: string }).slashMenuEmptyText =
      this.options.emptyText;
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const options = this.options;

    // emptyText 同步到 storage（onBeforeCreate 后 options 可能被 configure 更新）
    (editor.storage as { slashMenuEmptyText?: string }).slashMenuEmptyText =
      options.emptyText;

    const plugin = Suggestion<SlashCommandItem>({
      editor,
      char: "/",
      // 允许 `/` 出现在空格后（行首由 Suggestion 默认允许）
      allowedPrefixes: [" "],
      // 不允许空格进入 query（避免命令面板被空格切断）
      allowSpaces: false,
      // 命令面板浮层位置
      placement: "bottom-start",
      offset: { mainAxis: 4, crossAxis: 0 },
      // items: 每次查询时构造命令列表 + 模糊过滤
      items: ({ query }): SlashCommandItem[] => {
        const all = buildCommands(editor, options);
        if (!query) return all;
        return all.filter((item) => fuzzyMatch(query, item.keywords));
      },
      // render: 挂载 SlashMenu React 组件
      render: renderSlashMenu,
      // command: Suggestion 选中时调用——先 deleteRange 删除 `/query`，再执行命令
      command: ({ editor: e, range, props: item }) => {
        e.chain().focus().deleteRange(range).run();
        item.command();
      },
    });

    return [plugin];
  },
});

export default SlashMenuExtension;

// 导出 Range 类型供外部使用（避免外部直接依赖 @tiptap/core）
export type { Range };
