/**
 * 看板视图切换按钮组 —— 共享组件。
 *
 * board 页曾有两套几乎相同的代码（< sm 仅图标 / ≥ sm 带文案），
 * 合并为单套响应式实现：图标始终显示，文案 sm 起显示。
 */

import type { ViewMode } from "./types";
import { getTranslations } from "next-intl/server";
import { ViewToggleClient } from "./ViewToggleClient";

interface ViewToggleProps {
  view: ViewMode;
  onChange: (v: ViewMode) => void;
}

export async function ViewToggle({ view, onChange }: ViewToggleProps) {
  const t = await getTranslations("task");

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
