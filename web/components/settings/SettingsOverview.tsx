// 设置 - 工作区概况区：成员数 / 任务数 / 套餐 / 创建时间 / 工作区 ID。
// 拆分自 settings/page.tsx 第 851-879 行。纯展示组件。

import { getLocale, getTranslations } from "next-intl/server";
import type { Workspace } from "./types";

const sectionClass =
  "bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-4 sm:p-5";

interface SettingsOverviewProps {
  ws: Workspace;
}

export async function SettingsOverview({ ws }: SettingsOverviewProps) {
  const t = await getTranslations("settings");
  const locale = await getLocale();

  return (
    <section className={`${sectionClass} mt-5`}>
      <h2 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mb-4">
        {t("overviewTitle")}
      </h2>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-y-3 sm:gap-x-4 text-[length:var(--text-sm)]">
        {[
          [t("overviewMembers"), `${ws.memberCount} ${t("overviewMembersUnit")}`],
          [t("overviewTasks"), `${ws.taskCount} ${t("overviewTasksUnit")}`],
          [t("overviewPlan"), ws.plan],
          [t("overviewCreated"), new Date(ws.createdAt).toLocaleDateString(locale)],
        ].map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-2">
            <dt className="text-[var(--muted)]">{k}</dt>
            <dd className="text-[var(--fg)] tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 pt-4 border-t border-[var(--border-soft)]">
        <div className="text-[length:var(--text-xs)] text-[var(--meta)] mb-1">
          {t("overviewWsId")}
        </div>
        <code className="font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] text-[var(--fg-2)] break-all">
          {ws.id}
        </code>
      </div>
    </section>
  );
}