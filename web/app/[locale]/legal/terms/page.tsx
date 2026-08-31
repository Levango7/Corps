import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { locales } from "@/lib/i18n";

/**
 * /legal/terms 服务条款 —— 静态法务文档页（审计缺口：付费 SaaS 无法律文本）。
 * 内容为通用 SaaS 条款基线；真实联系信息已填入（个人开发者运营，winger35@163.com）。
 * 法务文本与 UI 框架文案不同，保持页面内双语直出（同 lib/pricing.ts 的冻结文案模式）。
 */

interface Section {
  heading: string;
  body: string[];
}

const ZH: Section[] = [
  {
    heading: "一、协议的接受",
    body: [
      '欢迎使用 corps（以下简称"本服务"）。注册账户或使用本服务即表示您已阅读、理解并同意本条款。若您代表团队或组织注册，您确认已获得该组织的授权。',
    ],
  },
  {
    heading: "二、账户与安全",
    body: [
      "您需妥善保管账户凭据，并对账户下的活动负责。发现未授权使用时应立即通知我们。我们提供密码重置功能，重置链接具有时效性且一次性有效。",
    ],
  },
  {
    heading: "三、套餐与付费",
    body: [
      "免费版供 10 人以内工作区永久免费使用。专业版（Pro）按席位订阅计费，价格以定价页公示为准；年付享有折扣。",
      "订阅可随时取消，取消后当前计费周期结束前仍可使用。月付当期不设按天退款；年付订单在购买 14 天内且未产生实质使用的，支持全额退款（退款请联系客服邮箱处理）。",
      "当前阶段提供电子收据；增值税发票能力将在具备开票资质后开放（如长期无法提供，以电子收据作为支付凭证）。",
    ],
  },
  {
    heading: "四、数据与降级",
    body: [
      "降级或取消订阅后，您的工作区回落到免费版，超出免费版额度的内容转为只读保留、可随时导出，我们不会因降级删除您的数据。",
    ],
  },
  {
    heading: "五、用户行为规范",
    body: [
      "您承诺不利用本服务存储或传播违法违规内容、侵犯他人权益的内容，或对服务进行恶意攻击、爬取、逆向。违反者我们有权暂停或终止服务。",
    ],
  },
  {
    heading: "六、服务的变更与终止",
    body: [
      "我们可能持续更新服务功能。对重大不利变更，我们会提前公告。您可随时停止使用并导出数据；我们破产、停业等极端情形下会提前 30 天通知并开放数据导出窗口。",
    ],
  },
  {
    heading: "七、免责与责任限制",
    body: [
      '本服务按"现状"提供。对因不可抗力、第三方服务（如支付通道、邮件服务商）故障导致的损失，我们在法律允许的最大范围内不承担责任。我们的累计赔偿责任以您过去 12 个月实际支付的费用为上限。',
    ],
  },
  {
    heading: "八、条款的修改",
    body: [
      "本条款可能不时修订，修订后的版本将在本页面发布并更新生效日期。重大变更我们会通过站内通知或邮件告知。",
    ],
  },
  {
    heading: "九、联系与争议",
    body: [
      "对本条款有任何疑问，或需要退款协助，请联系：winger35@163.com。本服务由个人开发者运营；本条款适用中华人民共和国法律（不含港澳台地区法律）。因本条款产生的争议，双方协商不成的，提交被告住所地有管辖权的人民法院解决。",
    ],
  },
];

const EN: Section[] = [
  {
    heading: "1. Acceptance of Terms",
    body: [
      'Welcome to corps (the "Service"). By registering an account or using the Service, you agree to these Terms. If you register on behalf of a team or organization, you confirm you are authorized to do so.',
    ],
  },
  {
    heading: "2. Accounts & Security",
    body: [
      "You are responsible for safeguarding your credentials and for activity under your account. Notify us promptly of any unauthorized use. Password reset links are time-limited and single-use.",
    ],
  },
  {
    heading: "3. Plans & Payments",
    body: [
      "The Free plan is free for workspaces of up to 10 members. The Pro plan is billed per seat as published on the pricing page; annual billing receives a discount.",
      "You may cancel at any time and keep access until the end of the current billing period. Monthly payments are non-refundable pro rata; annual orders are fully refundable within 14 days of purchase if substantially unused (contact support).",
      "Electronic receipts are provided at this stage; VAT invoicing will be available once we are qualified to issue them (if that never becomes possible, electronic receipts serve as proof of payment).",
    ],
  },
  {
    heading: "4. Data on Downgrade",
    body: [
      "After downgrade or cancellation, your workspace returns to the Free plan. Content beyond Free quotas becomes read-only and remains exportable at any time. We never delete your data due to a downgrade.",
    ],
  },
  {
    heading: "5. Acceptable Use",
    body: [
      "You agree not to store or distribute unlawful or infringing content via the Service, or to attack, scrape, or reverse-engineer it. We may suspend or terminate accounts that violate these rules.",
    ],
  },
  {
    heading: "6. Changes & Termination",
    body: [
      "The Service may evolve over time; material adverse changes will be announced in advance. You may stop using the Service and export your data at any time. In extreme cases (e.g., shutdown) we will provide 30 days' notice and an export window.",
    ],
  },
  {
    heading: "7. Disclaimers & Liability",
    body: [
      'The Service is provided "as is". To the maximum extent permitted by law, we are not liable for losses caused by force majeure or third-party services (e.g., payment or email providers). Our aggregate liability is capped at the fees you paid in the preceding 12 months.',
    ],
  },
  {
    heading: "8. Amendments",
    body: [
      "These Terms may be revised from time to time. Updated versions will be published on this page with a new effective date; material changes will be communicated in-app or by email.",
    ],
  },
  {
    heading: "9. Contact & Disputes",
    body: [
      "Questions about these Terms, or refund assistance: winger35@163.com. The Service is operated by an individual developer; these Terms are governed by the laws of the People's Republic of China (excluding Hong Kong, Macao and Taiwan). Disputes unresolved through negotiation shall be brought to a competent court at the defendant's domicile.",
    ],
  },
];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "legal" });
  return { title: t("termsTitle") };
}

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "legal" });
  const sections = locale === "en" ? EN : ZH;
  const updated = t("lastUpdated");

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      <article className="mx-auto max-w-[720px] px-[var(--space-6)] py-[var(--space-20)]">
        <h1 className="text-[length:var(--text-2xl)] font-[var(--weight-semibold)]">
          {t("termsTitle")}
        </h1>
        <p className="mt-1 text-[length:var(--text-xs)] text-[var(--meta)]">{updated}</p>
        <div className="mt-6 space-y-5">
          {sections.map((s) => (
            <section key={s.heading}>
              <h2 className="text-[length:var(--text-md)] font-[var(--weight-semibold)]">
                {s.heading}
              </h2>
              {s.body.map((p, i) => (
                <p
                  key={i}
                  className="mt-1.5 text-[length:var(--text-sm)] leading-[1.8] text-[var(--fg-2)]"
                >
                  {p}
                </p>
              ))}
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}
