# UI 与原型对齐缺口报告（corps v0.1.0）

- **提交**：颜好看（UI/UX 设计师）｜依据：`design/prototype/index.html`、`design/design-tokens.json`、`design/DESIGN.md`
- **设计语言**：Calm Precision（Notion 留白 + Linear 精度 + Stripe 克制）｜图标库：lucide-react（16/20/24/32，2px stroke，禁 emoji）

---

## 一、缺口表（按优先级）

| 页面 / 区域 | 当前状态 | 缺口 | 对应 Token | 优先级 |
|---|---|---|---|---|
| 工作区外壳 layout | topbar+sidebar 已有，但导航项缺失 | 缺成员/计费/设置导航项；缺 workspace 切换、Cmd+K 入口、主题切换 | --shell-* / --accent | P0 |
| 看板 Board | 已建，基本贴合 token | 卡片拖拽无乐观反馈动画；空状态已 OK | 已对齐 | P1 |
| 登录/注册 Auth | 基础表单 | 未对齐原型（缺品牌区、信任文案、聚焦态/ARIA 细化） | --surface / --accent | P1 |
| 工作区 Home | **缺失** | Cmd+K 命令栏 + Slim Sidebar + 非对称主区（今日/我的任务/最近决策） | --shell-* | P0 |
| 任务详情 TaskDetail | **缺失** | 详情 + 评论 + 决策记录（Markdown） | --surface-2 | P0 |
| 成员管理 Members | 占位空页 | 邀请 + 角色下拉 + 移除 | --surface | P0 |
| 计费 Billing | **缺失** | 套餐卡 + Portal 入口 + 当前用量 | --accent / --success | P1 |
| 设置 Settings | 占位空页 | 工作区名/slug/主题/危险区 | --surface | P2 |
| 空状态/Onboarding | 看板有 | 缺首屏引导「60 秒建首个任务并指派」（AC-07） | --muted | P1 |

## 二、统一 Shell 规范（topbar + sidebar）

- **Topbar（56px, --topbar-h）**：左=工作区切换（breadcrumb + 下拉选 workspace）；中=Cmd+K 触发按钮（⌘K 提示）；右=主题切换（sun/moon）、用户菜单（初始头像）。
- **Sidebar（240px, --sidebar-w）**：Logo「corps」+ 导航项（看板/成员/计费/设置）+ 底部工作区信息。
- **Content**：非对称主区，最大宽 `--container-max`，留白 `--section-y`。

### 图标映射总表（lucide-react）

| 位置 | 图标 | 尺寸 |
|---|---|---|
| 看板导航 | `LayoutDashboard` | 20 |
| 成员导航 | `Users` | 20 |
| 计费导航 | `CreditCard` | 20 |
| 设置导航 | `Settings` | 20 |
| 命令栏触发 | `Search` | 20 |
| 主题切换 | `Sun` / `Moon` | 20 |
| 新建任务 | `Plus` | 16 |
| 拖拽手柄 | `GripVertical` | 16 |
| 工作区切换 | `ChevronsUpDown` | 16 |
| 用户菜单 | `UserCircle` | 20 |
| 任务优先级 | `Flag` | 16 |
| 截止日 | `Calendar` | 16 |
| 评论 | `MessageSquare` | 16 |
| 决策记录 | `FileText` | 16 |
| 邀请成员 | `UserPlus` | 16 |
| 删除/危险 | `Trash2` | 16 |
| 成功/完成 | `CheckCircle2` | 16 |
| 警告/空 | `AlertCircle` | 20+ |

## 三、逐页构建规范（给前端工程师）

### Home（/w/:wid）
- 布局：Slim Sidebar（收起态 64px，hover/点击展开）+ 非对称主区（左 2/3「我的任务」+「今日」，右 1/3「最近决策」「团队成员」）。
- 命令栏：Cmd+K 打开 modal（overlay --z-cmd），输入检索任务/决策；lucide `Search`。
- Token：--bg / --surface / --accent / --muted。

### TaskDetail（/w/:wid/task/:id）
- 两栏：主栏任务字段（标题/描述/状态/优先级/负责人/截止），侧栏「评论」(`MessageSquare`) + 「决策记录」(`FileText`, Markdown 渲染)。
- 评论支持 @提及（@输入触发成员列表）。

### Members（/w/:wid/members）
- 列表行：头像(`UserCircle`) + 名称/邮箱 + 角色下拉(owner/admin/member，Admin 可改) + 移除(`Trash2`, Member 自见不可移除他人)。
- 顶部「邀请成员」按钮(`UserPlus`) → 邮箱输入 → 调用 invite 端点；超 seatLimit 提示升级。

### Billing（/w/:wid/billing）
- 套餐卡：Free / Starter / Pro（由 `Workspace.plan` 高亮当前）；用量条（成员数/seatLimit）。
- 「升级/管理订阅」按钮 → 调 `/billing/checkout` 或 `/billing/portal`（Owner 可见）。
- 状态徽标：active(past_due 用 --warn) / trialing / canceled。

### Settings（/w/:wid/settings）
- 表单：工作区名、slug（只读展示）、主题切换、危险区「删除工作区」(`Trash2` + 确认)。

### Auth（login/signup）
- 居中卡片（--surface，--shadow-md，--radius-lg）；左品牌区「corps · 团队」+ 一句话价值主张（真实文案，非 Welcome to）；右表单。聚焦态 `focus-visible` + --accent-ring；错误用 --danger-soft。

## 四、P0 合规核对（当前代码）

- board/page.tsx：用 lucide（✅ 禁 emoji）、颜色走 var(--token)（✅ 无硬编码），`urgent:"#DC3D4A"` 为硬编码色 → **需改为 var(--danger)**。
- 全局：主色 --accent 纯色（✅ 无紫粉渐变）；缓动用 token ease-standard（✅ 无弹跳）。
- 修正点：board.tsx 第 28 行 `urgent: "#DC3D4A"` → `var(--danger)`。
