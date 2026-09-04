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
      "features.free.f01",
      "features.free.f02",
      "features.free.f03",
      "features.free.f04",
      "features.free.f05",
      "features.free.f06",
      "features.free.f07",
      "features.free.f08",
      "features.free.f09",
      "features.free.f10",
      "features.free.f11",
      "features.free.f12",
      "features.free.f13",
      "features.free.f14",
      "features.free.f15",
      "features.free.f16",
      "features.free.f17",
      "features.free.f18",
      "features.free.f19",
      "features.free.f20",
      "features.free.f21",
    ],
  },
  pro: {
    name: "专业版 Pro",
    monthlyPrice: 29.9,
    yearlyPrice: 299,
    tagline: "决策闭环不限量，团队扩容无上限",
    cta: "升级到 Pro",
    badge: "推荐",
    features: [
      "features.pro.p00",
      "features.pro.p01",
      "features.pro.p02",
      "features.pro.p03",
      "features.pro.p04",
      "features.pro.p05",
      "features.pro.p06",
      "features.pro.p07",
    ],
  },
} as const;

/**
 * 年付派生数字（由月付 × 12 − 年付计算得出，非硬编码）。
 *  - yearlyMonthlyAverage: 年付折算月均价 24.9（299 / 12）
 *  - yearlySavingPerSeat: 每席每年省 59.8（29.9 × 12 − 299）
 */
export const YEARLY_MONTHLY_AVERAGE = PRICING_PLANS.pro.yearlyPrice / 12; // 24.9166... → 展示时 toFixed(1) = 24.9
export const YEARLY_SAVING_PER_SEAT =
  PRICING_PLANS.pro.monthlyPrice * 12 - PRICING_PLANS.pro.yearlyPrice; // 59.8

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
      "第 11 位成员接受邀请时系统会提示升级。升级到 Pro（¥29.9/人/月，年付 ¥299/人/年）即不限人数；也可以移除或停用成员腾出席位继续免费用——我们不会为了逼你付费而锁数据。",
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
 * 功能对比表数据（v2 定价方案，2026-09-02 用户拍板）。
 * 七分组；group/feature 为 pricing.matrix.* 翻译键（zh/en 双语渲染），
 * free/pro 单元格为展示字面量（✅/—/短语，单元格短语经 ComparisonGroup 上下文注入语言）。
 */
export const PRICING_MATRIX: PricingMatrixGroup[] = [
  {
    group: "matrix.g1",
    rows: [
      { feature: "matrix.r01", free: "✅", pro: "✅" },
      { feature: "matrix.r02", free: "✅", pro: "✅" },
      { feature: "matrix.r03", free: "✅", pro: "✅" },
      { feature: "matrix.r04", free: "✅", pro: "✅" },
      { feature: "matrix.r05", free: "✅", pro: "✅" },
      { feature: "matrix.r06", free: "—", pro: "✅" },
    ],
  },
  {
    group: "matrix.g2",
    rows: [
      { feature: "matrix.r07", free: "最近 10 条/工作区", pro: "无限" },
      { feature: "matrix.r08", free: "—", pro: "✅" },
    ],
  },
  {
    group: "matrix.g3",
    rows: [
      { feature: "matrix.r09", free: "✅", pro: "✅" },
      { feature: "matrix.r10", free: "✅", pro: "✅" },
      { feature: "matrix.r11", free: "✅", pro: "✅" },
      { feature: "matrix.r12", free: "—", pro: "✅" },
    ],
  },
  {
    group: "matrix.g4",
    rows: [
      { feature: "matrix.r13", free: "✅", pro: "✅" },
      { feature: "matrix.r14", free: "—", pro: "✅" },
    ],
  },
  {
    group: "matrix.g5",
    rows: [
      { feature: "matrix.r15", free: "✅", pro: "✅" },
      { feature: "matrix.r16", free: "✅", pro: "✅" },
      { feature: "matrix.r17", free: "✅", pro: "✅" },
    ],
  },
  {
    group: "matrix.g6",
    rows: [
      {
        feature: "matrix.r18",
        free: "≤10 人",
        pro: "不限（产品定位服务 5–30 人）",
      },
      { feature: "matrix.r19", free: "✅", pro: "✅" },
      { feature: "matrix.r20", free: "✅", pro: "✅" },
    ],
  },
  {
    group: "matrix.g7",
    rows: [
      { feature: "matrix.r21", free: "10MB", pro: "50MB" },
      { feature: "matrix.r22", free: "—", pro: "✅" },
      { feature: "matrix.r23", free: "¥0", pro: "¥29.9/人/月 或 ¥299/人/年" },
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
