"use client";

/**
 * 分组控制 —— 多维表格分组字段选择器。
 *
 * 设计：
 *  - 下拉选择分组字段（只允许 select/multiselect/user 类型字段）
 *  - "不分组" 选项（value=""）
 *  - 选中分组字段后显示 "取消分组" 按钮
 *  - 所有样式用 design token，lucide-react 图标 size=14
 *
 * 来源：Phase 3D 多维表格筛选/排序/分组
 *
 * 拆分说明：GroupControl 保持 client component（被 DatabaseEditor client 引用），
 * 下拉交互逻辑委托给 GroupControlClient 子组件。
 */

import type { DatabaseField } from "@/lib/database/query-engine";
import { useTranslations } from "next-intl";
import { GroupControlClient } from "./GroupControlClient";

// ─── 可分组字段类型 ──────────────────────────────────────────

const GROUPABLE_TYPES = new Set(["select", "multiselect", "user"]);

// ─── 主组件 ──────────────────────────────────────────────────

interface GroupControlProps {
  fields: DatabaseField[];
  groupFieldId: string | null;
  onChange: (fieldId: string | null) => void;
}

export function GroupControl({ fields, groupFieldId, onChange }: GroupControlProps) {
  const t = useTranslations("database.groupControl");

  // 只允许 select/multiselect/user 类型字段分组
  const groupableFields = fields.filter((f) => GROUPABLE_TYPES.has(f.type));

  return (
    <GroupControlClient
      groupableFields={groupableFields}
      groupFieldId={groupFieldId}
      onChange={onChange}
      label={t("label")}
      fieldAria={t("fieldAria")}
      noGroup={t("noGroup")}
      clearAria={t("clearAria")}
    />
  );
}
