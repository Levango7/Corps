/**
 * /pricing 定价页路由入口 —— 服务端组件外壳 + 九区块静态骨架。
 *
 * 渲染模式（docs/design/pricing-page-impl-design.md 第4章）：
 *  - 全站动态 SSR（根 layout headers() 读 CSP nonce 致全站退出静态生成）。
 *  - 本页不添加 export const revalidate（无效配置，prerender-manifest 实证）。
 *  - 本页零 IO 载渲染保住 LCP 预算；SSG 改造立为后续独立事项。
 *
 * i18n（ADR-008 next-intl）：
 *  - 页面位于 [locale] 路由段下，按 locale 取 web/messages/{zh|en}.json 的 pricing 命名空间。
 *  - 服务端用 getTranslations；客户端子组件 PricingSection 用 useTranslations。
 *  - PRICING_MATRIX / PRICING_PLANS.features 为 spec §4 逐字冻结产品规格文案，
 *    保持常量直出（非 UI 框架文案，不进翻译）；其余 UI 文案全部走翻译 key。
 *
 * 客户端边界（§3.2）：
 *  - 七个静态区块在本文内联（服务端渲染，零 JS）。
 *  - 三个客户端子组件：PricingSection（周期 state）+ PricingViewTracker（view_pricing）+ TrackedCta（click_upgrade）。
 *
 * 埋点（§5.1，按裁决一）：
 *  - landing_view 由埋点线 PublicPageTracker 自动覆盖 /pricing，本页不直接实现。
 *  - 本页只实现 spec §8 三事件：view_pricing / select_billing_period / click_upgrade。
 *
 * 关联：
 *  - docs/design/pricing-page-impl-design.md（实现设计 v2）
 *  - docs/market/pricing-page-spec.md（ACCEPTED 冻结规格）
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  GitBranch,
  SquareKanban as KanbanSquare,
  ShieldCheck,
  ChevronDown,
  ArrowRight,
} from "lucide-react";
import { PRICING_FAQS, PRICING_MATRIX, FEATURE_COLUMNS, SOCIAL_PROOF } from "@/lib/pricing";
import { locales } from "@/lib/i18n";
import { PricingSection } from "@/components/pricing/PricingSection";
import { PricingViewTracker } from "@/components/pricing/PricingViewTracker";
import { TrackedCta } from "@/components/pricing/TrackedCta";

/**
 * 翻译函数结构签名。
 * next-intl 的 t（getTranslations / useTranslations 返回）兼容此调用形态：
 *  - t(key) → string
 *  - t(key, { values }) → string（ICU 参数插值，如 socialProof 的 {teams}）
 * 服务端 getTranslations 的 t 带命名空间字面量泛型，赋值给此宽签名需一次 `as unknown as`。
 */
type TranslateFn = (key: string, values?: Record<string, unknown>) => string;

/** CTA 目标基础 URL（spec §1，已适配为 /auth/signup?src=pricing，见 R1）。 */
const SIGNUP_BASE = "/auth/signup?src=pricing";

/** 功能三栏图标映射（spec §3.4，lucide-react 0.513.0）。 */
const FEATURE_ICONS = {
  GitBranch,
  KanbanSquare,
  ShieldCheck,
} as const;

/** 功能三栏 title/body 翻译 key（与 FEATURE_COLUMNS 顺序对齐）。 */
const FEATURE_TITLE_KEYS = [
  "features.col1Title",
  "features.col2Title",
  "features.col3Title",
] as const;
const FEATURE_BODY_KEYS = ["features.col1Body", "features.col2Body", "features.col3Body"] as const;

/** SEO metadata（spec §9，按 locale 取 pricing.metadata 翻译）。 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "pricing" });
  const title = t("metadata.title");
  const description = t("metadata.description");
  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
  };
}

/** 默认导出：定价页服务端组件。 */
export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // 非法 locale 直接 404
  if (!hasLocale(locales, locale)) notFound();
  // 启用 RSC 静态渲染注水（next-intl App Router 推荐）
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "pricing" });
  // 转为宽签名传给内联区块（一处断言，避免 7 个子组件各自 getTranslations 的冗余调用）
  const tt = t as unknown as TranslateFn;

  // 社会证明条件渲染（spec §3.3）：paidTeams !== null && paidTeams >= minTeams
  const showSocialProof =
    SOCIAL_PROOF.paidTeams !== null && SOCIAL_PROOF.paidTeams >= SOCIAL_PROOF.minTeams;

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      {/* 客户端副作用：view_pricing 埋点（渲染 null） */}
      <PricingViewTracker />

      {/* ① TopNav */}
      <TopNav t={tt} />

      {/* ② Hero */}
      <Hero t={tt} />

      {/* ③ 社会证明条（条件渲染） */}
      {showSocialProof && <SocialProof t={tt} />}

      {/* ④ 功能三栏 */}
      <FeatureGrid t={tt} />

      {/* ⑤ 定价卡（client，内部 useTranslations） */}
      <PricingSection />

      {/* ⑥ 功能对比表 */}
      <ComparisonTable t={tt} />

      {/* ⑦ FAQ */}
      <Faq t={tt} />

      {/* ⑧ 尾部 CTA */}
      <TailCta t={tt} />

      {/* ⑨ Footer */}
      <Footer t={tt} />
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ① TopNav
// ─────────────────────────────────────────────────────────────────────────────

function TopNav({ t }: { t: TranslateFn }) {
  return (
    <nav
      className="sticky top-0 z-10 h-[var(--topbar-h)] flex items-center justify-between px-[var(--space-8)] md:px-[var(--space-6)] border-b border-[var(--border-soft)] bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] backdrop-blur-[8px]"
      aria-label={t("nav.ariaLabel")}
    >
      <Link
        href="/pricing"
        className="text-[length:var(--text-base)] font-[var(--weight-semibold)] text-[var(--fg)]"
      >
        corps
      </Link>
      <div className="flex items-center gap-4">
        {/* 当前页高亮 --accent（静态已知事实，无需 usePathname） */}
        <Link
          href="/pricing"
          className="hidden md:inline text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--accent)]"
          aria-current="page"
        >
          {t("nav.pricing")}
        </Link>
        <Link
          href="/auth/login"
          className="hidden md:inline text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--fg-2)] hover:text-[var(--fg)]"
        >
          {t("nav.login")}
        </Link>
        <TrackedCta
          href={SIGNUP_BASE}
          plan="free"
          source="nav"
          period="yearly"
          variant="primary"
          className="btn-press inline-flex items-center justify-center h-9 px-4 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--on-accent)] text-[length:var(--text-sm)] font-[var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-base)]"
        >
          {t("nav.freeStart")}
        </TrackedCta>
      </div>
    </nav>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ② Hero
// ─────────────────────────────────────────────────────────────────────────────

function Hero({ t }: { t: TranslateFn }) {
  return (
    <section
      className="relative overflow-hidden px-[var(--space-8)] md:px-[var(--space-6)] py-[var(--space-20)]"
      aria-labelledby="hero-heading"
    >
      {/* 背景装饰 SVG —— 抽象几何形状，纯装饰 aria-hidden */}
      <div className="pointer-events-none absolute inset-0 select-none" aria-hidden="true">
        {/* 右上角大圆环 */}
        <svg
          className="absolute -top-24 -right-24 w-96 h-96 opacity-[0.04]"
          viewBox="0 0 400 400"
          fill="none"
        >
          <circle cx="200" cy="200" r="180" stroke="var(--accent)" strokeWidth="2" />
          <circle cx="200" cy="200" r="120" stroke="var(--accent)" strokeWidth="1.5" />
          <circle cx="200" cy="200" r="60" stroke="var(--accent)" strokeWidth="1" />
        </svg>
        {/* 左下角小圆点群 */}
        <svg
          className="absolute -bottom-8 -left-8 w-40 h-40 opacity-[0.06]"
          viewBox="0 0 160 160"
          fill="var(--accent)"
        >
          <circle cx="20" cy="20" r="4" />
          <circle cx="60" cy="40" r="6" />
          <circle cx="100" cy="20" r="3" />
          <circle cx="40" cy="80" r="5" />
          <circle cx="80" cy="100" r="4" />
          <circle cx="120" cy="60" r="2" />
          <circle cx="20" cy="120" r="3" />
          <circle cx="140" cy="120" r="5" />
        </svg>
        {/* 中间偏右的菱形网格 */}
        <svg
          className="absolute top-1/3 right-1/4 w-32 h-32 opacity-[0.03]"
          viewBox="0 0 120 120"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1"
        >
          <path d="M60 10L110 60L60 110L10 60Z" />
          <path d="M60 30L90 60L60 90L30 60Z" />
          <path d="M60 50L70 60L60 70L50 60Z" />
        </svg>
      </div>

      <div className="relative mx-auto max-w-[var(--container-max)]">
        {/* eyebrow 小标签 */}
        <span className="inline-block px-[var(--space-3)] py-[var(--space-1)] rounded-[var(--radius-pill)] bg-[var(--eyebrow-bg)] text-[var(--eyebrow-fg)] text-[length:var(--text-xs)] font-[var(--weight-medium)]">
          {t("hero.eyebrow")}
        </span>

        {/* H1 */}
        <h1
          id="hero-heading"
          className="mt-4 text-[length:var(--text-2xl)] md:text-[length:var(--text-3xl)] lg:text-[length:var(--text-4xl)] font-[var(--weight-semibold)] tracking-[var(--tracking-tight)] text-[var(--fg)]"
        >
          {t("hero.title")}
        </h1>

        {/* 副标 */}
        <p className="mt-4 max-w-[36em] text-[length:var(--text-md)] text-[var(--muted)]">
          {t("hero.subtitle")}
        </p>

        {/* CTA 组 */}
        <div className="mt-6 flex flex-col sm:flex-row gap-3">
          <TrackedCta
            href={SIGNUP_BASE}
            plan="free"
            source="hero"
            period="yearly"
            variant="primary"
          >
            {t("hero.ctaPrimary")}
          </TrackedCta>
          {/* 次按钮：锚点平滑滚动至 #plans（零 JS，globals.css html scroll-behavior: smooth） */}
          <a
            href="#plans"
            className="btn-press inline-flex items-center justify-center gap-2 h-10 px-5 rounded-[var(--radius-md)] border border-[var(--border)] text-[var(--fg-2)] font-[var(--weight-medium)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-[var(--focus-ring)]"
          >
            {t("hero.ctaSecondary")}
            <ArrowRight size={16} aria-hidden="true" />
          </a>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ③ 社会证明条（条件渲染，MVP 种子期不显示）
// ─────────────────────────────────────────────────────────────────────────────

function SocialProof({ t }: { t: TranslateFn }) {
  // 当前 paidTeams === null → 本组件不会渲染；保留分支结构供未来接通数据
  const teams = SOCIAL_PROOF.paidTeams ?? 0;
  return (
    <section className="px-[var(--space-8)] md:px-[var(--space-6)] py-[var(--section-y)]">
      <div className="mx-auto max-w-[var(--container-max)] text-center">
        <p className="text-[length:var(--text-sm)] text-[var(--muted)]">
          {t("socialProof", { teams })}
        </p>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ④ 功能三栏
// ─────────────────────────────────────────────────────────────────────────────

function FeatureGrid({ t }: { t: TranslateFn }) {
  return (
    <section
      className="px-[var(--space-8)] md:px-[var(--space-6)] py-[var(--section-y)]"
      aria-labelledby="features-heading"
    >
      <div className="mx-auto max-w-[var(--container-max)]">
        <h2 id="features-heading" className="sr-only">
          {t("features.heading")}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-[var(--space-8)]">
          {FEATURE_COLUMNS.map((col, i) => {
            const Icon = FEATURE_ICONS[col.icon];
            return (
              <div
                key={col.icon}
                className="card-lift p-[var(--space-8)] rounded-[var(--radius-lg)] bg-[var(--surface)] border border-[var(--border)] hover:shadow-[var(--elev-hover)] transition-shadow duration-[var(--motion-base)] ease-[var(--ease-standard)]"
              >
                <Icon size={24} className="text-[var(--accent)]" aria-hidden="true" />
                <h3 className="mt-3 text-[length:var(--text-lg)] font-[var(--weight-semibold)] text-[var(--fg)]">
                  {t(FEATURE_TITLE_KEYS[i])}
                </h3>
                <p className="mt-2 text-[length:var(--text-sm)] text-[var(--fg-2)]">
                  {t(FEATURE_BODY_KEYS[i])}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑥ 功能对比表
// ─────────────────────────────────────────────────────────────────────────────

function ComparisonTable({ t }: { t: TranslateFn }) {
  return (
    <section
      className="px-[var(--space-8)] md:px-[var(--space-6)] py-[var(--section-y)]"
      aria-labelledby="compare-heading"
    >
      <div className="mx-auto max-w-[var(--container-max)]">
        <h2
          id="compare-heading"
          className="text-[length:var(--text-2xl)] font-[var(--weight-semibold)] text-[var(--fg)]"
        >
          {t("comparison.heading")}
        </h2>
        {/* 移动端容器 overflow-x-auto，表格 min-w 720px（spec §7） */}
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[720px] text-[length:var(--text-sm)]">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="py-3 px-[var(--space-4)] text-left font-[var(--weight-medium)] text-[var(--fg-2)]">
                  {t("comparison.feature")}
                </th>
                <th className="py-3 px-[var(--space-4)] text-left font-[var(--weight-medium)] text-[var(--fg-2)]">
                  {t("comparison.free")}
                </th>
                <th className="py-3 px-[var(--space-4)] text-left font-[var(--weight-medium)] text-[var(--fg-2)]">
                  {t("comparison.pro")}
                </th>
              </tr>
            </thead>
            <tbody>
              {PRICING_MATRIX.map((group) => (
                <ComparisonGroup key={group.group} group={group} t={t} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/** 对比表分组行（含分组标题行 + 数据行；group/feature 为 pricing.matrix.* 翻译键，
 *  单元格短语经 matrixCells 取当前语言（最近 10 条/无限 等））。
 *  单元格中的 ✅/—/数字/价格字面量语言无关直出。 */
function ComparisonGroup({ group, t }: { group: (typeof PRICING_MATRIX)[number]; t: TranslateFn }) {
  /** 单元格短语按语言解析：命中已知短语 key 时走翻译，否则原样输出（✅/—/数字等） */
  function cellText(value: string): string {
    if (value === "最近 10 条/工作区") return t("matrixCells.decisionLimitFree");
    if (value === "无限") return t("matrixCells.unlimited");
    if (value === "≤10 人") return t("matrixCells.seatLimitFree");
    if (value === "不限（产品定位服务 5–30 人）") return t("matrixCells.seatUnlimited");
    return value;
  }
  return (
    <>
      {/* 分组标题行（spec §4.2 用 surface-2 背景） */}
      <tr className="bg-[var(--surface-2)]">
        <th
          colSpan={3}
          className="py-2 px-[var(--space-4)] text-left font-[var(--weight-semibold)] text-[var(--fg)]"
          scope="rowgroup"
        >
          {t(group.group)}
        </th>
      </tr>
      {/* 数据行 */}
      {group.rows.map((row) => (
        <tr key={row.feature} className="border-b border-[var(--border-soft)]">
          <td className="py-3 px-[var(--space-4)] text-[var(--fg-2)]">{t(row.feature)}</td>
          <td className="py-3 px-[var(--space-4)] text-[var(--fg-2)]">{cellText(row.free)}</td>
          <td className="py-3 px-[var(--space-4)] text-[var(--fg-2)]">{cellText(row.pro)}</td>
        </tr>
      ))}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑦ FAQ
// ─────────────────────────────────────────────────────────────────────────────

function Faq({ t }: { t: TranslateFn }) {
  return (
    <section
      className="px-[var(--space-8)] md:px-[var(--space-6)] py-[var(--section-y)]"
      aria-labelledby="faq-heading"
    >
      <div className="mx-auto max-w-[var(--container-max)]">
        <h2
          id="faq-heading"
          className="text-[length:var(--text-2xl)] font-[var(--weight-semibold)] text-[var(--fg)]"
        >
          {t("faq.heading")}
        </h2>
        <div className="mt-6 max-w-[720px] mx-auto">
          {PRICING_FAQS.map((faq) => (
            // 原生 details/summary（零 JS，键盘可达，spec §3.7）
            // question/answer 走翻译 key（faq.q{0-5}/a{0-5}），questionId 来自常量保排序与埋点
            <details key={faq.questionId} className="group border-b border-[var(--border-soft)]">
              <summary className="flex items-center justify-between py-[var(--space-4)] px-[var(--space-5)] cursor-pointer text-[length:var(--text-base)] font-[var(--weight-medium)] text-[var(--fg)] list-none focus-visible:outline-none focus-visible:ring-[var(--focus-ring)] rounded-[var(--radius-md)]">
                <span>{t(`faq.q${faq.questionId}`)}</span>
                <ChevronDown
                  size={18}
                  className="text-[var(--muted)] transition-transform duration-[var(--motion-base)] group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <p className="px-[var(--space-5)] pb-[var(--space-4)] text-[length:var(--text-sm)] text-[var(--fg-2)]">
                {t(`faq.a${faq.questionId}`)}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑧ 尾部 CTA
// ─────────────────────────────────────────────────────────────────────────────

function TailCta({ t }: { t: TranslateFn }) {
  return (
    <section
      className="px-[var(--space-8)] md:px-[var(--space-6)] py-[var(--space-20)] bg-[var(--accent-soft)]"
      aria-labelledby="tail-cta-heading"
    >
      <div className="mx-auto max-w-[var(--container-max)] flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2
            id="tail-cta-heading"
            className="text-[length:var(--text-2xl)] font-[var(--weight-semibold)] text-[var(--fg)]"
          >
            {t("tailCta.title")}
          </h2>
          <p className="mt-1 text-[length:var(--text-sm)] text-[var(--muted)]">
            {t("tailCta.subtitle")}
          </p>
        </div>
        <TrackedCta
          href={SIGNUP_BASE}
          plan="free"
          source="tail_cta"
          period="yearly"
          variant="primary"
        >
          {t("tailCta.cta")}
        </TrackedCta>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑨ Footer
// ─────────────────────────────────────────────────────────────────────────────

function Footer({ t }: { t: TranslateFn }) {
  return (
    <footer className="px-[var(--space-8)] md:px-[var(--space-6)] py-[var(--space-6)] border-t border-[var(--border-soft)]">
      <div className="mx-auto max-w-[var(--container-max)] flex flex-wrap items-center justify-between gap-2 text-[length:var(--text-xs)] text-[var(--meta)]">
        <span>{t("footer.copyright")}</span>
        <div className="flex gap-4">
          {/* 法务文档页（审计 TODO(legal) 修复；文档内主体信息待注册后补齐） */}
          <Link href="/legal/terms" className="hover:text-[var(--fg-2)]">
            {t("footer.terms")}
          </Link>
          <Link href="/legal/privacy" className="hover:text-[var(--fg-2)]">
            {t("footer.privacy")}
          </Link>
        </div>
      </div>
    </footer>
  );
}
