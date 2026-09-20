"use client";

/**
 * 看板视图切换按钮组 —— 共享组件。
 *
 * board 页曾有两套几乎相同的代码（< sm 仅图标 / ≥ sm 带文案），
 * 合并为单套响应式实现：图标始终显示，文案 sm 起显示。
 *
 * 拆分说明：ViewToggle 保持 client component（被 board/page.tsx client 引用），
 * 交互逻辑委托给 ViewToggleClient 子组件。
 */

import { useTranslations } from "next-intl";
import type { ViewMode } from "./types";
import { ViewToggleClient } from "./ViewToggleClient";

interface ViewToggleProps {
  view: ViewMode;
  onChange: (v: ViewMode) => void;
}

export function ViewToggle({ view, onChange }: ViewToggleProps) {
  const t = useTranslations("task");

  return (
    <ViewToggleClient
      view={view}
      onChange={onChange}
      viewAria={t("viewAria")}
      boardViewAria={t("boardViewAria")}
      boardView={t("boardView")}
      listViewAria={t("listViewAria")}
      listView={t("listView")}
    />
  );
}
