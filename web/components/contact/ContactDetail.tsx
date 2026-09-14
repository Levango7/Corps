"use client";

/**
 * 联系人详情/编辑面板 · ContactDetail
 *
 * 显示联系人所有字段，支持内联编辑与删除。
 * 数据流：contactId 变化时拉 GET /contacts/{cid}；编辑 PATCH；删除 DELETE。
 */

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  X,
  Loader2,
  Save,
  Trash2,
  Mail,
  Phone,
  Building2,
  Briefcase,
  FileText,
  User,
} from "lucide-react";
import { api } from "@/lib/api";
import type { ContactDetail, ContactGroupItem } from "./types";

export function ContactDetail({
  wid,
  contactId,
  onClose,
  onDeleted,
  onUpdated,
}: {
  wid: string;
  contactId: string;
  onClose: () => void;
  onDeleted: (id: string) => void;
  onUpdated: (contact: ContactDetail) => void;
}) {
  const t = useTranslations("contact");
  const tButton = useTranslations("button");
  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [groups, setGroups] = useState<ContactGroupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // 编辑表单状态
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    department: "",
    position: "",
    notes: "",
    groupId: "",
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([
      api<ContactDetail>(`/api/v1/workspaces/${wid}/contacts/${contactId}`).catch((e) => {
        throw e;
      }),
      api<ContactGroupItem[]>(`/api/v1/workspaces/${wid}/contact-groups`).catch(() => [] as ContactGroupItem[]),
    ])
      .then(([c, g]) => {
        if (cancelled) return;
        setContact(c);
        setGroups(g);
        setForm({
          name: c.name,
          email: c.email ?? "",
          phone: c.phone ?? "",
          department: c.department ?? "",
          position: c.position ?? "",
          notes: c.notes ?? "",
          groupId: c.groupId ?? "",
        });
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : t("loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [wid, contactId, t]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (saving || !contact) return;
    setSaving(true);
    setError("");
    try {
      const updated = await api<ContactDetail>(
        `/api/v1/workspaces/${wid}/contacts/${contactId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            name: form.name.trim(),
            email: form.email.trim() || null,
            phone: form.phone.trim() || null,
            department: form.department.trim() || null,
            position: form.position.trim() || null,
            notes: form.notes.trim() || null,
            groupId: form.groupId || null,
          }),
        },
      );
      setContact(updated);
      setEditing(false);
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (deleting) return;
    setDeleting(true);
    setError("");
    try {
      await api(`/api/v1/workspaces/${wid}/contacts/${contactId}`, {
        method: "DELETE",
      });
      onDeleted(contactId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("delete"));
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const fieldLabel =
    "flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)] mb-1.5";
  const fieldValue = "text-[length:var(--text-sm)] text-[var(--fg)]";
  const fieldControl =
    "w-full h-9 px-2.5 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]";

  return (
    <aside className="flex h-full flex-col border-l border-[var(--border)] bg-[var(--surface)]">
      {/* 头部 */}
      <header className="flex items-center justify-between px-[var(--space-4)] py-[var(--space-3)] border-b border-[var(--border-soft)]">
        <h2 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)] truncate">
          {contact?.name ?? t("title")}
        </h2>
        <div className="flex items-center gap-1">
          {contact && !editing && !confirmDelete && (
            <>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-sm)] border border-[var(--border)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
              >
                {t("edit")}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={deleting}
                className="inline-flex items-center justify-center w-8 h-8 rounded-[var(--radius-sm)] text-[var(--meta)] hover:text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)]"
                aria-label={t("delete")}
                title={t("delete")}
              >
                {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center w-8 h-8 rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
            aria-label={tButton("close")}
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {error && (
        <p className="px-[var(--space-4)] py-2 text-[length:var(--text-sm)] text-[var(--danger)]">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-[var(--muted)]">
          <Loader2 size={20} className="animate-spin mr-2" />
          {t("loading")}
        </div>
      ) : !contact ? (
        <div className="flex-1 flex flex-col items-center justify-center text-[var(--muted)] py-[var(--space-12)]">
          <User size={36} className="mb-3 opacity-50" />
          <p className="text-[length:var(--text-sm)]">{t("noContacts")}</p>
        </div>
      ) : confirmDelete ? (
        <div className="flex-1 flex flex-col items-center justify-center px-[var(--space-6)] text-center">
          <Trash2 size={28} className="mb-3 text-[var(--danger)]" />
          <p className="mb-4 text-[length:var(--text-sm)] text-[var(--fg)]">
            {t("confirmDelete")}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="h-9 px-4 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
            >
              {tButton("cancel")}
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={deleting}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-[var(--radius-md)] bg-[var(--danger)] text-[var(--danger-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:opacity-90 disabled:opacity-50 transition-opacity duration-[var(--motion-fast)]"
            >
              {deleting && <Loader2 size={14} className="animate-spin" />}
              {t("delete")}
            </button>
          </div>
        </div>
      ) : editing ? (
        <form onSubmit={save} className="flex-1 overflow-y-auto px-[var(--space-4)] py-[var(--space-4)] space-y-4">
          <div>
            <label className={fieldLabel} htmlFor="cd-name">
              <User size={13} />
              {t("name")}
            </label>
            <input
              id="cd-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              maxLength={100}
              required
              className={`${fieldControl} h-10`}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={fieldLabel} htmlFor="cd-email">
                <Mail size={13} />
                {t("email")}
              </label>
              <input
                id="cd-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                maxLength={255}
                className={fieldControl}
              />
            </div>
            <div>
              <label className={fieldLabel} htmlFor="cd-phone">
                <Phone size={13} />
                {t("phone")}
              </label>
              <input
                id="cd-phone"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                maxLength={50}
                className={fieldControl}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={fieldLabel} htmlFor="cd-dept">
                <Building2 size={13} />
                {t("department")}
              </label>
              <input
                id="cd-dept"
                value={form.department}
                onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                maxLength={100}
                className={fieldControl}
              />
            </div>
            <div>
              <label className={fieldLabel} htmlFor="cd-pos">
                <Briefcase size={13} />
                {t("position")}
              </label>
              <input
                id="cd-pos"
                value={form.position}
                onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
                maxLength={100}
                className={fieldControl}
              />
            </div>
          </div>

          <div>
            <label className={fieldLabel} htmlFor="cd-group">
              {t("group")}
            </label>
            <select
              id="cd-group"
              value={form.groupId}
              onChange={(e) => setForm((f) => ({ ...f, groupId: e.target.value }))}
              className={fieldControl}
            >
              <option value="">{t("allContacts")}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={fieldLabel} htmlFor="cd-notes">
              <FileText size={13} />
              {t("notes")}
            </label>
            <textarea
              id="cd-notes"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={4}
              className="w-full px-2.5 py-2 resize-y border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setForm({
                  name: contact.name,
                  email: contact.email ?? "",
                  phone: contact.phone ?? "",
                  department: contact.department ?? "",
                  position: contact.position ?? "",
                  notes: contact.notes ?? "",
                  groupId: contact.groupId ?? "",
                });
              }}
              className="h-9 px-4 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
            >
              {tButton("cancel")}
            </button>
            <button
              type="submit"
              disabled={!form.name.trim() || saving}
              className="inline-flex items-center gap-1.5 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)]"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {tButton("save")}
            </button>
          </div>
        </form>
      ) : (
        /* 只读详情 */
        <div className="flex-1 overflow-y-auto px-[var(--space-4)] py-[var(--space-4)]">
          {/* 头像 + 姓名 */}
          <div className="flex items-center gap-3 mb-[var(--space-5)]">
            <div className="shrink-0 w-16 h-16 rounded-full bg-[var(--surface-2)] border border-[var(--border-soft)] flex items-center justify-center text-[length:var(--text-xl)] font-[weight:var(--weight-semibold)] text-[var(--fg-2)]">
              {contact.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={contact.avatar}
                  alt={contact.name}
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                contact.name.charAt(0).toUpperCase()
              )}
            </div>
            <div className="min-w-0">
              <h3 className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)] truncate">
                {contact.name}
              </h3>
              {contact.group && (
                <span className="inline-block mt-1 px-2 py-0.5 rounded-[var(--radius-sm)] bg-[var(--surface-2)] text-[length:var(--text-xs)] text-[var(--fg-2)]">
                  {contact.group.name}
                </span>
              )}
            </div>
          </div>

          <dl className="space-y-[var(--space-3)]">
            <DetailRow icon={<Mail size={14} />} label={t("email")} value={contact.email} />
            <DetailRow icon={<Phone size={14} />} label={t("phone")} value={contact.phone} />
            <DetailRow
              icon={<Building2 size={14} />}
              label={t("department")}
              value={contact.department}
            />
            <DetailRow
              icon={<Briefcase size={14} />}
              label={t("position")}
              value={contact.position}
            />
            <DetailRow
              icon={<FileText size={14} />}
              label={t("notes")}
              value={contact.notes}
              multiline
            />
          </dl>
        </div>
      )}
    </aside>
  );
}

/** 详情行：图标 + 标签 + 值；值为空时显示占位 */
function DetailRow({
  icon,
  label,
  value,
  multiline,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  multiline?: boolean;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)] mb-1">
        {icon}
        {label}
      </dt>
      <dd
        className={`text-[length:var(--text-sm)] text-[var(--fg)] ${
          multiline ? "whitespace-pre-wrap" : ""
        }`}
      >
        {value || <span className="text-[var(--muted)]">—</span>}
      </dd>
    </div>
  );
}