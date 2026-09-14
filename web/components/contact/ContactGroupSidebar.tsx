"use client";

/**
 * 联系人分组侧栏 · ContactGroupSidebar
 *
 * 显示「全部联系人」+ 各分组（带联系人计数）。
 * 支持选中分组过滤、新建分组、删除分组。
 *
 * 数据流：挂载时拉 GET /contact-groups；新建/删除后本地更新。
 */

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Users, FolderPlus, Trash2, Loader2, X } from "lucide-react";
import { api } from "@/lib/api";
import type { ContactGroupItem } from "./types";

export function ContactGroupSidebar({
  wid,
  selectedGroupId,
  onSelectGroup,
  totalCount,
}: {
  wid: string;
  /** 当前选中的分组 id；null 表示「全部联系人」 */
  selectedGroupId: string | null;
  /** 选中分组回调；null 表示选中「全部」 */
  onSelectGroup: (groupId: string | null) => void;
  /** 全部联系人总数（由父组件传入，用于「全部联系人」行计数） */
  totalCount: number;
}) {
  const t = useTranslations("contact");
  const [groups, setGroups] = useState<ContactGroupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [showInput, setShowInput] = useState(false);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await api<ContactGroupItem[]>(
          `/api/v1/workspaces/${wid}/contact-groups`,
        );
        if (!cancelled) setGroups(data);
      } catch {
        /* 静默：侧栏加载失败不阻塞主列表 */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wid]);

  async function createGroup(e: FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    setError("");
    try {
      const created = await api<ContactGroupItem>(
        `/api/v1/workspaces/${wid}/contact-groups`,
        { method: "POST", body: JSON.stringify({ name }) },
      );
      setGroups((prev) =>
        [...prev, { ...created, _count: { contacts: 0 } }].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
      setNewName("");
      setShowInput(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("create"));
    } finally {
      setCreating(false);
    }
  }

  async function deleteGroup(gid: string) {
    if (deletingId) return;
    setDeletingId(gid);
    setError("");
    try {
      await api(`/api/v1/workspaces/${wid}/contact-groups?gid=${gid}`, {
        method: "DELETE",
      });
      setGroups((prev) => prev.filter((g) => g.id !== gid));
      // 若删除的是当前选中分组，回退到「全部」
      if (selectedGroupId === gid) onSelectGroup(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("delete"));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-[var(--space-4)] py-[var(--space-3)] border-b border-[var(--border-soft)]">
        <h2 className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)] uppercase tracking-[var(--tracking-wide)]">
          {t("groups")}
        </h2>
        <button
          type="button"
          onClick={() => setShowInput((v) => !v)}
          className="inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
          aria-label={t("addGroup")}
          title={t("addGroup")}
        >
          <FolderPlus size={14} />
        </button>
      </div>

      {/* 新建分组输入框 */}
      {showInput && (
        <form
          onSubmit={createGroup}
          className="px-[var(--space-3)] py-[var(--space-2)] border-b border-[var(--border-soft)]"
        >
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={100}
              placeholder={t("groupName")}
              className="flex-1 h-8 px-2.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]"
            />
            <button
              type="submit"
              disabled={!newName.trim() || creating}
              className="inline-flex items-center justify-center w-8 h-8 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-fg)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)]"
              aria-label={t("create")}
            >
              {creating ? <Loader2 size={14} className="animate-spin" /> : <FolderPlus size={14} />}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowInput(false);
                setNewName("");
              }}
              className="inline-flex items-center justify-center w-8 h-8 rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
              aria-label={t("delete")}
            >
              <X size={14} />
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="px-[var(--space-3)] py-1.5 text-[length:var(--text-xs)] text-[var(--danger)]">
          {error}
        </p>
      )}

      <nav className="flex-1 overflow-y-auto py-[var(--space-1)]">
        {/* 全部联系人 */}
        <button
          type="button"
          onClick={() => onSelectGroup(null)}
          className={`w-full flex items-center gap-2 px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] transition-colors duration-[var(--motion-fast)] ${
            selectedGroupId === null
              ? "bg-[var(--surface-2)] text-[var(--fg)] font-[weight:var(--weight-medium)]"
              : "text-[var(--fg-2)] hover:bg-[var(--surface-2)]"
          }`}
        >
          <Users size={14} className="shrink-0 text-[var(--muted)]" />
          <span className="flex-1 text-left truncate">{t("allContacts")}</span>
          <span className="shrink-0 text-[length:var(--text-xs)] text-[var(--meta)]">
            {totalCount}
          </span>
        </button>

        {loading ? (
          <div className="px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--text-xs)] text-[var(--muted)]">
            <Loader2 size={14} className="inline animate-spin mr-1.5" />
            {t("loading")}
          </div>
        ) : (
          groups.map((g) => (
            <div
              key={g.id}
              className={`group flex items-center gap-2 px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] transition-colors duration-[var(--motion-fast)] ${
                selectedGroupId === g.id
                  ? "bg-[var(--surface-2)] text-[var(--fg)] font-[weight:var(--weight-medium)]"
                  : "text-[var(--fg-2)] hover:bg-[var(--surface-2)]"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectGroup(g.id)}
                className="flex-1 flex items-center gap-2 min-w-0 text-left"
              >
                <span
                  className="shrink-0 inline-block w-2 h-2 rounded-full bg-[var(--accent)] opacity-70"
                  aria-hidden="true"
                />
                <span className="flex-1 truncate">{g.name}</span>
              </button>
              <span className="shrink-0 text-[length:var(--text-xs)] text-[var(--meta)]">
                {g._count.contacts}
              </span>
              <button
                type="button"
                onClick={() => deleteGroup(g.id)}
                disabled={deletingId === g.id}
                className="shrink-0 w-6 h-6 inline-flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--meta)] opacity-0 group-hover:opacity-100 hover:text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:opacity-50 transition-all duration-[var(--motion-fast)]"
                aria-label={t("delete")}
                title={t("delete")}
              >
                {deletingId === g.id ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Trash2 size={12} />
                )}
              </button>
            </div>
          ))
        )}
      </nav>
    </div>
  );
}