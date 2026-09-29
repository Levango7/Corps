"use client";

/**
 * 多维表格 · 列表组件（/w/[wid]/databases）
 *
 * 与 `components/whiteboard/WhiteboardList.tsx` 同构（卡片列表 + 新建 + 删除），
 * 差别有两处：
 *  1. 列表请求一律走 `apiList`——`GET /databases` 返回的是分页信封
 *     `{ items, page, limit, total, hasMore }`，按裸数组消费会直接崩。
 *  2. 新建会**连带补齐一个默认字段 + 一个默认表格视图**。因为
 *     `POST /databases` 只插 database 行，而 `DatabaseEditor` 在没有视图时
 *     只会渲染 `database.editor.noView` 空态——不补这两样，新建就等于跳进死路。
 *
 * 权限：`POST /databases` 与 `POST .../fields`、`POST .../views` 服务端都只放行
 * owner/admin，所以非管理角色直接不渲染新建/删除按钮（避免点了才吃 403）。
 */

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/lib/i18n-navigation";
import { Database as DatabaseIcon, Layers, Loader2, Plus, Trash2 } from "lucide-react";
import { api, apiList } from "@/lib/api";
import type { Role } from "@/lib/types";
import { canManageDatabases, fetchMyWorkspaceRole, type DatabaseDto } from "./shared";

export function DatabaseList({ wid }: { wid: string }) {
  const t = useTranslations("database.list");
  const router = useRouter();

  const [items, setItems] = useState<DatabaseDto[]>([]);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const canManage = canManageDatabases(role);

  // ─── 拉列表 + 判断角色（一次 Promise.all，避免两次往返）───
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [list, myRole] = await Promise.all([
          apiList<DatabaseDto>(`/api/v1/workspaces/${wid}/databases?limit=100`),
          fetchMyWorkspaceRole(wid),
        ]);
        if (cancelled) return;
        setItems(list);
        setRole(myRole);
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

  // ─── 新建：database + 默认字段 + 默认表格视图 ─────────────────
  async function createDatabase(e: FormEvent) {
    e.preventDefault();
    if (creating) return;
    const name = title.trim() || t("untitled");
    setCreating(true);
    setError("");
    try {
      const created = await api<DatabaseDto>(`/api/v1/workspaces/${wid}/databases`, {
        method: "POST",
        body: JSON.stringify({ title: name }),
      });
      // 编辑器要求"至少一个视图"才渲染，且没有字段就没有可填的列，
      // 因此按既有 API 顺序补齐；失败不阻断跳转，编辑页会给出对应空态。
      await Promise.all([
        api(`/api/v1/workspaces/${wid}/databases/${created.id}/fields`, {
          method: "POST",
          body: JSON.stringify({ name: t("defaultFieldName"), type: "text", sortOrder: 0 }),
        }),
        api(`/api/v1/workspaces/${wid}/databases/${created.id}/views`, {
          method: "POST",
          body: JSON.stringify({ name: t("defaultViewName"), type: "table", config: {} }),
        }),
      ]).catch(() => undefined);

      setFormOpen(false);
      setTitle("");
      router.push(`/w/${wid}/databases/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("createFailed"));
      setCreating(false);
    }
  }

  async function deleteDatabase(id: string) {
    if (!window.confirm(t("confirmDelete"))) return;
    setDeletingId(id);
    setError("");
    try {
      await api(`/api/v1/workspaces/${wid}/databases/${id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("deleteFailed"));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="max-w-[var(--container-max)] mx-auto">
      {/* ─── 标题行 + 新建入口 ─── */}
      <div className="flex items-end justify-between gap-[var(--space-4)] mb-[var(--space-6)]">
        <div>
          <h1 className="text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)]">
            {t("title")}
          </h1>
          <p className="mt-1.5 text-[length:var(--text-sm)] text-[var(--muted)]">{t("subtitle")}</p>
        </div>
        {canManage && !formOpen && (
          <button
            type="button"
            onClick={() => {
              setFormOpen(true);
              setError("");
            }}
            className="inline-flex items-center gap-1.5 h-9 px-3 shrink-0 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)]"
          >
            <Plus size={14} />
            {t("create")}
          </button>
        )}
      </div>

      {/* ─── 内联新建表单（与 layout.tsx 创建工作区的交互一致）─── */}
      {canManage && formOpen && (
        <form
          onSubmit={createDatabase}
          className="flex flex-wrap items-center gap-2 mb-[var(--space-5)] p-[var(--space-4)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]"
        >
          <input
            autoFocus
            type="text"
            value={title}
            onChange={(ev) => setTitle(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "Escape") {
                ev.preventDefault();
                setFormOpen(false);
                setTitle("");
              }
            }}
            maxLength={255}
            placeholder={t("namePlaceholder")}
            disabled={creating}
            aria-label={t("nameLabel")}
            className="flex-1 min-w-[180px] h-9 px-3 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[var(--fg)] text-[length:var(--text-sm)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]"
          />
          <button
            type="submit"
            disabled={creating}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)]"
          >
            {creating && <Loader2 size={14} className="animate-spin" />}
            {creating ? t("creating") : t("createConfirm")}
          </button>
          <button
            type="button"
            onClick={() => {
              setFormOpen(false);
              setTitle("");
            }}
            disabled={creating}
            className="h-9 px-3 rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)]"
          >
            {t("cancel")}
          </button>
        </form>
      )}

      {error && (
        <p className="mb-3 text-[length:var(--text-sm)] text-[var(--danger-fg)]">{error}</p>
      )}

      {/* ─── 列表 ─── */}
      {loading ? (
        <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
          <Loader2 size={20} className="inline animate-spin mr-2" />
          {t("loading")}
        </div>
      ) : items.length === 0 ? (
        <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
          <Layers size={36} className="mx-auto mb-3 opacity-50" />
          <p>{t("empty")}</p>
          {!canManage && (
            <p className="mt-1 text-[length:var(--text-sm)]">{t("emptyNoPermission")}</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[var(--space-4)]">
          {items.map((db) => (
            <div
              key={db.id}
              className="group relative rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] hover:shadow-[var(--elev-sm)] transition-all duration-[var(--motion-fast)]"
            >
              <Link
                href={`/w/${wid}/databases/${db.id}`}
                aria-label={t("openAria", { title: db.title })}
                className="block px-[var(--space-4)] py-[var(--space-4)]"
              >
                <div className="flex items-start gap-2 mb-2">
                  {db.emoji ? (
                    <span className="text-[length:var(--text-md)] shrink-0">{db.emoji}</span>
                  ) : (
                    <DatabaseIcon
                      size={16}
                      className="shrink-0 mt-0.5 text-[var(--muted)]"
                      aria-hidden="true"
                    />
                  )}
                  <h2 className="flex-1 min-w-0 text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)] truncate">
                    {db.title || t("untitled")}
                  </h2>
                </div>
                {db.description && (
                  <p className="ml-6 text-[length:var(--text-sm)] text-[var(--muted)] line-clamp-2">
                    {db.description}
                  </p>
                )}
                <p className="ml-6 mt-1 text-[length:var(--text-xs)] text-[var(--meta)]">
                  {t("lastUpdated", { date: new Date(db.updatedAt).toLocaleString() })}
                </p>
              </Link>
              {canManage && (
                <button
                  type="button"
                  onClick={() => deleteDatabase(db.id)}
                  disabled={deletingId === db.id}
                  title={t("delete")}
                  aria-label={t("delete")}
                  className="absolute top-[var(--space-2)] right-[var(--space-2)] w-8 h-8 inline-flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger-fg)] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-all duration-[var(--motion-fast)] disabled:opacity-50"
                >
                  {deletingId === db.id ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Trash2 size={14} />
                  )}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
