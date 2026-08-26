# corps /pricing 定价页实现设计文档

> 日期：2026-08-26 ｜ 作者：定价页设计师 ｜ 状态：v2（按三线审核报告 docs/design/tri-line-design-review.md 放行条件 P1-1~P1-7 修订完成，可进入实现）
> 上游规格：docs/market/pricing-page-spec.md（ACCEPTED 冻结版，唯一权威）、docs/market/pricing-strategy.md（2026-08-26 收口版）
> 跨线裁决依据：docs/design/tri-line-design-review.md 第3章裁决一~五（2026-08-26 三线设计审核员任务 #92 出具，已 ACCEPTED）
> 本文性质：实现设计（How to build），不含产品代码；所有结论均标注真实出处（文件 + 行号）
> 任务编号：#89（设计产出）/ #97（实现 v2，本文档为 #97 的设计基线）
> 修订摘要：P1-1 撤销 landing_view 单方裁定改为接受 PublicPageTracker 自动覆盖；P1-2 /pricing 四 CTA 只打 click_upgrade、click_signup 收敛 auth/login；P1-3 D1 移交埋点线；P1-4 checkout/route.ts 归支付线、§5.4/R4 改为契约引用；P1-5 白名单计数 22→20；P1-6 统一三文件清单；P1-7 补工时小结

---

## 第1章 调研结论

### 1.1 设计 Token 核实

核实对象：`web/app/design-tokens.css`（319 行，globals.css L2 `@import "./design-tokens.css"` 实际生效版本）。逐项核对 pricing-page-spec.md §2/§3/§6 引用的全部变量。

表：spec 引用 Token 核实表（web/app/design-tokens.css）

| 变量 | 定义行 | 实测值 | 结论 |
|------|--------|--------|------|
| `--container-max` | L208 | 1280px | 存在 |
| `--section-y` | L211 | 36px | 存在 |
| `--eyebrow-bg` | L231（深色 L278 覆盖） | color-mix accent 9% | 存在 |
| `--eyebrow-fg` | L230（深色 L277 覆盖） | var(--accent) | 存在 |
| `--radius-pill` | L180 | 9999px | 存在 |
| `--text-xs` ~ `--text-4xl` | L135–143 | 12/13/14/16/18/20/24/30/36px 九档全 | 存在 |
| `--weight-regular/medium/semibold` | L158–160 | 400/510/590 | 存在 |
| `--tracking-tight` | L153 | -0.01em | 存在 |
| `--tracking-display` | L152 | -0.02em | 存在 |
| `--accent` 及派生 hover/active/soft/soft-fg/on-accent | L99–104 | color-mix 派生 | 存在 |
| `--surface` / `--surface-2` / `--surface-calm` | L54/L55/L58 | — | 存在 |
| `--border` / `--border-soft` | L95/L96 | — | 存在 |
| `--elev-ring` / `--elev-hover` / `--elev-md` | L184/L189/L186 | — | 存在 |
| `--motion-base` / `--motion-enter` | L193/L195 | 150ms/420ms | 存在 |
| `--ease-standard` | L196 | cubic-bezier(0.2,0,0,1) | 存在 |
| `--success` / `--warn` | L108/L109 | #1a9e6b/#c9881a | 存在 |
| `--muted` / `--meta` | L92/L93 | — | 存在 |
| `--fg` / `--fg-2` | L90/L91 | — | 存在 |
| `--topbar-h` | L210 | 56px | 存在 |
| `--icon-lg` | L236 | 24px | 存在 |
| `--radius-md/lg/xl` | L177–179 | 10/14/16px | 存在 |
| `--space-1` ~ `--space-20` | L163–173 | 档位 1/2/3/4/5/6/8/10/12/16/20 | 存在（见下方注意项） |
| `--font-display`（§6 引用） | L130 | Inter/Noto Sans SC | 存在 |
| `--text-md`（§3.2 Hero 副标引用） | L138 | 16px | 存在 |
| `--focus-ring`（§6 焦点环引用） | L225 | 0 0 0 3px accent-ring | 存在 |

#### 1.1.1 双文件同步性

仓库存在两份 design-tokens.css：`design/design-tokens.css`（303 行）与 `web/app/design-tokens.css`(319 行)。实测结论：

1. **变量集合完全一致**：规范化解析后两份各含 137 个变量，名称集合差集为空，值语义一致（差异仅为 hex 大小写如 `#4263eb` vs `#4263EB`、空格对齐、单行/多行 color-mix 写法）。spec 引用的变量在两份中均可解析。
2. **复制方向是 design/ → web/app/**：`web/package.json` scripts 中 `predev` 与 `prebuild` 均执行 `copyFileSync('../design/design-tokens.css','app/design-tokens.css')`。即 `design/` 是源文件，`web/app/` 是构建期副本。
3. **风险**：当前 web/app 版比 design/ 版多 16 行（主要是格式重排），说明有人曾直接编辑了副本侧；下次 `pnpm dev/build` 会将其覆盖回 design/ 版。本页开发若需新增 Token，必须改 `design/design-tokens.css`，禁止改 `web/app/design-tokens.css`。

#### 1.1.2 缺失清单与补齐建议

- **缺失清单：空**。spec 引用的全部 Token 变量均已存在，无需补齐任何变量。
- 注意项一：间距档位只有 4 的倍数附近子集（无 `--space-7/9/11…`），但 spec 未引用缺失档位，不构成缺口。另注 `--space-5 = 22px`（tokens L167），非 20px，实现时照用变量即可，不得写死数值。
- 注意项二：billing 页在用的 `--success-fg/--warn-fg/--danger-fg/--accent-fg` 并不在 tokens 文件中，而是定义于 `web/app/globals.css`（L24、L30–32 浅色、L48–50 深色）。本页语义色按 spec §6 只用 `var(--success)`/`var(--warn)`/`var(--accent)` 原色与 `--on-accent`/`--accent-soft-fg`，避免跨文件引用不一致。

### 1.2 Lucide 图标导出实测

实测环境：`web/node_modules/lucide-react`，`package.json` 版本字段 **0.513.0**（`web/package.json` dependencies 声明同为精确版本 `"0.513.0"`，无 `^/~`，符合 spec §6「钉确切版本」要求）。查证文件：`dist/lucide-react.d.ts`（3 个类型声明文件之一为主声明）。

表：lucide-react 0.513.0 图标导出核实表

| 导出名 | declare 原生声明 | 实际导出形式 | 结论 |
|--------|------------------|--------------|------|
| `GitBranch` | 是 | 原生 declare const | 可直接 import |
| `KanbanSquare` | 否 | 别名 `SquareKanban as KanbanSquare`（主名 `SquareKanban` 于 d.ts L17554 declare；别名出现在 L24037 大导出行） | **可用但是 deprecated 别名** |
| `ShieldCheck` | 是 | 原生 declare const | 可直接 import |
| `Check` | 是 | 原生 declare const | 可直接 import |
| `ChevronDown` | 是 | 原生 declare const | 可直接 import |
| `ArrowRight`（§6 可选 CTA 箭头） | 是 | 原生 declare const | 可直接 import |

SPEC §11 已知坑在本版本的实证：lucide 自 v0.4x 起「形状前缀改名」（`SquareKanban` 为新规范名，旧名 `KanbanSquare` 经 `as` 别名保留，同类先例见同导出行中 `TriangleAlert as AlertTriangle`、`CircleCheckBig as CheckCircle`）。别名在未来大版本存在移除风险。

**实现决策**：import 时写 `import { SquareKanban as KanbanSquare } from "lucide-react"`——既绑定稳定的新规范名符号，又保持 spec 文案中的图标语义命名；其余四个图标按原生名直接导入。TypeScript 编译（next build 内置 tsc）会在导出名不存在时直接报错，构成编译期校验；无需额外 lint 规则。

### 1.3 middleware 与鉴权现状

`web/middleware.ts`（131 行）全文核对，其职责仅四项：

1. CSRF Origin 校验（L10–32、L83–88）：仅拦 `/api` 写请求的跨源提交；
2. CORS 白名单回显（L47–56、L66–81）;
3. CSP nonce 生成注入 + 安全响应头（L90–112）；
4. 生产 HSTS（L114–118）。

**middleware 中不存在任何「未登录跳转登录页」的重定向逻辑**。matcher（L123–130）虽覆盖全站 `/(.*)`,但只用于给所有页面注入 CSP/HSTS 头。

真实的登录守卫位置：`web/app/w/[wid]/layout.tsx`（客户端组件）在 useEffect 内调用 `/api/v1/workspaces`，失败或工作区不在列表时执行 `router.push("/auth/login")`（该文件 useEffect 块，`catch(() => router.push("/auth/login"))`）。即守卫是**仅挂在 /w/* 路径下的客户端软守卫**，且根路径 `web/app/page.tsx` 也是服务端 `redirect("/auth/login")`。

**结论（对应 spec §1 「middleware 若对全站未登录跳转，需将 /pricing 加入公开路径列表」的前提核实）**：该前提不成立。未登录访问任意非 /w 页面不会被跳转，`/pricing` 作为 `web/app/pricing/page.tsx` 新增顶层路由**天然公开可达，middleware 零改动**。无需维护公开路径白名单。

### 1.4 billing 页插入点

文件 `web/app/w/[wid]/billing/page.tsx`，头部结构（L126–135）：

```tsx
<div className="max-w-4xl mx-auto">
  <div className="mb-6">                                  {/* ← 头部容器 L127 */}
    <h1 ...><CreditCard size={20} ... />计费</h1>          {/* L128–131 */}
    <p ...>按实际席位付费，随时调整人数。</p>               {/* L132–134 */}
  </div>
```

**插入位置**：L134 的 `</p>` 之后、L135 头部容器 `</div>` 之前，新增一行链接。建议形态（遵循页面既有 Tailwind + token 类风格）：

```tsx
<Link href="/pricing" className="mt-3 inline-flex items-center gap-1 text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--accent)] hover:text-[var(--accent-hover)]">
  查看完整功能对比 <ArrowRight size={14} />
</Link>
```

窗口行为取其一（spec §1）：建议**当前窗口跳转**并用 next/link `<Link>`（该文件现无 Link import，需补一行；站内导航走客户端路由更顺，返回时 SPA 状态保留）。文案中的箭头字符「→」建议替换为 Lucide `ArrowRight` 图标，与 SPEC §10「禁 emoji/文本符号做 UI 图标」的图标体系一致性取向一致（对比表内的 ✅/— 文本字符属 spec §4.2 明示例外，不受此限）。

### 1.5 其他关键现状

#### 1.5.1 auth 路由与归因参数现状

- 实际登录/注册路由是 **`/auth/login` 与 `/auth/signup`**（`web/app/auth/{login,signup}/page.tsx`），**不存在裸 `/auth` 路径**。spec §1/§3 多处写的 CTA 目标 `/auth?src=pricing` 与现状不符，实现时须适配为 `/auth/signup?src=pricing`（注册意图 CTA）与 `/auth/login`（TopNav「登录」链接）。此为规格文字与代码事实的偏差修正，详见第7章风险 R1。
- signup 页已有读取 URL 参数的成熟先例：`new URLSearchParams(window.location.search).get("invite")`（signup/page.tsx L29–30 注释明确说明用 `window.location.search` 而非 `useSearchParams` 以规避静态预渲染 Suspense 约束）。`src` 参数读取应复用同一模式。
- login/signup 页当前均未读取 `src` 参数，也**未调用任何 `track("register_*")`**（全局搜索无调用点）；白名单中的 `register_view/register_submit/register_success` 目前是「已注册事件名、无埋点调用」状态。归因透传需要 auth 页配合改造，列为本任务的依赖交付项而非阻塞项（见第5章）。

#### 1.5.2 埋点调用现状

- 客户端：`web/lib/analytics.ts` 导出 `track(name: string, props: Record<string, unknown> = {}): void`（L88），模块自带 `"use client"`（L1），批量缓冲（满 20 条/5 秒兜底/visibilitychange/beforeunload sendBeacon），localStorage 匿名 sessionId（30 分钟 TTL）。公开匿名场景可直接调用，与 spec §8 实现要点 1 一致，analytics.ts 零改动。
- 服务端：`web/lib/analytics-server.ts` 导出 `trackServerEvent({ userId, workspaceId, name, props })`，内部 runWithAuthOp("provision") + 失败静默。
- 服务端白名单：`web/app/api/v1/events/route.ts` L21–46 `ALLOWED_EVENT_NAMES` 共 **20 个**事件名（9 注册激活 + 5 核心激活 + 2 留存 + 4 转化，逐行实测），**不含** spec §8 要求的 `view_pricing/select_billing_period/click_upgrade/click_pricing_faq`，白名单外事件被静默过滤（L75），漏配即丢数。本线对白名单的扩充归属埋点线一次性扩齐（见 §5.1 与裁决一），本线只消费。
- checkout 现状：`web/app/api/v1/workspaces/[wid]/billing/checkout/route.ts` 已通过 `trackServerEvent` 写入 `billing_checkout`，props 现状 `{ seatLimit }`（该文件 trackServerEvent 调用处）；请求体 schema `checkoutSchema` 仅 priceId/successUrl/cancelUrl 三字段，无 period。**checkout/route.ts 整体归支付线独占重构**（裁决三），本线不修改该文件，period 字段扩充以对接契约形式落纸（见 §5.4）。

#### 1.5.3 渲染模式现状（直接影响 SSG 决策，关键发现）

实测构建产物证据：

- Next.js 版本：**16.3.2**（web/package.json dependencies.next）。
- `web/.next/prerender-manifest.json` 的 routes 仅含 `/_global-error`；`.next/server/app/` 下唯一 `.html` 静态产物是 `_global-error.html`。即**现有全站没有任何页面被静态预渲染**。
- 成因：`web/app/layout.tsx` L11–13 在根 layout 中 `await headers()` 读取 CSP nonce（供 theme-init.js 注入）。Next App Router 的规则是任一路由段调用动态函数（headers/cookies）即整条路由退出静态生成；根 layout 属于全部路由的公共段，因此全站被迫逐请求动态渲染。

推论：spec §1「默认静态生成（SSG + ISR）」的技术前提在当前架构下不成立。处理方案见第4章。

#### 1.5.4 组件与样式惯例

- 整页客户端组件是主流：billing/login/signup 均 `"use client"` 整文件；`components/Skeleton.tsx` 则是无指令纯展示组件（可在服务端渲染），导出具名函数而非 default。
- 样式风格：Tailwind 任意值类直引 token（`text-[length:var(--text-2xl)]`、`bg-[var(--surface)]`、`rounded-[var(--radius-lg)]`、`duration-[var(--motion-base)]`），复杂派生色用 inline style（billing 页订阅徽标 L180–193 先例）。
- `<details>` 手风琴有先例：billing 页 L307 `<details className="mt-3 group">` + summary 内 hover 过渡。
- lucide 图标统一 `size={n}` props + `className` 控色（currentColor），无自绘 SVG。
- 目录命名惯例：`web/lib` 全部 kebab-case 单词文件（slug.ts/task-meta.ts/date.ts/types.ts…），无常量集中文件；`web/components` PascalCase 组件文件（Skeleton/CommandPalette/SidebarNav…），尚无子目录分层（扁平结构）。

---

## 第2章 文件清单与改动范围

表：定价页改动文件清单表

| 序号 | 文件 | 动作 | 职责 |
|------|------|------|------|
| 1 | `web/lib/pricing.ts` | 新建 | PRICING_PLANS 常量（spec §4.1 逐字）、年付派生数字、PRICING_FAQ 六条（spec §5）、PRICING_MATRIX 对比表数据（spec §4.2）、社会证明开关常量。纯数据 + 类型，零 React/DOM 依赖，保证可被服务端组件与测试直接导入 |
| 2 | `web/app/pricing/page.tsx` | 新建 | 路由入口，服务端组件：metadata（title/description/OG）+ 九区块静态骨架（TopNav/Hero/三栏/对比表/FAQ/尾部 CTA/Footer 内联函数组件）+ 挂载三个客户端子组件 |
| 3 | `web/components/pricing/PricingSection.tsx` | 新建 | `'use client'`：计费周期切换器 + Free/Pro 双卡 + select_billing_period 埋点。本页唯一有状态的客户端区块 |
| 4 | `web/components/pricing/PricingViewTracker.tsx` | 新建 | `'use client'`：挂载后打 view_pricing（sessionStorage 会话去重），渲染 null |
| 5 | `web/components/pricing/TrackedCta.tsx` | 新建 | `'use client'`：带 click_upgrade 上报的 CTA 链接微组件，包裹 nav/hero/card/tail_cta 四处 CTA（选型论证见 5.3 节） |
| 6 | `web/app/w/[wid]/billing/page.tsx` | 修改 | 头部插入「查看完整功能对比」Link（见 1.4 节插入点）。**仅此一处改动**：upgrade() 请求体的 period 字段不在此处预留（checkout/route.ts 归支付线独占，period 管道由支付线在重构中打通，见 §5.4 对接契约） |

依赖与移交项（不属于本页文件，验收链路需要）：

| 序号 | 文件 | 动作 | 归属 |
|------|------|------|------|
| D1 | `web/app/auth/signup/page.tsx` + `web/app/api/v1/auth/register/route.ts` | **移交埋点线**（裁决四） | src 参数读取与透传、register_success props 一次成型（含 src 字段）由埋点线在 signup/register 改造中一次成型；本线 ?src=pricing 是纯增量字段需求，作为对接需求输入移交后 D1 关闭。spec §9 归因链路 e2e 验收由本线在埋点线交付后联调 |
| D2 | `web/tests/unit/pricing-page.test.tsx` | 新建（本线交付） | 见第8章测试计划 |
| D3 | `web/app/api/v1/events/route.ts` 白名单扩齐 | **移交埋点线**（裁决一） | ALLOWED_EVENT_NAMES 一次性扩齐至 16 名（FUNNEL 9 + spec §8 三事件 3 + 支付线 webhook 四事件 4）并抽出 lib/analytics-whitelist.ts 单一事实源；本线/支付线只消费 |
| D4 | `web/app/api/v1/workspaces/[wid]/billing/checkout/route.ts` period schema + props 扩充 | **移交支付线**（裁决三） | checkout/route.ts 整体重构由支付线独占，本线 period 两项需求（zod 增 period 枚举、billing_checkout props 扩 { seatLimit, period }）并入支付线清单；契约六要点见 §5.4 |

**明确不改动**：`web/middleware.ts`（1.3 节结论）；`web/lib/analytics.ts`（客户端能力已满足）；`web/lib/analytics-server.ts`（签名改造归埋点线独占，裁决二）；`web/app/api/v1/events/route.ts`（白名单归埋点线一次性扩齐，裁决一）；`web/app/api/v1/workspaces/[wid]/billing/checkout/route.ts`（归支付线独占重构，裁决三）；`web/app/auth/signup/page.tsx` 与 `web/app/api/v1/auth/register/route.ts`（归埋点线独占，裁决四）；`design/design-tokens.css`（无缺失变量；若评审要求微调 Token 必须改这份源文件）；billing 页既有 PLANS 常量（保持 app 内展示口径独立，仅在代码注释处互链 `@/lib/pricing` 说明权威口径在定价页常量）。

---

## 第3章 组件拆分方案

### 3.1 拆分原则与结论

原则（源自 spec 克制基调与项目现状）：

1. 项目 components/ 目前是扁平结构、无 marketing 共享层，定价页九区块中七个是纯静态内容，抽成七个独立组件文件属于过度工程（违背 spec §2「控制复杂度」「宁可没有，不要假数据」的克制原则，也徒增 import 面）。
2. billing 页单文件 352 行的项目现状证明：中等复杂度页面允许单文件内联函数组件。
3. 客户端边界必须最小化以保证首屏体积与未来 SSG 改造成本最低（见第4章）。

**结论：page.tsx 单文件内联 TopNav/Hero/三栏 FeatureGrid/对比表 ComparisonTable/FAQ/尾部 CTA/FootFooter 七个模块级函数组件（不导出），另抽三个真正的交互/副作用单元到 `components/pricing/`**：

```text
web/app/pricing/page.tsx        （服务端外壳 + 7 个内联静态区块组件）
web/components/pricing/
  ├─ PricingSection.tsx         （'use client'：切换器 + 双卡，唯一 stateful 区块）
  ├─ PricingViewTracker.tsx     （'use client'：view_pricing 埋点，渲染 null）
  └─ TrackedCta.tsx             （'use client'：click_upgrade CTA 微组件，包裹四 source）
```

P1-6 定稿：`components/pricing/` 下共三个文件（PricingSection / PricingViewTracker / TrackedCta），与第2章清单、§5.3 选型论证一致。

理由细化：

- PricingSection 必须 client 化的原因：计费周期是 React state，切换器与双卡价格数字联动；若把 Toggle 和卡片分开，state 无法跨越服务端组件边界传递，反而要把整个⑤区一起包进 client 边界——那就干脆以⑤区整体为一个 client 组件，边界清晰且只有一个。
- FAQ 用原生 `<details>/<summary>`（spec §3.7 明确零 JS），留在服务端区；展开图标的 ChevronDown 旋转用 Tailwind `group-open:rotate-180`（billing 页 L307 `details.group` 先例 + `transition-transform duration-[var(--motion-base)]`），零自定义 JS。
- Hero「先看看团队能省多少」平滑滚动：**用锚点 `<a href="#plans">` + CSS `scroll-behavior: smooth`，零 JS**。落点：在 globals.css 给 `html` 增加 `scroll-behavior: smooth;`（tokens 的 prefers-reduced-motion 块已含 `scroll-behavior: auto !important` 全局降级，design-tokens.css L310–319，符合 spec §3.2「尊重 prefers-reduced-motion——已全局降级」）。不引入 onClick scrollTo 客户端组件。
- 社会证明条（§3.3 条件渲染）：MVP 种子期付费团队数必然 < 20 且静态页无数据源。实现为 `web/lib/pricing.ts` 导出 `SOCIAL_PROOF = { minTeams: 20, paidTeams: null }`，page.tsx 按 `paidTeams !== null && paidTeams >= minTeams` 条件渲染，当前恒为 false——保留分支结构、永不显示空占位，未来接通数据只改常量来源一处。
- TopNav「当前页高亮 --accent」是静态已知事实（本页就是定价页），直接写死高亮类，无需 usePathname。

### 3.2 服务端/客户端边界

表：区块渲染边界表

| 区块 | 渲染端 | 说明 |
|------|--------|------|
| TopNav / Hero / 三栏 / 对比表 / FAQ / 尾部 CTA / Footer | 服务端（page.tsx 内联） | 纯静态 JSX；Hero 主按钮是 `<Link href="/auth/signup?src=pricing">`，无需 JS |
| 定价卡⑤（切换器+双卡+卡按钮） | `'use client'`（PricingSection） | 周期 state + select_billing_period/click_upgrade 埋点；Pro 卡游客跳转 `<Link href="/auth/signup?src=pricing&plan=pro">` 保持 Link 语义 |
| view_pricing 埋点 | `'use client'`（PricingViewTracker） | useEffect once；sessionStorage key `corps_pricing_viewed` 做每会话去重（spec §8「每会话去重一次」）；渲染 null 不产生 DOM |

客户端 JS 总量预估：两个小组件 + analytics 模块 + react 运行时，无第三方库新增。

### 3.3 PRICING_PLANS 常量落点

**决策：放 `web/lib/pricing.ts`**，不放 page.tsx 也不放 components/。依据：

1. lib 目录现状即「框架无关的可复用逻辑/常量」层（task-meta.ts 是最接近的先例：领域常量 + 类型）；
2. spec §4.1 明示「建议集中为 PRICING_PLANS 常量，供页面与埋点引用」——埋点侧（PricingSection）与页面侧（page.tsx 的对比表、metadata description 里的价格文案）都要消费，放 page.tsx 会让 metadata 与组件耦合；
3. 测试可直接 `import { PRICING_PLANS } from "@/lib/pricing"` 断言口径（vitest alias `@` 已配置指向 web 根，vitest.config.ts resolve.alias）；
4. billing 页 PLANS 是页面私有展示口径（¥59 字符串形态），不动它，避免扩大回归面；在其旁加注释指向权威口径即可。

`web/lib/pricing.ts` 导出面：`PRICING_PLANS`（spec §4.1 逐字冻结）、`type PlanId = keyof typeof PRICING_PLANS`、`type BillingPeriod = "monthly" | "yearly"`、年付派生数字（月均价 49.2、省 118，由 59×12−590 计算得出而非硬编码字符串）、`PRICING_FAQS`（六条，question_id 0–5）、`PRICING_MATRIX`（分组行结构：组名 + 行[名称, free 值, pro 值]，值类型 string，✅/— 按 spec §4.2 用文本字符）。

### 3.4 关键交互实现选型汇总

表：交互选型对照表

| 交互 | 选型 | 依据 |
|------|------|------|
| 平滑滚动到定价卡 | 锚点 a[href="#plans"] + globals.css `html { scroll-behavior: smooth }` | 零 JS；reduced-motion 已由 tokens L310–319 兜底 |
| FAQ 手风琴 | 原生 details/summary + Tailwind group-open 旋转 | spec §3.7；billing L307 先例 |
| 周期切换器 | React 受控分段控件（button aria-pressed） | spec §3.5 默认年付；选中态 accent-soft/accent-soft-fg/pill |
| 切换时价格变化 | 仅文本节点更新 | spec §9 CLS≈0；用户主动交互后的位移不计入 CLS（hadRecentInput 豁免），首屏默认年付态含徽标故加载后零位移 |
| Pro 升级按钮 | 渲染态二分支：始终渲染 Link 至 /auth/signup?src=pricing&plan=pro（游客/营销语境） | spec §3.5「Owner 场景直连 checkout」发生在 app 内 billing 页，公开页无会话上下文，一律走注册归因链路；Owner 从 billing 页互链进入时其升级动作仍在 billing 完成 |

---

## 第4章 SSG/ISR 决策

**结论：本期不做 SSG/ISR 改造，接受与全站一致的动态 SSR；不添加 `export const revalidate`。**

论证链（全部为实测证据，非推断）：

1. spec §1 设想「默认静态 + 可选 revalidate=3600」，前提是页面无动态数据——这一点成立（本页零 fetch、零 cookies/searchParams 读取，CTA 的 `?src=pricing` 是静态拼在 href 里的出参不是入参）。
2. 但 1.5.3 节实证：根 layout `headers()` 读 CSP nonce 使全站退出静态生成（prerender-manifest 仅 `/_global-error`）。在此架构下给 page.tsx 加 `revalidate = 3600` 不会产生 ISR 产物，属于无效配置。
3. 性能预算复核（spec §9 LCP<2.5s）：本页动态渲染的成本仅为每请求一次 Node JSX 渲染（纯静态 JSX 树，无 IO），无认证往返、无数据库查询、无第三方脚本；HTML 体积小。LCP 主要瓶颈仍是字体与网络，与渲染模式弱相关。Lighthouse ≥90 验收目标预计仍可达标，但须实测确认（列入第8章验收清单）。
4. 若强行追求 SSG，需把根 layout 拆为 route groups 双布局（marketing 组不读 headers；theme-init 的 nonce 对外链脚本并非必需，CSP `script-src 'self'` 已覆盖同源外部脚本）——这是一次全站架构手术，波及主题初始化与 CSP 策略，远超定价页任务边界。

**后续路线建议（非本期）**：若未来出现独立营销首页等更多 marketing 页面，再立项做 route groups 拆分，一次性让 marketing 层 SSG。本期在 page.tsx 顶部留注释说明该决策及出处（本文档 1.5.3 节），防止后人误加无效的 revalidate。

---

## 第5章 埋点集成点

### 5.1 与 landing_view 的语义边界（P1-1/P1-2 落实裁决一）

> 修订说明：本节原 v1 版单方面裁定「landing_view 本期不进白名单、不打点」被三线审核报告 P1-1 判为越权（一条设计线无权否定另一份 ACCEPTED 冻结文档 FUNNEL-METRICS 的口径）。本 v2 版按裁决一修订为「共存 + 边界声明」。

**结论（按裁决一）**：landing_view 与 view_pricing 共存，按语义分域：

- **landing_view**＝全站公开页曝光基线（获客段漏斗第一步 + ADR-008 S1 国际化信号载体）。由**埋点线单一线维护**的 `PublicPageTracker` 与 `PUBLIC_LANDING_ROUTES`（含 `/pricing`、`/auth/*`）自动覆盖 `/pricing`。本页对 PublicPageTracker 与白名单零感知、零改动。
- **view_pricing**＝定价页专属曝光与 spec §9 白名单联调事件，由本页 PricingViewTracker 显式触发（每会话 sessionStorage 去重）。
- **单次 PV 两条事件并存**：各自独立会话去重（landing_view 按 (sid,path) 模块级 Set、view_pricing 按 sessionStorage），无重复刷量；漏斗各走各的——获客段用 landing_view（path=/pricing 可过滤），spec §8 的 `view_pricing → click_upgrade → billing_checkout` 转化漏斗用 view_pricing。

**本页自身只实现 spec §8 三事件**：`view_pricing` / `select_billing_period` / `click_upgrade`。landing_view 由 PublicPageTracker 自动产生，本页不直接调用、不进白名单、不耦合其实现。

**click_signup 处置（P1-2 落实裁决一附属）**：

- /pricing 四 CTA 只打 spec §8 的 `click_upgrade`（定价线独占），**不打 click_signup**。
- click_signup 本期落地范围收敛为 auth/login 页注册链接（埋点线独占）。
- 埋点线漏斗匹配器登记「/pricing 来源跳过 click_signup 属预期跳步」——匹配器本就允许跳步，register_submit 计数不受影响，「点击意愿」信号由 click_upgrade 单独承载。
- 理由：同一意图双打会造成 CTR 分子重复计数，比少一格漏斗步骤危害更大；未来独立营销首页出现后 click_signup 自然获得真实落点。

**props 口径**：任务输入中的 `props={cta:"header"|"hero"|"pricing", path}` 与 spec 的 `{ plan, period, source:"hero"|"card"|"tail_cta"|"nav" }` 冲突，**以 spec 为准**：source 枚举已完整覆盖四个 CTA 位（header→nav、hero 主按钮→hero、定价卡按钮→card、尾部 CTA→tail_cta），不额外传 path（events/route.ts L15 注释约束 props 仅存匿名化字段，URL path 属冗余维度）。

### 5.2 view_pricing 实现

- 触发位置：PricingViewTracker（client）useEffect 首次挂载时；去重用 sessionStorage（会话语义，关标签即重置，符合「每会话去重一次」）。
- props：`{ theme: document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light" }`（spec §8 表格要求；根 layout data-theme 由 /theme-init.js 同步设置，挂载时已就绪）。
- 为什么不在服务端打：spec §8 实现要点 2 明确「在 page.tsx 服务端组件外壳内的客户端挂载组件中触发（页面本体保持 SSG）」——虽然第4章已证实现阶段是 SSR，客户端触发的设计仍正确保留（匿名访客无 userId，客户端 track 走匿名 sessionId 漏斗关联；且未来切 SSG 后该设计无需变更）。

### 5.3 click_upgrade 与 select_billing_period 实现

- click_upgrade：PricingSection 内各按钮 onClick 中调用 `track("click_upgrade", { plan, period, source })` 后放行默认导航（Link 场景改为 button 包裹或不拦截导航——推荐：外层 `<Link onClick={() => track(...)}>`，fire-and-forget 不阻塞跳转，analytics 队列 5s 兜底 flush + beforeunload sendBeacon 保证离开前发出，analytics.ts L72–81/L135–150 机制已覆盖）。source 取值映射：TopNav「免费开始」→ nav；Hero 主按钮 → hero；Pro 卡按钮 → card；尾部 CTA 按钮 → tail_cta。Free 卡按钮同样上报 plan="free"。
  - 注意：nav/hero/tail_cta 三个 source 位于服务端区块，但其 CTA 都是 Link——onClick 内联调用 track() 写在 page.tsx 里会使这些区块沾染客户端行为。两种做法：(a) 这三个 CTA 保持纯 Link 不打点，仅 card 内按钮打点（丢三个位置的点击数据，不可接受）；(b) 抽公共 `<TrackedCta>` client 微组件包裹四处 CTA。**选 (b)**：`components/pricing/TrackedCta.tsx`（'use client'，props: href/plan/source/children/variant），它替代 PricingSection 内按钮的直接 track 调用，成为第三个也是最后一个 client 组件，职责单一。
- select_billing_period：切换器 onChange 时 `track("select_billing_period", { period })`，period 值 "monthly"|"yearly"。

### 5.4 与支付线 checkout period 对接契约（P1-4 落实裁决三）

> 修订说明：v1 版本节自列 checkout/route.ts 改动（schema 加 period、props 扩 { seatLimit, period }）与支付线对该路由的整体重构冲突。v2 版按裁决三改写为对接契约引用，本线不修改 checkout/route.ts。

**归属**：`checkout/route.ts` 由支付线整体重构独占；本线的两项需求（zod 增 period 枚举、billing_checkout props 扩 { seatLimit, period }）并入支付线清单交付（对应 D4）。

**对接契约六要点**（与支付线文档互相引用，避免验收时误判「年付转化链路已闭环」）：

1. 请求体字段 `period: string` 枚举 `monthly|yearly` 可选；
2. 缺省 `monthly`；
3. 非法值由 zod 400 兜底；
4. `yearly` 且 `STRIPE_PRICE_ID_YEARLY` 未配置 → 400 文案「年付价格未配置」（错误码 `unsupported_period`），**绝不静默降级**；
5. 响应信封不变 `{ code: 200, data: { url } }`；
6. `billing_checkout` props 为 `{ seatLimit, period? }`，period 缺省时键可省略。

**现状断层披露**（R4）：Phase 1 定价页年付默认选中只作用于展示与 click_upgrade 归因；注册进 app 后 billing 页 upgrade() 暂传 `period: undefined`（仅打通管道），年付实际下单依赖 billing 周期 UI 后续迭代——此断层本线 R4 已登记，并在支付线对接契约节互相引用。

**白名单扩充归属**（P1-1 落实裁决一）：events/route.ts 的 `ALLOWED_EVENT_NAMES` 由埋点线一次性扩齐至 16 名（FUNNEL 9 + spec §8 三事件 3 + 支付线 webhook 四事件 4）并抽出 `lib/analytics-whitelist.ts` 单一事实源，本线/支付线只消费（对应 D3）。本线不修改 events/route.ts。

---

## 第6章 移动端断点处理

断点沿用 SPEC sm 640/md 768/lg 1024/xl 1280；Tailwind 默认档位与之对齐（sm/md/lg 前缀即 640/768/1024）。逐区块表现（lg 为基准，spec §7 断点行为表的落地细化）：

表：移动端断点落地明细表

| 区块 | lg ≥1024 | md 768–1023 | sm <768 |
|------|----------|-------------|---------|
| 容器 | max-w-[var(--container-max)] mx-auto px-[var(--space-8)] | px 收窄至 --space-6 | px 收窄至 --space-4，容器全宽 |
| TopNav | logo + 定价(高亮) + 登录 + [免费开始] | 同 lg | 仅 logo + [免费开始]；中间两个链接 hidden md:inline（spec §3.1 不引入汉堡菜单） |
| Hero | H1 text-4xl + tracking-display | H1 降 text-3xl | H1 text-2xl；副标 max-w-[36em] 自然换行；双 CTA 纵向堆叠全宽（gap --space-3） |
| 功能三栏 | grid-cols-3 gap-8 | 退化 1 列（采纳 spec §7「倾向退化 1 列保可读性」，md 即 grid-cols-1） | 1 列堆叠，卡 padding --space-6 |
| 定价卡 | grid-cols-2 等宽，Pro 不放大 | grid-cols-2，卡内 padding 收窄至 --space-6 | grid-cols-1，**DOM 顺序 Pro 在前**（转化优先，spec §7；用 order 类实现：Free `order-2 md:order-1`，Pro `order-1 md:order-2`，避免源顺序反转伤害屏幕阅读器语义的做法需评审——备选：CSS grid 用 order 仅为视觉序，details 语义序不变，可接受） |
| 对比表 | 平铺三列 | 容器 div overflow-x-auto，table min-w-[720px] | 同 md；首列 th/td sticky left-0 bg surface（z-index 1 遮住滚动穿透） |
| FAQ | max-w-[720px] mx-auto | 同 lg | 全宽，条目 padding 降为 `var(--space-4) var(--space-4)` |
| 尾部 CTA | 标题与按钮横排两端对齐 | flex-col 纵向堆叠居中 | 纵向；按钮 w-full |
| Footer | 单行左右分布 | 同 lg | 左右两组换行为两行（flex-wrap gap-2） |

实现载体：Tailwind 响应式前缀（项目已在用 sm:/md: 前缀，billing 页 L156/170/237 大量先例），不引入自定义 breakpoint 配置。

---

## 第7章 风险与非目标

### 7.1 风险

表：风险登记表

| 编号 | 风险 | 影响 | 缓解措施 |
|------|------|------|----------|
| R1 | spec 写的 CTA 目标 `/auth?src=pricing` 与实际路由不符（实际 `/auth/login`、`/auth/signup`，无裸 /auth；证据 1.5.1） | 若照抄 spec，四个 CTA 全部 404，转化链路断裂 | 实现已适配为 `/auth/signup?src=pricing`（注册意图）与 `/auth/login`；在 PR 描述中提请产品负责人知悉，并在 spec 勘误（勘误属规格修订，须走评审） |
| R2 | KanbanSquare 是 deprecated 别名（1.2 节） | lucide 未来大版本移除别名导致构建失败 | import 写法绑定为 `SquareKanban as KanbanSquare`；版本已精确锁 0.513.0，升级需显式改 package.json，届时编译期即暴露 |
| R3 | 全站动态渲染（根 layout headers()），spec SSG 前提不成立（1.5.3/第4章） | LCP 验收存在不确定性；每请求渲染成本 | 本页零 IO 轻量 SSR；Lighthouse 实测列入验收清单；SSG 改造立后续项 |
| R4 | billing 页无周期概念，checkout 的 period 管道暂时空传（5.4 节对接契约） | 年付转化分析在 billing 直达场景缺维度 | checkout/route.ts 归支付线独占重构（裁决三）；schema optional 向后兼容；定价页进来的流量经 /auth 注册后首次触达 billing 前，period 维度主要由 click_upgrade 承载；billing 周期 UI 列后续迭代。本线不修改 checkout/route.ts，仅以契约引用形式与支付线互相落纸 |
| R5 | register_view/register_submit 目前无任何调用点（1.5.1），src 归因终点未接通 | ?src=pricing 透传到注册页后无人消费，漏斗断在最后一环 | D1 已移交埋点线（裁决四）：signup/register 改造由埋点线一次成型；验收清单含归因链路端到端检查（spec §9），本线 e2e 在埋点线交付后联调 |
| R6 | tokens 双文件覆盖机制（predev/prebuild 从 design/ 复制，1.1.1 节） | 误改 web/app 副本的改动会被静默回滚 | 团队约定 + PR 检查：Token 变更只进 design/；本页无 Token 新增需求 |
| R7 | Footer「服务条款/隐私政策」href="#" 占位（spec §3.9 明示 TODO） | SEO/合规瑕疵 | 代码注释 `// TODO(legal): 上线前补齐真实文档链接`；不阻塞 M3 发布（spec 已拍板占位） |
| R8 | 深色模式双主题人工过检依赖自觉（spec §6/§9） | 深色下对比度或徽标观感问题漏检 | 验收清单固化两主题 × 四断点矩阵目检；eyebrow/elev/accent-soft 深色覆盖均已存在于 tokens（L245–292），理论无适配工作量 |

### 7.2 非目标

1. 不做独立营销首页/Landing 改版（landing_view 由埋点线 PublicPageTracker 自动覆盖 /pricing，本页不直接实现，见 5.1）。
2. 不做 Enterprise 询价通道 UI（pricing-strategy §3.1 仅邮箱占位口径，页面不出现在本页）。
3. 不做多语言/i18n（lang="zh-CN" 单语，root layout L16 现状）。
4. 不引入动画库、不做入场动效编排（spec §6 动效收敛条款：motion-enter 仅首屏可用一次，克制执行）。
5. 不改 billing 页套餐卡视觉与 PLANS 结构（仅加互链；period 管道归支付线在 checkout/route.ts 重构中打通，本线不动 checkout）。
6. 不做 A/B 实验框架接入（漏斗基线先行，spec 未要求）。
7. middleware/CSP/CORS 安全层零改动（1.3 节结论）。
8. 不改 events/route.ts 白名单与 analytics-server.ts 签名（分别归埋点线一次性扩齐与独占改造，裁决一/二）。
9. 不改 checkout/route.ts（归支付线独占重构，裁决三）。
10. 不改 signup/page.tsx 与 auth/register/route.ts（归埋点线独占，裁决四）。

---

## 第8章 测试计划

### 8.1 单元测试

新建 `web/tests/unit/pricing-page.test.tsx`，完全沿用项目测试风格（参照 tests/unit/skeleton.test.tsx：文件顶部 `// @vitest-environment jsdom`、`@testing-library/jest-dom/vitest`、describe/it 中文用例名、Arrange/Act/Assert 注释分段）。覆盖四组：

1. **常量口径测试**（纯 node 环境即可，无需 jsdom）：PRICING_PLANS.free.monthlyPrice===0；pro.monthlyPrice===59、yearlyPrice===590；features 数组长度 7/6；年付派生（59*12-590===118）；PRICING_FAQS 长度 6 且 question_id 连续。防手滑改价（呼应 spec「价格调整仅需改第 4 节常量表」的单点修改承诺）。
2. **页面骨架渲染测试**：render(<PricingPage />)（default export 含 metadata 导出不影响组件渲染）；断言 H1 文案「让讨论结论自动落位」、对比表分组行数（5 组）与总数据行、FAQ details 元素数量 === 6、Footer 含「© 2026 corps」、TopNav 高亮类落在「定价」链接上。
3. **PricingSection 交互测试**：默认年付态断言（¥590 可见、删除线 ¥59 原价可见、「省 ¥118/席」徽标可见）；fireEvent.click 月付分段后价格切 ¥59 且徽标消失；切换调用被 mock 的 `track("select_billing_period", { period: "monthly" })`（vi.mock("@/lib/analytics")）；Pro 卡按钮 click 上报 click_upgrade 且 source==="card"、period 与当前态一致。
4. **TrackedCta/PricingViewTracker 测试**：TrackedCta 渲染为链接且 href 正确、onClick 上报对应 source；PricingViewTracker 挂载即上报 view_pricing 且二次挂载（同 sessionStorage 会话）不上报（去重断言）；mock matchMedia/localStorage/sessionStorage 已在 tests/setup.ts 环境下按需补 stub。

运行命令：`pnpm test`（vitest run，package.json scripts.test；vitest.config include 已覆盖 tests/**/*.test.tsx，alias @ 已配置）。

### 8.2 E2E 冒烟

扩展 `web/e2e/smoke.spec.ts`（playwright，现有唯一 e2e 文件）新增一条：访问 /pricing → 断言 HTTP 200、H1 可见、双卡价格文本、点击 Hero 主按钮落地 /auth/signup?src=pricing（URL 断言）。移动视口（375px）下断言对比表容器可横向滚动、无横向溢出破版（scrollWidth 校验）。

### 8.3 白名单联调

按 spec §9「白名单五事件联调入库验证」：本地起 dev 后，脚本或手动触发 view_pricing/select_billing_period/click_upgrade 各一次，`GET /api/v1/events`（dev 环境）或直接查 analytics_events 表确认入库 accepted>0；再发一个白名单外事件确认被过滤（accepted 不含它）。

**前置依赖**：白名单扩齐（D3）由埋点线一次性扩齐至 16 名并抽出 `lib/analytics-whitelist.ts` 单一事实源（裁决一）。本线单测阶段用 vi.mock 模拟 track 调用，不依赖白名单真实扩充；联调阶段须在埋点线 D3 交付后进行。同时验证 billing_checkout 入库 props 含 seatLimit 与 period 字段（period 为空时字段可为 undefined/null，schema 兼容）——此项依赖支付线 D4 交付后在 checkout/route.ts 重构中验证。

### 8.4 验收清单对照

任务提示要求对照「spec 第 8 节」，经核对 spec 第 8 节为埋点事件规格、**性能与验收预算在第 9 节**（第 10 节为任务拆解），以下对照第 9 节逐条落实：

表：spec §9 验收清单对照表

| spec §9 验收项 | 落实方式 | 出处 |
|----------------|----------|------|
| 两主题目检 | R8 矩阵目检：light/dark × 四断点 | spec §6 深色自动生效、§9 |
| 四断点目检（重点 sm 不崩） | 第6章断表明细逐项过；e2e 375px 溢出断言 | spec §7 |
| 白名单五事件联调入库 | 8.3 节流程（view_pricing/select_billing_period/click_upgrade 三新事件 + 既有 register/billing 系列 src/period 字段） | spec §8 |
| ？src=pricing 归因链路走通 | 定价页 CTA → signup 页读 src（D1 移交埋点线）→ register 事件 props.src="pricing" 入库抽查；本线 e2e 在埋点线 D1 交付后联调 | spec §1/§8 |
| Lighthouse Performance ≥ 90（本地生产构建） | `pnpm build && pnpm start` 后本地跑分；关注 LCP<2.5s；若受动态渲染拖累则触发第4章后续路线评估 | spec §9、本文第4章 |
| （§9 补充项）CLS≈0 | 切换仅文本变化 + 首屏即年付终态（3.4 节） | spec §9 |
| （§9 补充项）键盘可达/AA/focus ring/lang | details 原生可达；muted/meta 置于 bg/surface 的 AA 抽查；focus-ring 全保留（禁 outline:none）；html lang 已是 zh-CN（root layout L16） | spec §6/§9 |
| （§9 补充项）SEO title/description/OG | page.tsx export metadata：title「corps 定价 —— 免费 10 人，Pro ¥59/人/月」；description 对齐 Hero 副标；OG 基础三件套 | spec §9 |

---

## 附：三个最关键设计决策摘要

1. **middleware 零改动**：实测 middleware.ts 无登录重定向逻辑（守卫是 /w 路径客户端软守卫），/pricing 天然公开，spec §1 的白名单假设不适用——砍掉一项计划内改动。
2. **放弃 SSG/ISR 配置，接受全站一致的动态 SSR**：根 layout 的 headers() nonce 读取已使全站退出静态生成（prerender-manifest 实证），revalidate=3600 是无效配置；本页零 IO 载渲染保住 LCP 预算，SSG 改造（route groups 拆分）立为后续独立事项。
3. **埋点严格按 spec §8 冻结口径实现（view_pricing/click_upgrade/select_billing_period），与 landing_view 共存按语义分域**（v2 修订 P1-1）：landing_view 由埋点线 PublicPageTracker 自动覆盖 /pricing（获客段漏斗第一步 + ADR-008 S1 国际化信号载体），本页不直接实现；view_pricing 为定价页专属曝光与 spec §9 白名单联调事件。/pricing 四 CTA 只打 click_upgrade（P1-2），click_signup 收敛为 auth/login 页注册链接（归埋点线）。客户端边界收敛为三个微组件（PricingSection/PricingViewTracker/TrackedCta）。

---

## 附二：跨线移交与工时小结（P1-7 落实）

### 跨线移交项汇总

| 移交项 | 接收线 | 内容 | 对本线验收的影响 |
|--------|--------|------|------------------|
| D1 | 埋点线 | signup/page.tsx + auth/register/route.ts：src 参数读取与透传、register_success props 一次成型 | spec §9 归因链路 e2e 验收依赖其交付后联调 |
| D3 | 埋点线 | events/route.ts 白名单一次性扩齐至 16 名 + 抽出 lib/analytics-whitelist.ts 单一事实源 | 单测阶段 vi.mock 不依赖；联调阶段须其交付 |
| D4 | 支付线 | checkout/route.ts 整体重构：period schema + billing_checkout props 扩 { seatLimit, period }，按对接契约六要点 | billing_checkout period 维度联调依赖其交付 |

### 本线工时小结（对齐 spec §10 的 0.5 周预算）

| 阶段 | 工作内容 | 估时 |
|------|----------|------|
| 设计 | 调研 + 本设计文档 v1 + v2 修订（按审核报告 P1-1~P1-7） | 1 人日（已发生） |
| 实现 | web/lib/pricing.ts + web/app/pricing/page.tsx + 三组件 + billing 页互链 | 1.5 人日 |
| 测试 | web/tests/unit/pricing-page.test.tsx 四组用例 + vitest run 验证 | 0.5 人日 |
| 联调 | D1/D3/D4 交付后的归因链路 + 白名单 + period 联调（依赖跨线排期） | 0.5 人日（依赖跨线） |
| 验收 | 双主题 × 四断点目检 + Lighthouse + e2e 冒烟 | 1 人日 |
| 合计 | — | **4.5 人日（≈ 0.5 周）** |

D1 移交埋点线计价（signup/register 改造含 src 字段透传）由埋点线工时承担，本线不计；联调 0.5 人日为本线在跨线交付后的尾端验收成本，已纳入合计。spec §10 的 0.5 周预算覆盖本线全部工作。