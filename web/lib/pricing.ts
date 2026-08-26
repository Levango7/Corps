/**
 * 定价页常量与类型 —— spec §4/§5 逐字冻结口径的唯一事实源。
 *
 * 设计：
 *  - 纯数据 + 类型，零 React/DOM 依赖，可被服务端组件与单测直接导入。
 *  - PRICING_PLANS 来自 docs/market/pricing-page-spec.md §4.1（ACCEPTED 冻结）。
 *  - 年付派生数字由 59×12−590 计算得出而非硬编码字符串，防手滑改价。
 *  - PRICING_FAQS 六条来自 spec §5（question_id 0–5）。
 *  - PRICING_MATRIX 来自 spec §4.2（值类型 string，✅/— 用文本字符）。
 *
 * 关联：
 *  - docs/design/pricing-page-impl-design.md §3.3（落点决策）
 *  - docs/market/pricing-page-spec.md §4/§5（权威口径）
 *  - web/app/w/[wid]/billing/page.tsx PLANS（页面私有展示口径，本常量是权威源）
 */

/** 计费周期枚举：月付 / 年付。 */
export type BillingPeriod = "monthly" | "yearly";

/** 套餐 ID：free / pro。 */
export type PlanId = keyof typeof PRICING_PLANS;

/** CTA 位 source 枚举（spec §8 click_upgrade.props.source）。 */
export type CtaSource = "nav" | "hero" | "card" | "tail_cta";

/**
 * 套餐常量（spec §4.1 逐字冻结）。
 * 调整价格仅需改此表（spec「价格调整仅需改第 4 节常量表」单点修改承诺）。
 */
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

/**
 * 年付派生数字（由月付 × 12 − 年付计算得出，非硬编码）。
 *  - yearlyMonthlyAverage: 年付折算月均价 49.2（590 / 12）
 *  - yearlySavingPerSeat: 每席每年省 118（59 × 12 − 590）
 */
export const YEARLY_MONTHLY_AVERAGE = PRICING_PLANS.pro.yearlyPrice / 12; // 49.166... → 展示时 toFixed(1) = 49.2
export const YEARLY_SAVING_PER_SEAT =
  PRICING_PLANS.pro.monthlyPrice * 12 - PRICING_PLANS.pro.yearlyPrice; // 118

/**
 * 社会证明条开关常量（spec §3.3 条件渲染）。
 *  - minTeams: 渲染阈值 20（spec §3.3「付费团队数 ≥ 20 才渲染」）
 *  - paidTeams: 当前付费团队数。MVP 种子期 null → 永不渲染空占位。
 *    未来接通数据源只改此常量一处。
 */
export const SOCIAL_PROOF: { minTeams: number; paidTeams: number | null } = {
  minTeams: 20,
  paidTeams: null,
};

/** FAQ 单条结构（spec §5 六条，question_id 0–5）。 */
export interface PricingFaq {
  questionId: number;
  question: string;
  answer: string;
}

/**
 * FAQ 六条（spec §5 逐字冻结）。
 * 第 3、6 条对外承诺已于 2026-08-26 经用户拍板批准生效。
 */
export const PRICING_FAQS: PricingFaq[] = [
  {
    questionId: 0,
    question: "免费版真的可以一直用吗？",
    answer:
      "可以。10 人以内的工作区永久免费，包含任务看板、评论、三级角色与 Cmd+K 搜索，不设时间限制。唯一的软限制是决策记录保留最近 10 条。",
  },
  {
    questionId: 1,
    question: "团队超过 10 人怎么办？",
    answer:
      "第 11 位成员接受邀请时系统会提示升级。升级到 Pro（¥59/人/月，年付 ¥590/人/年）即不限人数；也可以移除或停用成员腾出席位继续免费用——我们不会为了逼你付费而锁数据。",
  },
  {
    questionId: 2,
    question: "支持哪些付款方式？可以开发票吗？",
    answer:
      "支持支付宝、微信扫码与外币卡。当前阶段提供电子收据（Receipt）；增值税发票能力将在国内主体就绪后开放（预计公开发布阶段），购买前如有开票刚需请先联系 support 邮箱确认。",
  },
  {
    questionId: 3,
    question: "降级或取消订阅后，我的数据会丢吗？",
    answer:
      "不会。取消后工作区回落到免费版，超额部分（如超出 10 条的决策记录）转为只读保留、随时可导出，绝不删除数据。",
  },
  {
    questionId: 4,
    question: "按席位计费是怎么算的？中途加人会多收钱吗？",
    answer:
      '按"已购席位数"计费，成员加入退出自动同步。月中新增席位按剩余天数折算补差价，不多收一个月。',
  },
  {
    questionId: 5,
    question: "可以随时取消吗？退款政策是什么？",
    answer:
      "可以随时在账户设置里取消，取消后当前计费周期结束前仍可用。月付当期不设按天退款；年付订单在购买 14 天内且未产生实质使用的，支持全额退款。",
  },
];

/** 对比表行结构（spec §4.2，值类型 string，✅/— 用文本字符）。 */
export interface PricingMatrixRow {
  feature: string;
  free: string;
  pro: string;
}

/** 对比表分组结构（spec §4.2 五分组）。 */
export interface PricingMatrixGroup {
  group: string;
  rows: PricingMatrixRow[];
}

/**
 * 功能对比表数据（spec §4.2 逐字冻结）。
 * 五分组：任务协作 / 决策记录 / 搜索与导出 / 团队与安全 / 席位计费。
 */
export const PRICING_MATRIX: PricingMatrixGroup[] = [
  {
    group: "任务协作",
    rows: [
      { feature: "任务看板 / 列表双视图 + 拖拽改状态", free: "✅", pro: "✅" },
      {
        feature: "任务详情字段（负责人/截止日/优先级/状态机）",
        free: "✅",
        pro: "✅",
      },
      { feature: "评论 + @提及通知", free: "✅", pro: "✅（升级为邮件通知）" },
      { feature: "任务筛选与自定义视图", free: "—", pro: "✅" },
    ],
  },
  {
    group: "决策记录",
    rows: [
      { feature: "决策记录数量", free: "最近 10 条/工作区", pro: "无限" },
      { feature: "版本留痕 + 任务双向回链", free: "—", pro: "✅" },
    ],
  },
  {
    group: "搜索与导出",
    rows: [
      { feature: "Cmd+K 全局搜索（任务 + 决策）", free: "✅", pro: "✅" },
      { feature: "CSV 导出", free: "—", pro: "✅" },
    ],
  },
  {
    group: "团队与安全",
    rows: [
      {
        feature: "成员规模",
        free: "≤10 人",
        pro: "不限（产品定位服务 5–30 人）",
      },
      { feature: "Owner/Admin/Member 三级 RBAC", free: "✅", pro: "✅" },
      { feature: "多租户引擎级隔离（PostgreSQL RLS）", free: "✅", pro: "✅" },
    ],
  },
  {
    group: "席位计费",
    rows: [
      { feature: "成员变更自动同步席位数量", free: "—", pro: "✅" },
      { feature: "价格", free: "¥0", pro: "¥59/人/月 或 ¥590/人/年" },
    ],
  },
];

/** 功能三栏内容（spec §3.4）。 */
export interface FeatureColumn {
  icon: "GitBranch" | "KanbanSquare" | "ShieldCheck";
  title: string;
  body: string;
}

/** 功能三栏数据（spec §3.4 逐字冻结）。 */
export const FEATURE_COLUMNS: FeatureColumn[] = [
  {
    icon: "GitBranch",
    title: "结论自动落位",
    body: "讨论结论一键固化为决策记录，版本留痕、双向回链任务，不再手动搬运",
  },
  {
    icon: "KanbanSquare",
    title: "15 分钟跑起来",
    body: "看板/列表双视图 + 拖拽改状态，乐观更新零等待；Cmd+K 全局检索任务与决策",
  },
  {
    icon: "ShieldCheck",
    title: "数据引擎级隔离",
    body: "PostgreSQL 行级安全（RLS）强制多租户隔离，跨工作区请求一律拦截",
  },
];
