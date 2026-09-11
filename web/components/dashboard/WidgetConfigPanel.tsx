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

/**
 * 根据 widgetId 返回该 Widget 的配置字段描述符列表。
 * 未注册的 widgetId 返回空数组（不显示配置项）。
 */
function getFields(widgetId: string): FieldDef[] {
  switch (widgetId) {
    case "task-stats":
      return [
        {
          kind: "select",
          key: "timeRange",
          label: "时间范围",
          options: [
            { value: "7d", label: "近 7 天" },
            { value: "30d", label: "近 30 天" },
            { value: "90d", label: "近 90 天" },
          ],
        },
        { kind: "toggle", key: "showCompletionRate", label: "显示完成率" },
      ];
    case "my-tasks":
      return [
        {
          kind: "select",
          key: "limit",
          label: "显示数量限制",
          options: [
            { value: 5, label: "5 条" },
            { value: 10, label: "10 条" },
            { value: 20, label: "20 条" },
          ],
        },
        {
          kind: "select",
          key: "statusFilter",
          label: "筛选状态",
          options: [
            { value: "all", label: "全部" },
            { value: "in_progress", label: "进行中" },
            { value: "done", label: "已完成" },
          ],
        },
      ];
    case "due-this-week":
      return [
        {
          kind: "select",
          key: "limit",
          label: "显示数量限制",
          options: [
            { value: 5, label: "5 条" },
            { value: 10, label: "10 条" },
            { value: 20, label: "20 条" },
          ],
        },
      ];
    case "team-load":
      return [
        {
          kind: "select",
          key: "memberLimit",
          label: "显示成员数量限制",
          options: [
            { value: 5, label: "5 人" },
            { value: 10, label: "10 人" },
            { value: 20, label: "20 人" },
          ],
        },
      ];
    case "burndown":
      return [
        {
          kind: "select",
          key: "timeRange",
          label: "时间范围",
          options: [
            { value: "current_sprint", label: "当前迭代" },
            { value: "all", label: "全部" },
          ],
        },
      ];
    case "priority-dist":
      return [
        {
          kind: "select",
          key: "chartStyle",
          label: "显示样式",
          options: [
            { value: "pie", label: "饼图" },
            { value: "bar", label: "柱状图" },
          ],
        },
      ];
    case "recent-activity":
      return [
        {
          kind: "select",
          key: "limit",
          label: "显示数量限制",
          options: [
            { value: 10, label: "10 条" },
            { value: 20, label: "20 条" },
            { value: 50, label: "50 条" },
          ],
        },
      ];
    case "decision-actions":
      return [
        {
          kind: "select",
          key: "limit",
          label: "显示数量限制",
          options: [
            { value: 5, label: "5 条" },
            { value: 10, label: "10 条" },
            { value: 20, label: "20 条" },
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
  const panelRef = useRef<HTMLDivElement>(null);
  const fields = getFields(widgetId);

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
        aria-label="Widget 配置"
        tabIndex={-1}
        className="w-full max-w-md bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-lg)] focus-visible:outline-none"
      >
        {/* 标题栏 */}
        <header className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-soft)]">
          <h2 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            Widget 配置
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-[var(--radius-sm)] text-[var(--meta)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </header>

        {/* 配置项列表 */}
        <div className="p-5">
          {fields.length === 0 ? (
            <p className="text-center text-[length:var(--text-sm)] text-[var(--meta)] py-4">
              此 Widget 暂无可配置项
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
            完成
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