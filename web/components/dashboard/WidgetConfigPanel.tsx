"use client";

/**
 * F3 Widget 仪表盘 — Widget 配置面板。
 *
 * 设计依据：design/FEATURE-DESIGN-v0.7.md §3.6。
 *
 * 职责：
 *  - 通用 Widget 配置模态框，根据 widgetId 渲染不同配置选项
 *  - 支持：时间范围、显示数量限制、筛选状态、显示样式、开关等
 *  - 配置变更通过 onChange 实时回调，由父组件持久化
 *  - 模态框：fixed inset-0 + 居中面板 + Escape 关闭 + 遮罩点击关闭
 *
 * 配置项矩阵（widgetId → 配置选项）：
 *  - task-stats: 时间范围（7d/30d/90d）、显示完成率开关
 *  - my-tasks: 显示数量限制（5/10/20）、筛选状态（全部/进行中/已完成）
 *  - due-this-week: 显示数量限制
 *  - team-load: 显示成员数量限制
 *  - burndown: 时间范围（当前迭代/全部）
 *  - priority-dist: 显示样式（饼图/柱状图）
 *  - recent-activity: 显示数量限制（10/20/50）
 *  - decision-actions: 显示数量限制
 *
 * 经验来源：2026-09-10-react-icon-size-prop-hardcoded-audit
 *   — 图标尺寸走档位值（16/14），不使用任意数值。
 */

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";

/** Widget 配置数据类型：任意键值对 */
export type WidgetConfig = Record<string, unknown>;

export interface WidgetConfigPanelProps {
  /** Widget id（决定渲染哪些配置选项） */
  widgetId: string;
  /** 当前配置值 */
  config: WidgetConfig;
  /** 配置变更回调（实时触发，父组件负责持久化） */
  onChange: (config: WidgetConfig) => void;
  /** 关闭回调 */
  onClose: () => void;
}

/** 单选选项组定义 */
interface Option<T extends string | number> {
  value: T;
  label: string;
}

/** 配置字段描述符（声明式渲染配置控件） */
type FieldDef =
  | { kind: "select"; key: string; label: string; options: Option<string | number>[] }
  | { kind: "toggle"; key: string; label: string };

/** i18n 翻译函数类型 */
type TFunc = (key: string, vars?: Record<string, string | number>) => string;

/**
 * 根据 widgetId 返回该 Widget 的配置字段描述符列表。
 * 未注册的 widgetId 返回空数组（不显示配置项）。
 * 标签通过 i18n 翻译函数 t("dashboard") 命名空间本地化。
 */
function getFields(widgetId: string, t: TFunc): FieldDef[] {
  switch (widgetId) {
    case "task-stats":
      return [
        {
          kind: "select",
          key: "timeRange",
          label: t("timeRange"),
          options: [
            { value: "7d", label: t("range7d") },
            { value: "30d", label: t("range30d") },
            { value: "90d", label: t("range90d") },
          ],
        },
        { kind: "toggle", key: "showCompletionRate", label: t("showCompletionRate") },
      ];
    case "my-tasks":
      return [
        {
          kind: "select",
          key: "limit",
          label: t("displayCount"),
          options: [
            { value: 5, label: t("countItems", { count: 5 }) },
            { value: 10, label: t("countItems", { count: 10 }) },
            { value: 20, label: t("countItems", { count: 20 }) },
          ],
        },
        {
          kind: "select",
          key: "statusFilter",
          label: t("filterStatus"),
          options: [
            { value: "all", label: t("statusAll") },
            { value: "in_progress", label: t("statusInProgress") },
            { value: "done", label: t("statusDone") },
          ],
        },
      ];
    case "due-this-week":
      return [
        {
          kind: "select",
          key: "limit",
          label: t("displayCount"),
          options: [
            { value: 5, label: t("countItems", { count: 5 }) },
            { value: 10, label: t("countItems", { count: 10 }) },
            { value: 20, label: t("countItems", { count: 20 }) },
          ],
        },
      ];
    case "team-load":
      return [
        {
          kind: "select",
          key: "memberLimit",
          label: t("displayMemberCount"),
          options: [
            { value: 5, label: t("countMembers", { count: 5 }) },
            { value: 10, label: t("countMembers", { count: 10 }) },
            { value: 20, label: t("countMembers", { count: 20 }) },
          ],
        },
      ];
    case "burndown":
      return [
        {
          kind: "select",
          key: "timeRange",
          label: t("timeRange"),
          options: [
            { value: "current_sprint", label: t("rangeCurrentSprint") },
            { value: "all", label: t("rangeAll") },
          ],
        },
      ];
    case "priority-dist":
      return [
        {
          kind: "select",
          key: "chartStyle",
          label: t("chartStyle"),
          options: [
            { value: "pie", label: t("stylePie") },
            { value: "bar", label: t("styleBar") },
          ],
        },
      ];
    case "recent-activity":
      return [
        {
          kind: "select",
          key: "limit",
          label: t("displayCount"),
          options: [
            { value: 10, label: t("countItems", { count: 10 }) },
            { value: 20, label: t("countItems", { count: 20 }) },
            { value: 50, label: t("countItems", { count: 50 }) },
          ],
        },
      ];
    case "decision-actions":
      return [
        {
          kind: "select",
          key: "limit",
          label: t("displayCount"),
          options: [
            { value: 5, label: t("countItems", { count: 5 }) },
            { value: 10, label: t("countItems", { count: 10 }) },
            { value: 20, label: t("countItems", { count: 20 }) },
          ],
        },
      ];
    default:
      return [];
  }
}

export default function WidgetConfigPanel({
  widgetId,
  config,
  onChange,
  onClose,
}: WidgetConfigPanelProps) {
  const t = useTranslations("dashboard");
  const panelRef = useRef<HTMLDivElement>(null);
  const fields = getFields(widgetId, t);

  // Escape 关闭
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 打开时聚焦面板
  useEffect(() => {
    if (panelRef.current) {
      const id = requestAnimationFrame(() => panelRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, []);

  /** 更新单个配置字段 */
  function updateField(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-[var(--overlay)]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("widgetConfig")}
        tabIndex={-1}
        className="w-full max-w-md bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-lg)] focus-visible:outline-none"
      >
        {/* 标题栏 */}
        <header className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-soft)]">
          <h2 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            {t("widgetConfig")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-[var(--radius-sm)] text-[var(--meta)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            aria-label={t("close")}
          >
            <X size={16} />
          </button>
        </header>

        {/* 配置项列表 */}
        <div className="p-5">
          {fields.length === 0 ? (
            <p className="text-center text-[length:var(--text-sm)] text-[var(--meta)] py-4">
              {t("widgetConfigNoOptions")}
            </p>
          ) : (
            <div className="space-y-4">
              {fields.map((field) => (
                <FieldRow
                  key={field.key}
                  field={field}
                  value={config[field.key]}
                  onChange={(v) => updateField(field.key, v)}
                />
              ))}
            </div>
          )}
        </div>

        {/* 底部操作区 */}
        <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border-soft)]">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          >
            {t("widgetConfigDone")}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** 单个配置字段行 */
function FieldRow({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
}): ReactNode {
  if (field.kind === "select") {
    return (
      <label className="block">
        <span className="block mb-1.5 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
          {field.label}
        </span>
        <select
          value={String(value ?? field.options[0]?.value ?? "")}
          onChange={(e) => {
            const opt = field.options.find((o) => String(o.value) === e.target.value);
            if (opt) onChange(opt.value);
          }}
          className="w-full px-3 py-2 rounded-[var(--radius-md)] bg-[var(--surface-2)] border border-[var(--border)] text-[length:var(--text-sm)] text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
        >
          {field.options.map((opt) => (
            <option key={String(opt.value)} value={String(opt.value)}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  // toggle
  const checked = Boolean(value);
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
        {field.label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={[
          "relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2",
          checked ? "bg-[var(--accent)]" : "bg-[var(--border)]",
        ].join(" ")}
      >
        <span
          className={[
            "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-[var(--surface)] shadow-[var(--elev-sm)] transition-transform duration-[var(--motion-fast)]",
            checked ? "translate-x-4" : "translate-x-0.5",
          ].join(" ")}
          style={{ marginTop: "2px" }}
        />
      </button>
    </label>
  );
}