"use client";

/**
 * 会议纪要列表组件 · components/minutes/MinutesList.tsx
 *
 * 功能：
 *  - 拉取 GET /meeting-minutes 列表（标题/创建时间/参会人数/行动项数）
 *  - 新建：POST 创建后跳转到编辑页
 *  - 删除：DELETE 带确认
 *  - 点击行跳转详情页
 *
 * 参考 DocumentListView.tsx 模式。design token + lucide-react + useTranslations。
 */

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/lib/i18n-navigation";
import { Plus, FileText, Loader2, Trash2, Users, CheckSquare } from "lucide-react";
import { api, ApiError } from "@/lib/api";

/** 参会人员 / 行动项 JSON 结构（与 API 一致） */
interface Attendee {
  userId?: string;
  name: string;
  role?: string;
}
interface ActionItem {
  title: string;
  assigneeId?: string;
  dueDate?: string;
  done: boolean;
}

/** 列表项（列表 API 返回的精简结构） */
interface MinutesListItem {
  id: string;
  meetingId: string | null;
  title: string;
  attendees: Attendee[];
  actionItems: ActionItem[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  creator: { id: string; name: string | null; email: string } | null;
}

export function MinutesList({ wid }: { wid: string }) {
  const t = useTranslations("minutes");
  const router = useRouter();
  const [items, setItems] = useState<MinutesListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await api<{ items: MinutesListItem[] }>(
          `/api/v1/workspaces/${wid}/meeting-minutes`,
        );
        if (!cancelled) setItems(data.items);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t("loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wid, t]);

  async function createMinutes(e: FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setError("");
    try {
      const res = await api<{ id: string }>(
        `/api/v1/workspaces/${wid}/meeting-minutes`,
        {
          method: "POST",
          body: JSON.stringify({
            title: t("untitled"),
            content: "",
            attendees: [],
            actionItems: [],
          }),
        },
      );
      router.push(`/w/${wid}/meeting-minutes/${res.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("createFailed"));
      setCreating(false);
    }
  }

  async function deleteMinutes(id: string) {
    if (!window.confirm(t("confirmDelete"))) return;
    setDeletingId(id);
    setError("");
    try {
      await api(`/api/v1/workspaces/${wid}/meeting-minutes/${id}`, {
        method: "DELETE",
      });
      setItems((prev) => prev.filter((m) => m.id !== id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("deleteFailed"));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="max-w-[var(--container-max)] mx-auto px-[var(--space-4)] py-[var(--space-6)]">
      <div className="flex items-center justify-between mb-[var(--space-5)]">
        <h1 className="text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)]">
          {t("title")}
        </h1>
        <button
          onClick={createMinutes}
          disabled={creating}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)]"
        >
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          {t("create")}
        </button>
      </div>

      {error && <p className="mb-3 text-[length:var(--text-sm)] text-[var(--danger)]">{error}</p>}

      {loading ? (
        <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
          <Loader2 size={20} className="inline animate-spin mr-2" />
          {t("loading")}
        </div>
      ) : items.length === 0 ? (
        <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
          <FileText size={36} className="mx-auto mb-3 opacity-50" />
          <p>{t("noMinutes")}</p>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border-soft)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
          {items.map((m) => {
            const creator = m.creator?.name || m.creator?.email;
            const attendeeCount = Array.isArray(m.attendees) ? m.attendees.length : 0;
            const actionCount = Array.isArray(m.actionItems) ? m.actionItems.length : 0;
            const doneCount = Array.isArray(m.actionItems)
              ? m.actionItems.filter((a) => a.done).length
              : 0;
            return (
              <li key={m.id} className="relative group">
                <Link
                  href={`/w/${wid}/meeting-minutes/${m.id}`}
                  className="block px-[var(--space-4)] py-3 hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                >
                  <div className="flex items-center gap-2">
                    <FileText size={15} className="shrink-0 text-[var(--muted)]" />
                    <span className="flex-1 min-w-0 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] truncate">
                      {m.title}
                    </span>
                    {/* 参会人数 */}
                    <span className="shrink-0 inline-flex items-center gap-1 text-[length:var(--text-xs)] text-[var(--meta)]">
                      <Users size={13} />
                      {attendeeCount}
                    </span>
                    {/* 行动项数（已完成/总数） */}
                    <span className="shrink-0 inline-flex items-center gap-1 text-[length:var(--text-xs)] text-[var(--meta)]">
                      <CheckSquare size={13} />
                      {doneCount}/{actionCount}
                    </span>
                  </div>
                  <div className="mt-1 ml-6 text-[length:var(--text-xs)] text-[var(--muted)] flex items-center gap-2">
                    {creator && <span>{creator}</span>}
                    {creator && <span>·</span>}
                    <span>{t("createdAt", { date: new Date(m.createdAt).toLocaleString() })}</span>
                  </div>
                </Link>
                {/* 删除按钮（hover 显示） */}
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    deleteMinutes(m.id);
                  }}
                  disabled={deletingId === m.id}
                  className="absolute right-[var(--space-3)] top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:text-[var(--danger)] hover:bg-[var(--surface-2)] opacity-0 group-hover:opacity-100 transition-opacity duration-[var(--motion-fast)] disabled:opacity-50"
                  aria-label={t("delete")}
                  title={t("delete")}
                >
                  {deletingId === m.id ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Trash2 size={14} />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}