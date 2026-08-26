/**
 * /pricing 定价页路由入口 —— 服务端组件外壳 + 九区块静态骨架。
 *
 * 渲染模式（docs/design/pricing-page-impl-design.md 第4章）：
 *  - 全站动态 SSR（根 layout headers() 读 CSP nonce 致全站退出静态生成）。
 *  - 本页不添加 export const revalidate（无效配置，prerender-manifest 实证）。
 *  - 本页零 IO 载渲染保住 LCP 预算；SSG 改造立为后续独立事项。
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
import {
  GitBranch,
  SquareKanban as KanbanSquare,
  ShieldCheck,
  ChevronDown,
  ArrowRight,
} from "lucide-react";
import { PRICING_FAQS, PRICING_MATRIX, FEATURE_COLUMNS, SOCIAL_PROOF } from "@/lib/pricing";
import { PricingSection } from "@/components/pricing/PricingSection";
import { PricingViewTracker } from "@/components/pricing/PricingViewTracker";
import { TrackedCta } from "@/components/pricing/TrackedCta";

/** CTA 目标基础 URL（spec §1，已适配为 /auth/signup?src=pricing，见 R1）。 */
const SIGNUP_BASE = "/auth/signup?src=pricing";

/** SEO metadata（spec §9）。 */
export const metadata: Metadata = {
  title: "corps 定价 —— 免费 10 人，Pro ¥59/人/月",
  description:
    "以工作区任务看板为锚点，决策记录双向回链任务上下文。15 分钟上手，不为用不上的功能付费。",
  openGraph: {
    title: "corps 定价 —— 免费 10 人，Pro ¥59/人/月",
    description:
      "以工作区任务看板为锚点，决策记录双向回链任务上下文。15 分钟上手，不为用不上的功能付费。",
    type: "website",
  },
};

/** 功能三栏图标映射（spec §3.4，lucide-react 0.513.0）。 */
const FEATURE_ICONS = {
  GitBranch,
  KanbanSquare,
  ShieldCheck,
} as const;

/** 默认导出：定价页服务端组件。 */
export default function PricingPage() {
  // 社会证明条件渲染（spec §3.3）：paidTeams !== null && paidTeams >= minTeams
  const showSocialProof =
    SOCIAL_PROOF.paidTeams !== null && SOCIAL_PROOF.paidTeams >= SOCIAL_PROOF.minTeams;

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      {/* 客户端副作用：view_pricing 埋点（渲染 null） */}
      <PricingViewTracker />

      {/* ① TopNav */}
      <TopNav />

      {/* ② Hero */}
      <Hero />

      {/* ③ 社会证明条（条件渲染） */}
      {showSocialProof && <SocialProof />}

      {/* ④ 功能三栏 */}
      <FeatureGrid />

      {/* ⑤ 定价卡（client） */}
      <PricingSection />

      {/* ⑥ 功能对比表 */}
      <ComparisonTable />

      {/* ⑦ FAQ */}
      <Faq />

      {/* ⑧ 尾部 CTA */}
      <TailCta />

      {/* ⑨ Footer */}
      <Footer />
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ① TopNav
// ─────────────────────────────────────────────────────────────────────────────

function TopNav() {
  return (
    <nav
      className="sticky top-0 z-10 h-[var(--topbar-h)] flex items-center justify-between px-[var(--space-8)] md:px-[var(--space-6)] border-b border-[var(--border-soft)] bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] backdrop-blur-[8px]"
      aria-label="顶部导航"
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
          定价
        </Link>
        <Link
          href="/auth/login"
          className="hidden md:inline text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--fg-2)] hover:text-[var(--fg)]"
        >
          登录
        </Link>
        <TrackedCta
          href={SIGNUP_BASE}
          plan="free"
          source="nav"
          period="yearly"
          variant="primary"
          className="inline-flex items-center justify-center h-9 px-4 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--on-accent)] text-[length:var(--text-sm)] font-[var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-base)]"
        >
          免费开始
        </TrackedCta>
      </div>
    </nav>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ② Hero
// ─────────────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section
      className="px-[var(--space-8)] md:px-[var(--space-6)] py-[var(--space-20)]"
      aria-labelledby="hero-heading"
    >
      <div className="mx-auto max-w-[var(--container-max)]">
        {/* eyebrow 小标签 */}
        <span className="inline-block px-[var(--space-3)] py-[var(--space-1)] rounded-[var(--radius-pill)] bg-[var(--eyebrow-bg)] text-[var(--eyebrow-fg)] text-[length:var(--text-xs)] font-[var(--weight-medium)]">
          为 5–30 人团队打造
        </span>

        {/* H1 */}
        <h1
          id="hero-heading"
          className="mt-4 text-[length:var(--text-2xl)] md:text-[length:var(--text-3xl)] lg:text-[length:var(--text-4xl)] font-[var(--weight-semibold)] tracking-[var(--tracking-tight)] text-[var(--fg)]"
        >
          让讨论结论自动落位成任务
        </h1>

        {/* 副标 */}
        <p className="mt-4 max-w-[36em] text-[length:var(--text-md)] text-[var(--muted)]">
          以工作区任务看板为锚点，决策记录双向回链任务上下文。15 分钟上手，不为用不上的功能付费。
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
            免费开始，最多 10 人
          </TrackedCta>
          {/* 次按钮：锚点平滑滚动至 #plans（零 JS，globals.css html scroll-behavior: smooth） */}
          <a
            href="#plans"
            className="inline-flex items-center justify-center gap-2 h-10 px-5 rounded-[var(--radius-md)] border border-[var(--border)] text-[var(--fg-2)] font-[var(--weight-medium)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-[var(--focus-ring)]"
          >
            先看看团队能省多少
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

function SocialProof() {
  // 当前 paidTeams === null → 本组件不会渲染；保留分支结构供未来接通数据
  const teams = SOCIAL_PROOF.paidTeams ?? 0;
  return (
    <section className="px-[var(--space-8)] md:px-[var(--space-6)] py-[var(--section-y)]">
      <div className="mx-auto max-w-[var(--container-max)] text-center">
        <p className="text-[length:var(--text-sm)] text-[var(--muted)]">
          {teams} 个团队正在用 corps 管理决策与任务
        </p>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ④ 功能三栏
// ─────────────────────────────────────────────────────────────────────────────

function FeatureGrid() {
  return (
    <section
      className="px-[var(--space-8)] md:px-[var(--space-6)] py-[var(--section-y)]"
      aria-labelledby="features-heading"
    >
      <div className="mx-auto max-w-[var(--container-max)]">
        <h2 id="features-heading" className="sr-only">
          核心能力
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-[var(--space-8)]">
          {FEATURE_COLUMNS.map((col) => {
            const Icon = FEATURE_ICONS[col.icon];
            return (
              <div
                key={col.title}
                className="p-[var(--space-8)] rounded-[var(--radius-lg)] bg-[var(--surface)] border border-[var(--border)] hover:shadow-[var(--elev-hover)] transition-shadow duration-[var(--motion-base)] ease-[var(--ease-standard)]"
              >
                <Icon size={24} className="text-[var(--accent)]" aria-hidden="true" />
                <h3 className="mt-3 text-[length:var(--text-lg)] font-[var(--weight-semibold)] text-[var(--fg)]">
                  {col.title}
                </h3>
                <p className="mt-2 text-[length:var(--text-sm)] text-[var(--fg-2)]">{col.body}</p>
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

function ComparisonTable() {
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
          功能对比
        </h2>
        {/* 移动端容器 overflow-x-auto，表格 min-w 720px（spec §7） */}
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[720px] text-[length:var(--text-sm)]">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="py-3 px-[var(--space-4)] text-left font-[var(--weight-medium)] text-[var(--fg-2)]">
                  功能
                </th>
                <th className="py-3 px-[var(--space-4)] text-left font-[var(--weight-medium)] text-[var(--fg-2)]">
                  Free
                </th>
                <th className="py-3 px-[var(--space-4)] text-left font-[var(--weight-medium)] text-[var(--fg-2)]">
                  Pro
                </th>
              </tr>
            </thead>
            <tbody>
              {PRICING_MATRIX.map((group) => (
                <ComparisonGroup key={group.group} group={group} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/** 对比表分组行（含分组标题行 + 数据行）。 */
function ComparisonGroup({ group }: { group: (typeof PRICING_MATRIX)[number] }) {
  return (
    <>
      {/* 分组标题行（spec §4.2 用 surface-2 背景） */}
      <tr className="bg-[var(--surface-2)]">
        <th
          colSpan={3}
          className="py-2 px-[var(--space-4)] text-left font-[var(--weight-semibold)] text-[var(--fg)]"
          scope="rowgroup"
        >
          {group.group}
        </th>
      </tr>
      {/* 数据行 */}
      {group.rows.map((row) => (
        <tr key={row.feature} className="border-b border-[var(--border-soft)]">
          <td className="py-3 px-[var(--space-4)] text-[var(--fg-2)]">{row.feature}</td>
          <td className="py-3 px-[var(--space-4)] text-[var(--fg-2)]">{row.free}</td>
          <td className="py-3 px-[var(--space-4)] text-[var(--fg-2)]">{row.pro}</td>
        </tr>
      ))}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑦ FAQ
// ─────────────────────────────────────────────────────────────────────────────

function Faq() {
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
          常见问题
        </h2>
        <div className="mt-6 max-w-[720px] mx-auto">
          {PRICING_FAQS.map((faq) => (
            // 原生 details/summary（零 JS，键盘可达，spec §3.7）
            <details key={faq.questionId} className="group border-b border-[var(--border-soft)]">
              <summary className="flex items-center justify-between py-[var(--space-4)] px-[var(--space-5)] cursor-pointer text-[length:var(--text-base)] font-[var(--weight-medium)] text-[var(--fg)] list-none focus-visible:outline-none focus-visible:ring-[var(--focus-ring)] rounded-[var(--radius-md)]">
                <span>{faq.question}</span>
                <ChevronDown
                  size={18}
                  className="text-[var(--muted)] transition-transform duration-[var(--motion-base)] group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <p className="px-[var(--space-5)] pb-[var(--space-4)] text-[length:var(--text-sm)] text-[var(--fg-2)]">
                {faq.answer}
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

function TailCta() {
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
            让下一次讨论直接变成任务
          </h2>
          <p className="mt-1 text-[length:var(--text-sm)] text-[var(--muted)]">
            无需信用卡 · 10 人内永久免费
          </p>
        </div>
        <TrackedCta
          href={SIGNUP_BASE}
          plan="free"
          source="tail_cta"
          period="yearly"
          variant="primary"
        >
          免费开始
        </TrackedCta>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑨ Footer
// ─────────────────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="px-[var(--space-8)] md:px-[var(--space-6)] py-[var(--space-6)] border-t border-[var(--border-soft)]">
      <div className="mx-auto max-w-[var(--container-max)] flex flex-wrap items-center justify-between gap-2 text-[length:var(--text-xs)] text-[var(--meta)]">
        <span>© 2026 corps</span>
        <div className="flex gap-4">
          {/* TODO(legal): 上线前补齐真实文档链接（spec §3.9 明示 TODO） */}
          <Link href="#" className="hover:text-[var(--fg-2)]">
            服务条款
          </Link>
          <Link href="#" className="hover:text-[var(--fg-2)]">
            隐私政策
          </Link>
        </div>
      </div>
    </footer>
  );
}
