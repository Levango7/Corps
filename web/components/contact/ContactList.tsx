"use client";

/**
 * 联系人列表 · ContactList
 *
 * 显示姓名/职位/部门/邮箱/电话，支持搜索、按分组过滤。
 * 选中联系人后通过 onSelect 回调通知父组件打开详情面板。
 *
 * 数据流：groupId/search 变化时拉 GET /contacts?groupId=&search=
 */

import { useEffect, useState, useDeferredValue } from "react";
import { useTranslations } from "next-intl";
import { Search, X, Loader2, User, Mail, Phone, Building2, Briefcase } from "lucide-react";
import { api } from "@/lib/api";
import type { ContactItem } from "./types";

export function ContactList({
  wid,
  groupId,
  onSelect,
  selectedId,
}: {
  wid: string;
  /** 当前过滤的分组 id；null 表示全部 */
  groupId: string | null;
  /** 选中联系人回调 */
  onSelect: (contact: ContactItem) => void;
  /** 当前选中的联系人 id（用于高亮） */
  selectedId: string | null;
}) {
  const t = useTranslations("contact");
  const [items, setItems] = useState<ContactItem[]>([]);
  const [q, setQ] = useState("");
  // 搜索防抖：useDeferredValue 让输入快速变化时不立即触发请求
  const deferredQ = useDeferredValue(q);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (groupId) params.set("groupId", groupId);
        if (deferredQ) params.set("search", deferredQ);
        const data = await api<{ items: ContactItem[]; total: number }>(
          `/api/v1/workspaces/${wid}/contacts?${params.toString()}`,
        );
        if (!cancelled) {
          setItems(data.items);
          setTotal(data.total);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t("loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wid, groupId, deferredQ, t]);

  return (
    <div className="flex h-full flex-col">
      {/* 搜索栏 */}
      <div className="px-[var(--space-4)] py-[var(--space-3)] border-b border-[var(--border-soft)]">
        <div className="relative">
          <Search
            size={15}
            className="absolute left-[var(--space-3)] top-1/2 -translate-y-1/2 text-[var(--meta)] pointer-events-none"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("search")}
            className="w-full h-9 pl-9 pr-9 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]"
          />
          {q && (
            <button
              onClick={() => setQ("")}
              className="absolute right-[var(--space-2)] top-1/2 -translate-y-1/2 p-1 rounded-[var(--radius-sm)] text-[var(--meta)] hover:text-[var(--fg)]"
              aria-label={t("search")}
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="px-[var(--space-4)] py-2 text-[length:var(--text-sm)] text-[var(--danger)]">
          {error}
        </p>
      )}

      {/* 列表 */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-[var(--muted)]">
          <Loader2 size={20} className="animate-spin mr-2" />
          {t("loading")}
        </div>
      ) : items.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-[var(--muted)] py-[var(--space-12)]">
          <User size={36} className="mb-3 opacity-50" />
          <p className="text-[length:var(--text-sm)]">{t("noContacts")}</p>
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto divide-y divide-[var(--border-soft)]">
          {items.map((c) => {
            const isSelected = c.id === selectedId;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onSelect(c)}
                  className={`w-full text-left px-[var(--space-4)] py-[var(--space-3)] transition-colors duration-[var(--motion-fast)] ${
                    isSelected
                      ? "bg-[var(--surface-2)]"
                      : "hover:bg-[var(--surface-2)]"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="shrink-0 w-9 h-9 rounded-full bg-[var(--surface-2)] border border-[var(--border-soft)] flex items-center justify-center text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
                      {c.avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={c.avatar}
                          alt={c.name}
                          className="w-full h-full rounded-full object-cover"
                        />
                      ) : (
                        c.name.charAt(0).toUpperCase()
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] truncate">
                          {c.name}
                        </span>
                        {c.position && (
                          <span className="inline-flex items-center gap-0.5 shrink-0 text-[length:var(--text-xs)] text-[var(--meta)]">
                            <Briefcase size={11} />
                            {c.position}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[length:var(--text-xs)] text-[var(--muted)]">
                        {c.department && (
                          <span className="inline-flex items-center gap-0.5">
                            <Building2 size={11} />
                            {c.department}
                          </span>
                        )}
                        {c.email && (
                          <span className="inline-flex items-center gap-0.5">
                            <Mail size={11} />
                            {c.email}
                          </span>
                        )}
                        {c.phone && (
                          <span className="inline-flex items-center gap-0.5">
                            <Phone size={11} />
                            {c.phone}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
          {total > items.length && (
            <li className="px-[var(--space-4)] py-2 text-center text-[length:var(--text-xs)] text-[var(--meta)]">
              {t("showingCount", { shown: items.length, total })}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}