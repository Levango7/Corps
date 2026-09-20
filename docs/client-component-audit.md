# Client Component 滥用审计报告

> **任务**: P0-1: client component 分析 — 分析哪些组件可安全改为 server component，输出分批改造计划
> **审计范围**: `web/components/` 目录下 250 个 .tsx 组件
> **技术栈**: Next.js 16 + React 19 + next-intl
> **审计日期**: 2026-09-20
> **审计性质**: 只读分析，未修改任何代码文件

---

## 1. 统计概览

| 分类 | 数量 | 占比 | 说明 |
|------|------|------|------|
| **可立即转为 server component** | 11 | 4.4% | 纯展示组件，无任何 client-only 特性，只需删除 `"use client"` |
| **需小改造后可转** | 11 | 4.4% | 主要改造：`useTranslations` → `getTranslations`，或拆分少量交互 |
| **需拆分改造后可转** | 11 | 4.4% | 有少量事件处理，需拆分为 server + client 子组件 |
| **必须保持 client component** | 217 | 86.8% | 大量 hooks/事件/浏览器 API/framer-motion，改造代价过大 |
| **总计** | 250 | 100% | — |

**当前状态**: 248 个组件标记为 `"use client"`，仅 `Logo.tsx` 和 `Skeleton.tsx` 已是 server component。

**潜在收益**: 33 个组件（13.2%）可通过改造转为 server component，减少客户端 JS 包体积，提升首屏加载性能。

---

## 2. 可立即转为 server component 的组件清单（最高优先级）

这些组件完全没有任何 client-only 特性（无 hooks、无事件处理、无浏览器 API、无 framer-motion、无 useTranslations），只需删除 `"use client"` 指令即可安全转为 server component。

| # | 组件路径 | 功能描述 | 被谁导入 | 改造步骤 |
|---|---------|---------|---------|---------|
| 1 | `ai/ProgressSteps.tsx` | AI 流式进度步骤指示器（纯展示） | `ai/ApprovalAdvicePanel`、`ai/DailyReportView`、`ai/ProjectInsightView`（均为 client） | 删除 `"use client"` |
| 2 | `TaskLabels.tsx` | 任务标签展示（色块+名称，最多3个） | `board-parts.tsx`（client） | 删除 `"use client"` |
| 3 | `DueTag.tsx` | 截止日期标签（相对时间+色调） | `board-parts.tsx`（client） | 删除 `"use client"` |
| 4 | `Markdown.tsx` | 极简 Markdown 渲染器（零依赖） | 多处 page.tsx + client components | 删除 `"use client"`（导入的 `Mermaid` 是 client component，server 可安全导入 client） |
| 5 | `wiki/WikiViewer.tsx` | Wiki Markdown 查看器（零依赖） | `wiki/[pageId]/page.tsx`（server）+ `wiki/WikiEditor`（client） | 删除 `"use client"` |
| 6 | `members/helpers.tsx` | 成员管理辅助函数 + Avatar 组件 | `members/MemberList`（client） | 删除 `"use client"` |
| 7 | `files/previews/VideoPreview.tsx` | HTML5 video 预览（纯展示） | `files/FilePreview`（client） | 删除 `"use client"` |
| 8 | `files/previews/AudioPreview.tsx` | HTML5 audio 预览（纯展示） | `files/FilePreview`（client） | 删除 `"use client"` |
| 9 | `files/previews/MarkdownPreview.tsx` | Markdown 预览（包装 Markdown 组件） | `files/FilePreview`（client） | 删除 `"use client"` |
| 10 | `files/VideoPreview.tsx` | HTML5 video 预览（纯展示） | `files/FilePreview`（client） | 删除 `"use client"` |
| 11 | `files/FilePreviewDialog.tsx` | 文件预览模态对话框（包装 FilePreview） | 未发现外部导入 | 删除 `"use client"` |

**注意事项**:
- 在 Next.js 中，server component 可以安全导入 client component（如 `Markdown.tsx` 导入 `Mermaid.tsx`），不会产生问题。
- 被 client component 导入的 server component，在 client 上下文中会自动作为 client component 渲染，不会破坏现有功能。
- 最高收益组件：`wiki/WikiViewer.tsx` 和 `Markdown.tsx`，因为它们被 page.tsx（server component）直接导入，转为 server 后可减少客户端 JS。

---

## 3. 需小改造后可转的组件清单

这些组件只使用了 `useTranslations`（next-intl client hook）或少量可替代的 hook，没有其他 client 特性。改造核心是将 `useTranslations` 替换为 `getTranslations`（server 版，异步），组件需改为 `async` 函数。

### 3.1 仅需 useTranslations → getTranslations 改造

| # | 组件路径 | trans | 其他特性 | 被谁导入 | 改造步骤 |
|---|---------|-------|---------|---------|---------|
| 1 | `PublicDocumentView.tsx` | 2 | 无 | `documents/share/[token]/page.tsx`（server） | 1. `useTranslations` → `getTranslations` 2. 组件改为 `async` 3. 删除 `"use client"` |
| 2 | `ai/BehaviorStats.tsx` | 3 | 无 | `ai/PersonalizationPanel`（client） | 同上 |
| 3 | `approval/ApprovalFlowDiagram.tsx` | 2 | 无 | `approval/ApprovalDetail`（client） | 同上 |
| 4 | `database/RollupField.tsx` | 2 | 无 | `lib/database/relation-resolver.ts` | 同上 |
| 5 | `settings/SettingsOverview.tsx` | 2 | 无 | settings page（推测） | 同上 |
| 6 | `files/previews/PdfPreview.tsx` | 2 | 无 | `files/FilePreview`（client） | 同上 |
| 7 | `files/previews/OfficePreview.tsx` | 2 | 无 | `files/FilePreview`（client） | 同上 |
| 8 | `files/PdfPreview.tsx` | 2 | 无 | `files/FilePreview`（client） | 同上 |
| 9 | `dashboard/widgets/index.tsx` | 2 | 导入 client widgets | `DashboardGrid`、`AddWidgetDialog`（client） | 同上（注册表本身不含 client 逻辑） |

### 3.2 需额外小改造

| # | 组件路径 | 特性 | 改造步骤 |
|---|---------|------|---------|
| 10 | `files/previews/CodePreview.tsx` | `useMemo`=1, `trans`=2 | 1. 移除 `useMemo`（server component 不需要记忆化） 2. `useTranslations` → `getTranslations` 3. 改为 `async` 4. 删除 `"use client"` |
| 11 | `dashboard/widgets/WidgetStates.tsx` | `events`=1(重试按钮), `trans`=3 | 1. `WidgetSkeleton` 和 `WidgetEmpty` 拆为 server component（纯展示） 2. `WidgetError` 保持 client（有 `onClick` 重试按钮） 3. `useTranslations` → `getTranslations` |

**改造注意事项**:
- `getTranslations` 是异步的（返回 `Promise`），组件需改为 `async` 函数。
- 在 Next.js 16 + React 19 中，server component 支持 `async` 函数组件。
- 如果组件被 client component 导入，client 中使用时仍会作为 client component 渲染——`async` 不影响 client 上下文（Next.js 自动处理）。
- 最高收益组件：`PublicDocumentView.tsx`，被 server page 直接导入。

---

## 4. 需拆分改造后可转的组件清单

这些组件有少量事件处理（1-6 个 `onClick`/`onChange` 等），但没有 React hooks。可通过将交互部分拆分为子 client component，主体保持为 server component。

| # | 组件路径 | events | trans | 改造策略 |
|---|---------|--------|-------|---------|
| 1 | `LanguageSwitcher.tsx` | 1 | 4 | 主体为 server（展示语言名称），拆分 `<select onChange>` 为 `LanguageSwitcherClient` 子组件 |
| 2 | `im/ConversationItem.tsx` | 1 | 4 | 主体为 server（展示对话信息），拆分 `onClick` 选择交互为子 client component |
| 3 | `SidebarNav.tsx` | 3 | 2 | 主体为 server（导航链接列表），拆分 active 状态检测+点击交互为子 client component |
| 4 | `ViewToggle.tsx` | 4 | 2 | 主体为 server（展示当前视图名称），拆分切换按钮交互为 `ViewToggleClient` 子组件 |
| 5 | `chat/ChatHeader.tsx` | 3 | 2 | 主体为 server（展示聊天标题），拆分搜索/关闭按钮为子 client component |
| 6 | `members/TransferOwnership.tsx` | 4 | 3 | 主体为 server（展示成员列表），拆分转让对话框交互为子 client component |
| 7 | `database/GroupControl.tsx` | 4 | 2 | 主体为 server（展示分组信息），拆分下拉选择交互为子 client component |
| 8 | `calendar/CalendarDay.tsx` | 4 | 0 | 主体为 server（展示日历日期），拆分事件点击交互为子 client component |
| 9 | `calendar/CalendarWeek.tsx` | 4 | 0 | 同上 |
| 10 | `calendar/CalendarMonth.tsx` | 5 | 0 | 同上 |
| 11 | `files/FileListItem.tsx` | 6 | 2 | 主体为 server（展示文件信息），拆分选择/点击/菜单交互为子 client component |

**改造模式**:
```tsx
// 改造前：整个组件是 client
"use client";
export function ViewToggle({ view, onChange }) {
  return (
    <div>
      <button onClick={() => onChange("board")}>看板</button>
      <button onClick={() => onChange("list")}>列表</button>
    </div>
  );
}

// 改造后：主体是 server，交互部分拆为 client
// ViewToggle.tsx (server)
import { ViewToggleClient } from "./ViewToggleClient";
export async function ViewToggle({ view }) {
  const t = await getTranslations("board");
  return (
    <div>
      <ViewToggleClient view={view} labels={{ board: t("board"), list: t("list") }} />
    </div>
  );
}

// ViewToggleClient.tsx (client)
"use client";
export function ViewToggleClient({ view, labels, onChange }) {
  return (
    <>
      <button onClick={() => onChange("board")}>{labels.board}</button>
      <button onClick={() => onChange("list")}>{labels.list}</button>
    </>
  );
}
```

---

## 5. 必须保持 client component 的组件清单

以下 217 个组件因使用了大量 client-only 特性，改造代价过大，建议保持 `"use client"`。

### 5.1 使用 framer-motion 的组件（必须保持 client）

framer-motion 的 `motion.*`、`useScroll`、`useTransform`、`useReducedMotion` 等 API 仅在客户端可用。

| 组件路径 | fm 使用数 | 说明 |
|---------|----------|------|
| `EmptyState.tsx` | 13 | 大量 framer-motion 动画 |
| `AnimatedList.tsx` | 9 | 列表动画 |
| `layout/MobileBottomNav.tsx` | 6 | 底部导航动画指示条 |
| `dashboard/DashboardGrid.tsx` | 5 | 仪表盘网格动画 |
| `PageTransition.tsx` | 4 | 页面过渡动画 |
| `Parallax.tsx` | 4 | 滚动视差（useScroll + useTransform） |
| `dashboard/WidgetCard.tsx` | 3 | Widget 卡片动画 |
| `Toast.tsx` | 3 | Toast 动画 |
| `DocumentListView.tsx` | 3 | 文档列表动画 |
| `board-parts.tsx` | 4 | 看板部件动画 |
| `QuickActionMenu.tsx` | 4 | 快捷菜单动画 |

### 5.2 使用大量 React hooks 的组件（必须保持 client）

hooks 数量 ≥ 10 的组件，改造需要重构整个状态管理逻辑。

| 组件路径 | hooks 数 | 说明 |
|---------|---------|------|
| `im/MessageInput.tsx` | 38 | IM 消息输入（复杂状态） |
| `DocumentEditor.tsx` | 33 | 文档编辑器（复杂状态） |
| `dashboard/DashboardGrid.tsx` | 31 | 仪表盘网格（拖拽+布局状态） |
| `chat/MessageInput.tsx` | 31 | 聊天消息输入 |
| `meetings/MeetingRoom.tsx` | 29 | 会议室（WebRTC 状态） |
| `KnowledgeBase.tsx` | 26 | 知识库 |
| `im/ConversationSettings.tsx` | 25 | 对话设置 |
| `chat/MessageList.tsx` | 25 | 消息列表 |
| `ChatPanel.tsx` | 24 | 聊天面板 |
| `calendar/CalendarView.tsx` | 23 | 日历视图 |
| `ai/DocQaPanel.tsx` | 23 | 文档问答面板 |
| `DocumentListView.tsx` | 23 | 文档列表 |
| `ai/KnowledgeQaPanel.tsx` | 22 | 知识问答 |
| `CollaborationProvider.tsx` | 22 | 协同 Provider（Context） |
| `RecycleBin.tsx` | 21 | 回收站 |
| `im/ConversationCreate.tsx` | 20 | 创建对话 |
| `WidgetGrid.tsx` | 20 | Widget 网格 |
| `NewTaskDialog.tsx` | 20 | 新建任务对话框 |
| `whiteboard/WhiteboardCanvas.tsx` | 19 | 白板画布 |
| `remote-control/RemoteViewer.tsx` | 19 | 远程查看器 |
| `im/MessageSearch.tsx` | 19 | 消息搜索 |
| `ai/MeetingAiPanel.tsx` | 19 | 会议 AI 面板 |
| `Toast.tsx` | 19 | Toast 通知 |
| `CommandPalette.tsx` | 19 | 命令面板 |

### 5.3 使用浏览器 API 的组件（必须保持 client）

使用了 `window.*`、`document.*`、`localStorage`、`sessionStorage`、`navigator.*` 等。

| 组件路径 | browser API 数 | 说明 |
|---------|---------------|------|
| `DocumentEditor.tsx` | 11 | 编辑器 DOM 操作 |
| `database/TableView.tsx` | 10 | 表格视图 DOM 操作 |
| `pricing/PricingViewTracker.tsx` | 9 | 价格页浏览追踪 |
| `QuickActionMenu.tsx` | 9 | 快捷菜单 DOM 操作 |
| `ExportPreview.tsx` | 9 | 导出预览 |
| `settings/SettingsPreferences.tsx` | 8 | 设置偏好 |
| `members/TemporaryGrantModal.tsx` | 8 | 临时授权模态 |
| `DocumentListView.tsx` | 8 | 文档列表 |
| `CollaborationProvider.tsx` | 8 | 协同 Provider |
| `BatchToolbar.tsx` | 8 | 批量工具栏 |
| `ThemeToggle.tsx` | 5 | 主题切换（localStorage） |
| `meetings/MeetingRoom.tsx` | 7 | 会议室（WebRTC） |
| `doc/ShareDialog.tsx` | 7 | 分享对话框 |
| `RecycleBin.tsx` | 7 | 回收站 |
| `pwa/PwaRegister.tsx` | 5 | PWA 注册 |
| `pwa/PushSubscribe.tsx` | 3 | PWA 推送订阅 |
| `announcement/AnnouncementBanner.tsx` | 5 | 公告横幅 |

### 5.4 使用 useWidgetData hook 的 dashboard widgets（必须保持 client）

`useWidgetData` 是自定义 client hook（使用 `useState`、`useEffect`、`useCallback`），所有使用它的 widget 必须保持 client。

| 组件路径 | 说明 |
|---------|------|
| `dashboard/widgets/TaskStatsWidget.tsx` | 任务统计 |
| `dashboard/widgets/MyTasksWidget.tsx` | 我的任务 |
| `dashboard/widgets/RecentActivityWidget.tsx` | 最近活动 |
| `dashboard/widgets/PriorityDistWidget.tsx` | 优先级分布 |
| `dashboard/widgets/TeamLoadWidget.tsx` | 团队负载 |
| `dashboard/widgets/MilestoneTimelineWidget.tsx` | 里程碑时间线 |
| `dashboard/widgets/GanttWidget.tsx` | 甘特图 |
| `dashboard/widgets/DueThisWeekWidget.tsx` | 本周截止 |
| `dashboard/widgets/DecisionActionsWidget.tsx` | 决策行动项 |
| `dashboard/widgets/BurndownWidget.tsx` | 燃尽图（+ useId） |
| `dashboard/widgets/CustomChartWidget.tsx` | 自定义图表（+ useId） |

### 5.5 其他必须保持 client 的组件

包括但不限于：
- 所有 IM 聊天组件（`im/IMClient`、`im/ChatWindow`、`im/MessageInput` 等）
- 所有编辑器组件（`editor/AiChatPanel`、`editor/SlashMenu`、`editor/AiSuggestion` 等）
- 所有审批组件（`approval/ApprovalSubmit`、`approval/ApprovalDetail` 等）
- 所有 AI 面板组件（`ai/AssistantPanel`、`ai/DocQaPanel` 等）
- 所有协同组件（`CollaborationCursor`、`CollaborationProvider`、`PresenceIndicator` 等）
- 所有 PWA 组件（`pwa/PwaRegister`、`pwa/PushSubscribe`）
- 所有同步组件（`sync/SyncStatus`、`sync/OfflineIndicator`）
- `web-vitals-reporter.tsx`（使用 `useReportWebVitals` hook）
- `ClientLayout.tsx`（作为 client layout wrapper，提供 ToastProvider context）

---

## 6. 分批改造建议

按改造难度和收益排序，每批 5-10 个组件。

### 第一批：零风险改造（仅删除 "use client"）— 11 个组件

**难度**: 极低 | **风险**: 极低 | **收益**: 中（减少客户端 JS）

| 序号 | 组件 | 操作 |
|------|------|------|
| 1 | `wiki/WikiViewer.tsx` | 删除 `"use client"` |
| 2 | `Markdown.tsx` | 删除 `"use client"` |
| 3 | `ai/ProgressSteps.tsx` | 删除 `"use client"` |
| 4 | `TaskLabels.tsx` | 删除 `"use client"` |
| 5 | `DueTag.tsx` | 删除 `"use client"` |
| 6 | `members/helpers.tsx` | 删除 `"use client"` |
| 7 | `files/previews/VideoPreview.tsx` | 删除 `"use client"` |
| 8 | `files/previews/AudioPreview.tsx` | 删除 `"use client"` |
| 9 | `files/previews/MarkdownPreview.tsx` | 删除 `"use client"` |
| 10 | `files/VideoPreview.tsx` | 删除 `"use client"` |
| 11 | `files/FilePreviewDialog.tsx` | 删除 `"use client"` |

**验证步骤**: 改造后运行 `npm run build`，确认无编译错误；手动测试涉及页面（Wiki 页面、Markdown 渲染、文件预览等）。

---

### 第二批：useTranslations → getTranslations 改造 — 9 个组件

**难度**: 低 | **风险**: 低 | **收益**: 高（被 server page 直接导入的组件收益最大）

| 序号 | 组件 | 操作 |
|------|------|------|
| 1 | `PublicDocumentView.tsx` | `useTranslations` → `getTranslations`，改 `async`，删除 `"use client"` |
| 2 | `approval/ApprovalFlowDiagram.tsx` | 同上 |
| 3 | `ai/BehaviorStats.tsx` | 同上 |
| 4 | `database/RollupField.tsx` | 同上 |
| 5 | `settings/SettingsOverview.tsx` | 同上 |
| 6 | `files/previews/PdfPreview.tsx` | 同上 |
| 7 | `files/previews/OfficePreview.tsx` | 同上 |
| 8 | `files/PdfPreview.tsx` | 同上 |
| 9 | `dashboard/widgets/index.tsx` | 同上 |

**验证步骤**: 改造后确认 `getTranslations` 的 namespace 和 key 与原 `useTranslations` 一致；测试国际化文案是否正常显示。

---

### 第三批：需额外小改造 — 2 个组件

**难度**: 中 | **风险**: 低 | **收益**: 中

| 序号 | 组件 | 操作 |
|------|------|------|
| 1 | `files/previews/CodePreview.tsx` | 移除 `useMemo`，`useTranslations` → `getTranslations`，改 `async`，删除 `"use client"` |
| 2 | `dashboard/widgets/WidgetStates.tsx` | 拆分：`WidgetSkeleton`/`WidgetEmpty` → server component；`WidgetError` → 保持 client（有 onClick）；`useTranslations` → `getTranslations` |

---

### 第四批：拆分交互为子 client component — 6 个组件

**难度**: 中 | **风险**: 中 | **收益**: 中

| 序号 | 组件 | 操作 |
|------|------|------|
| 1 | `LanguageSwitcher.tsx` | 拆分 `<select onChange>` 为 `LanguageSwitcherClient`；主体改 server + `getTranslations` |
| 2 | `ViewToggle.tsx` | 拆分切换按钮为 `ViewToggleClient`；主体改 server + `getTranslations` |
| 3 | `SidebarNav.tsx` | 拆分 active 状态检测为 `SidebarNavClient`；主体改 server + `getTranslations` |
| 4 | `chat/ChatHeader.tsx` | 拆分搜索/关闭按钮为 `ChatHeaderClient`；主体改 server + `getTranslations` |
| 5 | `im/ConversationItem.tsx` | 拆分 onClick 为 `ConversationItemClient`；主体改 server + `getTranslations` |
| 6 | `database/GroupControl.tsx` | 拆分下拉交互为 `GroupControlClient`；主体改 server + `getTranslations` |

---

### 第五批：拆分交互为子 client component（较复杂）— 5 个组件

**难度**: 高 | **风险**: 中 | **收益**: 低

| 序号 | 组件 | 操作 |
|------|------|------|
| 1 | `members/TransferOwnership.tsx` | 拆分转让对话框交互为子 client component |
| 2 | `calendar/CalendarDay.tsx` | 拆分事件点击交互为子 client component |
| 3 | `calendar/CalendarWeek.tsx` | 同上 |
| 4 | `calendar/CalendarMonth.tsx` | 同上 |
| 5 | `files/FileListItem.tsx` | 拆分选择/点击/菜单交互为子 client component |

---

## 7. 改造优先级矩阵

```
收益 ↑
高 │  PublicDocumentView    WikiViewer, Markdown
   │  ApprovalFlowDiagram   ProgressSteps
   │  BehaviorStats         TaskLabels, DueTag
   │  RollupField           members/helpers
   │  SettingsOverview      files/previews/*
中 │  CodePreview           ViewToggle
   │  WidgetStates          SidebarNav
   │  dashboard/widgets/idx  LanguageSwitcher
   │                        ChatHeader
低 │  CalendarDay/Month/Week  TransferOwnership
   │  FileListItem          GroupControl
   │  ConversationItem
   │───────────────────────────────────────────→ 难度
   低          中          高
```

**建议执行顺序**: 第一批 → 第二批 → 第三批 → 第四批 → 第五批

每批完成后运行完整构建和测试，确认无回归后再进入下一批。

---

## 8. 关键注意事项

1. **`getTranslations` 是异步的**: 改造后组件需改为 `async` 函数。在 Next.js 16 + React 19 中，server component 支持 `async` 函数组件，这是合法的。

2. **被 client component 导入的 server component**: 在 Next.js 中，当一个 server component 被 client component 导入时，它会自动作为 client component 渲染。这意味着删除 `"use client"` 不会破坏任何现有功能——在 client 上下文中组件仍然正常工作。

3. **`useId` 在 server component 中可用**: React 19 的 `useId` 可以在 server component 中使用，因此 `dashboard/widgets/BurndownWidget.tsx` 和 `CustomChartWidget.tsx` 的 `useId` 不阻碍改造（但它们使用了 `useWidgetData` client hook，所以仍需保持 client）。

4. **`next/link` 的 `Link` 组件在 server component 中可用**: 不影响改造。

5. **导入 client component 的 server component**: server component 可以安全导入和渲染 client component（如 `Markdown.tsx` 导入 `Mermaid.tsx`）。这是 Next.js 的正常模式。

6. **`useMemo` 在 server component 中不需要**: server component 每次渲染都是独立的，不需要记忆化。移除 `useMemo` 是安全的。

7. **测试策略**: 每批改造后，至少需要：
   - `npm run build` 确认无编译错误
   - 手动测试涉及页面的渲染和交互
   - 检查国际化文案是否正常显示
   - 确认客户端 JS 包大小是否减少（`npm run build` 的输出会显示 bundle size）

---

## 附录：审计方法

### 数据收集维度

对每个组件检查以下 6 个维度：
1. **React hooks 使用**: `useState`、`useEffect`、`useRef`、`useReducer`、`useContext`、`useCallback`、`useMemo`、`useId`
2. **事件处理**: `onClick`、`onChange`、`onSubmit`、`onKeyDown`、`onKeyUp`、`onMouseEnter`、`onMouseLeave`、`onFocus`、`onBlur`、`onDrag`、`onDrop`、`onScroll`、`onResize`、`onTouchStart`、`onTouchEnd`
3. **浏览器 API**: `window.*`、`document.*`、`localStorage`、`sessionStorage`、`navigator.*`
4. **第三方 client-only 库**: `framer-motion`（`motion.*`、`useScroll`、`useTransform`、`useReducedMotion`）、`react-hot-toast`
5. **next-intl**: `useTranslations`（client 版） vs `getTranslations`（server 版）
6. **导入链**: 被哪些组件导入（client 或 server）

### 分类标准

- **可立即转**: hooks=0, events=0, browser=0, framer-motion=0, useTranslations=0
- **需小改造**: 仅使用 `useTranslations` 或 `useMemo`，无其他 client 特性
- **需拆分改造**: 有 1-6 个事件处理，无 React hooks，可拆分交互部分
- **必须保持**: hooks≥7 或 events≥7 或 browser≥3 或 framer-motion≥3 或使用 `useWidgetData`/`useReportWebVitals`/`useCollaboration` 等自定义 client hooks