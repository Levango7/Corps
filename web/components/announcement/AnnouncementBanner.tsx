"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { X, Megaphone, Info, AlertTriangle, AlertOctagon } from "lucide-react";
import { api } from "@/lib/api";
import { type AnnouncementItem, type AnnouncementType, TYPE_TOKEN } from "./AnnouncementEditor";

const TYPE_ICON: Record<AnnouncementType, typeof Info> = {
  info: Info,
  warning: AlertTriangle,
  urgent: AlertOctagon,
};

/**
 * 公告横幅：展示工作区置顶公告，可关闭（localStorage 记忆已关闭的公告 ID）。
 * 按 type 显示不同颜色样式（info=accent, warning=warn, urgent=danger）。
 */
export function AnnouncementBanner({ wid }: { wid: string }) {
  const t = useTranslations("announcement");
  const [banner, setBanner] = useState<AnnouncementItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api<{ items: AnnouncementItem[] }>(
          `/api/v1/workspaces/${wid}/announcements?pinned=true&limit=10`,
        );
        if (cancelled) return;

        // 读取已关闭的公告 ID
        let dismissed: string[] = [];
        try {
          dismissed = JSON.parse(localStorage.getItem(`dismissed-announcements-${wid}`) ?? "[]");
        } catch {
          dismissed = [];
        }

        // 过滤掉已关闭的，取第一条（API 已按 publishedAt DESC 排序）
        const visible = data.items.filter((a) => !dismissed.includes(a.id));
        setBanner(visible[0] ?? null);
      } catch {
        if (!cancelled) setBanner(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wid]);

  function dismiss() {
    if (!banner) return;
    try {
      const key = `dismissed-announcements-${wid}`;
      const dismissed: string[] = JSON.parse(localStorage.getItem(key) ?? "[]");
      if (!dismissed.includes(banner.id)) {
        dismissed.push(banner.id);
        localStorage.setItem(key, JSON.stringify(dismissed));
      }
    } catch {
      // localStorage 不可用时静默失败
    }
    setBanner(null);
  }

  if (!banner) return null;

  const tok = TYPE_TOKEN[banner.type];
  const Icon = TYPE_ICON[banner.type];

  return (
    <div
      className="flex items-center gap-3 px-[var(--space-4)] py-2.5 border-b"
      style={{
        background: tok.soft,
        borderColor: tok.fg,
      }}
      role="status"
      aria-live="polite"
    >
      <Icon size={16} className="shrink-0" style={{ color: tok.fg }} />
      <Megaphone size={14} className="shrink-0 hidden sm:block" style={{ color: tok.fg }} />
      <div className="flex-1 min-w-0 flex items-baseline gap-2">
        <span
          className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] font-[weight:var(--weight-semibold)]"
          style={{ background: tok.fg, color: "var(--surface)" }}
        >
          {t(banner.type)}
        </span>
        <span
          className="truncate text-[length:var(--text-sm)] font-[weight:var(--weight-medium)]"
          style={{ color: tok.softFg }}
        >
          {banner.title}
        </span>
        <span className="hidden md:inline truncate text-[length:var(--text-xs)] opacity-80" style={{ color: tok.softFg }}>
          {banner.content.replace(/[#*`>_~\n]/g, " ").trim().slice(0, 120)}
        </span>
      </div>
      <button
        onClick={dismiss}
        className="shrink-0 w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
        style={{ color: tok.softFg }}
        aria-label={t("dismiss")}
        title={t("dismiss")}
      >
        <X size={14} />
      </button>
    </div>
  );
}