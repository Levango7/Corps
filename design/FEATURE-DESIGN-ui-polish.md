# UI 打磨 — 功能设计方案

> **项目**: corps · 团队协作平台
> **技术栈**: Next.js 16.3 (App Router) + React 19.2 + Tailwind v4.3 + Prisma 6 + better-auth + Stripe
> **设计语言**: Calm Precision（克制精密）— Notion 留白 + Linear 精度 + Stripe 克制
> **状态**: 设计阶段
> **优先级**: P0（1 周）→ P1（1–2 周）→ P2（1–2 周）

---

## 1. 概述

### 1.1 设计理念（vivo Origin OS / OPPO ColorOS 灵感）

当前 corps 已具备完整的 design token 系统、暖度调节 / 主题色 / 动画切换（F6）、Widget 仪表盘自由拼接布局（F7）。本方案在此基础上，借鉴 vivo Origin OS 与 OPPO ColorOS 的设计理念，将产品从"可用"打磨至"好用且耐玩"：

| 理念 | 内涵 | 在 corps 中的落地 |
|------|------|-------------------|
| **丝滑动效** | 所有交互都有过渡动画，页面切换有 shared element transition | framer-motion `AnimatePresence` + `layoutId`，列表 `layout` prop 自动编排 |
| **层级感** | 卡片有微妙的阴影层级，hover / press 有深度变化 | 复用现有 `--elev-sm/md/lg/hover` token 体系，hover 时 `translateY(-1px)` + 阴影递进 |
| **呼吸感** | 加载状态用 shimmer / skeleton 而非 spinner，错误状态有优雅的空状态 | Skeleton 组件升级为 shimmer 渐变扫光；EmptyState 已有 6 种插画，增加入场动画 |
| **可玩性** | 拖拽磁吸、长按浮窗菜单、手势支持 | F7 DashboardGrid 拖拽释放弹簧吸附；WidgetCard 长按浮窗；pinch / swipe 手势 |

**设计原则**：

1. **克制优先** — 动画服务于交互反馈，不为动而动。每个动画必须有明确的交互语义（入场 / 退场 / 状态切换 / 反馈）。
2. **token 驱动** — 所有颜色走 `var(--token)`，所有动画时长走 `var(--motion-*)`，所有缓动走 `var(--ease-*)`。禁止裸值。
3. **可访问性不可妥协** — 所有动画尊重 `prefers-reduced-motion`（项目已有全局降级块，见 §1.3）。焦点环 `var(--focus-ring)` 不可移除。
4. **性能优先** — 只动画 `transform` / `opacity`，避免触发 layout / paint。合理使用 `will-change`，用后即焚。
5. **SSR 安全** — framer-motion 仅在客户端组件（`"use client"`）中使用，不影响 SSG / SSR 输出与首屏 LCP。

### 1.2 技术选型

| 能力 | 选型 | 理由 |
|------|------|------|
| 声明式动画 / shared layout / gesture | **framer-motion v11** | React 19 兼容；`AnimatePresence` + `layoutId` 是实现 shared element transition 的最短路径；`useMotionValue` + `drag` 内置手势；tree-shaking 后按需引入 |
| 骨架屏 shimmer | **自研 Skeleton 组件升级** | 现有 `Skeleton.tsx` 用 `animate-pulse`（透明度脉动），升级为 shimmer 渐变扫光，零新增依赖 |
| Ripple 涟漪 | **自研 Ripple 组件** | 纯 CSS + 1 个 `useRef`，无需依赖；尊重 `prefers-reduced-motion` |
| 拖拽磁吸 | **framer-motion `spring` + RGL `onDragStop`** | 在 react-grid-layout 释放回调中叠加弹簧物理吸附，复用现有 F7 布局基础设施 |
| 手势 | **framer-motion `drag` / `useMotionValue` / `useTransform`** | pinch-to-zoom 用双指 `useMotionValue` 距离计算；swipe-to-dismiss 用 `drag="x"` + `dragConstraints` |

**framer-motion 版本与 bundle 影响**（详见 §5.1）：
- 版本：`framer-motion@^11`（React 19 兼容，需 `motion@^11` 或 `framer-motion@^11`）
- gzip 后核心约 **~15 KB**（仅 `motion` + `AnimatePresence` + `layout`）；按需 `import { motion, AnimatePresence } from "framer-motion"` 触发 tree-shaking
- 通过 `next/dynamic` + `"use client"` 隔离，不进入 SSR bundle

### 1.3 与现有 design token 系统的关系

项目已有完备的 design token 系统（`design/design-tokens.css`，397 行），本方案 **不新建并行 token 体系**，而是复用并少量补充：

**直接复用（无需新增）**：

| Token 类别 | 现有 token | 用途 |
|------------|-----------|------|
| 动画时长 | `--motion-fast` (120ms) / `--motion-base` (150ms) / `--motion-slow` (220ms) / `--motion-enter` (420ms) | 微交互 / 状态切换 / 模态 / 页面入场 |
| 缓动 | `--ease-standard` `cubic-bezier(0.2,0,0,1)` / `--ease-out` `cubic-bezier(0.16,1,0.3,1)` | 标准过渡 / 退场减速 |
| 阴影层级 | `--elev-flat` / `--elev-ring` / `--elev-sm` / `--elev-md` / `--elev-lg` / `--elev-hover` | 卡片层级 / hover 抬升 |
| 间距 | `--space-1` ~ `--space-20` (4px 网格) | 动画位移量 |
| 圆角 | `--radius-sm` (8) / `--radius-md` (10) / `--radius-lg` (14) / `--radius-xl` (16) / `--radius-pill` | |
| 层级 | `--z-base` / `--z-dropdown` (1000) / `--z-sticky` (1100) / `--z-modal` (1200) / `--z-toast` (1300) / `--z-cmd` (1400) | 浮窗菜单 / Toast 层叠 |
| 焦点环 | `--focus-ring` `0 0 0 3px var(--accent-ring)` | 所有可交互元素 |
| 交互态背景 | `--hover-soft` | hover 微蓝灰 |

**已有动画偏好降级（无需新增）**：

`design-tokens.css` 末尾及 `globals.css` 均已包含全局 `prefers-reduced-motion: reduce` 降级块：

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;       /* 0.01ms 而非 0s：兼容性 */
    animation-iteration-count: 1 !important;      /* 停止循环动画无限迭代 */
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

> 来源：经验 `2026-09-11-prefers-reduced-motion-global-block-and-max-duration` — `0.01ms` 是业界通用值（部分浏览器对 `0s` 有兼容性问题）；`animation-iteration-count: 1` 停止循环动画的无限迭代。

此外，项目已有 `[data-motion="reduced|standard|enhanced"]` 三档动画开关（F6），覆盖 `--motion-*` token。framer-motion 侧需通过 `useReducedMotion()` hook 与此联动（见 §5.2）。

**需新增的 token（少量补充，追加到 `design-tokens.css` `:root`）**：

```css
/* —— UI 打磨补充 token —— */
/* shimmer 扫光渐变基准色（浅色：从左到右的高光扫过） */
--shimmer-from:  color-mix(in srgb, var(--surface-2) 100%, transparent);
--shimmer-to:    color-mix(in srgb, var(--surface-3) 100%, transparent);
--shimmer-hi:    color-mix(in srgb, var(--surface) 60%, var(--p-accent) 4%);

/* ripple 涟漪色（accent 极淡） */
--ripple:        color-mix(in srgb, var(--accent) 12%, transparent);

/* 弹簧物理（framer-motion spring config 复用） */
--spring-stiffness: 300;
--spring-damping:   30;

/* 3D 翻转透视 */
--perspective-card: 1000px;
```

深色模式补充（`[data-theme="dark"]`）：

```css
--shimmer-hi: color-mix(in srgb, var(--surface-3) 70%, var(--p-accent) 8%);
--ripple:     color-mix(in srgb, var(--accent) 16%, transparent);
```

> **token 变更流程**：所有新增 token 集中在 `design-tokens.css` 定义层，经 `predev` / `prebuild` 脚本自动同步至 `web/app/design-tokens.css`。组件层只引用 `var(--token)`，禁止裸值。
> 来源：经验 `2026-09-10-dead-design-token-grep-confirm-multi-source-delete` — token 唯一定义层原则，消费侧 `grep -rn "var(--<token>)"` 确认引用。

---

## 2. P0: 丝滑基础（1 周）

### 2.1 页面切换动画

**目标**：列表 → 详情的页面切换有 shared element transition，标题 / 缩略图从列表位置平滑过渡到详情页头部，而非生硬的路由跳转。

#### 技术方案：framer-motion `AnimatePresence` + `layoutId`

```
列表项（layoutId="task-title-{id}"）
    ↓ 点击
详情页头部（layoutId="task-title-{id}"）  ← framer-motion 自动编排 shared transition
```

framer-motion 的 `layoutId` 机制：两个不同组件树中相同 `layoutId` 的 `motion.*` 元素，在 `AnimatePresence` 包裹下会自动计算位置 / 尺寸差异，生成平滑过渡动画。无需手动测量 DOM。

#### 适用场景

| 场景 | shared 元素 | 路由 |
|------|------------|------|
| 任务列表 → 任务详情 | 任务标题、状态图标、优先级标签 | `/[locale]/w/[wid]/tasks` → 详情抽屉 |
| 文档列表 → 文档编辑器 | 文档标题、图标 | `/[locale]/w/[wid]/documents` → 编辑器 |
| 看板卡片 → 卡片详情 | 卡片标题、标签 | 看板列内卡片 → 详情弹层 |
| Widget 仪表盘 → Widget 全屏 | Widget 标题、图标 | Dashboard → 全屏 Widget |

#### 实现方案：Next.js App Router 集成

Next.js 16 App Router 的路由切换是 Server Component 级别的，framer-motion 需在客户端侧接管过渡。方案：

**1. `PageTransition` 客户端包裹组件**（新增 `web/components/PageTransition.tsx`）：

```tsx
"use client";
import { motion, AnimatePresence } from "framer-motion";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}  // var(--ease-standard) 对应值
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
```

> **注意**：`transition.duration` 不能直接引用 CSS `var()`（framer-motion 在 JS 侧解析数值）。需通过 `useMotionConfig` 或常量映射 token 值（见 §5.2 token 桥接）。

**2. Shared element 示例**（任务列表项 → 详情）：

列表项：
```tsx
<motion.h3 layoutId={`task-title-${task.id}`} className="...">
  {task.title}
</motion.h3>
```

详情页头部：
```tsx
<motion.h1 layoutId={`task-title-${task.id}`} className="...">
  {task.title}
</motion.h1>
```

当详情页在 `AnimatePresence` 内挂载时，framer-motion 自动匹配 `layoutId`，将标题从列表位置 / 尺寸平滑过渡到详情头部。

**3. 路由集成点**：在 `web/app/[locale]/w/[wid]/layout.tsx` 的内容区包裹 `<PageTransition>`。侧栏 / 顶栏不参与（保持固定）。

#### 性能考量

| 维度 | 策略 |
|------|------|
| SSR 兼容 | `PageTransition` 是 `"use client"`，其 `children`（Server Component）正常 SSR。framer-motion 仅在 hydration 后接管过渡，首屏 HTML 不受影响 |
| Bundle size | `motion` + `AnimatePresence` tree-shake 后 gzip ~15 KB。通过 `dynamic import` 懒加载到客户端 bundle |
| 首屏 LCP | `PageTransition` 的 `initial` 状态在 hydration 前不应用（SSR 输出完整 HTML），避免首屏白屏 |
| layout 抖动 | `layoutId` 过渡期间 framer-motion 自动设置 `position: relative` + `will-change: transform`，过渡结束即焚。不会持续触发 layout |
| `mode="wait"` | 旧页面 exit 完成后再 enter 新页面，避免两层重叠导致的布局抖动。代价是过渡稍慢（exit + enter 串行）。对任务详情等抽屉式切换可用 `mode="popLayout"`（旧元素退出布局流，新元素同时入场） |

### 2.2 列表布局动画

**目标**：列表项增删时，剩余项自动平滑让位，而非生硬地跳到新位置。

#### 技术方案：framer-motion `layout` prop

```tsx
<LayoutGroup>
  {items.map((item) => (
    <motion.li key={item.id} layout="position" transition={{ duration: 0.22, ease: [0.2,0,0,1] }}>
      {item.content}
    </motion.li>
  ))}
</LayoutGroup>
```

- `layout="position"`：仅动画位置（不动画尺寸），适合等高列表项，性能最优
- `layout`（全量）：位置 + 尺寸都动画，适合卡片网格（尺寸可能变化）
- `LayoutGroup`：将多个 `layout` 元素编组，共享同一编排上下文，避免跨组误匹配

#### 适用场景

| 场景 | 触发 | 组件位置 |
|------|------|---------|
| 任务列表 | 勾选完成（移到底部）/ 删除 / 新增 | `web/app/[locale]/w/[wid]/tasks/page.tsx` |
| 文档列表 | 新建 / 删除 / 重命名排序 | `web/components/DocumentListView.tsx` |
| 通知列表 | 标记已读（移除）/ 清空 | Toast / 通知中心 |
| 看板列 | 卡片拖拽跨列 / 新增卡片 | `web/components/board-parts.tsx` |
| Widget 仪表盘 | 添加 / 删除 Widget | `web/components/dashboard/DashboardGrid.tsx`（RGL 已有过渡，可叠加 framer-motion） |

#### 实现方案

**1. 列表项增删 `AnimatePresence`**：

```tsx
<LayoutGroup>
  <AnimatePresence initial={false}>
    {items.map((item) => (
      <motion.li
        key={item.id}
        layout="position"
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      >
        <ItemContent {...item} />
      </motion.li>
    ))}
  </AnimatePresence>
</LayoutGroup>
```

- `initial={false}`：首次渲染不动画（避免首屏所有列表项依次入场）
- `height: "auto"`：framer-motion 自动测量目标高度，删除时收折到 0
- `exit` + `AnimatePresence`：删除项先淡出收折，剩余项 `layout` 自动让位

**2. 看板跨列拖拽**：`board-parts.tsx` 的卡片在跨列时，源列 `exit` 收折，目标列 `initial` 展开，两列同时 `layout` 重排。

#### 性能考量

- `layout` 依赖 framer-motion 的 `useLayoutEffect` 测量，在 commit 阶段同步读取 DOM 位置，不会产生可见的中间帧
- 列表项 > 50 条时，考虑虚拟化（`react-window`）+ 仅对可见区 `layout`。当前任务列表默认分页，单页 ≤ 50 条，无需虚拟化
- `layout="position"` 比 `layout` 轻量（跳过尺寸测量），等高列表优先使用

### 2.3 骨架屏

**目标**：将所有 spinner 替换为 shimmer skeleton，加载完成时无布局跳动。

#### 现状

项目已有 `web/components/Skeleton.tsx`，导出 `Skeleton`（基础块）、`TaskListSkeleton`、`StatCardSkeleton`。当前用 Tailwind `animate-pulse`（透明度脉动 0.5 ↔ 1），视觉上是"呼吸"而非"扫光"。

#### 设计方案：shimmer 渐变扫光

**升级方向**：从 `animate-pulse`（透明度脉动）升级为 shimmer（高光从左到右扫过），更接近 Linear / Stripe 的加载质感。

**1. shimmer keyframes**（追加到 `globals.css`）：

```css
@keyframes shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.shimmer {
  background: linear-gradient(
    90deg,
    var(--shimmer-from) 25%,
    var(--shimmer-hi)  50%,
    var(--shimmer-to)   75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.6s var(--ease-standard) infinite;
}
```

> `prefers-reduced-motion` 全局降级块已将 `animation-iteration-count` 设为 1、`animation-duration` 设为 0.01ms，shimmer 自动降级为静态占位，无需额外处理。

**2. Skeleton 组件升级**（`web/components/Skeleton.tsx`）：

```tsx
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      style={style}
      className={`shimmer rounded-[var(--radius-sm)] ${className ?? ""}`}
    />
  );
}
```

将 `animate-pulse bg-[var(--surface-2)]` 替换为 `shimmer`（渐变背景已含 base 色）。

#### 需要替换的组件列表

| 组件 | 当前加载态 | 替换为 | 位置 |
|------|-----------|--------|------|
| 概览页统计卡片 | `StatCardSkeleton`（已有） | 升级为 shimmer | `app/[locale]/w/[wid]/page.tsx` |
| 概览页最近任务 | `TaskListSkeleton`（已有） | 升级为 shimmer | 同上 |
| DashboardGrid | `DashboardGridSkeleton`（已有） | 升级为 shimmer | `components/dashboard/DashboardGrid.tsx` |
| 文档列表 | spinner | `DocumentListSkeleton`（新增） | `components/DocumentListView.tsx` |
| 看板列 | spinner | `BoardColumnSkeleton`（新增） | `components/board-parts.tsx` |
| 任务详情抽屉 | 无（直接空） | `TaskDetailSkeleton`（新增） | 任务详情组件 |
| Widget 内容 | 各 Widget 内部 spinner | 各 Widget 专属 skeleton | `components/dashboard/widgets/` |

#### 组件 API 设计：Skeleton 组件

```tsx
/** 基础 shimmer 块 */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }): JSX.Element;

/** 任务列表骨架 */
export function TaskListSkeleton({ count?, className? }: { count?: number; className?: string }): JSX.Element;

/** 统计卡片骨架 */
export function StatCardSkeleton({ className? }: { className?: string }): JSX.Element;

/** 文档列表骨架（新增） */
export function DocumentListSkeleton({ count?, className? }: { count?: number; className?: string }): JSX.Element;

/** 看板列骨架（新增） */
export function BoardColumnSkeleton({ count?, className? }: { count?: number; className?: string }): JSX.Element;

/** 任务详情骨架（新增） */
export function TaskDetailSkeleton({ className? }: { className?: string }): JSX.Element;

/** 通用圆形骨架（头像 / 图标位） */
export function CircleSkeleton({ size, className? }: { size: number; className?: string }): JSX.Element;
```

每个预设骨架与对应正式组件的尺寸 / 间距 **逐像素对齐**，确保加载 → 加载完成无布局跳动。骨架项宽度在 60%–95% 间错落（`maxWidth: ${60 + ((i * 37) % 36)}%`），避免机械感（现有 `TaskListSkeleton` 已采用此策略）。

### 2.4 Toast / 通知动画

**目标**：Toast 滑入 / 淡出 / 缩放，有物理感而非生硬显隐。

#### 现状

`web/components/Toast.tsx` 使用 CSS `fade-in` 类（`opacity 0→1 + translateY 4px→0`），无退场动画（直接从 DOM 移除）。

#### 动画曲线设计

| 阶段 | 动画 | 时长 | 缓动 |
|------|------|------|------|
| 入场 | `x: 100% → 0`（从右侧滑入）+ `opacity: 0 → 1` | `var(--motion-slow)` 220ms | `var(--ease-out)` `cubic-bezier(0.16,1,0.3,1)`（减速出场） |
| 退场 | `x: 0 → 100%`（向右滑出）+ `opacity: 1 → 0` + `scale: 1 → 0.9` | `var(--motion-base)` 150ms | `var(--ease-standard)` |
| hover 暂停 | 无动画（暂停自动关闭计时器，已有逻辑） | — | — |
| 多 Toast 堆叠 | 新 Toast 入场时，已有 Toast `layout` 自动上移让位 | `var(--motion-base)` | `var(--ease-standard)` |

#### 实现方案

升级 `Toast.tsx` 为 framer-motion：

```tsx
<AnimatePresence>
  {toasts.map((t) => (
    <motion.div
      key={t.id}
      layout                    // 堆叠时自动让位
      initial={{ x: "100%", opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: "100%", opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      // ... 现有样式 / 事件
    >
      {t.message}
    </motion.div>
  ))}
</AnimatePresence>
```

- `layout`：新 Toast 入场时，已有 Toast 平滑上移
- `exit`：退场动画完成后才从 DOM 移除（`AnimatePresence` 保证）
- `x: "100%"`：相对于自身宽度，从右侧滑入

**保留现有逻辑**：hover 暂停 / 恢复计时器、动态相对时间显示、`aria-live="polite"` 无障碍属性均不变。

---

## 3. P1: 精致交互（1–2 周）

### 3.1 空状态设计

**目标**：每个空状态有插画 + 引导文案 + CTA，让用户知道"为什么是空的"和"接下来做什么"。

#### 现状

`web/components/EmptyState.tsx` 已有 6 种内联 SVG 插画（`inbox` / `folder` / `search` / `chart` / `calendar` / `users`），API 完整（`type` / `title` / `description` / `action` / `className`）。插画用 `currentColor` 继承文字颜色，暗色模式自动适配。

#### 增强方向

**1. 入场动画**：EmptyState 挂载时插画 + 文案依次淡入（stagger），有"被呈现"的仪式感而非生硬出现：

```tsx
<motion.div
  initial="hidden"
  animate="visible"
  variants={{
    hidden: {},
    visible: { transition: { staggerChildren: 0.06 } },
  }}
>
  <motion.div variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}>
    <Illustration />
  </motion.div>
  <motion.p variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}>{title}</motion.p>
  {description && <motion.p variants={...}>{description}</motion.p>}
  {action && <motion.div variants={...}>{action}</motion.div>}
</motion.div>
```

**2. 插画微动效**：插画挂载后 2s，主元素轻微浮动（`y: 0 → -2px → 0`，2s 循环），营造"呼吸感"。`prefers-reduced-motion` 下自动停止。

**3. 扩展插画类型**（按需新增）：

| 新增 type | 插画 | 适用场景 |
|-----------|------|---------|
| `network` | 断链 / 云离线 | 网络错误 |
| `permission` | 锁 + 禁止符号 | 无权限 |
| `trash` | 空回收站 | 回收站为空 |
| `filter` | 漏斗 + 无匹配 | 筛选无结果 |

#### 每个空状态的插画 + 文案 + CTA 设计

| 场景 | type | title | description | CTA |
|------|------|-------|-------------|-----|
| 任务列表为空 | `inbox` | "暂无任务" | "创建第一个任务，开始团队协作" | "新建任务" → 打开 NewTaskDialog |
| 文档列表为空 | `folder` | "暂无文档" | "创建文档，沉淀团队知识" | "新建文档" → 跳转编辑器 |
| 搜索无结果 | `search` | "未找到匹配结果" | "尝试调整关键词或筛选条件" | "清除筛选" |
| 看板为空 | `chart` | "看板暂无卡片" | "添加任务并拖入看板" | "添加任务" |
| 日历无日程 | `calendar` | "今日无日程" | "查看未来 7 天安排" | "切换视图" |
| 成员列表为空 | `users` | "暂无成员" | "邀请队友加入工作区" | "邀请成员" |
| 回收站为空 | `trash` | "回收站为空" | "删除的内容会暂存于此" | — |
| 网络错误 | `network` | "网络连接中断" | "请检查网络后重试" | "重试" |
| 无权限 | `permission` | "无访问权限" | "联系管理员申请权限" | — |

#### 组件 API：EmptyState 组件（增强）

```tsx
interface EmptyStateProps {
  type: EmptyStateType;            // 现有 6 种 + 新增 4 种
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
  /** 新增：是否启用入场 stagger 动画（默认 true） */
  animate?: boolean;
  /** 新增：插画尺寸（默认 64，可选 48 / 80） */
  illustrationSize?: 48 | 64 | 80;
}
```

### 3.2 微交互

**目标**：按钮 / 图标的每一次交互都有即时视觉反馈，手感"跟手"。

#### 按钮 ripple effect

**自研 Ripple 组件**（`web/components/Ripple.tsx`），无额外依赖：

```tsx
"use client";
import { useRef, useCallback } from "react";

export function Ripple({ children, className }: { children: ReactNode; className?: string }) {
  const ripplesRef = useRef<{ x: number; y: number; id: number }[]>([]);
  // 点击时在点击位置生成涟漪，animationend 后移除
  // ...
  return (
    <span className={`relative overflow-hidden ${className ?? ""}`} onClick={handleClick}>
      {children}
      {ripples.map((r) => (
        <span
          key={r.id}
          className="absolute rounded-full bg-[var(--ripple)] pointer-events-none"
          style={{ left: r.x, top: r.y, /* 扩散动画 */ }}
        />
      ))}
    </span>
  );
}
```

**ripple CSS**（追加到 `globals.css`）：

```css
@keyframes ripple-expand {
  from { transform: scale(0); opacity: 1; }
  to   { transform: scale(4); opacity: 0; }
}
.ripple-dot {
  animation: ripple-expand var(--motion-base) var(--ease-out) forwards;
  width: 8px;
  height: 8px;
  margin: -4px 0 0 -4px;
}
```

**应用范围**：所有主要按钮（accent solid / outline / ghost）。通过 `Button` 组件统一接入（若项目有 Button 抽象），或在各按钮 className 中加 `ripple` 标记。

> `prefers-reduced-motion` 下降级：ripple 仍出现但无扩散动画（`animation-duration: 0.01ms`），仅闪现一下反馈。

#### 图标 hover bounce

可交互图标（如刷新 / 收藏 / 更多）hover 时轻微弹跳：

```css
.icon-bounce {
  transition: transform var(--motion-fast) var(--ease-out);
}
.icon-bounce:hover {
  transform: scale(1.1);
}
.icon-bounce:active {
  transform: scale(0.92);
}
```

- hover `scale(1.1)`：放大 10%，提示可点击
- active `scale(0.92)`：按下收缩，模拟物理按压
- 用 `transform` 不触发 layout

#### hover 深度变化（translateZ + shadow）

卡片 hover 时的"被托起"深度感。项目已有 `.card-lift` 类（`translateY(-1px)` + `elev-md`），增强为更细腻的层级递进：

```css
.card-lift {
  transition: transform var(--motion-base) var(--ease-out),
              box-shadow var(--motion-base) var(--ease-out);
  will-change: transform;             /* hover 频繁，提前 hint */
}
.card-lift:hover {
  transform: translateY(-2px);        /* 从 -1px 加到 -2px，更明显的抬升 */
  box-shadow: var(--elev-hover);      /* 0 6px 18px ... 专用 hover 阴影 */
}
.card-lift:active {
  transform: translateY(0);           /* 按下回沉 */
  box-shadow: var(--elev-sm);         /* 阴影收回 */
}
```

> `will-change: transform` 在 hover 频繁的卡片上合理。对非交互卡片不加，避免内存占用。

**press 深度**（移动端 / 触屏）：`:active` 时 `scale(0.98)` + 阴影收回，模拟"按入"。

### 3.3 磁吸拖拽

**目标**：F7 DashboardGrid 拖拽释放时，Widget 弹簧吸附到最近网格位，有"啪嗒"的物理手感。

#### 现状

`DashboardGrid.tsx` 使用 react-grid-layout v2 legacy，拖拽时 RGL 内部处理位置计算，`onDragStop` 后直接 snap 到网格。已有拖拽视觉反馈（`scale-[1.02]` + `elev-md` + `opacity-90`）。

#### F7 DashboardGrid 增强

RGL 的 snap 是瞬时的（释放即跳到网格位）。磁吸增强在 RGL 的 `onDragStop` 与最终 snap 之间插入一段弹簧过渡：

**方案**：在 `onDragStop` 回调中，先让 WidgetCard 用 framer-motion `spring` 过渡到目标网格位，过渡完成后再提交 layout 给 RGL。

```tsx
const handleDragStop = useCallback(
  (_current: unknown, _oldItem: unknown, newItem: { i: string; x: number; y: number } | null) => {
    if (!newItem) return;
    // 计算目标网格位的像素坐标
    const targetPx = gridToPixel(newItem.x, newItem.y);
    // 触发 WidgetCard 的弹簧过渡到 targetPx
    setMagneticTarget({ id: newItem.i, ...targetPx });
    // 弹簧过渡完成后（onSpringEnd）再 setDraggingId(null)
  },
  [],
);
```

#### 弹簧物理动画（spring config）

framer-motion `spring` 配置，复用 token：

```tsx
const SPRING_CONFIG = {
  stiffness: 300,    // var(--spring-stiffness)
  damping: 30,       // var(--spring-damping)
  mass: 1,
};
// 弹簧略带过冲（damping < critical），有"弹一下"的手感
// critical damping = 2 * sqrt(stiffness * mass) ≈ 34.6
// damping 30 < 34.6 → 轻微欠阻尼，会过冲一格再回弹
```

**WidgetCard 磁吸过渡**：

```tsx
<motion.div
  animate={{ x: magneticTarget.x, y: magneticTarget.y }}
  transition={{ type: "spring", ...SPRING_CONFIG }}
  onAnimationComplete={() => setDraggingId(null)}
>
  <WidgetCard ... />
</motion.div>
```

**边界处理**：
- 移动端（`bp === "sm"`）禁用磁吸（移动端无拖拽）
- `freeMode`（自由排列）下不磁吸（允许任意位置）
- `prefers-reduced-motion` 下直接 snap（无弹簧），由全局降级块保证

### 3.4 暗色模式优化

**目标**：确保所有组件在深色模式下对比度达标（WCAG AA 4.5:1 文本，3:1 交互元素）。

#### 对比度审计清单

项目已有 `[data-theme="dark"]` 完整 token 覆盖（`design-tokens.css` L248–292）。需审计的是 **组件层硬编码色值** 与 **soft 背景上的前景色**。

| 审计项 | 检查内容 | 工具 |
|--------|---------|------|
| 裸 hex 残漏 | 组件 / 页面中是否残留裸 `#` 色值（应全走 `var(--token)`） | `grep -rn "#[0-9a-fA-F]{3,8}" web/components web/app --include="*.tsx" --exclude-dir=node_modules` |
| soft 背景 + 前景对比 | `--*-soft` 背景上的文字是否达 4.5:1 | 浏览器 DevTools Contrast checker |
| 边框可见性 | 深色下 `--border` (#2A2A2E) 在 `--surface` (#1A1A1E) 上的对比是否达 3:1 | 计算 |
| 焦点环可见性 | `--accent-ring` (rgba(91,126,245,0.40)) 在深色背景上是否可辨 | 视觉 + 对比 |
| 阴影层级 | 深色下阴影极弱（`rgba(0,0,0,0.36~0.56)`），是否靠 1px 边框充分分隔 | 视觉 |
| 图标 / 占位 | `--meta` (#6A6A62) 在 `--surface` 上的对比 | 计算（约 3.2:1，达 3:1 非文本标准） |

#### 修复方案

**1. 裸 hex 清理**：对 grep 命中的组件，替换为 `var(--token)`。已知 `globals.css` 中 `--success-fg` / `--warn-fg` / `--danger-fg` 在 `:root` 用裸 hex（#055a40 等），这是 **primitive 补充声明**（soft 背景前景色，design-tokens 未覆盖），属合理例外，保留。

**2. soft 前景对比**：深色下 `--success-fg: #6ee7b7` 在 `--success-soft`（`color-mix(success 12%, transparent)`）上对比约 7:1，达标。同理 `--warn-fg` / `--danger-fg` 已在 `[data-theme="dark"]` 提亮。

**3. 边框对比**：`--border` #2A2A2E 在 `--surface` #1A1A1E 上对比约 1.4:1，**低于 3:1**。但深色模式设计意图是"靠亮度递进表达层级，阴影极弱，靠 1px 边框分隔"——边框的作用是分隔而非高对比。若审计要求 3:1，可微调 `--p-border` 至 `#333338`（对比约 1.8:1），但会改变深色质感。**建议保持现状**，在审计报告中注明设计决策。

**4. 新增组件的暗色适配**：本方案所有新增组件（Ripple / PageTransition / 长按浮窗等）必须只用 `var(--token)`，由 token 系统自动适配深色。禁止在组件内写 `[data-theme="dark"]` 分支。

---

## 4. P2: 高级可玩性（1–2 周）

### 4.1 长按浮窗菜单

**目标**：长按任务 / 文档 / Widget 卡片 500ms，弹出快捷操作浮窗菜单（复制 / 删除 / 归档 / 分享），松手或点击外部关闭。

#### 技术方案

framer-motion `whileTap` + 自定义 `useLongPress` hook：

```tsx
function useLongPress(callback: () => void, delay = 500) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // onPressStart 启动 timer，onPressEnd 清除
  // timer 到期触发 callback
}
```

**浮窗菜单组件**（`web/components/QuickActionMenu.tsx`）：

```tsx
<motion.div
  initial={{ opacity: 0, scale: 0.8, y: 8 }}
  animate={{ opacity: 1, scale: 1, y: 0 }}
  exit={{ opacity: 0, scale: 0.8, y: 8 }}
  transition={{ type: "spring", stiffness: 400, damping: 28 }}
  className="absolute z-[var(--z-dropdown)] ... "
>
  {actions.map((action) => (
    <button onClick={action.onClick} className="...">
      <action.icon size={16} />
      {action.label}
    </button>
  ))}
</motion.div>
```

- 长按 500ms 触发，浮窗从长按位置弹出（spring 入场）
- 浮窗 `z-index: var(--z-dropdown)` (1000)，高于卡片
- 点击外部 / Esc 关闭（`useClickOutside` + `useEscapeKey`）
- 移动端：长按是原生上下文菜单手势，需 `onContextMenu` 阻止默认 + 触发浮窗

#### 适用场景

| 对象 | 快捷操作 |
|------|---------|
| 任务卡片 | 完成 / 复制 / 归档 / 删除 / 分享 |
| 文档项 | 打开 / 重命名 / 移动 / 删除 / 分享 |
| Widget 卡片 | 配置 / 全屏 / 删除 / 刷新 |

### 4.2 卡片 3D 翻转

**目标**：WidgetCard 点击配置按钮时，卡片 3D 翻转露出配置面板，而非弹出浮层。

#### 现状

`WidgetCard.tsx` 配置面板当前是条件渲染弹出（`configOpen && <WidgetConfigPanel />`）。

#### 技术方案

framer-motion `rotateY` + CSS `perspective`：

```tsx
<div style={{ perspective: "var(--perspective-card)" }}>  {/* 1000px */}
  <motion.div
    animate={{ rotateY: configOpen ? 180 : 0 }}
    transition={{ duration: 0.5, ease: [0.2, 0, 0, 1] }}
    style={{ transformStyle: "preserve-3d" }}
    className="relative"
  >
    {/* 正面：Widget 内容 */}
    <div style={{ backfaceVisibility: "hidden" }} className="absolute inset-0">
      <WidgetFront />
    </div>
    {/* 背面：配置面板 */}
    <div style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }} className="absolute inset-0">
      <WidgetConfigPanel />
    </div>
  </motion.div>
</div>
```

- `perspective: 1000px`（`var(--perspective-card)`）：观察距离，值越小透视越强
- `transformStyle: preserve-3d`：子元素保留 3D 变换
- `backfaceVisibility: hidden`：翻转时背面不可见
- `rotateY: 0 → 180`：正面翻转到背面

**边界**：
- `prefers-reduced-motion` 下降级为直接切换（无翻转），由全局降级块保证
- 移动端 `perspective` 可能性能不佳，降级为 slide 过渡
- 翻转期间禁用正面交互（`pointer-events: none`）

### 4.3 手势支持

**目标**：pinch-to-zoom（Widget 内容缩放）/ swipe-to-dismiss（通知 / 卡片横滑删除）。

#### pinch-to-zoom

framer-motion 双指 `useMotionValue` 距离计算：

```tsx
const scale = useMotionValue(1);
// onTouchStart 记算双指距离 d0
// onTouchMove 计算当前距离 d，scale.set(d / d0)
// 限制 scale 范围 [0.5, 2]
<motion.div style={{ scale }}>
  <WidgetContent />
</motion.div>
```

适用：Widget 内容区（图表 / 长列表）、文档预览。双指捏合缩小、张开放大。

#### swipe-to-dismiss

framer-motion `drag="x"` + 释放阈值：

```tsx
<motion.li
  drag="x"
  dragConstraints={{ left: 0, right: 0 }}    // 松手回弹
  dragElastic={0.7}
  onDragEnd={(_, info) => {
    if (info.offset.x > 100 || info.velocity.x > 500) {
      onDismiss();  // 横滑超过 100px 或速度 > 500px/s → 删除
    }
  }}
  whileDrag={{ scale: 0.98 }}
>
  <NotificationContent />
</motion.li>
```

适用：通知列表项（横滑删除）、看板卡片（横滑跨列，与现有拖拽互补）。

**边界**：
- 移动端优先（桌面用鼠标拖拽即可）
- `drag` 与列表 `layout` 动画兼容（framer-motion 内部协调）
- swipe 过程中显示背景删除提示（红色"删除"文字渐显）

### 4.4 页面视差

**目标**：滚动时页面元素有微妙的视差移动，营造深度感。

#### 技术方案

framer-motion `useScroll` + `useTransform`：

```tsx
const { scrollY } = useScroll();
const y1 = useTransform(scrollY, [0, 300], [0, -20]);    // 背景层慢移
const y2 = useTransform(scrollY, [0, 300], [0, -10]);    // 中景层
// 前景层不移动

<motion.div style={{ y: y1 }} className="absolute inset-0 -z-10">{backgroundPattern}</motion.div>
<motion.div style={{ y: y2 }}>{middleContent}</motion.div>
```

适用：
- 概览页：顶部统计卡片与背景纹理有 2px 视差
- 文档编辑器：标题区与正文有微妙视差
- 营销 / Landing 页：大幅视差（背景 30px / 中景 15px / 前景 0）

**克制原则**：应用内（工作区）视差极轻（≤ 10px），避免干扰阅读。营销页可加重。

**性能**：`useScroll` + `useTransform` 基于 `requestAnimationFrame`，且只写 `transform`（`y` 映射到 `translateY`），不触发 layout / paint。

---

## 5. 技术选型

### 5.1 framer-motion

#### 版本、bundle size、SSR 兼容性

| 维度 | 详情 |
|------|------|
| 版本 | `framer-motion@^11`（或 `motion@^11`，新包名）。React 19 兼容（framer-motion v11+ 支持 React 19） |
| 安装 | `pnpm add framer-motion`（项目用 pnpm@11.22） |
| Bundle size | gzip 后：`motion` + `AnimatePresence` ~15 KB，`layout` + `LayoutGroup` ~3 KB，`drag` / `useMotionValue` ~5 KB。按需 import tree-shake |
| SSR 兼容 | framer-motion 在 SSR 阶段输出初始状态 HTML（`initial` 值），hydration 后接管动画。`"use client"` 隔离，不进入 Server Component bundle |
| React 19 | v11 官方支持 React 19（`useInsertionEffect` / `useSyncExternalStore` 兼容） |

#### 与 Next.js 16 App Router 集成方案

**1. 客户端隔离**：所有 framer-motion 使用点在 `"use client"` 组件中。Server Component 正常 SSR，framer-motion 仅在 hydration 后激活。

**2. 动态导入**（可选，对非首屏动画）：

```tsx
const PageTransition = dynamic(() => import("@/components/PageTransition"), { ssr: false });
```

对首屏即需的动画（如列表 `layout`），不动态导入（hydration 后立即生效）。

**3. `next.config.ts` 配置**：framer-motion 无需特殊 webpack 配置。若用 `motion` 新包名，确保 `transpilePackages` 包含（Next.js 16 默认 transpile）。

**4. 与 `prefers-reduced-motion` 联动**：

```tsx
import { useReducedMotion } from "framer-motion";

function MyComponent() {
  const reduced = useReducedMotion();
  const transition = reduced
    ? { duration: 0 }                    // 无动画
    : { duration: 0.22, ease: [0.2, 0, 0, 1] };
  return <motion.div animate={...} transition={transition} />;
}
```

`useReducedMotion()` 监听 `prefers-reduced-motion` 媒体查询，与项目现有全局 CSS 降级块双保险。

### 5.2 动画性能

#### will-change 使用规范

| 场景 | 是否加 `will-change` | 理由 |
|------|---------------------|------|
| hover 频繁的卡片（`.card-lift`） | ✅ `will-change: transform` | hover 高频，提前 hint 合成层 |
| framer-motion `layout` 元素 | ❌ | framer-motion 内部自动管理 `will-change`，过渡结束即焚 |
| 长按浮窗菜单 | ❌ | 低频触发，不值得常驻合成层 |
| 视差背景 | ✅ `will-change: transform` | 滚动持续触发 |
| Toast | ❌ | 低频 |

**原则**：`will-change` 是"提前告诉浏览器这个元素即将变化"，用后不焚会导致合成层常驻、内存占用。framer-motion 自动管理，手动加的场景仅限高频 hover / 持续滚动。

#### transform / opacity 优先

| 属性 | 是否合成层友好 | 说明 |
|------|--------------|------|
| `transform` (translate / scale / rotate) | ✅ | 合成层，不触发 layout / paint |
| `opacity` | ✅ | 合成层 |
| `width` / `height` | ❌ | 触发 layout |
| `top` / `left` | ❌ | 触发 layout |
| `box-shadow` | ⚠️ | 触发 paint，但现代浏览器优化较好 |
| `background-color` | ⚠️ | 触发 paint |

**framer-motion 映射**：
- `x` / `y` / `scale` / `rotate` → `transform` ✅
- `opacity` → `opacity` ✅
- `width` / `height` → 触发 layout ❌（列表 `layout` 不可避免，但 framer-motion 用 `position: absolute` + `transform` 模拟尺寸变化，减少 layout）

#### 避免布局抖动（layout thrashing）

1. **读写分离**：framer-motion 的 `useLayoutEffect` 测量在 commit 阶段同步完成，不在 render 阶段读 DOM，避免强制同步布局
2. **`layout="position"` 优先**：等高列表项只动画位置，跳过尺寸测量
3. **`mode="wait"` / `mode="popLayout"`**：`AnimatePresence` 的 mode 控制新旧元素是否同时存在。`wait` 串行（无重叠），`popLayout` 旧元素退出布局流（不挤新元素）
4. **虚拟化长列表**：列表 > 50 条时配合 `react-window`，仅对可见区 `layout`

#### token 桥接（CSS var → JS 常量）

framer-motion 的 `transition.duration` / `ease` 在 JS 侧解析数值，不能直接用 CSS `var()`。建立 token 桥接常量：

```tsx
// web/lib/motion-tokens.ts
export const MOTION = {
  fast: 0.12,           // var(--motion-fast) 120ms
  base: 0.15,           // var(--motion-base) 150ms
  slow: 0.22,           // var(--motion-slow) 220ms
  enter: 0.42,          // var(--motion-enter) 420ms
  easeStandard: [0.2, 0, 0, 1] as const,   // var(--ease-standard)
  easeOut: [0.16, 1, 0.3, 1] as const,     // var(--ease-out)
};

export const SPRING = {
  magnetic: { stiffness: 300, damping: 30, mass: 1 },   // 磁吸弹簧
  menu:      { stiffness: 400, damping: 28, mass: 1 },   // 浮窗菜单
};
```

> **同步约束**：若 `design-tokens.css` 中 `--motion-*` 值变更，需同步更新此文件。`[data-motion="reduced|enhanced"]` 切换时，framer-motion 侧通过 `useReducedMotion()` + 上下文感知（见 §5.1）。

---

## 6. 组件设计

### 新增组件列表

| 组件 | 路径 | 职责 | 优先级 |
|------|------|------|--------|
| `PageTransition` | `web/components/PageTransition.tsx` | App Router 页面切换过渡包裹 | P0 |
| `Ripple` | `web/components/Ripple.tsx` | 按钮涟漪反馈 | P1 |
| `QuickActionMenu` | `web/components/QuickActionMenu.tsx` | 长按浮窗快捷菜单 | P2 |
| `useLongPress` | `web/lib/use-long-press.ts` | 长按 hook | P2 |
| `motion-tokens` | `web/lib/motion-tokens.ts` | CSS var → JS 常量桥接 | P0 |
| `DocumentListSkeleton` | `web/components/Skeleton.tsx`（追加导出） | 文档列表骨架 | P0 |
| `BoardColumnSkeleton` | 同上 | 看板列骨架 | P0 |
| `TaskDetailSkeleton` | 同上 | 任务详情骨架 | P0 |
| `CircleSkeleton` | 同上 | 圆形骨架（头像 / 图标） | P0 |

### 新增组件 API

#### PageTransition

```tsx
export function PageTransition({ children }: { children: ReactNode }): JSX.Element;
```

#### Ripple

```tsx
export function Ripple({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element;
```

#### QuickActionMenu

```tsx
interface QuickAction {
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  onClick: () => void;
  danger?: boolean;       // 危险操作（删除）红色
}

export function QuickActionMenu({
  actions,
  position,               // { x, y } 锚点
  onClose,
}: {
  actions: QuickAction[];
  position: { x: number; y: number };
  onClose: () => void;
}): JSX.Element;
```

#### useLongPress

```tsx
export function useLongPress(
  callback: () => void,
  options?: { delay?: number; threshold?: number }
): {
  onPressStart: () => void;
  onPressEnd: () => void;
};
```

### 现有组件修改清单

| 组件 | 修改内容 | 优先级 |
|------|---------|--------|
| `Toast.tsx` | `fade-in` CSS → framer-motion `AnimatePresence` + `layout` 堆叠 + 滑入 / 滑出 | P0 |
| `Skeleton.tsx` | `animate-pulse` → `shimmer` 渐变扫光；新增 4 个预设骨架导出 | P0 |
| `EmptyState.tsx` | 新增 `animate` / `illustrationSize` props；入场 stagger 动画；新增 4 种插画类型 | P1 |
| `DashboardGrid.tsx` | `onDragStop` 叠加弹簧磁吸过渡（`freeMode` / 移动端跳过） | P1 |
| `WidgetCard.tsx` | 配置面板弹出 → 3D `rotateY` 翻转（P2）；长按浮窗（P2） | P2 |
| `DocumentListView.tsx` | spinner → `DocumentListSkeleton`；列表项 `layout` 增删动画 | P0 |
| `board-parts.tsx` | 看板卡片 `layout` 跨列动画；`BoardColumnSkeleton` | P0 |
| `globals.css` | 新增 `shimmer` keyframes / `.shimmer` 类 / `ripple-expand` keyframes / `.icon-bounce` / `.card-lift` 增强 | P0–P1 |
| `design-tokens.css` | 新增 `--shimmer-*` / `--ripple` / `--spring-*` / `--perspective-card` token（浅色 + 深色） | P0 |
| `app/[locale]/w/[wid]/layout.tsx` | 内容区包裹 `<PageTransition>` | P0 |
| 各按钮 | 接入 `Ripple` 组件 / `icon-bounce` 类 | P1 |
| 各空状态调用点 | 传入更精准的 `type` / `description` / `action` | P1 |

---

## 7. 实施计划

### 工作包拆分

#### P0: 丝滑基础（1 周）

| 包 | 内容 | 依赖 | 预估 |
|----|------|------|------|
| P0-1 | 安装 framer-motion；建立 `motion-tokens.ts` 桥接；`design-tokens.css` 补充 token | 无 | 0.5 天 |
| P0-2 | `PageTransition` 组件 + `layout.tsx` 集成 | P0-1 | 1 天 |
| P0-3 | 列表 `layout` 动画：任务列表 / 文档列表 / 看板列 | P0-1 | 1.5 天 |
| P0-4 | Skeleton shimmer 升级 + 新增 4 个预设骨架 | P0-1 | 1 天 |
| P0-5 | Toast framer-motion 升级 | P0-1 | 1 天 |
| P0-6 | P0 回归测试 + `prefers-reduced-motion` 验证 | P0-2~5 | 0.5 天 |

#### P1: 精致交互（1–2 周）

| 包 | 内容 | 依赖 | 预估 |
|----|------|------|------|
| P1-1 | EmptyState 增强（stagger 动画 + 4 种新插画） | P0-1 | 1 天 |
| P1-2 | `Ripple` 组件 + 按钮接入；`.icon-bounce` / `.card-lift` 增强 | P0-1 | 1.5 天 |
| P1-3 | DashboardGrid 磁吸拖拽（spring config + `onDragStop`） | P0-1 | 2 天 |
| P1-4 | 暗色模式对比度审计 + 修复 | 无 | 1.5 天 |
| P1-5 | P1 回归测试 | P1-1~4 | 0.5 天 |

#### P2: 高级可玩性（1–2 周）

| 包 | 内容 | 依赖 | 预估 |
|----|------|------|------|
| P2-1 | `useLongPress` hook + `QuickActionMenu` 组件 | P0-1 | 1.5 天 |
| P2-2 | WidgetCard 3D 翻转配置面板 | P0-1 | 1 天 |
| P2-3 | pinch-to-zoom + swipe-to-dismiss 手势 | P0-1 | 2 天 |
| P2-4 | 页面视差（概览页 / 文档编辑器 / Landing） | P0-1 | 1 天 |
| P2-5 | P2 回归测试 + 性能验证 | P2-1~4 | 0.5 天 |

### 与功能开发的并行策略

| 策略 | 说明 |
|------|------|
| **P0 阻塞优先** | P0 是基础体验，优先于新功能开发。P0-1（framer-motion 引入 + token）是所有后续包的前置 |
| **P1 与功能并行** | P1 的微交互 / 空状态增强可与新功能开发并行，互不阻塞。磁吸拖拽依赖 F7 已稳定 |
| **P2 锦上添花** | P2 在 P0 / P1 完成后启动，不阻塞任何功能。可按用户反馈按需启用 |
| **token 变更同步** | `design-tokens.css` 变更经 `predev` / `prebuild` 脚本自动同步，无需手动干预 |
| **回归测试** | 每个 P 级结束做整级回归（`prefers-reduced-motion` / 深色 / 移动端 / SSR），不累积技术债 |

---

## 8. 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| **framer-motion 与 React 19 兼容性** | 低 | 高（动画全失效） | v11+ 官方支持 React 19；安装后先在 Toast 单点验证，再铺开 |
| **bundle size 超预期** | 中 | 中（首屏 LCP 退化） | `dynamic import` + `"use client"` 隔离；监测 `next build` bundle 报告；tree-shake 验证 |
| **SSR / hydration mismatch** | 中 | 中（控制台报错 / 闪烁） | framer-motion `initial={false}` 避免首屏动画；`useReducedMotion` 在 hydration 后读取 |
| **`layout` 动画布局抖动** | 中 | 中（视觉跳动） | `layout="position"` 优先；`mode="wait"` / `popLayout"`；长列表虚拟化 |
| **`prefers-reduced-motion` 未尊重** | 低 | 高（可访问性违规） | 全局 CSS 降级块（已有）+ `useReducedMotion()` 双保险；每级回归必测 |
| **磁吸拖拽与 RGL 冲突** | 中 | 中（拖拽卡顿 / 位置错乱） | 磁吸在 `onDragStop` 后叠加，不侵入 RGL 拖拽过程；`freeMode` / 移动端跳过 |
| **3D 翻转移动端性能** | 中 | 低（低端机掉帧） | 移动端降级为 slide 过渡；`prefers-reduced-motion` 降级为直接切换 |
| **暗色模式对比度不达标** | 低 | 中（可访问性） | 审计清单逐项检查；新组件只用 `var(--token)` 自动适配 |
| **token 桥接不同步** | 中 | 低（动画时长不一致） | `motion-tokens.ts` 注释标注对应 CSS token；`design-tokens.css` 变更时同步 |
| **视差干扰阅读** | 低 | 低（体验） | 应用内视差 ≤ 10px；仅营销页加重；可通过 `[data-motion="reduced"]` 关闭 |

---

## 附录 A: design-tokens.css 新增 token 完整清单

```css
/* —— UI 打磨补充 token（追加到 :root）—— */

/* shimmer 扫光渐变基准色 */
--shimmer-from:  color-mix(in srgb, var(--surface-2) 100%, transparent);
--shimmer-to:    color-mix(in srgb, var(--surface-3) 100%, transparent);
--shimmer-hi:    color-mix(in srgb, var(--surface) 60%, var(--p-accent) 4%);

/* ripple 涟漪色 */
--ripple:        color-mix(in srgb, var(--accent) 12%, transparent);

/* 弹簧物理（framer-motion spring config 复用） */
--spring-stiffness: 300;
--spring-damping:   30;

/* 3D 翻转透视 */
--perspective-card: 1000px;
```

```css
/* —— 深色模式补充（追加到 [data-theme="dark"]）—— */
--shimmer-hi: color-mix(in srgb, var(--surface-3) 70%, var(--p-accent) 8%);
--ripple:     color-mix(in srgb, var(--accent) 16%, transparent);
```

## 附录 B: globals.css 新增动画类完整清单

```css
/* shimmer 渐变扫光 */
@keyframes shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.shimmer {
  background: linear-gradient(
    90deg,
    var(--shimmer-from) 25%,
    var(--shimmer-hi)  50%,
    var(--shimmer-to)   75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.6s var(--ease-standard) infinite;
}

/* ripple 涟漪扩散 */
@keyframes ripple-expand {
  from { transform: scale(0); opacity: 1; }
  to   { transform: scale(4); opacity: 0; }
}
.ripple-dot {
  animation: ripple-expand var(--motion-base) var(--ease-out) forwards;
}

/* 图标 hover bounce */
.icon-bounce {
  transition: transform var(--motion-fast) var(--ease-out);
}
.icon-bounce:hover  { transform: scale(1.1); }
.icon-bounce:active { transform: scale(0.92); }
```

> **注意**：`.card-lift` 增强为 `translateY(-2px)` + `--elev-hover` + `will-change: transform`，替换现有定义。

## 附录 C: 经验来源引用

| 经验 | 应用点 |
|------|--------|
| `2026-09-11-prefers-reduced-motion-global-block-and-max-duration` | §1.3 全局降级块（`0.01ms` + `iteration-count: 1`），§5.1 `useReducedMotion()` 联动 |
| `2026-09-10-dead-design-token-grep-confirm-multi-source-delete` | §1.3 token 唯一定义层原则，消费侧 grep 确认引用 |
| `2026-09-10-tailwind-v4-utility-class-to-design-token-migration` | §1.3 新增 token 集中在 `design-tokens.css`，组件层只 `var(--token)` |