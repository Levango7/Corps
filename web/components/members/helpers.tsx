"use client";

// 成员管理共享辅助：Avatar / formatExpiry / durationKey / DURATION_HOURS。
// 拆分自 members/page.tsx 第 31-74 行。

import type { Member } from "@/lib/types";

/** 临时授权持续时间选项（小时） — label 由组件内用 i18n 映射 */
export const DURATION_HOURS: number[] = [1, 4, 8, 24, 48, 168];

/** 持续时间小时数 → i18n key 映射 */
export function durationKey(hours: number): string {
  switch (hours) {
    case 1:
      return "duration1h";
    case 4:
      return "duration4h";
    case 8:
      return "duration8h";
    case 24:
      return "duration24h";
    case 48:
      return "duration48h";
    case 168:
      return "duration7d";
    default:
      return "duration24h";
  }
}

/** 格式化到期时间（相对时间 + 绝对时间） — 接受 i18n 翻译函数 */
export function formatExpiry(expiresAt: string, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const now = Date.now();
  const expiry = new Date(expiresAt).getTime();
  const diffMs = expiry - now;
  if (diffMs <= 0) return t("tempGrantExpired");
  const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays > 0) return t("tempGrantExpiryDays", { count: diffDays });
  if (diffHours > 0) return t("tempGrantExpiryHours", { count: diffHours });
  const diffMinutes = Math.floor(diffMs / (60 * 1000));
  return t("tempGrantExpiryMinutes", { count: diffMinutes });
}

export function Avatar({ m }: { m: Member }) {
  return (
    <div className="w-8 h-8 rounded-full bg-[var(--accent)] text-[var(--accent-fg)] flex items-center justify-center text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] shrink-0">
      {(m.name || m.email)[0]?.toUpperCase()}
    </div>
  );
}