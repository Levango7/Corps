"use client";

// 临时授权模态框（F2 任务 186）。
// 拆分自 members/page.tsx 第 839-1010 行。

import { useEffect, useState } from "react";
import { Clock, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Member, TemporaryGrant } from "@/lib/types";
import { DURATION_HOURS, durationKey, formatExpiry } from "./helpers";

interface TemporaryGrantModalProps {
  target: Member;
  existingGrant: TemporaryGrant | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (
    target: Member,
    tempRole: "admin" | "member",
    durationHours: number,
    reason: string,
  ) => Promise<void>;
  onRevoke: () => Promise<void>;
}

export function TemporaryGrantModal({
  target,
  existingGrant,
  busy,
  onClose,
  onConfirm,
  onRevoke,
}: TemporaryGrantModalProps) {
  const t = useTranslations("members");
  const tButton = useTranslations("button");

  // Escape 关闭 + body 滚动锁（可访问性）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const [tempRole, setTempRole] = useState<"admin" | "member">(
    existingGrant?.tempRole === "member" ? "member" : "admin",
  );
  const [durationHours, setDurationHours] = useState(24);
  const [reason, setReason] = useState(existingGrant?.reason ?? "");
  const existingActive =
    existingGrant && new Date(existingGrant.expiresAt).getTime() > Date.now();

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[var(--overlay)] p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-lg)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="flex items-center gap-2 text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            <Clock size={18} className="text-[var(--warn-fg)]" />
            {t("tempGrant")}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-[var(--radius-sm)] text-[var(--meta)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
            aria-label={tButton("close")}
          >
            <X size={18} />
          </button>
        </div>

        <p className="text-[length:var(--text-sm)] text-[var(--muted)] mb-4">
          {t("tempGrantDesc")} <span className="font-[weight:var(--weight-medium)] text-[var(--fg)]">{target.name || target.email}</span>
        </p>

        {/* 当前授权状态 */}
        {existingActive && (
          <div className="mb-4 px-3 py-2 rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] border border-[color-mix(in_srgb,var(--warn)_20%,transparent)]">
            <div className="text-[length:var(--text-sm)] text-[var(--warn-fg)] font-[weight:var(--weight-medium)]">
              {t("tempGrantCurrent", { role: existingGrant!.tempRole === "admin" ? t("tempGrantAdmin") : t("tempGrantMember") })}
            </div>
            <div className="text-[length:var(--text-xs)] text-[var(--meta)] mt-0.5">
              {formatExpiry(existingGrant!.expiresAt, t)}
              {existingGrant!.reason && ` · ${existingGrant!.reason}`}
            </div>
            <button
              onClick={onRevoke}
              disabled={busy}
              className="mt-2 h-7 px-2.5 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] text-[length:var(--text-xs)] text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
            >
              <X size={12} />
              {t("tempGrantRevokeNow")}
            </button>
          </div>
        )}

        {/* 授权表单 */}
        <div className="space-y-3">
          <div>
            <label className="block text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] mb-1.5">
              {t("tempRole")}
            </label>
            <select
              value={tempRole}
              onChange={(e) => setTempRole(e.target.value as "admin" | "member")}
              className="w-full h-9 px-3 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
            >
              <option value="admin">{t("tempGrantAdmin")}</option>
              <option value="member">{t("tempGrantMember")}</option>
            </select>
          </div>

          <div>
            <label className="block text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] mb-1.5">
              {t("duration")}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {DURATION_HOURS.map((hours) => (
                <button
                  key={hours}
                  type="button"
                  onClick={() => setDurationHours(hours)}
                  className={`h-9 rounded-[var(--radius-md)] text-[length:var(--text-sm)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 ${
                    durationHours === hours
                      ? "bg-[var(--accent)] text-[var(--accent-fg)] font-[weight:var(--weight-medium)]"
                      : "border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)]"
                  }`}
                >
                  {t(durationKey(hours))}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] mb-1.5">
              {t("grantReason")}
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              placeholder={t("grantReasonPlaceholder")}
              className="w-full h-9 px-3 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 placeholder:text-[var(--meta)]"
            />
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="h-9 px-4 text-[length:var(--text-sm)] text-[var(--fg-2)] rounded-[var(--radius-md)] hover:bg-[var(--surface-2)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
          >
            {tButton("cancel")}
          </button>
          <button
            onClick={() => onConfirm(target, tempRole, durationHours, reason)}
            disabled={busy}
            className="h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
          >
            {busy ? t("tempGrantSubmitting") : existingActive ? t("tempGrantUpdate") : t("grantTempPermission")}
          </button>
        </div>
      </div>
    </div>
  );
}