"use client";

/**
 * F3 Widget 仪表盘 — RGL 容器组件。
 *
 * 设计依据：design/FEATURE-DESIGN-v0.7.md §3.6。
 *
 * 职责：
 *  - dynamic import react-grid-layout/legacy（ssr: false，避免 hydration mismatch）
 *    legacy 导出兼容 v1 API（isDraggable/isResizable/compactType 等扁平 props）
 *    + WidthProvider HOC 自动测量容器宽度
 *  - 加载布局：GET /api/v1/workspaces/:wid/dashboard/layout
 *  - 保存布局：PUT /api/v1/workspaces/:wid/dashboard/layout（编辑模式退出时触发）
 *  - 编辑模式切换：可拖拽、缩放、删除；非编辑模式 Widget 固定
 *  - 移动端：禁用拖拽（isDraggable=false + cols=1 纵向堆叠）
 *  - 按 layout 项渲染对应 Widget 组件（每个 Widget 独立加载数据）
 *  - 通过 forwardRef 暴露 addWidget / getLayoutIds / exportLayout / importLayout 命令式 API
 *  - 管理 widgetConfigs 状态，配置变更时持久化到 layout API
 *
 * 数据流：
 *  - 布局 + widgetConfigs：本组件统一管理，编辑后 PUT 持久化（复合格式 { items, widgetConfigs }）
 *  - Widget 数据：各 Widget 内部独立 fetch /dashboard/widgets/:widgetId
 *
 * 经验来源：
 *  - 2026-09-10-nextjs-global-error-zero-dependency-inline-token
 *    — dynamic import + ssr:false 避免 RGL 在 SSR 阶段访问 window 报错
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import {
  WIDGET_REGISTRY,
  getDefaultLayout,
  type RGLItem,
} from "./default-layouts";
import { SIZE_PRESETS } from "@/lib/default-layouts";
import WidgetCard from "./WidgetCard";
import { getWidgetComponent, getWidgetIcon, getWidgetTitleKey } from "./widgets";
import type { WidgetConfig } from "./WidgetConfigPanel";

// react-grid-layout v2 的原生 API 与 v1 完全不同（gridConfig/dragConfig 等配置对象）。
// 使用 legacy 导入兼容 v1 扁平 props + WidthProvider HOC 自动测量容器宽度。
// SSR 阶段访问 window，必须 dynamic import + ssr:false。
const ResponsiveGridLayoutWithWidth = dynamic(
  () =>
    import("react-grid-layout/legacy").then((m) => {
      const Responsive = m.Responsive ?? m.ResponsiveReactGridLayout;
      return m.WidthProvider(Responsive);
    }),
  { ssr: false },
);

/** RGL 布局断点：lg=桌面（12 列）、md=平板（6 列）、sm=移动（1 列纵向堆叠） */
const BREAKPOINTS = { lg: 1024, md: 640, sm: 0 };
/** F7: 细粒度网格 — 4列→12列，更精细的拼接控制 */
const COLS = { lg: 12, md: 6, sm: 1 };
/** F7: 每格高度从 80→60，配合 12 列实现更细粒度的尺寸控制 */
const ROW_HEIGHT = 60;
/** 移动端断点名称 */
type Bp = "lg" | "md" | "sm";

/** F7: 密度预设 — 控制 Widget 间距 */
type Density = "compact" | "comfortable" | "spacious";
const DENSITY_MARGIN: Record<Density, readonly [number, number]> = {
  compact: [8, 8],
  comfortable: [12, 12],
  spacious: [20, 20],
};
/** 将字符串安全转为 Density，非法值回退 comfortable */
function toDensity(v: string | undefined | null): Density {
  return v === "compact" || v === "comfortable" || v === "spacious" ? v : "comfortable";
}


/** Widget 配置映射：widgetId → 配置对象 */
type WidgetConfigs = Record<string, WidgetConfig>;

/** 导出的布局模板数据结构 */
export interface LayoutTemplate {
  layout: RGLItem[];
  widgetConfigs: WidgetConfigs;
  name?: string;
  exportedAt?: string;
}

/** DashboardGrid 暴露的命令式 API */
export interface DashboardGridHandle {
  /** 添加 Widget 到布局（追加到末尾） */
  addWidget: (widgetId: string) => void;
  /** 获取当前布局中的 Widget id 列表 */
  getLayoutIds: () => string[];
  /** 导出当前布局为模板 JSON（GET /layout/export） */
  exportLayout: () => Promise<LayoutTemplate>;
  /** 导入布局模板（POST /layout/import），成功后重新加载布局 */
  importLayout: (data: { layout: RGLItem[]; widgetConfigs?: WidgetConfigs }) => Promise<boolean>;
}

export interface DashboardGridProps {
  /** 工作区 id */
  wid: string;
  /** 当前用户角色（用于回退默认布局） */
  role: string;
  /** 当前 locale（透传给 Widget 用于 i18n） */
  locale: string;
  /** 是否处于编辑模式（由父组件控制） */
  editing: boolean;
  /** 当前布局变化回调（用于父组件感知脏状态 + 获取 widget id 列表） */
  onLayoutChange?: (layout: RGLItem[]) => void;
  /** F7: 自由排列模式（允许重叠 + 不紧凑），由父组件控制 */
  freeMode: boolean;
  /** F7: 自由模式变更回调 */
  onFreeModeChange?: (v: boolean) => void;
  /** F7: 密度预设（控制 Widget 间距），由父组件控制 */
  density: Density;
  /** F7: 密度变更回调 */
  onDensityChange?: (v: Density) => void;
}

/** GET /dashboard/layout 响应数据 */
interface LayoutResponse {
  layout: RGLItem[];
  widgetConfigs?: WidgetConfigs;
  /** F7: 自由排列模式（持久化字段） */
  freeMode?: boolean;
  /** F7: 密度预设（持久化字段） */
  density?: string;
}

/** GET /dashboard/layout/export 响应数据 */
interface ExportResponse {
  layout: RGLItem[];
  widgetConfigs: WidgetConfigs;
  name: string;
  exportedAt: string;
}

const DashboardGrid = forwardRef<DashboardGridHandle, DashboardGridProps>(function DashboardGrid(
  {
    wid,
    role,
    locale: _locale,
    editing,
    onLayoutChange,
    freeMode,
    onFreeModeChange,
    density,
    onDensityChange,
  },
  ref,
) {
  const t = useTranslations("dashboard");
  const tButton = useTranslations("button");

  const [layout, setLayout] = useState<RGLItem[]>([]);
  const [widgetConfigs, setWidgetConfigs] = useState<WidgetConfigs>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** 当前活动断点（用于判断是否移动端） */
  const [bp, setBp] = useState<Bp>("lg");
  /** F7: 拖拽中的 widget id（用于 WidgetCard dragging 视觉反馈） */
  const [draggingId, setDraggingId] = useState<string | null>(null);
  /** 是否有未保存的布局变更 */
  const dirtyRef = useRef(false);
  /** 防止 onLayoutChange 在初次加载时触发保存 */
  const initializedRef = useRef(false);

  // ─── 加载布局 ───
  const loadLayout = useCallback(async () => {
    try {
      setError(null);
      const res = await api<LayoutResponse>(`/api/v1/workspaces/${wid}/dashboard/layout`);
      setLayout(res.layout ?? []);
      setWidgetConfigs(res.widgetConfigs ?? {});
      // F7: 读取持久化的 freeMode / density，通知父组件同步状态
      if (typeof res.freeMode === "boolean" && onFreeModeChange) {
        onFreeModeChange(res.freeMode);
      }
      if (res.density && onDensityChange) {
        onDensityChange(toDensity(res.density));
      }
    } catch {
      // 加载失败回退角色默认布局，保证可用
      setLayout(getDefaultLayout(role));
      setWidgetConfigs({});
      setError(t("loadLayoutFailed"));
    } finally {
      setLoaded(true);
      initializedRef.current = true;
    }
  }, [wid, role, t, onFreeModeChange, onDensityChange]);

  useEffect(() => {
    loadLayout();
  }, [loadLayout]);

  // ─── 保存布局（编辑模式退出时触发） ───
  const saveLayout = useCallback(
    async (toSave: RGLItem[], configsToSave: WidgetConfigs) => {
      try {
        setSaving(true);
        await api(`/api/v1/workspaces/${wid}/dashboard/layout`, {
          method: "PUT",
          body: JSON.stringify({
            layout: toSave,
            widgetConfigs: configsToSave,
            // F7: 持久化自由模式与密度预设
            freeMode,
            density,
          }),
        });
        dirtyRef.current = false;
      } catch {
        setError(t("saveLayoutFailed"));
      } finally {
        setSaving(false);
      }
    },
    [wid, t, freeMode, density],
  );

  // 编辑模式退出时若有脏数据则保存
  useEffect(() => {
    if (!editing && dirtyRef.current && initializedRef.current && layout.length > 0) {
      saveLayout(layout, widgetConfigs);
    }
  }, [editing, layout, widgetConfigs, saveLayout]);

  // ─── 布局变化回调 ───
  // RGL legacy onLayoutChange 签名：(layout: Layout, layouts?: ResponsiveLayouts) => void
  // Layout = readonly LayoutItem[]，LayoutItem 含 RGL 内部附加字段，需规范化为 RGLItem
  // 用 readonly unknown[] 宽松接收，内部按 LayoutItem 形态提取字段
  const handleLayoutChange = useCallback(
    (current: readonly { i: string; x: number; y: number; w: number; h: number; minW?: number; minH?: number }[]) => {
      if (!initializedRef.current) return;
      const normalized: RGLItem[] = current.map((item) => ({
        i: item.i,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        ...(item.minW != null ? { minW: item.minW } : {}),
        ...(item.minH != null ? { minH: item.minH } : {}),
      }));
      setLayout(normalized);
      dirtyRef.current = true;
      onLayoutChange?.(normalized);
    },
    [onLayoutChange],
  );

  // ─── F7: 拖拽视觉反馈 ───
  // RGL onDragStart/onDragStop 签名：(layout, oldItem, newItem, placeholder, event, element) => void
  // newItem 类型为 LayoutItem | null，需处理 null 情况
  const handleDragStart = useCallback(
    (_current: unknown, _oldItem: unknown, newItem: { i: string } | null) => {
      if (newItem) setDraggingId(newItem.i);
    },
    [],
  );
  const handleDragStop = useCallback(() => {
    setDraggingId(null);
  }, []);

  // ─── F7: 双击标题栏循环尺寸（E4） ───
  // S(2×2) → M(4×3) → L(6×4) → XL(8×5) → S
  // 返回新尺寸标签供 WidgetCard 显示短暂提示
  const handleCycleSize = useCallback(
    (widgetId: string): string | void => {
      const item = layout.find((it) => it.i === widgetId);
      if (!item) return;
      const currentIdx = SIZE_PRESETS.findIndex((p) => p.w === item.w && p.h === item.h);
      const nextIdx = currentIdx >= 0 ? (currentIdx + 1) % SIZE_PRESETS.length : 0;
      const next = SIZE_PRESETS[nextIdx];
      setLayout((prev) =>
        prev.map((it) => (it.i === widgetId ? { ...it, w: next.w, h: next.h } : it)),
      );
      dirtyRef.current = true;
      return next.label;
    },
    [layout],
  );

  // ─── 删除 Widget ───
  const handleRemove = useCallback((id: string) => {
    setLayout((prev) => {
      const next = prev.filter((item) => item.i !== id);
      dirtyRef.current = true;
      return next;
    });
  }, []);

  // ─── 添加 Widget（追加到布局末尾） ───
  const addWidget = useCallback((widgetId: string) => {
    if (!(widgetId in WIDGET_REGISTRY)) return;
    setLayout((prev) => {
      // 已存在则不重复添加
      if (prev.some((item) => item.i === widgetId)) return prev;
      const meta = WIDGET_REGISTRY[widgetId];
      // 计算追加位置：y = 当前最大 y + 其高度（新起一行）
      const maxY = prev.reduce((acc, item) => Math.max(acc, item.y + item.h), 0);
      const newItem: RGLItem = {
        i: widgetId,
        x: 0,
        y: maxY,
        w: meta.defaultW,
        h: meta.defaultH,
        ...(meta.minW != null ? { minW: meta.minW } : {}),
        ...(meta.minH != null ? { minH: meta.minH } : {}),
      };
      dirtyRef.current = true;
      return [...prev, newItem];
    });
  }, []);

  // ─── Widget 配置变更 ───
  const handleConfigChange = useCallback((widgetId: string, nextConfig: WidgetConfig) => {
    setWidgetConfigs((prev) => ({ ...prev, [widgetId]: nextConfig }));
    dirtyRef.current = true;
  }, []);

  // ─── 导出布局 ───
  const exportLayout = useCallback(async (): Promise<LayoutTemplate> => {
    const res = await api<ExportResponse>(
      `/api/v1/workspaces/${wid}/dashboard/layout/export`,
    );
    return {
      layout: res.layout,
      widgetConfigs: res.widgetConfigs ?? {},
      name: res.name,
      exportedAt: res.exportedAt,
    };
  }, [wid]);

  // ─── 导入布局 ───
  const importLayout = useCallback(
    async (data: { layout: RGLItem[]; widgetConfigs?: WidgetConfigs }): Promise<boolean> => {
      try {
        setError(null);
        await api(`/api/v1/workspaces/${wid}/dashboard/layout/import`, {
          method: "POST",
          body: JSON.stringify({
            layout: data.layout,
            widgetConfigs: data.widgetConfigs ?? {},
          }),
        });
        // 导入成功后重新加载布局
        await loadLayout();
        return true;
      } catch {
        setError(t("saveLayoutFailed"));
        return false;
      }
    },
    [wid, loadLayout, t],
  );

  // ─── 命令式 API ───
  useImperativeHandle(
    ref,
    () => ({
      addWidget,
      getLayoutIds: () => layout.map((item) => item.i),
      exportLayout,
      importLayout,
    }),
    [addWidget, layout, exportLayout, importLayout],
  );

  // ─── 移动端：禁用拖拽 + 1 列纵向堆叠 ───
  const isMobile = bp === "sm";

  // 为 RGL 准备 layouts 对象（各断点共用同一 layout，移动端自动堆叠）
  const layouts = useMemo(() => ({ lg: layout, md: layout, sm: layout }), [layout]);

  if (!loaded) {
    return <DashboardGridSkeleton />;
  }

  if (error && layout.length === 0) {
    return (
      <div className="rounded-[var(--radius-md)] bg-[var(--danger-soft)] p-3 text-[length:var(--text-sm)] text-[var(--danger-fg)] flex items-center justify-between">
        <span>{error}</span>
        <button
          onClick={() => {
            setError(null);
            loadLayout();
          }}
          className="text-[var(--danger)] underline hover:text-[var(--danger-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
        >
          {tButton("retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      {saving && (
        <div className="absolute top-2 right-2 z-[var(--z-sticky)] px-2 py-1 rounded-[var(--radius-sm)] bg-[var(--surface)] border border-[var(--border)] text-[length:var(--text-xs)] text-[var(--meta)]">
          {t("saving")}
        </div>
      )}
      {error && (
        <div className="mb-2 text-[length:var(--text-xs)] text-[var(--danger-fg)]">{error}</div>
      )}
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- RGL legacy dynamic import 类型推断为 any，运行时 props 由 legacy 接口保证 */}
      <ResponsiveGridLayoutWithWidth
        className="layout"
        layouts={layouts}
        breakpoints={BREAKPOINTS}
        cols={COLS}
        rowHeight={ROW_HEIGHT}
        margin={DENSITY_MARGIN[density]}
        containerPadding={[0, 0]}
        isDraggable={editing && !isMobile}
        isResizable={editing && !isMobile}
        // F7: 自由模式 — 允许重叠 + 不紧凑；网格模式 — 垂直紧凑 + 不允许重叠
        compactType={freeMode ? null : "vertical"}
        preventCollision={false}
        allowOverlap={freeMode}
        // F7: 全方向拉伸手柄（编辑模式下生效，8 个方向）
        resizeHandles={["s", "w", "e", "n", "sw", "nw", "se", "ne"]}
        onLayoutChange={(current) => handleLayoutChange(current)}
        onBreakpointChange={(newBp: string) => setBp(newBp as Bp)}
        // F7: 拖拽视觉反馈
        onDragStart={handleDragStart}
        onDragStop={handleDragStop}
        useCSSTransforms
        draggableHandle=".drag-handle"
      >
        {layout.map((item) => {
          const WidgetComp = getWidgetComponent(item.i);
          const WidgetIcon = getWidgetIcon(item.i);
          const titleKey = getWidgetTitleKey(item.i);
          const title = t(titleKey);
          return (
            <div key={item.i}>
              <WidgetCard
                title={title}
                icon={WidgetIcon}
                editing={editing}
                onRemove={() => handleRemove(item.i)}
                widgetId={item.i}
                config={widgetConfigs[item.i]}
                onConfigChange={(next) => handleConfigChange(item.i, next)}
                // F7: 拖拽视觉反馈
                dragging={draggingId === item.i}
                // F7: 双击标题栏循环尺寸
                onCycleSize={() => handleCycleSize(item.i)}
              >
                <WidgetComp wid={wid} />
              </WidgetCard>
            </div>
          );
        })}
      </ResponsiveGridLayoutWithWidth>
      {layout.length === 0 && (
        <div className="py-[var(--space-12)] text-center text-[length:var(--text-sm)] text-[var(--muted)]">
          {t("emptyLayout")}
        </div>
      )}
    </div>
  );
});

export default DashboardGrid;

/** 加载骨架：与仪表盘布局占位一致 */
function DashboardGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" aria-busy="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="h-32 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] animate-pulse"
        />
      ))}
    </div>
  );
}
