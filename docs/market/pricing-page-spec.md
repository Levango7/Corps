# corps 定价页/Landing 页规格

> 日期：2026-08-26 ｜ 状态：**PROPOSED（待用户拍板）** ｜ 决策人：＿＿＿＿＿＿（留空待签署）
> 作者：商业化决策分析师 ｜ 面向读者：前后端开发
> 依据：SPEC.md v0.1.0（§1 产品定义 / §2 MVP 范围 / §8 设计 Token / §10 边界约束）、design-tokens.css（303 行，Token 唯一定义层）、ADR-003（2026-08-26 收口版，支付通道路线）、pricing-strategy.md（2026-08-26 两档制定价）、web/lib/analytics.ts 与 web/app/api/v1/events/route.ts（埋点现状）
> 前置依赖：本文定价数字（¥59/¥590）以 pricing-strategy.md 拍板为准；若价格调整仅需改第 4 节常量表

---

## 1. 路由与页面形态决策

表：路由方案对照表

| 方案 | 说明 | 结论 |
|------|------|------|
| `/pricing` 独立公开页 | marketing 层路由，无需登录，静态生成（SSG + ISR） | **采用** |
| app 内嵌（挂在 /w/:wid 下） | 仅登录可见，无法承接外部流量 | 否决 |

采用理由：

1. 定价页承担获客漏斗第一环（访客 → 注册），必须对未登录用户可达且可被搜索引擎收录；app 内嵌方案做不到。
2. SSG 保证 SPEC §10 的 LCP < 2.5s 预算，无认证往返。
3. app 内计费管理页 `/w/:wid/billing` 保持现状（升级/Portal/订阅状态管理），在其头部新增一行链接"查看完整功能对比 →"指向 `/pricing`（新窗口或当前窗口均可，实现取其一并保持一致）。

技术落点：

- 路由文件：`web/app/pricing/page.tsx`（App Router，默认静态；若引入 ISR 则 `export const revalidate = 3600`）。
- 该页面不进入登录重定向白名单之外的鉴权逻辑；`middleware` 若对全站未登录跳转，需将 `/pricing` 加入公开路径列表（开发时核对 `web/middleware.ts` 现状）。
- 注册归因：CTA 链接携带 `?src=pricing` 至 `/auth?src=pricing`，注册流程将该参数并入既有 `register_view` / `register_submit` 事件的 props（不新增事件，见第 8 节）。

## 2. 页面结构总览

自上而下九个区块；除导航与尾栏外，全部区块共用同一内容容器宽 `max-width: var(--container-max)`（1280px）水平居中，保证整页左右边界一致（全站布局一致性约定）：

```
┌──────────────────────────────────────────────┐
│ ① TopNav        logo · 定价 · 登录 · [免费开始] │
│ ② Hero          eyebrow + H1 + 副标 + 双 CTA    │
│ ③ 社会证明条     （条件渲染，见 3.3）             │
│ ④ 功能三栏       决策落位 / 任务看板 / 安全隔离    │
│ ⑤ 定价卡         Free / Pro 双卡 + 计费周期切换   │
│ ⑥ 功能对比表     完整矩阵（含免费/Pro 全部差异点） │
│ ⑦ FAQ           6 条手风琴                      │
│ ⑧ 尾部 CTA       强调色区块 + 主按钮              │
│ ⑨ Footer        极简：© · 服务条款 · 隐私         │
└──────────────────────────────────────────────┘
```

区块间距统一 `padding-block: var(--section-y)`（36px）；②⑤⑧ 三个重点区块加大至 `var(--space-20)`（80px）形成呼吸节奏。

## 3. 各区块规格

### 3.1 TopNav

- 结构：左侧 wordmark「corps」；右侧文字链接「定价」（当前页高亮 `--accent`）、「登录」、主按钮「免费开始」→ `/auth?src=pricing`。
- 高度 `var(--topbar-h)`（56px）；背景 `color-mix(in srgb, var(--surface) 92%, transparent)` + `backdrop-filter: blur(8px)`，滚动时底边出现 `1px solid var(--border-soft)`。
- 移动端（<md）：折叠为 logo + 「免费开始」按钮，中间链接收起（本页锚点少，不引入汉堡菜单，控制复杂度）。

### 3.2 Hero

- eyebrow 小标签：「为 5–30 人团队打造」，样式 `background: var(--eyebrow-bg); color: var(--eyebrow-fg); border-radius: var(--radius-pill); font-size: var(--text-xs); padding: var(--space-1) var(--space-3)`。
- H1（`--text-3xl` 30px，lg 以上升 `--text-4xl`；`font-weight: var(--weight-semibold)`; `letter-spacing: var(--tracking-tight)`）：

  > 让讨论结论自动落位成任务

- 副标（`--text-md`，`color: var(--muted)`，最大行宽 36em）：

  > 以工作区任务看板为锚点，决策记录双向回链任务上下文。15 分钟上手，不为用不上的功能付费。

- CTA 组（水平排列，间距 `var(--space-3)`）：
  - 主按钮「免费开始，最多 10 人」：实心 accent，`background: var(--accent); color: var(--on-accent)`，hover `var(--accent-hover)`，active `var(--accent-active)`，圆角 `var(--radius-md)`，高度 40px。
  - 次按钮「先看看团队能省多少」：幽灵样式 `border: 1px solid var(--border); color: var(--fg-2)`，点击平滑滚动至定价卡（`scroll-behavior: smooth`，尊重 prefers-reduced-motion——design-tokens.css 已全局降级）。

### 3.3 社会证明条（条件渲染）

- 数据源：付费团队数 ≥ 20 才渲染此区块；MVP 种子期隐藏整个区块，不显示空占位（克制原则：宁可没有，不要假数据）。
- 渲染形态：单行居中文案「N 个团队正在用 corps 管理决策与任务」+ 团队名首字母圆形头像组（`--icon-lg` 尺寸，边框 `var(--border)`），无第三方 logo 墙。

### 3.4 功能三栏

表：功能三栏内容表（图标均为 Lucide，尺寸 `--icon-lg` 24px，stroke 2px，`color: var(--accent)`）

| 栏 | Lucide 图标 | 标题 | 正文（一句话） |
|----|-------------|------|----------------|
| 决策不散落 | `GitBranch` | 结论自动落位 | 讨论结论一键固化为决策记录，版本留痕、双向回链任务，不再手动搬运 |
| 看板即上手 | `KanbanSquare` | 15 分钟跑起来 | 看板/列表双视图 + 拖拽改状态，乐观更新零等待；Cmd+K 全局检索任务与决策 |
| 隔离够硬核 | `ShieldCheck` | 数据引擎级隔离 | PostgreSQL 行级安全（RLS）强制多租户隔离，跨工作区请求一律拦截 |

- 布局：lg 及以上三等分栅格（gap `var(--space-8)`）；卡片 `background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: var(--space-8)`，hover 抬升 `box-shadow: var(--elev-hover)`（过渡 `var(--motion-base) var(--ease-standard)`）。
- 图标统一封装单一组件（传入名称），禁 emoji、禁止混用其他图标库（SPEC §8 锁定 Lucide）。

### 3.5 定价卡

- 顶部切换器（分段控件）：「按月付 ¥59/人」「按年付 ¥49.2/人（省 2 个月）」，**默认选中年付**（呼应 ADR-003 第 4 节"年付优先"的续费摩擦策略）。选中态 `background: var(--accent-soft); color: var(--accent-soft-fg)`，容器 `border-radius: var(--radius-pill); border: 1px solid var(--border)`。年付态在 Pro 价格旁显示删除线月付原价与徽标「省 ¥118/席」。
- 双卡布局：lg 以上两列等宽（grid 2 列，Pro 列不放大——收敛风格，不用夸张缩放）；md 及以下纵向堆叠。
- Free 卡：`background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-xl); padding: var(--space-8)`。
- Pro 卡（推荐档）：同基础样式 + `border-color: var(--accent); box-shadow: var(--elev-md)`；右上角角标「推荐」，样式 `background: var(--accent); color: var(--on-accent); font-size: var(--text-xs); border-radius: var(--radius-pill)`。
- 价格排版：金额 `--text-4xl; font-weight: var(--weight-semibold)`，单位「/人/月」`--text-sm; color: var(--muted)`。
- 卡内功能列表逐项前缀 Lucide `Check` 图标（16px，`color: var(--success)`）。
- 按钮：Free 卡「免费开始」（幽灵样式）；Pro 卡「升级到 Pro」（实心 accent，Owner 场景直连 checkout，游客场景跳 `/auth?src=pricing&plan=pro`）。
- 卡片底部辅助行（`--text-xs; color: var(--meta)`）：「支持支付宝 / 微信扫码 · 外币卡」「随时取消，降级后数据只读保留」。支付方式表述随 ADR-003 阶段推进更新，不在页面写死通道细节。

### 3.6 功能对比表

完整矩阵一张表，桌面横向平铺，移动端容器 `overflow-x: auto`（表格自身不换行挤压）。列：功能 / Free / Pro。分组行用 `background: var(--surface-2)`。完整文案见第 4 节。

### 3.7 FAQ 手风琴

- 交互：原生 `<details>/<summary>` 实现（零 JS 依赖，键盘可达），展开图标 Lucide `ChevronDown` 旋转 180°（`transition: transform var(--motion-base)`）。
- 单条内边距 `var(--space-4) var(--space-5)`；分隔线 `border-bottom: 1px solid var(--border-soft)`；问题文字 `--text-base; font-weight: var(--weight-medium)`。
- 六条问答文案见第 5 节。

### 3.8 尾部 CTA（首尾呼应的重点区块）

- 形态：整宽色块 `background: var(--accent-soft)`，内部内容仍受 1280px 容器约束；标题（`--text-2xl`）「让下一次讨论直接变成任务」+ 主按钮「免费开始」复用 Hero 主按钮样式 + 辅助文字「无需信用卡 · 10 人内永久免费」（`--text-sm; color: var(--muted)`）。
- 该区块与 Hero 构成页面首尾两个强调焦点，中间区块保持低饱和留白（Calm Precision 的克制节奏）。

### 3.9 Footer

- 单行：左「© 2026 corps」；右文字链「服务条款」「隐私政策」（占位 `href="#"` 并在代码注释标记 TODO，上线前补齐真实文档）。
- 背景 `transparent`，上边框 `1px solid var(--border-soft)`，文字 `--text-xs; color: var(--meta)`。

## 4. 定价卡与功能对比表文案（从 SPEC 提取，可直接复制）

### 4.1 价格常量（建议集中为 `PRICING_PLANS` 常量，供页面与埋点引用）

```ts
export const PRICING_PLANS = {
  free: {
    name: "免费版",
    monthlyPrice: 0,
    tagline: "10 人以内小团队，永久免费",
    cta: "免费开始",
    features: [
      "任务看板（看板/列表双视图 + 拖拽改状态）",
      "任务详情（负责人 / 截止日 / 优先级 / 状态）",
      "成员邀请 + Owner/Admin/Member 三级角色",
      "任务评论 + @提及提醒",
      "决策记录（每个工作区最近 10 条）",
      "Cmd+K 全局搜索（任务 + 决策记录）",
      "社区支持",
    ],
  },
  pro: {
    name: "专业版 Pro",
    monthlyPrice: 59,
    yearlyPrice: 590,
    tagline: "解锁决策闭环全部能力",
    cta: "升级到 Pro",
    badge: "推荐",
    features: [
      "免费版全部能力",
      "无限决策记录 + 版本留痕 + 任务双向回链",
      "任务筛选与自定义视图",
      "CSV 导出（任务与决策记录）",
      "邮件通知（指派 / 截止日 / @提及）",
      "优先邮件支持（1 个工作日内响应）",
    ],
  },
} as const;
```

> 口径来源：Free 功能集 = SPEC §2 P0/P1 中非计费门槛项；Pro 差异项与 `web/app/w/[wid]/billing/page.tsx` PLANS 现状一致（无限决策记录/筛选视图/导出 CSV/邮件通知），并补齐 pricing-strategy.md §3.1 已确认的两项（双向回链强调、优先支持 SLA）。「决策记录最近 10 条」为免费层软上限，与 billing 页现有 details 文案一致。

### 4.2 功能对比表

表：Free 与 Pro 功能对比表

| 功能 | Free | Pro |
|------|------|-----|
| **任务协作** |||
| 任务看板 / 列表双视图 + 拖拽改状态 | ✅ | ✅ |
| 任务详情字段（负责人/截止日/优先级/状态机） | ✅ | ✅ |
| 评论 + @提及通知 | ✅ | ✅（升级为邮件通知） |
| 任务筛选与自定义视图 | — | ✅ |
| **决策记录** |||
| 决策记录数量 | 最近 10 条/工作区 | 无限 |
| 版本留痕 + 任务双向回链 | — | ✅ |
| **搜索与导出** |||
| Cmd+K 全局搜索（任务 + 决策） | ✅ | ✅ |
| CSV 导出 | — | ✅ |
| **团队与安全** |||
| 成员规模 | ≤10 人 | 不限（产品定位服务 5–30 人） |
| Owner/Admin/Member 三级 RBAC | ✅ | ✅ |
| 多租户引擎级隔离（PostgreSQL RLS） | ✅ | ✅ |
| **席位计费** |||
| 成员变更自动同步席位数量 | — | ✅ |
| 价格 | ¥0 | ¥59/人/月 或 ¥590/人/年 |

> 「✅/—」使用文本字符而非 emoji（SPEC §10 禁 emoji 约束针对 UI 图标体系；表格内符号同样以纯文本呈现，避免引入非 Lucide 视觉元素）。「升级为邮件通知」一格用于表达 Free 站内提醒与 Pro 邮件通知的差异，避免双勾歧义。

## 5. FAQ 文案（六条）

1. **免费版真的可以一直用吗？**
   可以。10 人以内的工作区永久免费，包含任务看板、评论、三级角色与 Cmd+K 搜索，不设时间限制。唯一的软限制是决策记录保留最近 10 条。
2. **团队超过 10 人怎么办？**
   第 11 位成员接受邀请时系统会提示升级。升级到 Pro（¥59/人/月，年付 ¥590/人/年）即不限人数；也可以移除或停用成员腾出席位继续免费用——我们不会为了逼你付费而锁数据。
3. **支持哪些付款方式？可以开发票吗？**
   支持支付宝、微信扫码与外币卡。当前阶段提供电子收据（Receipt）；增值税发票能力将在国内主体就绪后开放（预计公开发布阶段），购买前如有开票刚需请先联系 support 邮箱确认。
4. **降级或取消订阅后，我的数据会丢吗？**
   不会。取消后工作区回落到免费版，超额部分（如超出 10 条的决策记录）转为只读保留、随时可导出，绝不删除数据。
5. **按席位计费是怎么算的？中途加人会多收钱吗？**
   按"已购席位数"计费，成员加入退出自动同步。月中新增席位按剩余天数折算补差价，不多收一个月。
6. **可以随时取消吗？退款政策是什么？**
   可以随时在账户设置里取消，取消后当前计费周期结束前仍可用。月付当期不设按天退款；年付订单在购买 14 天内且未产生实质使用的，支持全额退款。

> 第 3、6 条涉及对外承诺（发票时点、年付 14 天退款），需用户拍板时一并确认；若不同意，替换为更保守表述即可，不影响页面结构。

## 6. 视觉规范（Calm Precision，全部引用 design-tokens.css 变量）

- **颜色**：页面背景 `var(--bg)`；卡片 `var(--surface)`（如需微蓝质感用 `var(--surface-calm)`，二选一全站统一）；正文 `var(--fg)`，次级 `var(--fg-2)`，辅助 `var(--muted)`，弱提示 `var(--meta)`；强调一律 `var(--accent)` 及其派生（hover/active/soft 由 color-mix 自动联动，禁止裸 hex）。语义色仅两处：功能列表勾选 `var(--success)`、年付省钱徽标可用 `var(--warn)` 或 accent-soft（实现任选其一并保持唯一）。
- **深色模式**：页面跟随 `[data-theme="dark"]` 自动生效（design-tokens.css 深色 Primitive 已定义），本页无需单独适配逻辑；上线验收需人工过一遍两主题。
- **字体与字号**：`var(--font-display)`；标题阶梯 H1=`--text-3xl`（lg+ 升 `--text-4xl`）/ 区块标题=`--text-2xl` / 卡片标题=`--text-lg` / 正文=`--text-base` / 辅助=`--text-sm`；字重仅用 400/510/590 三档（`--weight-regular/medium/semibold`）；≥30px 标题启用 `letter-spacing: var(--tracking-display)`。
- **间距与圆角**：间距只用 `--space-*` 4px 网格档位；圆角卡片 `--radius-lg`（14px）、定价卡 `--radius-xl`（16px）、按钮/输入 `--radius-md`（10px）、徽标 `--radius-pill`；禁用 ≥24px 大圆角（tokens 注释明令）。
- **阴影与描边**：浅色以描边为主——默认 `var(--elev-ring)`，悬浮 `var(--elev-hover)`，推荐卡 `var(--elev-md)`；禁用大面积投影。
- **动效**：交互反馈统一 `var(--motion-base)` 150ms + `var(--ease-standard)`；入场动画不超过 `var(--motion-enter)` 且仅在首屏区块使用一次；`prefers-reduced-motion` 已由 tokens 全局降级，勿再叠加自定义关闭逻辑。
- **焦点与可达性**：所有可交互元素保留 `var(--focus-ring)` 焦点环（禁 outline:none）；对比度按 WCAG AA 校验 muted 文字置于 bg/surface 之上。
- **图标**：仅 Lucide（lucide-react），尺寸走 `--icon-sm/md/lg/xl` 四档，stroke 2px，`currentColor`；本页固定使用集合：`Check`、`ChevronDown`、`GitBranch`、`KanbanSquare`、`ShieldCheck`、`ArrowRight`（CTA 箭头，可选）。钉确切版本并在 lint 中校验导出名（SPEC §11 已知坑）。

## 7. 响应式断点行为

断点沿用 SPEC §10：sm 640 / md 768 / lg 1024 / xl 1280。MVP 以 lg+ 为主、md 可用、sm 保证不崩不专属优化。

表：定价页断点行为表

| 区块 | lg ≥1024（基准） | md 768–1023 | sm <768 |
|------|------------------|-------------|---------|
| 容器 | 1280px 居中，左右 padding `--space-8` | 同左，padding `--space-6` | 全宽，padding `--space-4` |
| Hero 标题 | `--text-4xl` | `--text-3xl` | `--text-2xl`，副标行宽自适应 |
| 功能三栏 | 3 列网格 | 3 列压缩（正文允许两行截断）或退化为 1 列（实现取其一，倾向退化 1 列保可读性） | 1 列堆叠 |
| 定价卡 | 2 列等宽 | 2 列（卡内 padding 收窄至 `--space-6`） | 1 列堆叠，Pro 卡置顶（转化优先） |
| 功能对比表 | 平铺 | 容器 `overflow-x: auto`，表格 min-width 720px | 同 md，首列 sticky（`position: sticky; left: 0; background: var(--surface)`） |
| FAQ | 最大行宽 720px 居中 | 同左 | 全宽 |
| 尾部 CTA | 标题+按钮横排 | 纵向堆叠 | 纵向，按钮全宽 |
| TopNav | 完整 | 完整 | logo + 主按钮 |

## 8. 埋点事件规格（对接现有 analytics 体系）

现状约束（开发必读）：客户端经 `track(name, props)` 批量缓冲上报至 `POST /api/v1/events`；该端点**允许匿名上报**但执行**事件名白名单**（`ALLOWED_EVENT_NAMES`，见 `web/app/api/v1/events/route.ts` L21–46），白名单外事件被静默过滤。因此本节所有新事件必须同步扩白名单，漏配 = 数据丢失且无报错。

表：定价页埋点事件表

| 事件名 | 类型 | 触发时机 | props | 白名单动作 |
|--------|------|----------|-------|------------|
| `view_pricing` | 客户端 | 页面首次加载（每会话去重一次） | `{ theme: "light"\|"dark" }` | 新增 |
| `select_billing_period` | 客户端 | 切换月付/年付 | `{ period: "monthly"\|"yearly" }` | 新增 |
| `click_upgrade` | 客户端 | 点击任意升级/开始按钮 | `{ plan: "free"\|"pro", period, source: "hero"\|"card"\|"tail_cta"\|"nav" }` | 新增 |
| `click_pricing_faq` | 客户端 | 展开某条 FAQ | `{ question_id: number }` | 可选，暂缓 |
| （归因）`register_view` / `register_success` | 客户端（已有） | 注册链路 | 追加 `src` 字段（值 `pricing`，由 URL `?src=pricing` 透传） | schema 加可选字段 |

漏斗口径：`view_pricing → click_upgrade(plan=pro) → billing_checkout（服务端已有，checkout 成功创建 session 时触发）→ billing_success（已有）`。`click_upgrade` 与服务端 `billing_checkout` 分别代表"点击意愿"与"会话创建成功"两级，中间流失可用于定位 Checkout 页跳出。

实现要点：

1. 公开页匿名场景直接调用 `track()`（sessionId 机制已内置 localStorage 匿名 ID，30 分钟 TTL），不需要改造 analytics.ts。
2. `view_pricing` 在 `page.tsx` 服务端组件外壳内的客户端挂载组件中触发（页面本体保持 SSG）。
3. props 不存 PII（events/route.ts 既有注释约束），本页事件天然满足。
4. 服务端事件 `billing_checkout` 的 props 建议追加 `period` 字段（checkout route 目前传 seatLimit），用于年付转化分析——改动一行，随本页一并交付。

## 9. 性能与验收预算

- LCP < 2.5s（SPEC §10）：SSG 无运行时数据请求；字体 Inter/Noto Sans SC 子集化 + `font-display: swap`；无第三方脚本。
- CLS ≈ 0：定价卡高度不随计费周期切换变化（切换只改数字文本）；FAQ 用 details 原生展开。
- 可访问性：手风琴键盘可达（details 原生）；对比度 AA；focus ring 全保留；语言属性 `lang="zh-CN"`。
- SEO：`title`「corps 定价 —— 免费 10 人，Pro ¥59/人/月」、`description` 对齐 Hero 副标；Open Graph 基础标签。
- 验收清单：两主题目检 / 四断点目检（重点 sm 不崩）/ 白名单五事件联调入库验证（查 `analytics_events` 表）/ `?src=pricing` 归因链路走通 / Lighthouse Performance ≥ 90（本地生产构建）。

## 10. 开发任务拆解（预估合计 0.5 周，对齐 roadmap M3"正式定价上线+付费页面"）

1. `web/app/pricing/page.tsx` + 区块组件（约 1.5 人日）：Hero / 三栏 / 定价卡 / 对比表 / FAQ / 尾栏 / Footer。
2. `PRICING_PLANS` 常量与年付切换逻辑（0.5 人日）。
3. events 白名单扩充 + checkout route props 补 `period`（0.5 人日）。
4. `/w/:wid/billing` 头部互链 + middleware 公开路径核对（0.5 人日）。
5. 双主题 + 四断点 + 埋点联调验收（1 人日）。

依赖与风险：定价数字与 FAQ 第 3/6 条承诺需用户拍板（pricing-strategy.md §8 清单）；`KanbanSquare` 等 lucide-react 导出名以锁定版本的实测为准（SPEC §11 已知坑）。