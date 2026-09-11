"use client";

/**
 * 决策执行追踪面板 · ActionItemPanel
 *
 * F1 决策驱动执行：把决策记录中的「行动项」结构化展示，
 * 让决策不止于记录，还能落到具体负责人 + 截止日 + 优先级 + 关联任务。
 *
 * 功能：
 *  - 行动项列表：勾选框 + 负责人头像 + 截止日 + 优先级标签 + 任务链接
 *  - 顶部完成率：已完成/总数 + 迷你环形进度条（SVG）
 *  - 「同步到任务」按钮：手动触发 sync-actions 端点（保存决策时也会自动同步）
 *  - 无行动项时显示「暂无行动项」空状态
 *
 * 数据来源：
 *  - GET /api/v1/workspaces/{wid}/tasks/{taskId}/decisions/{decisionId}/action-items
 *  - POST /api/v1/workspaces/{wid}/tasks/{taskId}/decisions/{decisionId}/sync-actions
 *
 * 设计：
 *  - 所有色值走 var(--token)，间距/字号/圆角走 token
 *  - 优先级标签复用 PRIORITY_BADGE_STYLES（与看板/详情页一致）
 *  - 负责人头像：项目无 Avatar 组件，用首字母圆形 + 语义色背景
 *  - 环形进度条：纯 SVG（与 analytics 页同模式，不引第三方库）
 *  - 图标仅用 lucide-react
 *
 * i18n：键命名空间 "decision"（actionItems / actionProgress / syncActions /
 *  noActions / actionCreated / actionUpdated）。任务 160 将统一添加翻译键，
 *  此处先用 useTranslations("decision") 调用，next-intl 在 key 缺失时会
 *  回退到 key 本身（不抛错），任务 160 补齐后即正确显示。
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "@/lib/i18n-navigation";
import { RefreshCw, Loader2, ListChecks, ExternalLink, Calendar, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/Toast";
import { useTranslations } from "next-intl";
import { PRIORITY_BADGE_STYLES } from "@/lib/task-meta";
import { ACTION_TEMPLATES } from "@/lib/decision-action-parser";
import type { Priority, Person } from "@/lib/types";

/** 行动项形态：决策记录中结构化提取的可执行条目。 */
export interface ActionItem {
  id: string;
  /** 行动项标题（决策中提炼的待办描述） */
  title: string;
  /** 是否已完成（勾选框状态） */
  completed: boolean;
  /** 负责人（同步到任务后关联 assignee；决策草稿阶段可能为 null） */
  assignee?: Person | null;
  /** 负责人显示名（assignee 为 null 时仍可能从草稿中保留名字） */
  assigneeName?: string | null;
  /** 截止日期（ISO 字符串或 null） */
  dueDate?: string | null;
  /** 优先级：与任务体系一致（low/medium/high/urgent） */
  priority: Priority;
  /** 关联任务 ID（同步到任务后产生；null 表示尚未同步） */
  taskId?: string | null;
}

/** sync-actions 端点响应：返回创建/更新的任务数。 */
interface SyncActionsResp {
  created?: number;
  updated?: number;
  /** 同步后的完整行动项列表（部分实现可能直接返回最新列表） */
  items?: ActionItem[];
}

interface ActionItemPanelProps {
  decisionId: string;
  workspaceId: string;
  taskId: string;
  /** 当前 locale（i18n-navigation 的 Link 自动处理 locale 前缀，此字段保留以备定制场景） */
  locale: string;
  /** 外部传入的初始行动项（决策详情内嵌时直接用，避免首次额外请求） */
  initialItems?: ActionItem[];
  /** 外部触发刷新的签名（父组件保存决策后 +1，触发本面板重新拉取） */
  refreshSignal?: number;
  /**
   * 插入模板回调（父组件将模板 markdown 插入到决策编辑器）。
   * 未提供时不显示「插入模板」按钮。模板中的 {dueDate} 占位符已替换为
   * 当前日期 + 7 天（YYYY-MM-DD）。
   */
  onInsertTemplate?: (markdown: string) => void;
}

/** 环形进度条尺寸常量（SVG viewBox） */
const RING_SIZE = 28;
const RING_STROKE = 3;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * 负责人头像：项目无 Avatar 组件，用首字母圆形 + 语义色背景。
 * 取 name 首字母（无 name 取 email 首字母），背景色按 hash 落到 accent/success/warn/danger 四档。
 */
function AssigneeAvatar({ name, email }: { name: string | null; email?: string | null }) {
  const display = name?.trim() || email?.trim() || "?";
  const initial = display.charAt(0).toUpperCase();
  // 简易 hash → 4 档语义色，保证同一人稳定着色
  const hash = display.charCodeAt(0) + (display.charCodeAt(1) || 0);
  const palette = ["var(--accent)", "var(--success)", "var(--warn)", "var(--danger)"];
  const bg = palette[hash % palette.length];
  return (
    <span
      aria-label={display}
      title={display}
      className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[length:var(--text-xs)] font-[weight:var(--weight-semibold)] text-[var(--accent-fg)] shrink-0"
      style={{ background: bg }}
    >
      {initial}
    </span>
  );
}

/** 优先级标签：复用 PRIORITY_BADGE_STYLES，与看板/详情页一致。 */
function PriorityBadge({ priority, label }: { priority: Priority; label: string }) {
  const style = PRIORITY_BADGE_STYLES[priority];
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] shrink-0"
      style={{ background: style.background, color: style.color }}
    >
      {label}
    </span>
  );
}

/**
 * 迷你环形进度条：SVG circle + stroke-dasharray 控制进度。
 * 与 analytics 页 SVG 图表同模式，不引第三方库。
 */
function ProgressRing({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const offset = RING_CIRCUMFERENCE * (1 - clamped / 100);
  const color = clamped === 100 ? "var(--success)" : "var(--accent)";
  return (
    <svg
      width={RING_SIZE}
      height={RING_SIZE}
      viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
      className="shrink-0"
      role="img"
      aria-label={`${clamped}%`}
    >
      {/* 背景轨道 */}
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_RADIUS}
        fill="none"
        stroke="var(--surface-3)"
        strokeWidth={RING_STROKE}
      />
      {/* 进度弧 */}
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_RADIUS}
        fill="none"
        stroke={color}
        strokeWidth={RING_STROKE}
        strokeLinecap="round"
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
        className="transition-[stroke-dashoffset] duration-[var(--motion-base)]"
      />
    </svg>
  );
}

export function ActionItemPanel({
  decisionId,
  workspaceId,
  taskId,
  initialItems,
  refreshSignal = 0,
  onInsertTemplate,
}: ActionItemPanelProps) {
  // TODO: i18n —— 任务 160 将在 messages/{locale}.json 的 "decision" 命名空间下
  // 补齐 actionItems / actionProgress / syncActions / noActions / actionCreated /
  // actionUpdated / priority.* 等键。此处 useTranslations 在 key 缺失时回退到 key
  // 本身（next-intl 默认行为），不会抛错。
  const t = useTranslations("decision");
  const tPriority = useTranslations("priority");
  const { toast } = useToast();

  const [items, setItems] = useState<ActionItem[]>(initialItems ?? []);
  const [loading, setLoading] = useState<boolean>(initialItems == null);
  const [error, setError] = useState<string>("");
  const [syncing, setSyncing] = useState(false);
  // 勾选中的行动项 ID（loading 反馈，避免重复点击）
  const [togglingId, setTogglingId] = useState<string | null>(null);
  // 模板下拉菜单开关
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);

  const endpoint = `/api/v1/workspaces/${workspaceId}/tasks/${taskId}/decisions/${decisionId}/action-items`;
  const syncEndpoint = `/api/v1/workspaces/${workspaceId}/tasks/${taskId}/decisions/${decisionId}/sync-actions`;

  /** 拉取行动项列表。 */
  const loadItems = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const resp = await api<ActionItem[] | { items: ActionItem[] }>(endpoint);
      // 兼容两种响应形态：直接数组 或 { items: [] }
      const list = Array.isArray(resp) ? resp : resp.items;
      setItems(list ?? []);
    } catch (e) {
      // API 可能尚未存在（404），此时不显示错误，仅置空列表
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("404") || msg.toLowerCase().includes("not found")) {
        setItems([]);
      } else {
        setError(msg || "加载失败");
      }
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  // 首次挂载：若无 initialItems 则拉取；有则跳过首次请求
  useEffect(() => {
    if (initialItems == null) {
      loadItems();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部 refreshSignal 变化时重新拉取（父组件保存决策后 +1）
  useEffect(() => {
    if (refreshSignal > 0) {
      loadItems();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  /** 手动同步到任务：POST sync-actions。 */
  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    setError("");
    try {
      const resp = await api<SyncActionsResp>(syncEndpoint, { method: "POST" });
      const created = resp.created ?? 0;
      const updated = resp.updated ?? 0;
      // 优先用响应里的 items，否则重新拉取
      if (resp.items) {
        setItems(resp.items);
      } else {
        await loadItems();
      }
      if (created > 0 && updated > 0) {
        toast("success", `${t("actionCreated", { count: created })} · ${t("actionUpdated", { count: updated })}`);
      } else if (created > 0) {
        toast("success", t("actionCreated", { count: created }));
      } else if (updated > 0) {
        toast("success", t("actionUpdated", { count: updated }));
      } else {
        toast("info", t("actionItems"));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "同步失败";
      setError(msg);
      toast("error", msg);
    } finally {
      setSyncing(false);
    }
  }

  /** 勾选/取消勾选行动项。 */
  async function handleToggle(item: ActionItem) {
    if (togglingId) return;
    setTogglingId(item.id);
    // 乐观更新
    setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, completed: !it.completed } : it)));
    try {
      await api(`${endpoint}/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ completed: !item.completed }),
      });
    } catch (e) {
      // 回滚
      setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, completed: item.completed } : it)));
      toast("error", e instanceof Error ? e.message : "更新失败");
    } finally {
      setTogglingId(null);
    }
  }

  /**
   * 插入模板：将 {dueDate} 占位符替换为当前日期 + 7 天（YYYY-MM-DD）后回调父组件。
   * 硬编码中文文本（i18n 由后续任务统一处理）。
   */
  function handleInsertTemplate(md: string) {
    const due = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const dueDateStr = due.toISOString().slice(0, 10);
    const filled = md.replace(/\{dueDate\}/g, dueDateStr);
    onInsertTemplate?.(filled);
    setTemplateMenuOpen(false);
  }

  const total = items.length;
  const completed = items.filter((it) => it.completed).length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  // 加载中骨架
  if (loading) {
    return (
      <section
        className="mt-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface-2)] px-[var(--space-3)] py-[var(--space-2)]"
        aria-busy="true"
        aria-label={t("actionItems")}
      >
        <div className="flex items-center gap-2 text-[length:var(--text-xs)] text-[var(--meta)]">
          <Loader2 size={12} className="animate-spin" />
          {t("actionItems")}
        </div>
      </section>
    );
  }

  return (
    <section
      className="mt-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface-2)] overflow-hidden"
      aria-label={t("actionItems")}
    >
      {/* 顶部：标题 + 完成率 + 环形进度 + 同步按钮 */}
      <header className="flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-2 border-b border-[var(--border-soft)]">
        <ListChecks size={13} className="shrink-0 text-[var(--muted)]" />
        <span className="text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
          {t("actionItems")}
        </span>
        {total > 0 && (
          <span className="flex items-center gap-1.5 ml-1 text-[length:var(--text-xs)] text-[var(--meta)] tabular-nums">
            <ProgressRing percent={percent} />
            <span>
              {completed}/{total}
            </span>
          </span>
        )}
        {/* 插入模板按钮（仅当 onInsertTemplate 提供时显示）· 硬编码中文文本 */}
        {onInsertTemplate && (
          <div className="relative ml-auto">
            <button
              onClick={() => setTemplateMenuOpen((v) => !v)}
              title="插入模板"
              aria-label="插入模板"
              className="inline-flex items-center gap-1 h-6 px-2 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] text-[var(--fg-2)] hover:bg-[var(--surface)] active:bg-[var(--surface-3)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
            >
              <Plus size={11} />
              <span className="hidden sm:inline">插入模板</span>
            </button>
            {templateMenuOpen && (
              <>
                {/* 点击外部关闭 */}
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setTemplateMenuOpen(false)}
                  aria-hidden="true"
                />
                <ul className="absolute right-0 top-7 z-20 min-w-[200px] rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface-2)] shadow-md py-1">
                  {ACTION_TEMPLATES.map((tpl) => (
                    <li key={tpl.id}>
                      <button
                        onClick={() => handleInsertTemplate(tpl.markdown)}
                        className="w-full text-left px-3 py-1.5 hover:bg-[var(--surface)] transition-colors duration-[var(--motion-fast)]"
                      >
                        <div className="text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
                          {tpl.name}
                        </div>
                        <div className="text-[length:var(--text-xs)] text-[var(--meta)]">
                          {tpl.description}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        <button
          onClick={handleSync}
          disabled={syncing}
          title={t("syncActions")}
          aria-label={t("syncActions")}
          className={`${onInsertTemplate ? "" : "ml-auto"} inline-flex items-center gap-1 h-6 px-2 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] text-[var(--fg-2)] hover:bg-[var(--surface)] active:bg-[var(--surface-3)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2`}
        >
          {syncing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          <span className="hidden sm:inline">{t("syncActions")}</span>
        </button>
      </header>

      {/* 错误提示 */}
      {error && (
        <div className="px-[var(--space-3)] py-1.5 text-[length:var(--text-xs)] text-[var(--danger-fg)] bg-[var(--danger-soft)]">
          {error}
        </div>
      )}

      {/* 行动项列表 */}
      {total === 0 ? (
        <div className="px-[var(--space-3)] py-[var(--space-3)] text-center text-[length:var(--text-xs)] text-[var(--meta)]">
          {t("noActions")}
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border-soft)]">
          {items.map((item) => {
            const isToggling = togglingId === item.id;
            const assigneeDisplay = item.assignee?.name ?? item.assigneeName ?? item.assignee?.email ?? null;
            const due = item.dueDate ? new Date(item.dueDate) : null;
            const isOverdue = due && !item.completed && due.getTime() < Date.now();
            return (
              <li
                key={item.id}
                className="flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-2"
              >
                {/* 勾选框 */}
                {isToggling ? (
                  <Loader2
                    size={14}
                    className="shrink-0 animate-spin text-[var(--meta)]"
                    aria-label="loading"
                  />
                ) : (
                  <input
                    type="checkbox"
                    checked={item.completed}
                    onChange={() => handleToggle(item)}
                    className="shrink-0 accent-[var(--accent)]"
                    aria-label={item.title}
                  />
                )}

                {/* 标题 + 任务链接 */}
                <div className="flex-1 min-w-0 flex items-center gap-1">
                  <span
                    className={`truncate text-[length:var(--text-sm)] ${
                      item.completed
                        ? "text-[var(--meta)] line-through"
                        : "text-[var(--fg-2)]"
                    }`}
                    title={item.title}
                  >
                    {item.title}
                  </span>
                  {item.taskId && (
                    <Link
                      href={`/w/${workspaceId}/task/${item.taskId}`}
                      className="shrink-0 inline-flex items-center text-[var(--accent)] hover:underline"
                      aria-label="open task"
                    >
                      <ExternalLink size={11} />
                    </Link>
                  )}
                </div>

                {/* 优先级标签 */}
                <PriorityBadge
                  priority={item.priority}
                  label={tPriority(item.priority)}
                />

                {/* 负责人头像 */}
                {assigneeDisplay && (
                  <AssigneeAvatar
                    name={item.assignee?.name ?? item.assigneeName ?? null}
                    email={item.assignee?.email ?? null}
                  />
                )}

                {/* 截止日 */}
                {due && (
                  <span
                    className={`shrink-0 inline-flex items-center gap-0.5 text-[length:var(--text-xs)] tabular-nums ${
                      isOverdue ? "text-[var(--danger-fg)]" : "text-[var(--meta)]"
                    }`}
                    title={due.toLocaleDateString()}
                  >
                    <Calendar size={10} />
                    {due.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default ActionItemPanel;