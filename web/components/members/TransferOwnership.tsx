"use client";

// 转让所有权区（owner only）。
// 拆分自 members/page.tsx 第 379-442 行。纯展示 + 回调，状态由父组件管理。
// 保持 "use client"：接收 6 个函数 props（setTransferOpen/setTransferTarget/onTransfer 等），
// 这些回调来自 client 父组件 (members/page.tsx)，无法跨越 server/client 边界传递。
// 父组件管理所有状态（transferOpen/transferTarget/transferBusy），本组件仅做展示 + 回调转发。

import { useTranslations } from "next-intl";
import type { Member } from "@/lib/types";

interface TransferOwnershipProps {
  members: Member[];
  transferOpen: boolean;
  setTransferOpen: (v: boolean) => void;
  transferTarget: string;
  setTransferTarget: (v: string) => void;
  transferBusy: boolean;
  onTransfer: () => void;
}

export function TransferOwnership({
  members,
  transferOpen,
  setTransferOpen,
  transferTarget,
  setTransferTarget,
  transferBusy,
  onTransfer,
}: TransferOwnershipProps) {
  const t = useTranslations("members");
  const tRole = useTranslations("role");

  return (
    <section className="mb-6 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-4">
      <h2 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mb-1">
        {t("transfer")}
      </h2>
      <p className="text-[length:var(--text-xs)] text-[var(--meta)] mb-3">
        {t("transferHint")}
      </p>
      {!transferOpen ? (
        <button
          onClick={() => setTransferOpen(true)}
          disabled={members.filter((m) => !m.isSelf && m.role !== "owner").length === 0}
          className="h-9 px-4 border border-[var(--border)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
        >
          {t("transfer")}
        </button>
      ) : (
        <div className="space-y-2">
          <select
            value={transferTarget}
            onChange={(e) => setTransferTarget(e.target.value)}
            className="w-full h-9 px-2 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
          >
            <option value="">{t("transferSelect")}</option>
            {members
              .filter((m) => !m.isSelf && m.role !== "owner")
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name || m.email}（{tRole(m.role)}）
                </option>
              ))}
          </select>
          <p className="text-[length:var(--text-xs)] text-[var(--meta)]">
            {t("transferConfirmHint")}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onTransfer}
              disabled={transferBusy || !transferTarget}
              className="h-9 px-3 bg-[var(--danger)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
            >
              {t("transferConfirm")}
            </button>
            <button
              onClick={() => {
                setTransferOpen(false);
                setTransferTarget("");
              }}
              disabled={transferBusy}
              className="h-9 px-3 text-[length:var(--text-sm)] text-[var(--fg-2)] rounded-[var(--radius-md)] hover:bg-[var(--surface-2)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
            >
              {t("transferCancel")}
            </button>
          </div>
        </div>
      )}
      {members.filter((m) => !m.isSelf && m.role !== "owner").length === 0 && (
        <p className="mt-2 text-[length:var(--text-xs)] text-[var(--meta)]">
          {t("transferEmptyList")}
        </p>
      )}
    </section>
  );
}