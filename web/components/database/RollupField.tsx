"use client";

/**
 * Rollup 聚合结果只读显示控件
 *
 * ## 功能
 *
 * - 只读显示 rollup 字段的聚合结果
 * - number 类型：显示数值（保留 2 位小数，整数则直接显示）
 * - string 类型：显示文本
 * - string[] 类型：显示逗号分隔列表
 * - null / 空：显示 "—"（em dash），用 var(--muted) 表示空值
 * - lucide-react Sigma 图标（size=14）作为 rollup 标识
 *
 * ## 样式
 *
 * - 所有颜色使用 design token（var(--*)），禁止裸 hex
 * - "use client" 隔离客户端交互（虽然本组件无交互，保持一致性）
 */

import type { DatabaseField } from "@prisma/client";
import type { ReactElement } from "react";
import { Sigma } from "lucide-react";
import { useTranslations } from "next-intl";

// ─── Props ──────────────────────────────────────────────────

export interface RollupFieldProps {
  /** rollup 类型字段 */
  field: DatabaseField;
  /** 聚合结果（由 computeRollup 计算得出） */
  value: number | string | string[] | null;
}

// ─── 共享样式 ───────────────────────────────────────────────

const containerClass =
  "w-full h-full flex items-center gap-1.5 px-2 text-[length:var(--text-sm)]";

// ─── 组件 ───────────────────────────────────────────────────

export function RollupField({ value }: RollupFieldProps): ReactElement {
  const t = useTranslations("database.rollupField");

  // ─── null / undefined：空值 ──────────────────────────────
  if (value === null || value === undefined) {
    return (
      <div
        className={containerClass}
        style={{ color: "var(--muted)" }}
      >
        <Sigma size={14} className="shrink-0" />
        <span>{t("empty")}</span>
      </div>
    );
  }

  // ─── number：数值（保留 2 位小数）────────────────────────
  if (typeof value === "number") {
    const text = Number.isInteger(value) ? String(value) : value.toFixed(2);
    return (
      <div className={containerClass}>
        <Sigma size={14} className="shrink-0 text-[var(--meta)]" />
        <span className="truncate text-[var(--fg)]">{text}</span>
      </div>
    );
  }

  // ─── string[]：逗号分隔列表 ──────────────────────────────
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <div
          className={containerClass}
          style={{ color: "var(--muted)" }}
        >
          <Sigma size={14} className="shrink-0" />
          <span>{t("empty")}</span>
        </div>
      );
    }
    return (
      <div className={containerClass}>
        <Sigma size={14} className="shrink-0 text-[var(--meta)]" />
        <span className="truncate text-[var(--fg)]">
          {value.join(", ")}
        </span>
      </div>
    );
  }

  // ─── string：文本 ────────────────────────────────────────
  if (value === "") {
    return (
      <div
        className={containerClass}
        style={{ color: "var(--muted)" }}
      >
        <Sigma size={14} className="shrink-0" />
        <span>{t("empty")}</span>
      </div>
    );
  }

  return (
    <div className={containerClass}>
      <Sigma size={14} className="shrink-0 text-[var(--meta)]" />
      <span className="truncate text-[var(--fg)]">{value}</span>
    </div>
  );
}