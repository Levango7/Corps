# corps DESIGN.md

> 生成日期：2026-08-19 ｜ 设计师：颜好看 ｜ 基于：PRD v1 + 架构文档 v1 + UIUX 文档 v1
> 三轴刻度：Variance=5 / Motion=3 / Density=4（产品型寄存器 · Product Register）
> 设计语言：**Calm Precision（克制精密）** = Notion 留白 + Linear 精度 + Stripe 克制
> 对标品牌：**Stripe Dashboard > Linear > Notion**（飞书仅作竞品功能参照，不抄其蓝）
> Token 源：`design-tokens.css`（浅色默认 + `[data-theme="dark"]`）+ `design-tokens.json`（机器可读）

---

## ① 设计语言与定位（Visual Theme & Atmosphere）

- **关键词**：克制（restrained）· 精密（precise）· 中性底色（neutral canvas）· 单点强调（single-accent）· 数据可信（trustworthy）
- **氛围描述**：浅中性灰底（`--bg`）承托纯白卡片（`--surface`），全站以钴蓝纯色（`--accent`）作唯一强调，无渐变、无发光、无毛玻璃装饰；信息密度适中、留白克制、栅格对齐到 4px。像 Stripe Dashboard 一样"专业到看不见设计"。
- **产品设计寄存器（Product Register）**：本产品是工具型 SaaS（非营销站），因此色彩收敛——中性色 ≥85%，强调色 ≤8%，语义色 ≤4%。**首屏不是营销 Hero，而是内容优先的非对称工作台**。
- **对标拆解**：
  - Stripe Dashboard → 克制的单色强调 + 表格精密度 + 错误/空态引导
  - Linear → 命令栏（Cmd+K）签名交互 + 键盘可达 + 200ms 内动效收敛
  - Notion → 留白节奏 + 内容优先布局 + 极简导航

---

## ② 色彩系统（Color Palette & Roles）

### 2.1 四层 Token 映射（Primitive → Semantic → Component）

> 组件层**只允许引用语义变量**，Primitive（原始 hex）仅存在于 `design-tokens.css` 顶部集中声明。本表是 Source of Truth。

| 角色 | Primitive（仅 CSS 内部） | Semantic 变量（组件引用） | 用途 |
|------|--------------------------|---------------------------|------|
| 页面底 | `#F7F8FA` / 暗 `#0E0F12` | `--bg` | 全局背景 |
| 卡片底 | `#FFFFFF` / 暗 `#16181D` | `--surface` | 卡片/弹窗/输入底 |
| 次级底 | `#F2F3F6` / 暗 `#1E2026` | `--surface-2` | 悬停/内嵌区 |
| 三级底 | `#ECEEF2` / 暗 `#262932` | `--surface-3` | 条纹/分隔区 |
| 主文字 | `#16181D` / 暗 `#F2F3F5` | `--fg` | 标题/正文 |
| 次文字 | `#3A3F4A` / 暗 `#C7CBD3` | `--fg-2` | 小标题/强调正文 |
| 辅助文字 | `#6B7280` / 暗 `#8B919E` | `--muted` | 副信息（非长正文） |
| 元数据 | `#9AA1AD` / 暗 `#6A707C` | `--meta` | 时间戳/计数 |
| 边框 | `#E6E8EC` / 暗 `#272A31` | `--border` | 默认 1px 边框 |
| 发丝边框 | `#F0F1F4` / 暗 `#1E2026` | `--border-soft` | 行内分隔 |
| **强调主色** | `#4263EB` / 暗 `#4D74FB` | `--accent` | **唯一品牌色（钴蓝纯色）** |
| 强调悬停 | `#2440CC` / 暗 `#6E8EFC` | `--accent-hover` | 按钮/链接 hover |
| 强调激活 | `#1E38B0` / 暗 `#88A4FD` | `--accent-active` | 按下态 |
| 强调柔和底 | `#EAF0FF` / 暗 `rgba(77,116,251,.16)` | `--accent-soft` | 选中导航背景 |
| 强调柔和字 | `#4263EB` / 暗 `#4D74FB` | `--accent-soft-fg` | 选中项文字 |
| 强调上文字 | `#FFFFFF` | `--on-accent` | 强调底上的文字 |
| 焦点环 | `rgba(42,72,230,.30)` / 暗 `rgba(77,116,251,.40)` | `--accent-ring` | focus-visible 环 |
| 成功 | `#1A9E6B` / 暗 `#34C98A` | `--success` | 完成态/通过 |
| 警告 | `#C9881A` / 暗 `#E0A93A` | `--warn` | 优先级中/注意 |
| 危险 | `#DC3D4A` / 暗 `#F25B67` | `--danger` | 错误/删除/高优先级 |
| 任务·待办 | `var(--muted)` | `--status-todo-fg` | 状态点 |
| 任务·进行中 | `var(--accent)` | `--status-doing-fg` | 状态点 |
| 任务·已完成 | `var(--success)` | `--status-done-fg` | 状态点 |
| 优先级·高 | `var(--danger)` | `--prio-high-fg` | 优先级点 |
| 优先级·中 | `var(--warn)` | `--prio-med-fg` | 优先级点 |
| 优先级·低 | `var(--muted)` | `--prio-low-fg` | 优先级点 |

### 2.2 双主题

- **浅色默认**：`design-tokens.css` 的 `:root` 即浅色值，无需选择器。
- **深色**：`<html data-theme="dark">`（或任意祖先）触发 `:root[data-theme="dark"]` 覆盖块。仅覆盖 Primitive 与少量派生，结构/间距/圆角/动效全沿用。
- 主题切换：在 `<html>` 上切换 `data-theme`，并提供右上角主题开关（Sun/Moon 图标，Lucide `sun`/`moon`）。切换不做整页动画，仅 150ms 背景/文字过渡。

### 2.3 表面质感（Calm Surface）与三层外壳背景

为营造"宁静祥和"的留白质感，并让应用外壳具备清晰的层级但不花哨，采用**同色系、明度递降**的三层背景方案（类飞书但更克制、更浅）：

| 层级 | Token | 浅色值 | 角色 |
|------|-------|--------|------|
| 顶栏（最亮、悬浮层） | `--shell-topbar` | `--surface`（纯白 #FFFFFF） | 压在淡蓝内容之上，轻底边阴影 |
| 侧栏（中间层、微透） | `--shell-sidebar` | `color-mix(--surface 84%, --accent 7%)` | 淡蓝微透，建立"壳"的边界 |
| 内容底布（最沉静） | `--shell-content`（= `--surface-calm`） | `color-mix(--surface 90%, --accent 6%)` | 更浅淡蓝，承载卡片 |

- **协调原则**：三者同取 `--accent` 蓝调，明度从顶栏纯白 → 侧栏微透淡蓝 → 内容更浅淡蓝逐层回落；卡片（`--surface` 纯白）浮于内容底布之上，形成"白卡浮于淡蓝底"的办公级平和层次。
- `--surface-calm`：白天 = `color-mix(--surface 90%, --accent 6%)`；深色 = `color-mix(#16181D 92%, #4D74FB 7%)`。用于 `.card`、`.stat`、`.mini`、内容底布等承载型表面，替代纯 `--bg`。
- 上述均经 `color-mix` 派生，租户换肤时随 `--accent` 自动联动，不另定义。

### 2.4 租户 `--accent` 覆盖机制（多租户换肤）

多租户 SaaS，每个 workspace 可带品牌强调色。派生色使用 `color-mix(var(--accent) …)` 定义，因此**租户只需覆盖一个变量**：

```css
/* 在 <html data-tenant-theme="acme"> 或 workspace 根节点上 */
:root[data-tenant-theme="acme"] {
  --p-accent:      #1F7A4D;   /* 客户森林绿 */
  --p-accent-dk:   #1A6841;
  --p-accent-dkr:  #155636;
  --p-accent-soft: color-mix(in srgb, #1F7A4D 12%, transparent);
  --p-accent-ring: rgba(31,122,77,0.30);
}
/* --accent-hover/active/soft/ring 经 color-mix 自动重算，无需重定义 */
```

- 覆盖层仅改 Primitive（`--p-accent*`），语义变量 `--accent` 引用 `--p-accent` 自动继承。
- 客户端在 workspace 根容器读取 `data-tenant-theme` 即可换肤；不写死在组件里。

### 2.5 每屏强调色 ≤ 2 处（强制）

- 全站每屏**最多 2 处** `--accent` 可见使用：① 主 CTA 按钮 ② 当前选中导航项（`--accent-soft` 背景 + 左侧 2px `--accent`）。其余一律中性。
- 标题、正文、图标（默认 `currentColor` 取 `--fg-2`）**不**使用 `--accent`。
- 状态点/语义色（success/warn/danger）属于"状态信号"，不计入"强调色"配额，但单屏内仍克制使用。

---

## ③ 字体与排版阶梯（Typography）

### 3.1 字体栈

```css
--font-display: "Inter", "Noto Sans SC", -apple-system, sans-serif;
--font-body:    "Inter", "Noto Sans SC", -apple-system, sans-serif;
--font-mono:    "JetBrains Mono", "Fira Code", ui-monospace, monospace;
```

- 拉丁文 Inter，中文 Noto Sans SC（避免中文回退到系统默认导致的"AI 模板味"）。
- 等宽 JetBrains Mono：任务 ID、日期、计量数字、命令栏快捷键提示。
- 加载：经 `next/font`（Inter / Noto Sans SC）与 `@fontsource/jetbrains-mono`，**不**用 `<link>` 到第三方 CDN，避免布局抖动（CLS）。

### 3.2 字号阶梯（8 级，应用密度 base=14px）

| Token | 值 | 用途 |
|-------|----|------|
| `--text-xs` | 12px | 标签、时间戳、计数 |
| `--text-sm` | 13px | 次要文本、表头 |
| `--text-base` | 14px | **正文基准**（看板/表格） |
| `--text-md` | 16px | 强调正文、输入框 |
| `--text-lg` | 18px | 小标题 |
| `--text-xl` | 20px | 二级标题 |
| `--text-2xl` | 24px | 一级标题（页眉） |
| `--text-3xl` | 30px | 页级标题（极少） |
| `--text-4xl` | 36px | 仅空态大标题 |

### 3.3 字重三级（禁用默认 500/600 的含糊中间档，按 Spec 锁定）

- `--weight-regular: 400` → 正文、描述
- `--weight-medium: 510` → 按钮文字、表头、小标题
- `--weight-semibold: 590` → 页眉标题、强调数字

### 3.4 行高 / 字距

- 行高：正文 `--leading-normal: 1.5`；标题 `--leading-tight: 1.2`；辅助 `--leading-snug: 1.35`
- 字距：展示字（`≥30px`）`--tracking-display: -0.02em`；标题（`≥20px`）`--tracking-tight: -0.01em`；正文 `0`；ALL CAPS / 小标签 `--tracking-caps: 0.06em`（如导航区节标签、状态徽章大写字母）

### 3.5 配对原则

- 仅 2 套字体（display=body=Inter+Noto，mono 单独不算配对）。
- 正文每行 50–75 字符；表格/看板单元克制到 1–2 行，超长按 `--truncate` 处理。

---

## ④ 间距 / 圆角 / 阴影 / 4px 网格（Layout & Spacing）

### 4.1 间距（4px 基准网格，禁用 5/7/13/15/22/30 等非标值）

| Token | 值 | 用途 |
|-------|----|------|
| `--space-1` | 4px | 图标与文字间隙 |
| `--space-2` | 8px | 同组紧凑元素 |
| `--space-3` | 12px | 表单元素间距 |
| `--space-4` | 16px | 卡片内边距（舒适） |
| `--space-5` | 20px | 模块间距 |
| `--space-6` | 24px | 区块间距 |
| `--space-8` | 32px | 大区块 |
| `--space-10` | 40px | 页级 |
| `--space-12` | 48px | 最大区块 |
| `--space-16` | 64px | 仅首屏留白 |
| `--space-20` | 80px | 极少用 |

### 4.2 圆角（≤16px，禁 ≥24px 过度圆滑）

`--radius-sm: 6px`（按钮/输入）· `--radius-md: 8px`（Tab/小卡）· `--radius-lg: 12px`（卡片）· `--radius-xl: 16px`（弹窗/大卡）· `--radius-pill: 9999px`（头像/胶囊标签）。

### 4.3 阴影（克制，浅色以边框为主，深色以亮度递进为主）

| Token | 浅色值 | 用途 |
|-------|--------|------|
| `--elev-flat` | none | 默认卡片（靠 `--border`） |
| `--elev-ring` | `0 0 0 1px var(--border)` | 卡片默认边 |
| `--elev-sm` | `0 1px 2px rgba(16,24,29,.04)` | hover 微浮 |
| `--elev-md` | `0 4px 12px rgba(16,24,29,.06)` | 下拉/弹窗 |
| `--elev-lg` | `0 12px 32px rgba(16,24,29,.10)` | Modal/命令栏浮层 |
| `--elev-hover` | `0 6px 18px rgba(16,24,29,.08)` | 卡片/行 hover 微抬升 |

- 新增 `--elev-hover`：比 `--elev-sm` 略强、比 `--elev-md` 弱，专用于**可交互卡片/任务行 hover 时**的"被托起"提示，配合 `translateY(-1~-2px)`。
- **禁用**默认毛玻璃 / 发光边框 / 投影 ≥ 模糊 24px 的"幽灵卡片"组合。
- 深色主题阴影极弱（靠 1px `--border` 分隔），层级靠表面亮度递进（`--surface`→`--surface-2`→`--surface-3`）。

### 4.4 布局骨架

- `--container-max: 1280px`（工作区内容最大宽）
- `--sidebar-w: 240px`（Slim Sidebar）
- `--topbar-h: 56px`（全局命令栏高度）
- 响应式断点：`sm 640 / md 768 / lg 1024 / xl 1280`（MVP 以 lg+ 为主、md 可用、移动 Web 不崩）。
- 栅格：12 列，`gap: var(--space-6)`；工作区主区非对称 `grid-template-columns: 2fr 1fr`（2:1）。

---

## ⑤ 图标规范（Lucide 死规则 + 导航映射表）

### 5.1 Lucide 死规则（违反即退回）

1. **唯一图标库**：`lucide-react`，具名 import（杜绝凭记忆猜名导致构建失败）。版本在 `package.json` 钉死，禁止 `^` / `latest`。
2. **尺寸档位**：仅 `16 / 20 / 24 / 32px`（`--icon-sm/md/lg/xl`）。行内 16、按钮内 20、独立图标 24、空态插画 32。
3. **描边**：`strokeWidth={2}`，`stroke="currentColor"`，`fill="none"`。
4. **颜色**：继承 `currentColor`；图标默认取 `--fg-2`，强调态取 `--accent`（仅选中/主操作）。
5. **绝对禁止 emoji** 作功能图标（rocket / fire / light-bulb / sparkle 等表情符号一律不可用，仅允许出现在用户生成内容 UGC 中）。
6. **禁止混用** 其他图标库（如 react-icons / heroicons / antd-icons）。
7. 图标按钮必须有 `aria-label`（见 §9）。

### 5.1.1 系统图标（favicon · 浏览器标签页）

- **形态**：内联 SVG（data URI 注入 `<head>` 的 `<link rel="icon">`），**不**用 emoji、不用 PNG 位图、不与飞书/钉钉的具象 logo 雷同。
- **视觉**：圆角方形底（`--accent` 钴蓝 #4263EB）+ 白色描边几何"协作网络"（三节点 + 连线），与界面 Lucide 线性风格同源、保证品牌一致。
- **规范**：`viewBox="0 0 32 32"`、`stroke-width="2"`、`stroke-linecap/linejoin="round"`，单色描边不渐变；标签页/书签/PWA 均复用同一源。
- **实现**：原型在 `index.html` `<head>` 内联；正式工程由设计系统导出 `favicon.svg` 置于 `public/`，并在 `app/(main)/layout` 的 metadata 引用。

### 5.2 导航 / 全局图标映射表

| 用途 | Lucide 图标名 | 尺寸 | 出现位置 |
|------|---------------|------|----------|
| 工作台 Home | `LayoutDashboard` | 20 | 侧栏主导航 |
| 任务看板 Board | `FolderKanban` | 20 | 侧栏导航 |
| 决策记录 | `FileText` | 20 | 任务详情内 section 头 |
| 成员 Members | `Users` | 20 | 侧栏导航 |
| 计费 Billing | `CreditCard` | 20 | 侧栏导航 |
| 全局命令栏 | `Search` | 20 | 顶栏 Cmd+K 触发器 |
| 通知 | `Bell` | 20 | 顶栏右侧 |
| 设置 | `Settings` | 20 | 侧栏底部 / 顶栏 |
| 日程（Home 右栏） | `Calendar` | 20 | 工作区 Home 右栏标题 |
| 评论 | `MessageSquare` | 20 | 任务详情 / 看板卡 |
| 主题切换 | `Sun` / `Moon` | 20 | 顶栏 |
| 新建任务 | `Plus` | 16–20 | 命令栏 / 看板列头 |
| 拖拽手柄 | `GripVertical` | 16 | 看板卡 / 列表行 |
| 优先级 | `SignalHigh` / `SignalMedium` / `SignalLow` | 16 | 任务卡/详情 |
| 状态 | `Circle` / `CircleDot` / `CheckCircle2` | 16 | 待办/进行中/已完成 |
| 更多操作 | `MoreHorizontal` | 16 | 行尾菜单 |
| 关闭 | `X` | 16–20 | Modal / Toast / 命令栏 |
| 成功 | `Check` | 16–20 | 成功态 / 校验通过 |
| 警告 | `AlertTriangle` | 16–20 | 错误/边界提示 |
| 删除 | `Trash2` | 16 | 行操作（destructive） |

---

## ⑥ 组件库清单（Components）

> 所有颜色经 Token 引用，强调色每屏 ≤2 处。按钮尺寸：sm(高 32) / md(高 36) / lg(高 40)。触摸热区 ≥ 44×44（图标按钮用 padding 扩到 44）。

### 6.1 Button（4 变体 × 5 状态）

| 变体 | 背景 | 文字 | 边框 | 用途 |
|------|------|------|------|------|
| Primary | `var(--accent)` | `var(--on-accent)` | none | 主 CTA（每屏≤1 个） |
| Secondary | `transparent` | `var(--accent)` | `1px var(--accent)` | 次级确认 |
| Ghost | `transparent` | `var(--fg-2)` | none | 工具栏/低强调 |
| Destructive | `var(--danger)` | `#fff` | none | 删除/移除（RBAC 控） |

- **状态**：Default / Hover(`--accent-hover`) / Active(`--accent-active`) / Focus(`--focus-ring`) / **Disabled**(`opacity:.5; cursor:not-allowed; 无 hover`)。
- **Loading**：按钮内 `Loader2` 旋转（Lucide `spinner` 语义），文字保留或替换为"处理中"，禁用再点击。
- **禁用规则**：无权限操作（如 Member 移除成员）按钮**直接不渲染**（前端隐藏不算安全，服务端 403 强制）。

### 6.2 Input / Textarea

- 背景 `var(--surface)`，边框 `1px var(--border)`，圆角 `--radius-sm`，字号 `--text-md`，padding `--space-3 --space-4`。
- **Focus**：`border-color: var(--accent)` + `box-shadow: var(--focus-ring)`（150ms）。
- **Error**：`border-color: var(--danger)` + 下方 `--danger` 文字说明（如"邮箱已被注册"）。
- **Disabled**：`var(--surface-2)` 底 + `var(--meta)` 文字。
- 必填项用 `*` + `aria-required`；label 永不作为 placeholder 独占（label 常驻可见）。

### 6.3 Card

- 背景 `var(--surface)`，边框 `1px var(--border)`（即 `--elev-ring`），圆角 `--radius-lg`，padding `--space-5`。
- Hover：`--elev-sm`（仅可点击卡）。Selected：`border-color: var(--accent)`。
- **禁用** 左侧彩色边条（`border-left: 3px`）与 ≥24px 圆角。

### 6.4 Modal / Dialog（Radix Dialog 原语）

- 遮罩 `rgba(16,24,29,.45)`；面板 `var(--surface)` + `--elev-lg` + `--radius-xl`，最大宽 `max-w-2xl`。
- 关闭：`X` 图标按钮（右上，44 热区）+ `Esc` + 点遮罩关闭；`role="dialog" aria-modal` + 焦点陷阱。
- 进出 150ms ease-out（opacity + 4px 位移）。

### 6.5 Table（成员/发票）

- 行高 44px（触摸友好）；斑马纹用 `--surface-2` 隔行或仅 `--border-soft` 横线。
- 表头 `--text-sm` `--weight-medium` `--meta`；单元格 `--text-base` `--fg`。
- 操作列图标按钮（MoreHorizontal / Trash2）带 `aria-label`。

### 6.6 Tag / Badge（状态/角色/优先级）

- 胶囊 `border-radius: var(--radius-pill)`，padding `--space-1 --space-2`，`--text-xs` + `tracking-caps`。
- 角色：`Owner`(accent-soft 底 + accent 字) / `Admin`(surface-3 底 + fg) / `Member`(surface-3 底 + muted)。
- 优先级点：`--prio-high-fg/med-fg/low-fg` 圆点 + 文字；状态：`--status-*-fg` 圆点。

### 6.7 Avatar

- 尺寸 24/32/36，圆 `var(--radius-pill)`；无图时用首字 + `var(--surface-3)` 底 + `--fg-2` 字。
- 列表/卡片内显示负责人头像（24）+ 姓名（`--text-sm`）。

### 6.8 Toast（Radix Toast）

- 右下浮层，`var(--surface)` + `--elev-md` + `1px var(--border)`，左侧 3px 状态色（success/warn/danger）。
- 自动消失 4s，可手动关闭（`X`）；`role="status"`（成功）或 `role="alert"`（错误）。

### 6.9 全局命令栏（Cmd+K）— 签名交互

- 触发器：顶栏 `Search` 图标 + 视觉输入框（`⌘K` 提示，mono 字体），点击/快捷键唤起浮层（`--z-cmd`）。
- 浮层：`--surface` + `--elev-lg`，顶部搜索输入，下方分组结果（任务 / 决策记录 / 跳转），键盘 ↑↓ 选择、Enter 跳转、Esc 关闭。
- 仅功能性动效（150ms 展开），无装饰动画。

---

## ⑦ 页面设计（13 页 · 真实中文样例数据 · 5 态覆盖）

> 统一外壳：顶栏（工作区切换器 + 在线点 + 命令栏 + 通知 + 主题 + RBAC 角色 + 用户）+ Slim Sidebar（240px，可折叠、微透明背景、尾栏滑到页底才显）。除 `/auth` 外均套用。
>
> **页面头层级（eyebrow 规范）**：每个页面头统一为「eyebrow 小标签（accent 胶囊）→ 大标题（`--text-3xl`，`--tracking-display`）→ 副标题（`--muted`）」三级纵深，制造产品级呼吸感。eyebrow 文案取页面类目（如"工作区""办公""账户"）或上下文（如工作区名、任务编号）。

### 7.1 注册 / 登录 — `/auth`

- **布局**：居中对齐卡片（max-w-2xl），上方产品名 **corps** + 一句话价值"轻量协作，让结论自动落位成任务"。Tab 切换 `注册 / 登录`。
- **注册表单**（真实样例）：
  - 工作区名称：`Acme 增长组`
  - 邮箱：`lead@acme.test`
  - 密码：`••••••••`（强度提示：至少 8 位，含字母与数字）
  - 主按钮：`创建工作区`（Primary）
- **登录表单**：邮箱 + 密码 + `登录`（Primary）+ `忘记密码？`（Ghost）。
- **5 态**：
  - Loading：提交后按钮 `Loader2` 旋转 + "创建中…"，禁用重复提交。
  - Empty：初始空白表单，label 常驻。
  - Error：邮箱已存在 → 输入框 `border-danger` + 下方"该邮箱已注册，请直接登录"；密码错误 → "邮箱或密码不正确"。
  - Success：注册成功 → 自动进 `/w/:wid`；登录成功 → 回跳来源页。
  - Edge：邮箱格式非法（实时内联校验）；密码 <8 位禁用提交按钮。

### 7.2 工作区 Home（登录后首屏）— `/w/:wid`

- **定位**：内容优先的非对称工作台（**非营销 Hero**）。这是产品第一印象，必须"打开即见真实工作"。
- **顶栏（56px）**：左 = 工作区切换（`ChevronsUpDown` + 当前名"Acme 增长组"）；中 = **全局命令栏 Cmd+K**（`Search` 图标 + 假输入"搜索任务、决策记录…" + 右侧 `⌘K` mono 提示）；右 = `Bell` 通知 + `Sun/Moon` 主题 + 用户 `Avatar`。
- **Slim Sidebar（240px）**：上部工作区名；导航（选中态 = `--accent-soft` 背景 + **左侧 2px `--accent`**，非 3px+ 彩色侧条）：
  - 工作台 `LayoutDashboard`（选中）
  - 任务看板 `FolderKanban`
  - 成员 `Users`
  - 计费 `CreditCard`
  - 底部：设置 `Settings` + 用户 Avatar+名。
- **顶部本周概览统计条（stat-strip）**：页面头下方一行 5 个指标卡（本周任务 / 进行中 / 待我处理 / 今明到期[accent 高亮] / 本周完成率）+ 右侧"快速新建"按钮。指标用 `--text-xl` 强调数字 + `--meta` 标签，`--surface-calm` 承载，accent 卡用 `--accent-soft` 背景。一屏速览，不喧宾夺主。
- **主区（非对称 2:1）**：
  - **左 2/3 — 进行中任务**（标题"进行中 · 4"）：列表行 = 状态点 + 标题 + 负责人 `Avatar`(24) + 截止日(mono)。
    - `CircleDot` 进行中 · **Q3 增长复盘** · 陈思 · 08-22
    - `CircleDot` 进行中 · **客户 Onboarding 流程 v2** · 李维 · 08-25
    - `Circle` 待办 · **官网落地页文案定稿** · 王悦 · 08-20
    - `CircleDot` 进行中 · **支付网关 Stripe 对接** · 张航 · 08-28
  - **右 1/3 — 今日 / 最近 / 日程**：
    - 今日待办：`MessageSquare` 回复投资人 DD 清单 · 周敏 · 今日 18:00 前
    - 最近：`FileText` 竞品功能对比表 · 周敏 更新于 2 小时前
    - 日程（`Calendar`）：团队周会 16:00–17:00 · 会议室 A
- **5 态**：
  - Loading：左列表骨架行（3 条 `--surface-2` 占位条）+ 右栏骨架。
  - Empty：无任何任务 → 引导卡"创建首个任务并指派"，按钮"新建任务"（Primary），承诺 15 分钟内完成激活（AC-07）。
  - Error：加载失败 → 居中 `AlertTriangle` + "工作区数据加载失败" + `重试` 按钮。
  - Success：如上真实数据展示。
  - Edge：任务 ≥200 条 → 左列表虚拟滚动 + "显示更多"；超长标题 `truncate` 带 `title` 全文本。

### 7.3 任务看板 — `/w/:wid/board`

- **布局**：顶部视图切换 `看板 / 列表`（SegmentedControl，Ghost 风格）+ `新建任务`（Primary，每屏唯一强调）。下方三列（=状态）：**待办 / 进行中 / 已完成**，列头显示计数（`meta`）。
- **看板卡**（真实样例）：
  - 待办：`SignalMedium` 中 · **官网落地页文案定稿** · 王悦 · 08-20 · `GripVertical`
  - 进行中：`SignalHigh` 高 · **Q3 增长复盘** · 陈思 · 08-22 · `GripVertical`
  - 进行中：`SignalLow` 低 · **支付网关 Stripe 对接** · 张航 · 08-28
  - 已完成：`CheckCircle2` · **竞品功能对比表** · 周敏 · 08-15
- **交互**：拖拽卡到另一列 → 乐观更新状态（`PATCH`），后台持久化；拖动时 `--elev-md` + 占位。
- **5 态**：
  - Loading：三列骨架卡。
  - Empty：整列空 → 列内虚线区"拖入或新建任务"；全空 → 引导"从模板新建"。
  - Error：拖拽落库失败 → 卡回弹原位 + Toast `role=alert`"状态更新失败，已恢复"。
  - Success：正常拖拽/渲染。
  - Edge：同名列多卡（>20）→ 列内滚动；并发拖拽冲突 → 以后端最终态为准的乐观回滚。

### 7.4 任务详情 — `/w/:wid/task/:id`

- **布局**：左主栏（≈2fr）+ 右元信息面板（≈1fr，sticky）。
- **左主栏**：
  - 标题：**客户 Onboarding 流程 v2**（`--text-2xl` `--weight-semibold`）
  - 描述：Markdown 渲染——"梳理新客户从签约到首次成功使用的 6 步流程，挂决策记录 v2。"
  - 评论区（`MessageSquare`）：李维 `@王悦 流程图初稿已写入决策记录，请 review` · 2 小时前
  - 决策记录（`FileText`）："Onboarding 六步法 v2" Markdown + 版本留痕（v1→v2，作者周敏）
- **右面板**：负责人 李维(`Avatar`) · 截止 08-25(mono) · 优先级 `SignalHigh` 高 · 状态 `CircleDot` 进行中 · 创建于 08-12 · `编辑`(Ghost)
- **5 态**：
  - Loading：标题+面板骨架。
  - Empty：无评论 → "成为第一个评论的人"；无决策记录 → "添加第一条决策记录"引导。
  - Error：评论发布失败 → 输入区下方 `AlertTriangle` + 重试；网络中断保留草稿。
  - Success：评论/决策即时插入列表。
  - Edge：描述超长 → 主栏独立滚动；@提及多人 → 各自通知；Markdown 渲染防 XSS（仅白名单标签）。

### 7.5 成员管理 — `/w/:wid/members`

- **布局**：顶部邀请栏（邮箱 `Input` + 角色 `Select`[Owner/Admin/Member] + `邀请` Primary）+ 成员 `Table`。
- **真实样例**：
  - 陈思 · chen@acme.test · `Owner`(accent-soft 徽章) · 操作 —
  - 李维 · li@acme.test · `Admin` · 操作 `MoreHorizontal`
  - 王悦 · wang@acme.test · `Member` · 操作 `MoreHorizontal`
  - 张航 · zhang@acme.test · `Member` · 操作 `MoreHorizontal`
  - 周敏 · zhou@acme.test · `邀请待接受`(meta) · 操作 `撤回邀请`
- **RBAC**：Member 角色不渲染"移除/改角色"按钮（前端隐藏）；即使绕过，服务端返回 403（AC-05）。
- **5 态**：
  - Loading：表格行骨架。
  - Empty：仅 Owner 一人 → 顶部提示"邀请伙伴一起协作"+ 高亮邀请栏。
  - Error：邀请失败（邮箱非法/已存在）→ 输入框 `border-danger` + 说明；服务端 409 → "该邮箱已在工作区内"。
  - Success：新成员行插入 + Toast `role=status`"已发送邀请"。
  - Edge：达 10 人免费上限 → 邀请栏禁用 + 横幅"免费版限 10 人，升级解锁更多席位"（引导计费页）。

### 7.6 计费 — `/w/:wid/billing`

- **布局**：当前套餐卡 + 席位用量 + 操作（升级/管理订阅）+ 发票历史表。
- **真实样例**：
  - 当前套餐：`免费版` · 席位 **5 / 10**（进度条 `--surface-3` 底 + `--accent` 填充）
  - 主操作：`升级到付费版 ¥59/人/月`（Primary）→ Stripe Checkout
  - 次操作：`管理订阅`（Ghost）→ Stripe Portal
  - 发票历史：2026-08 试用中 · 暂无账单（Empty 态文案）
- **5 态**：
  - Loading：套餐卡骨架 + 进度条占位。
  - Empty：无发票 → "升级后将在此显示账单"（非报错）。
  - Error：扣款失败 → 顶部 `AlertTriangle` 横幅"本次扣款未成功，服务暂不受影响，请更新支付方式"（催缴，不中断，AC-09）；webhook 重试。
  - Success：升级完成 → 套餐卡变 `付费版` + Toast"已升级到付费版"。
  - Edge：第 11 人接受邀请 → 触发 Stripe `subscription quantity` 同步 +1（AC-08）；超额保护提示。

### 7.7 我的待办 — `/w/:wid/mytasks`

- **布局**：页面头 eyebrow=当前用户；右 `新建待办`（Primary）。下方 `.card` 内含筛选取代（`全部 / 待办 / 进行中 / 已完成` SegmentedControl）+ 计数（实时随筛选更新）。
- **任务行**：每行左侧**可勾选框**（`.chk`，accent 填充 + 删除线 `done` 态），点击/键盘 Space/Enter 切换完成；右侧负责人 Avatar + mono 截止日。
- **筛选交互**：切换 seg 即时隐藏/显示行并更新 `count-chip`，纯前端原型态（无后端）。

### 7.8 其余页面索引（同壳）

- **日程 `/w/:wid/calendar`**：2026 年 8 月真实月历（周一始），今日 22 高亮；会议事件点（accent/success/warn 三色）；连接平台后自动同步（设计占位）。
- **规划中 `/w/:wid/coming`（云盘 / 知识库 / 审批 共用）**：`coming-title` 随导航动态锚定；统一占位页"即将到来"，不伪造已连接状态。
- **通知 `/w/:wid/notifications`**：顶栏铃铛 Demo 触发 Toast"暂无新通知"；正式版为抽屉/页。

---

## ⑧ 动效规范（Motion）

- **仅功能性动效**，收敛到 **150ms**（`--motion-base`）基准；确认类 120ms（`--motion-fast`），内容进入 220ms（`--motion-slow`）。
- **缓动**：`--ease-standard: cubic-bezier(0.2,0,0,1)`；浮层用 `--ease-out`。
- **禁止**：弹跳缓动 `cubic-bezier(0.68,-0.55,0.265,1.55)`、>500ms 动画、单屏同时 >3 个元素动画、装饰性粒子/光晕。
- **典型动效**：hover 变色 150ms；Modal/命令栏 opacity+4px 位移 150ms；Toast 滑入 200ms；拖拽卡 `--elev-md` 即时（<100ms）跟手。
- **页面入场**：路由切换时 `.page.active` 触发 `lc-rise`（`opacity 0→1` + `translateY(4px)→0`，`--motion-enter: 420ms`，`--ease-out`）。仅一次、不循环、不堆叠。
- **可交互表面 hover 微抬升**：`.card-hover` / `.task-row` hover 时 `translateY(-1~-2px)` + `--elev-hover`，制造"可点"的实体感；按下 `:active` 回弹 1px。
- **`prefers-reduced-motion: reduce`**：全局降级——动画时长压到 ~0、禁用位移/视差，仅保留必要状态切换（已在 `design-tokens.css` 末段 `@media` 强制）。

---

## ⑨ 无障碍（Accessibility · WCAG 2.1 AA）

- **对比度**：正文 `--fg` on `--bg` ≥ 7:1；次要 `--muted` 仅用于非长正文/大字号；按钮文字 `on-accent` 在浅色 7:1、深色（accent `#4D74FB` + 白字）满足 AA 大/粗字阈值（按钮为 590 半粗，视为达标；若严格场景可加深 `--p-accent-dk` 作按钮底）。
- **焦点可见**：所有可交互元素 `:focus-visible` 显示 `--focus-ring`（3px accent 半透明环），**禁止** `outline:none` 无替代。
- **键盘导航**：Sidebar / 命令栏 / Modal 全键盘可达；命令栏 `↑↓` 选择 `Enter` 确认 `Esc` 关闭；Modal 焦点陷阱 + 返回焦点。
- **触摸热区**：所有可点元素 ≥ 44×44px（图标按钮用 padding 扩到 44，不靠视觉尺寸）。
- **icon-only 按钮强制 `aria-label`**：`Bell`/`Search`/`Settings`/`X`/`MoreHorizontal`/`Trash2` 等必须有 `aria-label`（如 `aria-label="打开通知"`）。
- **语义结构**：页面 `h1` 唯一（页眉标题）；列表用 `ul/li`；表格 `th scope`；表单 `label` 关联 `input` + `aria-required`。
- **状态不靠颜色独传**：状态点/优先级均配文字或图标（如 `CircleDot`+「进行中」），色盲可用；错误同时给图标+文字。
- **实时区域**：Toast `role=status/alert`；命令栏结果 `aria-live="polite"`。
- **减少动效**：遵循 §8 的 `prefers-reduced-motion`。

---

## 附录 A：Agent Implementation Guide（前端 Phase 3 依据）

### A.1 Tailwind 配置（锁定量，映射 Token）

```js
// tailwind.config.ts —— 仅引用语义变量，无裸 hex
import tokens from './design-tokens.json';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        'surface-3': 'var(--surface-3)',
        fg: 'var(--fg)',
        'fg-2': 'var(--fg-2)',
        muted: 'var(--muted)',
        meta: 'var(--meta)',
        border: 'var(--border)',
        'border-soft': 'var(--border-soft)',
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          active: 'var(--accent-active)',
          soft: 'var(--accent-soft)',
          'soft-fg': 'var(--accent-soft-fg)',
          on: 'var(--on-accent)',
          ring: 'var(--accent-ring)',
        },
        success: 'var(--success)',
        warn: 'var(--warn)',
        danger: 'var(--danger)',
      },
      fontFamily: {
        display: ['Inter', 'Noto Sans SC', 'sans-serif'],
        body: ['Inter', 'Noto Sans SC', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      fontSize: {
        xs: ['var(--text-xs)', { lineHeight: 'var(--leading-snug)' }],
        sm: ['var(--text-sm)', { lineHeight: 'var(--leading-snug)' }],
        base: ['var(--text-base)', { lineHeight: 'var(--leading-normal)' }],
        md: ['var(--text-md)', { lineHeight: 'var(--leading-normal)' }],
        lg: ['var(--text-lg)', { lineHeight: 'var(--leading-tight)' }],
        xl: ['var(--text-xl)', { lineHeight: 'var(--leading-tight)' }],
        '2xl': ['var(--text-2xl)', { lineHeight: 'var(--leading-tight)' }],
        '3xl': ['var(--text-3xl)', { lineHeight: 'var(--leading-tight)', letterSpacing: 'var(--tracking-display)' }],
      },
      fontWeight: { regular: '400', medium: '510', semibold: '590' },
      spacing: {
        1: 'var(--space-1)', 2: 'var(--space-2)', 3: 'var(--space-3)',
        4: 'var(--space-4)', 5: 'var(--space-5)', 6: 'var(--space-6)',
        8: 'var(--space-8)', 10: 'var(--space-10)', 12: 'var(--space-12)',
        16: 'var(--space-16)', 20: 'var(--space-20)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)', md: 'var(--radius-md)',
        lg: 'var(--radius-lg)', xl: 'var(--radius-xl)', pill: 'var(--radius-pill)',
      },
      boxShadow: {
        ring: 'var(--elev-ring)', sm: 'var(--elev-sm)',
        md: 'var(--elev-md)', lg: 'var(--elev-lg)',
      },
      transitionDuration: { fast: '120ms', base: '150ms', slow: '220ms' },
      transitionTimingFunction: { std: 'var(--ease-standard)', out: 'var(--ease-out)' },
      maxWidth: { container: 'var(--container-max)' },
    },
  },
};
```

### A.2 CSS 变量引用（前端 `import './design-tokens.css'`）

- 全站 `:root` 已含浅色值；`<html data-theme="dark">` 切深色；`<html data-tenant-theme="acme">` 切租户色。
- 组件样式**只写 `bg-surface border-border text-fg` 这类 Token 类**，禁写 `bg-[#fff]` 等裸值。

### A.3 框架特定提示（按 Spec 锁定栈）

- 图标：`import { LayoutDashboard, FolderKanban } from 'lucide-react'`（钉版本）；`<LayoutDashboard size={20} strokeWidth={2} />`。
- 原语：Modal/Toast/Tooltip/Select 用 **Radix UI**（无样式可访问），样式套 Token，不重写焦点逻辑。
- 命令栏：Cmd+K 用 `cmdk` 或自建 Radix Dialog + 键盘导航；全局监听 `keydown` (meta/ctrl+k)。
- 字体：`next/font` 引入 Inter / Noto Sans SC，避免 CLS。

### A.4 已知坑提醒（来自 Spec §11 + 设计侧）

- **Lucide 导出名随版本变**（如 `AlertCircle`→`CircleAlert`）：钉确切版本 + 具名 import，缺失即 lint 失败。
- **图标按钮漏 `aria-label`**：在组件封装层强制 `aria-label` 必填（无 label 编译告警）。
- **主题闪烁**：在 `<html>` 尽早注入 `data-theme`（SSR 内联脚本读 localStorage），避免首屏闪白。
- **租户换肤漏覆盖派生色**：只改 `--p-accent`，其余经 `color-mix` 自动联动，勿在组件写死 hover 色。
