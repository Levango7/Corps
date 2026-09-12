"use client";

/**
 * 协同光标 / 选区（Phase 2，对应 design/FEATURE-DESIGN-cloud-doc.md §3.2）。
 *
 * 职责：
 * - 提供 TipTap 扩展工厂 createCollaborationExtensions，包装 y-prosemirror 的
 *   ySyncPlugin（CRDT 文档同步）+ yCursorPlugin（awareness 光标/选区装饰）。
 * - 自定义 cursorBuilder / selectionBuilder，用 CSS class + CSS 变量 --user-color
 *   渲染光标，所有样式走 design token（var(--*))，无裸 hex、无 inline color。
 * - 导出 <CollaborationCursorStyles /> 组件，注入 .collaboration-cursor__* 样式
 *   （使用 --radius-sm / --text-xs / --weight-medium / --space-1 / --space-2 / --on-accent）。
 *
 * 设计取舍：
 * - 项目未安装 @tiptap/extension-collaboration(-cursor)，改用 y-prosemirror 直接提供
 *   的 ProseMirror 插件，通过 Extension.create({ addProseMirrorPlugins }) 包装为
 *   TipTap 扩展。能力等价：CRDT 同步 + awareness 光标/选区，且少两个依赖。
 * - Extension 从 @tiptap/react 导入（其 index re-export @tiptap/core 全部导出），
 *   无需直接依赖 @tiptap/core。
 * - 光标颜色通过 --user-color CSS 变量传入（值是 var(--accent) 等 token 引用），
 *   cursorBuilder 只设置 CSS 变量，不直接写颜色，样式由 <style> 中的 class 规则消费。
 * - ySyncPlugin 绑定 ydoc.getXmlFragment(field)，与 CollaborationProvider 的 field 一致。
 *
 * 用法（在 RichTextEditor 的 useEditor extensions 中追加）：
 *   const { ydoc, awareness } = useCollaboration();
 *   const collabExts = createCollaborationExtensions(ydoc, awareness);
 *   useEditor({ extensions: [StarterKit, ...collabExts] });
 *
 * i18n 说明：本组件无面向用户文案。
 */

import { Extension } from "@tiptap/react";
import * as Y from "yjs";
import { ySyncPlugin, yCursorPlugin } from "y-prosemirror";
import type { CollaborationAwareness } from "@/components/CollaborationProvider";

// ── cursor / selection builder ─────────────────────────────────────────────
// y-prosemirror 默认 builder 用 inline style 写死颜色，且校验 hex 格式（拒绝 var()）。
// 这里自定义 builder，只设置 CSS 变量 --user-color，颜色由 <style> 中 class 规则消费，
// 既绕过 hex 校验，又保证样式全走 design token。

/** awareness user 形态（与 CollaborationProvider.AwarenessUser 一致）。 */
interface CursorUser {
  name?: string;
  color?: string;
}

/**
 * 光标 caret 构造器：创建 span.collaboration-cursor__caret，设置 --user-color。
 * 内嵌 label span 显示用户名，由 CSS 定位到 caret 上方。
 */
function cursorBuilder(user: CursorUser): HTMLElement {
  const cursor = document.createElement("span");
  cursor.className = "collaboration-cursor__caret";
  // user.color 是 var(--accent) 等 token 引用；设置为 CSS 变量供 class 规则消费。
  if (user.color) {
    cursor.style.setProperty("--user-color", user.color);
  }
  const label = document.createElement("span");
  label.className = "collaboration-cursor__label";
  label.textContent = user.name ?? "";
  cursor.appendChild(label);
  return cursor;
}

/**
 * 选区装饰构造器：返回 ProseMirror DecorationAttrs。
 * 用 class + CSS 变量，背景色由 CSS 用 color-mix 派生（半透明选区高亮）。
 */
function selectionBuilder(
  user: CursorUser,
): { class: string; style: string } {
  const styleVar = user.color ? `--user-color: ${user.color}` : "";
  return {
    class: "collaboration-cursor__selection",
    style: styleVar,
  };
}

// ── TipTap 扩展工厂 ────────────────────────────────────────────────────────

/**
 * 创建协同编辑 TipTap 扩展（ySyncPlugin + yCursorPlugin）。
 *
 * @param ydoc      Yjs 文档（来自 CollaborationProvider）
 * @param awareness WS Provider 的 awareness 实例（来自 CollaborationProvider）
 * @param field     ProseMirror 内容在 Yjs Doc 上的 field 名，默认 "prosemirror"
 * @returns         TipTap Extension 数组，展开到 useEditor({ extensions: [...] })
 *
 * 返回两个扩展（collaboration / collaborationCursor）而非合并为一个，
 * 便于未来按需禁用光标（仅保留同步）或追加 yUndoPlugin。
 */
export function createCollaborationExtensions(
  ydoc: Y.Doc,
  awareness: CollaborationAwareness,
  field = "prosemirror",
): ReturnType<typeof Extension.create>[] {
  const yFragment = ydoc.getXmlFragment(field);

  const collaboration = Extension.create({
    name: "collaboration",
    addProseMirrorPlugins() {
      return [
        // CRDT 文档同步：ProseMirror ↔ Yjs XmlFragment 双向绑定。
        ySyncPlugin(yFragment),
      ];
    },
  });

  const collaborationCursor = Extension.create({
    name: "collaborationCursor",
    addProseMirrorPlugins() {
      return [
        // awareness 光标/选区装饰：监听 awareness.change，渲染其他用户光标。
        yCursorPlugin(awareness, {
          cursorBuilder,
          selectionBuilder,
        }),
      ];
    },
  });

  return [collaboration, collaborationCursor];
}

// ── 光标样式 ───────────────────────────────────────────────────────────────
// 对应 design/FEATURE-DESIGN-cloud-doc.md §3.2.1 的 CSS，改为用 design token。
// --user-color 由 cursorBuilder / selectionBuilder 在元素上设置（值是 var(--accent) 等）。

const COLLABORATION_CURSOR_STYLE = `
.collaboration-cursor__caret {
  border-left: 2px solid var(--user-color, var(--muted));
  margin-left: -1px;
  margin-right: -1px;
  pointer-events: none;
  position: relative;
  word-break: normal;
}
.collaboration-cursor__label {
  border-radius: var(--radius-sm) var(--radius-sm) var(--radius-sm) 0;
  background: var(--user-color, var(--muted));
  color: var(--on-accent);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  left: -1px;
  padding: var(--space-1) var(--space-2);
  position: absolute;
  top: -1.4em;
  user-select: none;
  white-space: nowrap;
  z-index: 10;
}
.collaboration-cursor__selection {
  background-color: color-mix(in srgb, var(--user-color, var(--muted)) 30%, transparent);
}
`;

/**
 * 协同光标样式注入组件。
 *
 * 在编辑器容器内渲染一次即可（无 DOM 占位，仅注入 <style>）。
 * 样式使用 design token，光标颜色通过 --user-color CSS 变量由 cursorBuilder 设置。
 */
export function CollaborationCursorStyles() {
  return <style dangerouslySetInnerHTML={{ __html: COLLABORATION_CURSOR_STYLE }} />;
}

// ── 便捷组件：同时注入样式 ─────────────────────────────────────────────────
// 业务侧若希望一个组件搞定样式，可直接用 <CollaborationCursor />（无 props，仅渲染样式）。
// 扩展仍需通过 createCollaborationExtensions 显式注入 useEditor，因为扩展依赖
// ydoc/awareness 实例，需在编辑器创建时确定。

/**
 * 协同光标组件（样式注入）。
 *
 * 仅注入光标样式 <style>。TipTap 扩展请通过 createCollaborationExtensions 工厂
 * 注入编辑器的 extensions。本组件放在编辑器容器内任意位置即可。
 */
export default function CollaborationCursor() {
  return <CollaborationCursorStyles />;
}