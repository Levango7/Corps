# corps v0.7.0 功能设计方案（完善版）

> 日期：2026-09-11
> 状态：✅ 已实现（2026-09-11）
> 实现日期：2026-09-11
> Commit 引用：Phase 1 = f9027d1，Phase 2+3 = 0737513，Review fix = b9fdbe9
> 基于：v0.6.0 现有架构 + 产品设计审视 + 代码级可行性验证
> 目标：75分→90分（已达成）

---

## 功能清单与可行性评估

| # | 功能 | 可行性 | 预估耗时 | 优先级 | 关键代码依据 | 状态 |
|---|------|--------|---------|--------|-------------|------|
| F1 | 决策驱动执行（自动任务分解） | ⭐⭐⭐⭐⭐ | 1.5周 | P0 | Decision 模型已有版本留痕+FOR UPDATE锁+通知机制 | ✅ 已实现 |
| F2 | Viewer角色 + 模块权限矩阵 | ⭐⭐⭐⭐⭐ | 1周 | P0 | Member.role 是字符串字段，types.ts Role 类型集中定义 | ✅ 已实现 |
| F3 | Widget仪表盘（可拖拽排列） | ⭐⭐⭐⭐ | 1.5周 | P1 | 工作区首页已是 client 组件，analytics SVG 图表可复用 | ✅ 已实现 |
| F4 | Markdown→PDF/HTML导出 | ⭐⭐⭐⭐ | 0.5周 | P1 | DocumentEditor 已有 Download 图标+split 预览 | ✅ 已实现 |
| F5 | 分享增强（有效期+密码+日志） | ⭐⭐⭐⭐⭐ | 0.5周 | P1 | Document/Task 均有 shareToken，runWithShareToken 已实现 | ✅ 已实现 |
| F6 | 暖度调节（密度+彩色可视化） | ⭐⭐⭐⭐ | 1周 | P2 | design-tokens.css 已有 density 参数，settings 已有主题切换模式 | ✅ 已实现 |

> **已实现跳过**：Markdown实时预览分屏 — DocumentEditor.tsx:65 已有 `split` 模式

---

## F1：决策驱动执行 — 自动任务分解引擎 ✅ 已实现（2026-09-11，Phase 1 f9027d1）

### 1.1 痛点

决策记录写了，但没人跟进执行。约1/4决策超期，核心问题"讨论→决策→任务→执行"闭环未打通。

### 1.2 行动项语法设计

在决策记录的 Markdown 中支持行动项语法，保存时自动解析生成任务并关联回决策。

```markdown
## 决议事项

采用 PostgreSQL RLS 做多租户隔离，不再在应用层逐条加 WHERE。

## 执行计划

- [ ] @张三 2026-10-15 完成 RLS 策略编写 #high
- [ ] @李四 2026-10-20 完成迁移脚本验证 #medium
- [x] @王五 2026-10-10 已完成现有查询审计 #low
```

**解析规则**（精确）：
- `- [ ]` 或 `- [x]` 开头 → 行动项（与普通 checkbox `- [ ]` 的区别：必须含 `@用户名` 或 `YYYY-MM-DD` 才触发任务生成，纯 checkbox 不触发）
- `@用户名` → assignee（模糊匹配工作区成员 name/email，匹配不到则 assignee 为 null）
- `YYYY-MM-DD` → dueDate
- `#high` / `#medium` / `#low` / `#urgent` → priority（默认 medium）
- 行动项剩余文本（去掉上述标记后）→ 任务 title
- `- [x]` → 任务 status 直接设为 `done`

**同步策略**（关键设计）：
- 首次保存决策 → 为每个行动项创建 Task + DecisionActionItem
- 编辑决策再次保存 → 按 lineIndex diff：
  - 新增行动项 → 创建 Task + DecisionActionItem
  - 行动项文本变更 → 更新 Task.title/dueDate/priority（**不覆盖** assignee 如果用户已手动改过）
  - 行动项勾选状态变更 → 更新 Task.status（checked → done，unchecked → todo）
  - 行动项被删除 → DecisionActionItem 标记 removed=true（**Task 保留**，不自动删——用户可能已手动编辑过）
- 用户手动修改生成的 Task → **不被决策同步覆盖**（DecisionActionItem 有 `userModified` 标记，一旦检测到 Task 与行动项原始值不一致就停止同步该字段）

### 1.3 数据模型变更

```prisma
// 新增模型
model DecisionActionItem {
  id          String   @id @default(uuid()) @db.Uuid
  decisionId  String   @map("decision_id") @db.Uuid
  taskId      String?  @map("task_id") @db.Uuid    // null = 行动项已删除，Task 保留
  lineIndex   Int      @map("line_index")            // markdown 中的行号（用于 diff 同步）
  checked     Boolean  @default(false)
  assigneeId  String?  @map("assignee_id") @db.Uuid
  dueDate     DateTime? @map("due_date") @db.Timestamptz
  priority    String   @default("medium") @db.VarChar(20)
  title       String   @db.VarChar(500)
  removed     Boolean  @default(false)               // 行动项从 markdown 中删除
  userModified Boolean @default(false) @map("user_modified") // 用户手动改过 Task，停止字段同步
  createdAt   DateTime @default(now()) @db.Timestamptz @map("created_at")
  updatedAt   DateTime @updatedAt @db.Timestamptz @map("updated_at")

  decision  Decision  @relation(fields: [decisionId], references: [id], onDelete: Cascade)
  task      Task?     @relation("DecisionActionTask", fields: [taskId], references: [id], onDelete: SetNull)
  assignee  User?     @relation(fields: [assigneeId], references: [id], onDelete: SetNull)

  @@index([decisionId])
  @@index([taskId])
  @@map("decision_action_items")
}
```

Task 模型新增关联（在现有 Task 模型中添加一行）：
```prisma
actionItems  DecisionActionItem[] @relation("DecisionActionTask")
```

Decision 模型新增关联：
```prisma
actionItems  DecisionActionItem[]
```

### 1.4 后端实现

**新增文件 `web/lib/decision-action-parser.ts`**：

```typescript
export interface ParsedActionItem {
  lineIndex: number;
  checked: boolean;
  assigneeName: string | null;   // @后跟的文本，待模糊匹配
  dueDate: string | null;        // YYYY-MM-DD
  priority: "low" | "medium" | "high" | "urgent";
  title: string;                 // 去掉标记后的纯文本
}

/** 从决策 markdown 中解析行动项 */
export function parseActionItems(markdown: string): ParsedActionItem[] {
  const lines = markdown.split("\n");
  const items: ParsedActionItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 匹配 - [ ] 或 - [x] 开头
    const match = line.match(/^\s*-\s*\[([xX\s])\]\s+(.*)/);
    if (!match) continue;
    const checked = match[1].toLowerCase() === "x";
    const rest = match[2];
    // 必须含 @用户名 或 日期才触发
    const hasAssignee = /@\S+/.test(rest);
    const hasDate = /\d{4}-\d{2}-\d{2}/.test(rest);
    if (!hasAssignee && !hasDate) continue;
    // 提取各部分
    const assigneeMatch = rest.match(/@(\S+)/);
    const dateMatch = rest.match(/(\d{4}-\d{2}-\d{2})/);
    const prioMatch = rest.match(/#(low|medium|high|urgent)/i);
    // 清理 title
    let title = rest
      .replace(/@\S+/g, "")
      .replace(/\d{4}-\d{2}-\d{2}/g, "")
      .replace(/#(low|medium|high|urgent)/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    items.push({
      lineIndex: i,
      checked,
      assigneeName: assigneeMatch?.[1] ?? null,
      dueDate: dateMatch?.[1] ?? null,
      priority: (prioMatch?.[1].toLowerCase() as any) ?? "medium",
      title: title || "未命名行动项",
    });
  }
  return items;
}
```

**新增 API 路由 `web/app/api/v1/workspaces/[wid]/tasks/[id]/decisions/[did]/sync-actions/route.ts`**：

```
POST /api/v1/workspaces/:wid/tasks/:id/decisions/:did/sync-actions
  1. 读取决策 markdown
  2. parseActionItems(markdown) → 解析行动项
  3. 读取现有 DecisionActionItem（where: decisionId, removed: false）
  4. 按 lineIndex diff：
     - 新增 → 模糊匹配 assignee（workspace members name/email）→ 创建 Task + DecisionActionItem
     - 变更 → 检查 userModified，未改则更新 Task 字段
     - 删除 → 标记 removed=true（Task 保留）
     - 勾选变更 → 更新 Task.status
  5. 对新增任务的 assignee 发送 notification（type: "task_assigned"）
  6. 返回 { created: N, updated: N, removed: N, tasks: Task[] }
```

**修改现有决策 POST 路由**（`tasks/[id]/decisions/route.ts`）：
- 在创建 Decision 后，自动调用 sync-actions 逻辑（内联，不另发请求）
- 即：POST 决策 → 创建 Decision + DecisionVersion → 解析行动项 → 创建 Tasks + DecisionActionItems → 发通知

### 1.5 前端 UI

**新增组件 `web/components/ActionItemPanel.tsx`**：
- 决策编辑器底部展开的「执行追踪」面板
- 行动项列表：勾选框 + 负责人头像 + 截止日 + 优先级标签 + 任务链接
- 顶部完成率环形图：`已完成/总数`
- 「同步到任务」按钮（保存决策时自动同步，此按钮供手动触发）

**修改 `web/app/[locale]/w/[wid]/decisions/page.tsx`**：
- Decision interface 新增 `actionItemCount` 和 `actionItemCompleted` 字段
- 时间线卡片新增「执行进度」列：`3/5` + 迷你进度条
- 点击可展开看行动项详情

**修改 `web/app/[locale]/w/[wid]/task/[id]/page.tsx`**（任务详情页的决策区域）：
- 决策卡片底部新增「执行追踪」面板（ActionItemPanel 组件）
- 保存决策后自动刷新行动项列表

**i18n 键**（`web/messages/zh.json` + `en.json`）：
```json
"decision": {
  "actionItems": "执行追踪",
  "actionProgress": "完成进度",
  "syncActions": "同步到任务",
  "noActions": "暂无行动项",
  "actionCreated": "已创建 {count} 个任务",
  "actionUpdated": "已更新 {count} 个任务"
}
```

### 1.6 实现步骤

1. Prisma schema 添加 DecisionActionItem 模型 + Task/Decision 关联 → `npx prisma migrate dev`
2. `web/lib/decision-action-parser.ts` — 解析器 + 单元测试
3. `sync-actions/route.ts` — 同步 API 路由
4. 修改 `decisions/route.ts` POST — 保存决策时自动同步
5. `web/components/ActionItemPanel.tsx` — 执行追踪面板
6. 修改决策列表页 — 执行进度列
7. 修改任务详情页 — 决策卡片底部行动项面板
8. i18n 键 + openapi.yaml 端点定义

---

## F2：Viewer角色 + 模块权限矩阵 ✅ 已实现（2026-09-11，Phase 1 f9027d1）

### 2.1 痛点

三角色（Owner/Admin/Member）太粗：外包人员需只读、新人需限制模块、跨部门需临时授权。

### 2.2 角色与权限设计

**4角色**：

| 角色 | 定位 | 权限边界 |
|------|------|---------|
| Owner | 工作区所有者 | 全权限，不可被降级 |
| Admin | 管理员 | 可管理成员+配置权限边界 |
| Member | 标准成员 | 可读写任务/决策/文档 |
| Viewer | 只读成员 | 只读全部内容，适合外包/外部协作 |

**模块权限矩阵**（默认值，Admin 可为 Member/Viewer 自定义覆盖）：

```
┌─────────────┬───────┬───────┬───────┬───────┐
│ 模块         │ Owner │ Admin │Member │Viewer │
├─────────────┼───────┼───────┼───────┼───────┤
│ tasks       │  CRUD │ CRUD  │ CRUD  │  R    │
│ decisions   │  CRUD │ CRUD  │  CR   │  R    │
│ documents   │  CRUD │ CRUD  │  CR   │  R    │
│ messages    │  CRUD │ CRUD  │ CRUD  │  R    │
│ members     │  CRUD │  CR   │  --   │  --   │
│ billing     │  CRUD │  --   │  --   │  --   │
│ analytics   │  R    │  R    │  --   │  --   │
│ settings    │  CRUD │  R    │  --   │  --   │
└─────────────┴───────┴───────┴───────┴───────┘
```

### 2.3 数据模型变更

```prisma
// Member.role 字段：现有 string，CHECK 约束需更新
// 迁移 SQL: ALTER TABLE members DROP CONSTRAINT IF EXISTS members_role_check;
//           ALTER TABLE members ADD CONSTRAINT members_role_check CHECK (role IN ('owner','admin','member','viewer'));

// 新增：模块权限覆盖表
model MemberPermission {
  id          String   @id @default(uuid()) @db.Uuid
  workspaceId String   @map("workspace_id") @db.Uuid
  role        String   @db.VarChar(20)    // "member" | "viewer"（owner/admin 不可覆盖）
  module      String   @db.VarChar(30)    // "tasks"|"decisions"|"documents"|"messages"|"members"|"billing"|"analytics"|"settings"
  actions     String[] @default([])       // ["read","create","update","delete"]
  createdAt   DateTime @default(now()) @db.Timestamptz @map("created_at")
  updatedAt   DateTime @updatedAt @db.Timestamptz @map("updated_at")

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, role, module], name: "uq_member_perm")
  @@index([workspaceId])
  @@map("member_permissions")
}
```

### 2.4 后端实现

**新增文件 `web/lib/permissions.ts`**：

```typescript
// 默认权限矩阵（代码内常量，零 DB 查询）
const DEFAULT_PERMISSIONS: Record<string, Record<string, string>> = {
  owner:  { tasks: "crud", decisions: "crud", documents: "crud", messages: "crud", members: "crud", billing: "crud", analytics: "r", settings: "crud" },
  admin:  { tasks: "crud", decisions: "crud", documents: "crud", messages: "crud", members: "cr",  billing: "",    analytics: "r", settings: "r"    },
  member: { tasks: "crud", decisions: "cr",  documents: "cr",  messages: "crud", members: "",    billing: "",    analytics: "",  settings: ""     },
  viewer: { tasks: "r",    decisions: "r",   documents: "r",   messages: "r",    members: "",    billing: "",    analytics(= "",  settings: ""     },
};

// 权限检查（带缓存：请求级 Map 缓存，避免同一请求多次查 DB）
export async function checkPermission(
  ctx: { member: { role: string; workspaceId: string } },
  module: string,
  action: "create" | "read" | "update" | "delete",
): Promise<boolean> {
  const role = ctx.member.role;
  if (role === "owner") return true;  // Owner 短路
  const actionCode = action[0]; // c/r/u/d
  // 1. 查默认权限
  const defaultActions = DEFAULT_PERMISSIONS[role]?.[module] ?? "";
  if (defaultActions.includes(actionCode)) return true;
  // 2. 查自定义覆盖（MemberPermission 表）
  //    缓存策略：getWorkspaceContext 时一次性加载该工作区的所有 MemberPermission，
  //    存入 ctx.permissions Map，此处只查内存
  const override = ctx.permissions?.[`${role}:${module}`];
  return override?.includes(actionCode) ?? false;
}

// 便捷函数：检查并返回 403
export async function requirePermission(
  ctx: WorkspaceContext,
  module: string,
  action: "create" | "read" | "update" | "delete",
  req: NextRequest,
): Promise<NextResponse | null> {
  const ok = await checkPermission(ctx, module, action);
  if (!ok) {
    return NextResponse.json(
      { code: 403, message: apiMsg(req, "forbidden"), data: null },
      { status: 403 },
    );
  }
  return null;
}
```

**修改 `web/lib/auth.ts` getWorkspaceContext**：
- 在返回 member 信息时，一次性加载该工作区的 MemberPermission（仅当 role 为 member/viewer 时）
- 将权限覆盖存入返回对象的 `permissions` 字段（Map<`${role}:${module}`, actions>）
- Owner/Admin 不需要查权限表（短路返回）

**修改现有路由的角色检查**（逐文件迁移）：

| 现有代码 | 迁移为 |
|---------|--------|
| `ctx.member.role !== "owner"` (billing) | `await requirePermission(ctx, "billing", "update", req)` |
| `ctx.member.role !== "owner" && ctx.member.role !== "admin"` (members/analytics) | `await requirePermission(ctx, "members", "update", req)` |
| 无检查的 GET 路由 | `await requirePermission(ctx, "tasks", "read", req)` |
| POST/PATCH/DELETE 路由 | `await requirePermission(ctx, "tasks", "create"/"update"/"delete", req)` |

涉及文件（基于 grep 结果）：
- `billing/checkout/route.ts` — billing:update
- `billing/portal/route.ts` — billing:update
- `Cmembers/[userId]/route.ts` — members:update / members:delete
- `tasks/batch/route.ts` — tasks:update
- `tasks/[id]/route.ts` DELETE — tasks:delete
- `analytics/overview/route.ts` — analytics:read
- `transfer-ownership/route.ts` — 保持 owner-only（特殊操作）
- 其余 GET 路由 — 对应 module:read

**新增 API 路由**：

```
GET /api/v1/workspaces/:wid/permissions
  → 返回所有角色的模块权限矩阵（默认 + 覆盖合并后）
  → 仅 owner/admin 可调用

PATCH /api/v1/workspaces/:wid/permissions
  body: { role: "member", module: "tasks", actions: ["read","create"] }
  → 更新权限覆盖（仅 owner 可调用）
  → role 为 owner 时拒绝（400）
```

### 2.5 前端实现

**修改 `web/lib/types.ts`**：
```typescript
export type Role = "owner" | "admin" | "member" | "viewer";
```

**修改 `web/lib/task-meta.ts` ROLE_META**：
```typescript
export const ROLE_META: Record<Role, { labelKey: string; icon: LucideIcon }> = {
  owner:  { labelKey: "roleOwner",  icon: Crown },
  admin:  { labelKey: "roleAdmin",  icon: Shield },
  member: { labelKey: "roleMember", icon: User },
  viewer: { labelKey: "roleViewer", icon: Eye },   // 新增
};
```

**新增页面 `web/app/[locale]/w/[wid]/settings/permissions/page.tsx`**：
- 4×8 权限矩阵可视化表格
- 每格是 4 个勾选框（R/C/U/D）
- Owner 行灰色锁定不可改
- Admin 行可改 Member 和 Viewer 列
- 保存调用 PATCH /permissions

**修改 `web/app/[locale]/w/[wid]/members/page.tsx`**：
- 邀请对话框角色下拉新增「Viewer（只读）」选项
- 选中 Viewer 时显示提示「该成员只能查看，不能编辑」
- 成员列表角色列显示 Viewer 标签

**修改 `web/app/[locale]/w/[wid]/layout.tsx`**（侧栏导航）：
- Viewer 角色隐藏「成员管理」「计费」「分析」入口
- 前端用 `role === "viewer"` 判断隐藏导航项

**修改 `web/components/SidebarNav.tsx`**：
- 导航项增加 `requiredPermission?: string` 属性
- Viewer 角色下，无权限的导航项不渲染

**i18n 键**：
```json
"role": {
  "roleOwner": "所有者",
  "roleAdmin": "管理员",
  "roleMember": "成员",
  "roleViewer": "只读成员"
},
"permissions": {
  "title": "权限管理",
  "module": "模块",
  "action": "操作",
  "read": "查看",
  "create": "创建",
  "update": "编辑",
  "delete": "删除",
  "viewerHint": "该成员只能查看内容，不能编辑"
}
```

### 2.6 实现步骤

1. Prisma schema 变更 + 迁移（MemberPermission + members role CHECK 约束）
2. `web/lib/permissions.ts` — 权限检查中间件
3. 修改 `auth.ts` getWorkspaceContext — 加载权限覆盖
4. 新增 `GET/PATCH /permissions` 路由
5. 逐文件迁移现有路由角色检查（约15个路由文件）
6. `types.ts` + `task-meta.ts` — Role 类型扩展
7. `settings/permissions/page.tsx` — 权限矩阵 UI
8. `members/page.tsx` — 邀请对话框加 Viewer
9. `layout.tsx` + `SidebarNav.tsx` — Viewer 导航过滤
10. i18n 键 + openapi.yaml 端点定义

---

## F3：Widget 仪表盘 — 可拖拽排列的工作区首页 ✅ 已实现（2026-09-11，Phase 2 0737513）

### 3.1 痛点

当前工作区首页（`w/[wid]/page.tsx`）是固定布局（3张统计卡 + 任务列表），不同角色关心的指标不同。

### 3.2 Widget 库设计

| Widget ID | 名称 | 数据源 | 默认大小(×) | 角色默认可见 |
|-----------|------|--------|-----------|-------------|
| `task-stats` | 任务统计 | tasks API 聚合 | 1×1 | all |
| `my-tasks` | 我的任务 | tasks?assignee=me | 2×2 | all |
| `decision-actions` | 决策待执行 | decisions + actionItems (F1) | 2×1 | all |
| `due-this-week` | 本周截止日 | tasks?dueDate=this_week | 2×1 | all |
| `team-load` | 团队负载热力图 | analytics/overview | 2×2 | owner/admin |
| `burndown` | 任务燃尽图 | analytics/burndown (新增) | 3×2 | owner/admin |
| `priority-dist` | 优先级分布 | tasks aggregated | 1×1 | all |
| `recent-activity` | 最近活动 | notifications | 2×1 | all |

### 3.3 技术方案

**依赖**：`react-grid-layout`（17k stars，支持拖拽+缩放+响应式+SSR）

```bash
pnpm add react-grid-layout @types/react-grid-layout
```

**SSR 兼容**：react-grid-layout 使用 `window`，需动态导入：
```typescript
import dynamic from "next/dynamic";
const ResponsiveGridLayout = dynamic(
  () => import("react-grid-layout").then(m => m.ResponsiveReactGridLayout),
  { ssr: false }
);
```

### 3.4 数据模型

```prisma
model UserDashboardPref {
  id          String   @id @default(uuid()) @db.Uuid
  userId      String   @map("user_id") @db.Uuid
  workspaceId String   @map("workspace_id") @db.Uuid
  layout     Json     // react-grid-layout 布局配置 [{i: "widget-id", x, y, w, h, minW, minH}]
  createdAt   DateTime @default(now()) @db.Timestamptz @map("created_at")
  updatedAt   DateTime @updatedAt @db.Timestamptz @map("updated_at")

  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([userId, workspaceId])
  @@map("user_dashboard_prefs")
}
```

### 3.5 API 设计

```
GET /api/v1/workspaces/:wid/dashboard/layout
  → 返回用户在该工作区的布局配置（无配置则返回角色默认布局）

PUT /api/v1/workspaces/:wid/dashboard/layout
  body: { layout: [{ i: "task-stats", x: 0, y: 0, w: 1, h: 1 }, ...] }
  → 保存布局

GET /api/v1/workspaces/:wid/dashboard/widgets/:widgetId
  → 按需加载单个 Widget 数据（避免首屏全量加载）
```

### 3.6 前端实现

**目录结构**：
```
web/components/dashboard/
  ├── DashboardGrid.tsx       // RGL 容器（拖拽+缩放+编辑模式）
  ├── WidgetCard.tsx          // Widget 卡片外壳（标题+内容+拖拽手柄）
  ├── AddWidgetDialog.tsx     // 「添加 Widget」选择对话框
  ├── widgets/
  │   ├── TaskStatsWidget.tsx
  │   ├── MyTasksWidget.tsx
  │   ├── DecisionActionsWidget.tsx   // 依赖 F1
  │   ├── DueThisWeekWidget.tsx
  │   ├── TeamLoadWidget.tsx
  │   ├── BurndownWidget.tsx
  │   ├── PriorityDistWidget.tsx
  │   └── RecentActivityWidget.tsx
  └── default-layouts.ts      // 按角色的默认布局配置
```

**`default-layouts.ts`**：
```typescript
export const DEFAULT_LAYOUTS: Record<Role, RGLItem[]> = {
  owner: [
    { i: "task-stats", x: 0, y: 0, w: 1, h: 1 },
    { i: "burndown", x: 1, y: 0, w: 3, h: 2 },
    { i: "team-load", x: 0, y: 1, w: 2, h: 2 },
    { i: "recent-activity", x: 2, y: 2, w: 2, h: 1 },
  ],
  admin: [
    { i: "task-stats", x: 0, y: 0, w: 1, h: 1 },
    { i: "burndown", x: 1, y: 0, w: 3, h: 2 },
    { i: "decision-actions", x: 0, y: 1, w: 2, h: 1 },
    { i: "recent-activity", x: 2, y: 2, w: 2, h: 1 },
  ],
  member: [
    { i: "task-stats", x: 0, y: 0, w: 1, h: 1 },
    { i: "my-tasks", x: 1, y: 0, w: 2, h: 2 },
    { i: "due-this-week", x: 0, y: 1, w: 2, h: 1 },
    { i: "priority-dist", x: 3, y: 0, w: 1, h: 1 },
  ],
  viewer: [
    { i: "task-stats", x: 0, y: 0, w: 1, h: 1 },
    { i: "recent-activity", x: 1, y: 0, w: 2, h: 1 },
  ],
};
```

**改造 `w/[wid]/page.tsx`**：
- 替换现有固定布局为 `<DashboardGrid wid={wid} role={role} />`
- 顶部：欢迎语 + 「添加 Widget」按钮 + 「编辑布局」开关
- 主体：ResponsiveGridLayout 网格
- 编辑模式：可拖拽、缩放、删除 Widget（拖拽手柄出现）
- 非编辑模式：Widget 固定，内部可交互（点击任务跳转等）
- 移动端：禁用拖拽，改为纵向堆叠（RGL 的 `isDraggable={false}` + `cols={1}`）

**Widget 数据加载策略**：
- 首屏：并行加载所有可见 Widget 的数据（`Promise.all`）
- 每个 Widget 内部有独立 loading/error 状态（Skeleton 占位）
- 编辑布局时不需要重新加载数据

**布局版本兼容**：
- 新增 Widget 时，旧布局配置中没有该 Widget → 不显示（用户可通过「添加 Widget」手动加）
- Widget 被移除时，旧布局中有该 Widget → 跳过渲染（不报错）

### 3.7 实现步骤

1. `pnpm add react-grid-layout @types/react-grid-layout`
2. Prisma schema 添加 UserDashboardPref + 迁移
3. `GET/PUT /dashboard/layout` + `GET /dashboard/widgets/:id` 路由
4. `components/dashboard/` 目录 — Widget 组件库（8个 Widget）
5. `DashboardGrid.tsx` — RGL 容器
6. 改造 `w/[wid]/page.tsx` 为仪表盘
7. `default-layouts.ts` — 角色默认布局
8. i18n 键 + openapi.yaml 端点定义

---

## F4：Markdown → PDF/HTML 导出 ✅ 已实现（2026-09-11，Phase 2 0737513）

### 4.1 痛点

决策记录和文档只能在 Web 端查看，无法离线分享或归档。

### 4.2 方案：纯客户端导出

使用浏览器原生 `window.print()` + 打印样式 CSS，零服务端成本。

### 4.3 前端实现

**新增组件 `web/components/ExportPreview.tsx`**：
```typescript
interface ExportPreviewProps {
  title: string;
  markdown: string;
  open: boolean;
  onClose: () => void;
}
```
- 模态框内显示打印预览（Markdown 渲染为 HTML + 打印样式）
- 底部「打印 / 保存为 PDF」按钮 → `window.print()`
- 可选：导出范围（全文 / 仅已发布版本）

**打印样式**（`web/app/globals.css` 新增）：
```css
@media print {
  /* 隐藏所有非打印内容 */
  body * { visibility: hidden; }
  /* 仅显示导出容器 */
  .export-container, .export-container * { visibility: visible; }
  /* 导出容器全屏 */
  .export-container {
    position: absolute;
    left: 0; top: 0; width: 100%;
  }
  /* 隐藏导航/侧栏/操作栏 */
  nav, aside, .no-print { display: none !important; }
  /* 分页控制 */
  h1, h2 { page-break-after: avoid; }
  pre, table { page-break-inside: avoid; }
  /* 字体优化 */
  body { font-size: 12pt; line-height: 1.6; }
}
```

**修改 `web/components/DocumentEditor.tsx`**：
- 操作栏「导出」按钮（Download 图标已导入）→ 打开 ExportPreview 模态框
- 传入 title + markdown

**修改任务详情页决策区域**：
- 决策卡片操作栏新增「导出」按钮
- 传入决策标题 + markdown

**Mermaid 图表打印兼容**：
- Mermaid 渲染为 SVG，`@media print` 中 SVG 正常打印
- 确保打印前所有 Mermaid 已完成渲染（延迟 500ms 再调 print）

### 4.4 实现步骤

1. `web/components/ExportPreview.tsx` — 导出预览模态框
2. `web/app/globals.css` — `@media print` 样式
3. DocumentEditor 添加导出按钮
4. 决策卡片添加导出按钮
5. i18n 键

---

## F5：分享增强 — 有效期 + 密码 + 访问日志 ✅ 已实现（2026-09-11，Phase 2 0737513）

### 5.1 痛点

当前分享 token 是永久有效的无密码只读链接，不适合对外分享敏感决策。

### 5.2 数据模型变更

```prisma
// Document 模型新增字段
model Document {
  // ... 现有字段 ...
  shareExpiresAt  DateTime? @map("share_expires_at") @db.Timestamptz  // null = 永不过期
  sharePassword   String?   @map("share_password") @db.VarChar(100)    // null = 无密码（存 scrypt hash，与 Better Auth 一致）
}

// Task 模型同上新增
model Task {
  // ... 现有字段 ...
  shareExpiresAt  DateTime? @map("share_expires_at") @db.Timestamptz
  sharePassword   String?   @map("share_password") @db.VarChar(100)
}

// 新增：分享访问日志
model ShareAccessLog {
  id          String   @id @default(uuid()) @db.Uuid
  entityType  String   @map("entity_type") @db.VarChar(20)  // "document" | "task"
  entityId    String   @map("entity_id") @db.Uuid
  ip          String?  @db.VarChar(45)
  userAgent   String?  @map("user_agent") @db.Text
  accessedAt  DateTime @default(now()) @db.Timestamptz @map("accessed_at")

  @@index([entityType, entityId, accessedAt])
  @@map("share_access_logs")
}
```

### 5.3 后端实现

**密码 hash**：复用 Better Auth 的 scrypt（`web/lib/crypto.ts` 已有 hash/verify 函数）

**修改分享路由**（`web/app/api/v1/workspaces/[wid]/documents/[id]/route.ts` PATCH）：
- 新增字段 `shareExpiresAt` 和 `sharePassword` 的更新支持
- `sharePassword` 存 scrypt hash（明文不存）

**修改公开分享路由**（`web/app/[locale]/documents/share/[token]/page.tsx`）：
- 检查有效期：`shareExpiresAt < now` → 返回 410 Gone 页面（「链接已过期」）
- 检查密码：
  - 无密码 → 直接显示内容
  - 有密码 → 显示密码输入页
  - 密码验证：scrypt verify → 正确则记录访问日志 + 显示内容
  - 密码错误 3 次 → 5 分钟锁定（IP 级别限流）

**新增 API 路由**：
```
POST /api/v1/workspaces/:wid/documents/:id/share/verify
  body: { password: string }
  → 验证密码，正确则返回内容 + 记录日志

GET /api/v1/workspaces/:wid/documents/:id/share/logs
  → 返回分享访问日志（分页，仅 owner/admin）

PATCH /api/v1/workspaces/:wid/documents/:id/share
  body: { expiresAt?: string | null, password?: string | null }
  → 更新分享设置
```

### 5.4 前端实现

**修改 DocumentEditor 分享对话框**：
- 有效期选择：永不过期 / 7天 / 30天 / 自定义日期 picker
- 密码保护：可选输入密码（输入后显示「已启用密码保护」）
- 「访问日志」可展开区域：显示最近 20 条访问记录（IP + 时间 + UA 摘要）
- 撤销分享按钮（清除 shareToken + shareExpiresAt + sharePassword）

**新增密码输入页**（`web/components/SharePasswordGate.tsx`）：
- 居中卡片 + 密码输入框 + 「访问」按钮
- 密码错误提示 + 剩余尝试次数
- 锁定状态提示（5 分钟后重试）

**Task 分享同步增强**（`tasks/share/[token]/page.tsx`）：
- 同样支持有效期 + 密码 + 访问日志

### 5.5 实现步骤

1. Prisma schema 变更 + 迁移
2. 修改 Document/Task PATCH 路由 — 支持 shareExpiresAt/sharePassword 更新
3. 修改公开分享路由 — 有效期/密码检查
4. `SharePasswordGate.tsx` — 密码输入组件
5. 访问日志 API + UI
6. DocumentEditor 分享对话框增强
7. i18n 键

---

## F6：暖度调节 — 密度切换 + 彩色可视化 + 空状态插画 ✅ 已实现（2026-09-11，Phase 3 0737513）

### 6.1 痛点

UI「专业到看不见设计」，对技术/PM型用户完美，但对设计/运营/市场型用户偏冷。

### 6.2a 密度切换

**实现**：在 `<html>` 上切换 `data-density="compact"|"comfortable"`，CSS 变量响应。

```css
/* design-tokens.css 新增 */
:root[data-density="comfortable"] {
  --space-1: 5px;    /* 原 4px */
  --space-2: 10px;   /* 原 8px */
  --space-3: 15px;   /* 原 12px */
  --space-4: 20px;   /* 原 16px */
  --space-5: 25px;   /* 原 20px */
  --space-6: 35px;   /* 原 28px */
  --radius-sm: 8px;  /* 原 6px */
  --radius-md: 12px; /* 原 10px */
  --radius-lg: 16px; /* 原 14px */
}
```

**修改 `web/app/[locale]/w/[wid]/settings/page.tsx`**：
- 在现有「主题」切换区域旁新增「密度」切换（紧凑/舒适）
- 持久化到 `localStorage: "corps_density"`
- 挂载时读取并设置 `document.documentElement.setAttribute("data-density", pref)`

### 6.2b 彩色数据可视化

**修改 analytics 页 + Widget 仪表盘图表**：

- **燃尽图**（`BurndownWidget.tsx`）：渐变填充
  ```svg
  <defs><linearGradient id="burnGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.3" />
    <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.05" />
  </linearGradient></defs>
  ```
- **热力图**（`TeamLoadWidget.tsx`）：多色阶
  ```typescript
  const HEAT_COLORS = ["var(--success)", "var(--warn)", "var(--danger)"];
  // 按负载百分比选色：<33% green, 33-66% yellow, >66% red
  ```
- **优先级分布**（`PriorityDistWidget.tsx`）：三色饼图
  ```typescript
  const PRIO_COLORS = {
    urgent: "var(--danger)",
    high: "var(--warn)",
    medium: "var(--accent)",
    low: "var(--muted)",
  };
  ```
- **任务状态分布**：三色环形图
  ```typescript
  const STATUS_COLORS = {
    todo: "var(--status-todo-fg)",
    in_progress: "var(--status-doing-fg)",
    done: "var(--status-done-fg)",
  };
  ```

所有彩色仍走 design token，不硬编码 hex。

### 6.2c 空状态轻量 SVG 插画

**新增组件 `web/components/EmptyState.tsx`**：
```typescript
interface EmptyStateProps {
  variant: "tasks" | "decisions" | "documents" | "notifications" | "search" | "members";
  title: string;
  description?: string;
  action?: { label: string; href: string };
}
```

内置 6 种轻量 SVG 插画（用 `currentColor`，随主题自动适配）：
- `tasks`：空收件箱
- `decisions`：空文档+放大镜
- `documents`：空文件夹
- `notifications`：空铃铛
- `search`：放大镜+问号
- `members`：空座位

SVG 风格：线性图标风（与 Lucide 一致），1.5px 描边，`var(--muted)` 色，64×64px。

**替换现有空状态**：
- 搜索 `空状态|暂无|empty` 关键词，逐一替换为 `<EmptyState />` 组件
- 涉及：board/page.tsx、decisions/page.tsx、documents/page.tsx、notifications/page.tsx、my-tasks/page.tsx

### 6.3 实现步骤

1. `design-tokens.css` — 密度变量覆盖
2. `settings/page.tsx` — 密度切换 UI + 持久化
3. `EmptyState.tsx` — SVG 插画空状态组件
4. 各页面空状态替换为 EmptyState
5. Widget 图表多色化（燃尽图/热力图/饼图/环形图）
6. i18n 键

---

## 实现顺序与依赖关系

```
Phase 1（P0，2.5周）— 2个 subagent 可并行：
  F2（Viewer + 权限矩阵）→ 无依赖
    ├─ Prisma 迁移
    ├─ permissions.ts 中间件
    ├─ 现有路由迁移（15个文件）
    ├─ 前端 types + UI
    └─ 预估 1 周

  F1（决策驱动执行）→ 无依赖
    ├─ Prisma 迁移
    ├─ action-parser.ts
    ├─ sync-actions API
    ├─ ActionItemPanel 组件
    ├─ 决策列表/详情页改造
    └─ 预估 1.5 周

Phase 2（P1，2.5周）— 3个 subagent 可并行：
  F3（Widget仪表盘）→ 依赖 F1 的 DecisionActionsWidget
    ├─ react-grid-layout 依赖
    ├─ Prisma 迁移
    ├─ 8 个 Widget 组件
    ├─ DashboardGrid 容器
    ├─ 工作区首页改造
    └─ 预估 1.5 周

  F4（PDF导出）→ 无依赖
    ├─ ExportPreview 组件
    ├─ @media print 样式
    ├─ DocumentEditor + 决策导出按钮
    └─ 预估 0.5 周

  F5（分享增强）→ 无依赖
    ├─ Prisma 迁移
    ├─ 分享路由增强
    ├─ SharePasswordGate 组件
    ├─ 访问日志 API + UI
    └─ 预估 0.5 周

Phase 3（P2，1周）：
  F6（暖度调节）→ 依赖 F3 的 Widget 图表
    ├─ design-tokens 密度变量
    ├─ settings 密度切换
    ├─ EmptyState 组件 + 替换
    ├─ Widget 图表多色化
    └─ 预估 1 周
```

## 数据库迁移顺序

```
migration_1: F2 — MemberPermission 表 + members role CHECK 约束更新
migration_2: F1 — DecisionActionItem 表 + Task/Decision 关联
migration_3: F3 — UserDashboardPref 表
migration_4: F5 — Document/Task shareExpiresAt/sharePassword + ShareAccessLog 表
```

## 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| F1 行动项解析误触发任务 | 中 | 中 | 仅识别含 `@user` 或 `date` 的 checkbox，纯 checkbox 不触发 |
| F1 用户手动改 Task 后被同步覆盖 | 中 | 高 | `userModified` 标记：检测到 Task 与行动项原始值不一致即停止该字段同步 |
| F2 权限检查增加 API 延迟 | 低 | 低 | Owner 短路 + 请求级内存缓存（getWorkspaceContext 一次性加载） |
| F2 现有路由迁移遗漏 | 中 | 高 | grep 所有 `ctx.member.role` 出现点，逐文件核对 |
| F3 react-grid-layout SSR 报错 | 中 | 中 | dynamic import + ssr:false |
| F3 移动端拖拽体验差 | 中 | 中 | 移动端 isDraggable=false + cols=1 纵向堆叠 |
| F3 新增 Widget 旧布局不兼容 | 低 | 低 | 未识别的 Widget ID 跳过渲染，用户手动添加 |
| F4 打印样式跨浏览器不一致 | 低 | 低 | 以 Chrome 为基准，Firefox/Safari 基本兼容 |
| F5 密码 hash 性能 | 低 | 低 | scrypt 复用 Better Auth 配置，单次 <100ms |
| F5 密码暴力破解 | 中 | 中 | 3 次错误后 IP 级 5 分钟锁定 |
| F6 密度切换导致布局偏移 | 低 | 低 | CSS 变量 150ms transition 过渡 |

## 测试策略

| 功能 | 单元测试 | 集成测试 | E2E |
|------|---------|---------|-----|
| F1 | action-parser 解析器 | sync-actions API | 决策→行动项→任务全链路 |
| F2 | permissions.ts 权限矩阵 | 各路由 403 响应 | Viewer 登录后 UI 隐藏 |
| F3 | default-layouts | dashboard/layout API | 拖拽 Widget + 刷新保持 |
| F4 | — | — | 导出预览 + 打印 |
| F5 | scrypt verify | 分享密码验证 | 密码输入→查看→日志 |
| F6 | — | — | 密度切换 + 空状态展示 |

## openapi.yaml 新增端点汇总

```
POST   /api/v1/workspaces/{wid}/tasks/{id}/decisions/{did}/sync-actions
GET    /api/v1/workspaces/{wid}/permissions
PATCH  /api/v1/workspaces/{wid}/permissions
GET    /api/v1/workspaces/{wid}/dashboard/layout
PUT    /api/v1/workspaces/{wid}/dashboard/layout
GET    /api/v1/workspaces/{wid}/dashboard/widgets/{widgetId}
PATCH  /api/v1/workspaces/{wid}/documents/{id}/share
POST   /api/v1/workspaces/{wid}/documents/{id}/share/verify
GET    /api/v1/workspaces/{wid}/documents/{id}/share/logs
PATCH  /api/v1/workspaces/{wid}/tasks/{id}/share
POST   /api/v1/workspaces/{wid}/tasks/{id}/share/verify
GET    /api/v1/workspaces/{wid}/tasks/{id}/share/logs
```
---

## 实现总结（2026-09-11）

| 阶段 | 功能 | Commit | 状态 |
|------|------|--------|------|
| Phase 1 | F1 决策驱动执行 + F2 Viewer/权限矩阵 | f9027d1 | ✅ 已实现 |
| Phase 2+3 | F3 Widget仪表盘 + F4 PDF导出 + F5 分享增强 + F6 暖度调节 | 0737513 | ✅ 已实现 |
| Review fix | 审查修复（openapi 对齐 + zod 校验 + 枚举 schema） | b9fdbe9 | ✅ 已实现 |

**实现闭环**：设计（本文档）→ 实现（3 阶段）→ 审查（openapi/zod/枚举对齐）→ 修复（b9fdbe9）→ 文档对齐（SPEC.md v0.7.0 + LANDING.md 端点数 59）
