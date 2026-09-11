"use client";

/**
 * 工作区首页（仪表盘）· /w/[wid]
 *
 * F3 改造：从固定布局改为可拖拽 Widget 仪表盘。
 *
 * 结构：
 *  - 顶部：欢迎语 + 「添加 Widget」按钮 + 「编辑布局」开关
 *  - 主体：<DashboardGrid>（RGL 容器，内部渲染各 Widget）
 *  - Onboarding 引导保留（无任务时显示）
 *
 * 数据流：
 *  - workspace context：GET /api/v1/workspaces → 获取当前 workspace 的 role
 *  - 布局：DashboardGrid 内部管理（GET/PUT /dashboard/layout）
 *  - Widget 数据：各 Widget 独立 fetch /dashboard/widgets/:widgetId
 *
 * 设计：
 *  - 所有色值走 var(--token)，图标来自 lucide-react
 *  - i18n 使用 useTranslations hook
 *  - 响应式：移动端 DashboardGrid 自动切换为单列纵向堆叠
 */

import { use, useCallback, useEffect, useRef, useState } from "react";
import { Plus, Pencil, Check, LayoutDashboard, Download, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/Toast";
import type { WorkspaceSummary, Role } from "@/lib/types";
import Onboarding from "@/components/Onboarding";
import DashboardGrid, { type DashboardGridHandle } from "@/components/dashboard/DashboardGrid";
import AddWidgetDialog from "@/components/dashboard/AddWidgetDialog";

export default function HomePage({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = use(params);

  const t = useTranslations("dashboard");
  const tNav = useTranslations("nav");
  const tTask = useTranslations("task");
  const { toast } = useToast();

  // workspace context（获取 role + 判断 onboarding）
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [wsLoaded, setWsLoaded] = useState(false);
  // Onboarding 引导：用户完成或跳过后本地标记，避免重复弹窗
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  // 任务数（用于 Onboarding 判断是否显示）
  const [taskCount, setTaskCount] = useState(0);

  // 仪表盘状态
  const [editing, setEditing] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  /** 当前布局中的 Widget id 列表（用于 AddWidgetDialog 灰显已添加项） */
  const [layoutIds, setLayoutIds] = useState<string[]>([]);
  const gridRef = useRef<DashboardGridHandle>(null);

  // ─── 加载 workspace context ───
  const loadWorkspace = useCallback(async () => {
    try {
      const wsList = await api<WorkspaceSummary[]>("/api/v1/workspaces");
      const cur = wsList.find((w) => w.id === wid);
      if (cur) setWorkspace(cur);
    } catch {
      // 忽略：DashboardGrid 会用 viewer 默认布局兜底
    } finally {
      setWsLoaded(true);
    }
  }, [wid]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  // ─── 加载任务数（用于 Onboarding 判断） ───
  useEffect(() => {
    api<{ items?: unknown[] } | unknown[]>(`/api/v1/workspaces/${wid}/tasks`)
      .then((res) => {
        const count = Array.isArray(res) ? res.length : (res as { items?: unknown[] }).items?.length ?? 0;
        setTaskCount(count);
      })
      .catch(() => {
        /* 忽略：Onboarding 不显示即可 */
      });
  }, [wid]);

  const role: Role = workspace?.role ?? "viewer";

  // ─── 添加 Widget ───
  const handleAddWidget = useCallback((widgetId: string) => {
    gridRef.current?.addWidget(widgetId);
  }, []);

  // ─── 布局变化回调：更新 layoutIds ───
  const handleLayoutChange = useCallback((layout: { i: string }[]) => {
    setLayoutIds(layout.map((item) => item.i));
  }, []);

  // ─── 导出布局 ───
  const handleExportLayout = useCallback(async () => {
    try {
      const data = await gridRef.current?.exportLayout();
      if (!data) return;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dashboard-layout-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast("error", t("exportLayoutFailed"));
    }
  }, []);

  // ─── 导入布局 ───
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleImportLayout = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await gridRef.current?.importLayout(data);
    } catch {
      toast("error", t("importLayoutFailed"));
    }
    e.target.value = ""; // 重置以便重复导入同一文件
  }, []);

  return (
    <div className="max-w-[var(--container-max)] mx-auto">
      {/* 顶部：欢迎语 + 操作区 */}
      <div className="flex items-end justify-between mb-[var(--space-6)] gap-[var(--space-4)]">
        <div>
          <h1 className="flex items-center gap-2 text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)]">
            <LayoutDashboard size={20} className="text-[var(--muted)]" />
            {tNav("menu.overview")}
          </h1>
          <p className="mt-1 text-[length:var(--text-sm)] text-[var(--muted)]">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* 编辑布局开关 */}
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className={[
              "flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] transition-colors duration-[var(--motion-base)] focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:outline-none",
              editing
                ? "bg-[var(--accent)] text-[var(--accent-fg)] hover:bg-[var(--accent-hover)]"
                : "bg-[var(--surface)] border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)]",
            ].join(" ")}
            aria-pressed={editing}
          >
            {editing ? <Check size={15} /> : <Pencil size={15} />}
            <span className="hidden sm:inline">{editing ? t("exitEdit") : t("editLayout")}</span>
          </button>
          {/* 导出/导入布局（仅编辑模式） */}
          {editing && (
            <>
              <button
                type="button"
                onClick={handleExportLayout}
                className="flex items-center gap-1.5 h-9 px-3 bg-[var(--surface)] border border-[var(--border)] text-[var(--fg-2)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-base)] focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:outline-none"
                aria-label={t("exportLayout")}
                title={t("exportLayout")}
              >
                <Download size={15} />
                <span className="hidden sm:inline">{t("exportLayout")}</span>
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 h-9 px-3 bg-[var(--surface)] border border-[var(--border)] text-[var(--fg-2)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-base)] focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:outline-none"
                aria-label={t("importLayout")}
                title={t("importLayout")}
              >
                <Upload size={15} />
                <span className="hidden sm:inline">{t("importLayout")}</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                onChange={handleImportLayout}
                className="hidden"
              />
            </>
          )}
          {/* 添加 Widget */}
          <button
            type="button"
            onClick={() => setAddDialogOpen(true)}
            className="flex items-center gap-1.5 h-9 px-3 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] transition-colors duration-[var(--motion-base)] focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:outline-none"
          >
            <Plus size={15} />
            <span className="hidden sm:inline">{t("addWidgetTitle")}</span>
          </button>
        </div>
      </div>

      {/* 主体：仪表盘网格 */}
      {!wsLoaded ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-32 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] animate-pulse"
            />
          ))}
        </div>
      ) : (
        <DashboardGrid
          ref={gridRef}
          wid={wid}
          role={role}
          locale=""
          editing={editing}
          onLayoutChange={handleLayoutChange}
        />
      )}

      {/* 添加 Widget 对话框 */}
      <AddWidgetDialog
        open={addDialogOpen}
        addedIds={layoutIds}
        onAdd={handleAddWidget}
        onClose={() => setAddDialogOpen(false)}
      />

      {/* Onboarding 引导：仅在工作区无任务且未标记完成时显示 */}
      {wsLoaded && taskCount === 0 && !onboardingDismissed && (
        <Onboarding
          wid={wid}
          taskCount={taskCount}
          memberCount={0}
          onDismiss={() => setOnboardingDismissed(true)}
        />
      )}
    </div>
  );
}
