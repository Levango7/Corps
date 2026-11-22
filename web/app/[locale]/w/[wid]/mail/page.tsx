"use client";

/**
 * 邮箱页 · /w/[wid]/mail
 *
 * 邮件域接线（IMAP 收件 + SMTP 发件 + 账户管理）：
 *  - MailSettings：账户管理（GET/POST/DELETE /api/v1/mail/accounts）
 *  - MailComposer：写邮件（POST /api/v1/mail/send）
 *  - MailList：收件列表（GET /api/v1/mail/inbox）+ 详情/删除
 * 收件拉取：MailSettings 内的「立即同步」按钮触发 POST /api/v1/mail/sync
 * （调 lib/mail/imap-sync.ts 的 syncAllAccounts）。
 */

import { use } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Mail } from "lucide-react";

// P0-2: code splitting — 三个邮件组件改为 dynamic import 懒加载
const MailSettings = dynamic(
  () => import("@/components/mail/MailSettings").then((m) => m.default),
  { loading: () => <div className="animate-pulse h-32 rounded-lg bg-[var(--surface-2)]" /> },
);
const MailComposer = dynamic(
  () => import("@/components/mail/MailComposer").then((m) => m.default),
  { loading: () => <div className="animate-pulse h-32 rounded-lg bg-[var(--surface-2)]" /> },
);
const MailList = dynamic(() => import("@/components/mail/MailList").then((m) => m.default), {
  loading: () => <div className="animate-pulse h-32 rounded-lg bg-[var(--surface-2)]" />,
});

export default function MailPage({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = use(params);
  const t = useTranslations("nav");

  return (
    <main className="flex-1 min-w-0">
      <div className="mx-auto max-w-[var(--container-max)] px-[var(--space-4)] py-[var(--space-6)]">
        <div className="mb-[var(--space-5)]">
          <h1 className="flex items-center gap-2 text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)]">
            <Mail size={20} className="text-[var(--accent)]" />
            {t("mail")}
          </h1>
        </div>

        <MailSettings workspaceId={wid} />
        <MailComposer workspaceId={wid} />
        <MailList workspaceId={wid} />
      </div>
    </main>
  );
}
