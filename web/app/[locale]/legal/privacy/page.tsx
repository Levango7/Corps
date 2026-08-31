import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { locales } from "@/lib/i18n";

/**
 * /legal/privacy 隐私政策 —— 静态法务文档页。
 * 与实际实现对齐：邮件通知（Resend）、支付（Stripe/支付宝/微信）、
 * PostgreSQL RLS 多租户隔离、httpOnly cookie 会话、Docker 自托管部署。
 * 运营主体：个人开发者（无公司/个体牌照），联系邮箱见"运营者"条款。
 */

interface Section {
  heading: string;
  body: string[];
}

const ZH: Section[] = [
  {
    heading: "一、运营者与生效",
    body: [
      "本服务由个人开发者运营（当前未注册公司或个体经营牌照），运营者联系邮箱：winger35@163.com。",
      "本政策可能不时更新，更新后在本页面发布并更新生效日期；重大变更会通过站内通知或邮件告知。",
    ],
  },
  {
    heading: "二、我们收集的信息",
    body: [
      "账户信息：注册邮箱、密码（仅以单向哈希存储，我们无法看到明文）、可选的显示名与头像。",
      "工作区内容：您创建的任务、评论、决策记录、聊天消息及附件元数据——这些数据仅对您所在工作区的成员可见。",
      "技术信息：登录会话记录（Better Auth 托管）、操作日志、匿名的产品使用统计（页面访问、功能点击等，不含内容正文）。",
      "支付信息：我们不在服务器存储银行卡信息；订阅支付由 Stripe / 支付宝 / 微信支付处理，我们仅保存订单号与订阅状态。",
    ],
  },
  {
    heading: "三、信息的使用",
    body: [
      "我们使用上述信息来：提供并维护服务（任务协作、通知、搜索）、处理订阅与扣款、发送与账户相关的必要邮件（邀请、任务指派、截止日提醒、密码重置）、改进产品体验。",
      "产品统计为匿名化聚合数据，不用于广告，也不与第三方共享用于广告目的。",
    ],
  },
  {
    heading: "四、信息的共享",
    body: [
      "除以下情形外，我们不会向第三方出售或共享您的个人信息：",
      "1. 服务提供商：邮件发送（Resend）、支付处理（Stripe / 支付宝 / 微信）——仅限其为提供服务所必需的最小范围；",
      "2. 法律要求：依法律法规或有权机关的强制要求。",
    ],
  },
  {
    heading: "五、数据安全",
    body: [
      "多租户数据以 PostgreSQL 行级安全（RLS）在数据库引擎层强制隔离，跨工作区请求被数据库直接拦截；会话凭证使用 httpOnly Cookie 传输，页面执行受内容安全策略（CSP）约束；外部日历集成的令牌以 AES-256-GCM 加密存储。",
    ],
  },
  {
    heading: "六、数据保留与删除",
    body: [
      "您可随时导出任务与决策记录数据。删除账户或工作区时，相关数据将被删除或匿名化；法律要求留存的记录（如交易流水）按法定期限保存。",
    ],
  },
  {
    heading: "七、您的权利",
    body: [
      "您有权访问、更正、导出您的个人信息，并可随时在账户设置中修改或删除。行使权利或提出投诉请联系：winger35@163.com。",
    ],
  },
  {
    heading: "八、儿童",
    body: ["本服务面向团队协作场景，不面向 14 岁以下儿童。"],
  },
];

const EN: Section[] = [
  {
    heading: "1. Operator & Effectiveness",
    body: [
      "The Service is operated by an individual developer (no company or sole-proprietor registration at this stage). Operator contact: winger35@163.com.",
      "This policy may be updated from time to time; new versions are published on this page with a new effective date, and material changes are announced in-app or by email.",
    ],
  },
  {
    heading: "2. Information We Collect",
    body: [
      "Account info: registration email, password (stored only as a one-way hash; we never see plaintext), optional display name and avatar.",
      "Workspace content: tasks, comments, decisions, chat messages and attachment metadata you create — visible only to members of your workspace.",
      "Technical info: session records (managed by Better Auth), operation logs, and anonymized product usage statistics (page views, feature clicks — never content bodies).",
      "Payment info: we do not store card details on our servers; payments are processed by Stripe / Alipay / WeChat Pay, and we keep only order IDs and subscription status.",
    ],
  },
  {
    heading: "3. How We Use Information",
    body: [
      "To provide and maintain the Service (collaboration, notifications, search), process subscriptions and payments, send necessary account emails (invitations, assignments, due-date reminders, password resets), and improve the product.",
      "Product statistics are anonymized aggregates — never used for advertising nor shared with third parties for that purpose.",
    ],
  },
  {
    heading: "4. Sharing",
    body: [
      "We do not sell or share your personal information except with:",
      "1. Service providers: email delivery (Resend), payment processing (Stripe / Alipay / WeChat Pay) — limited to what is necessary;",
      "2. Legal requirements: where compelled by applicable law or authorities.",
    ],
  },
  {
    heading: "5. Data Security",
    body: [
      "Multi-tenant data is isolated at the database engine level with PostgreSQL Row-Level Security (RLS); session credentials travel in httpOnly cookies; page execution is constrained by a Content Security Policy (CSP); external calendar tokens are encrypted at rest with AES-256-GCM.",
    ],
  },
  {
    heading: "6. Retention & Deletion",
    body: [
      "You can export task and decision data at any time. Deleting an account or workspace removes or anonymizes related data; records we must retain by law (e.g., transaction records) are kept for the statutory period.",
    ],
  },
  {
    heading: "7. Your Rights",
    body: [
      "You may access, correct, export, or delete your personal information at any time from account settings. To exercise rights or file complaints: winger35@163.com.",
    ],
  },
  {
    heading: "8. Children",
    body: ["The Service targets team collaboration and is not directed at children under 14."],
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
  return { title: t("privacyTitle") };
}

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "legal" });
  const sections = locale === "en" ? EN : ZH;

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      <article className="mx-auto max-w-[720px] px-[var(--space-6)] py-[var(--space-20)]">
        <h1 className="text-[length:var(--text-2xl)] font-[var(--weight-semibold)]">
          {t("privacyTitle")}
        </h1>
        <p className="mt-1 text-[length:var(--text-xs)] text-[var(--meta)]">{t("lastUpdated")}</p>
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
