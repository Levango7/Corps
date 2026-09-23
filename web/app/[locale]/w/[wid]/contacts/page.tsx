"use client";

import { useEffect, useState, use, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Plus, Loader2, X } from "lucide-react";
import { api } from "@/lib/api";
import { ContactGroupSidebar } from "@/components/contact/ContactGroupSidebar";
import { ContactList } from "@/components/contact/ContactList";
import { ContactDetail } from "@/components/contact/ContactDetail";
import type { ContactItem, ContactGroupItem } from "@/components/contact/types";

/**
 * 通讯录页面 · /[locale]/w/[wid]/contacts
 *
 * 布局：左侧分组侧栏 + 中间联系人列表 + 右侧详情侧栏（选中时）
 * 新建：内联弹窗 POST /contacts
 */
export default function ContactsPage({
  params,
}: {
  params: Promise<{ wid: string }>;
}) {
  const { wid } = use(params);
  const t = useTranslations("contact");
  const tButton = useTranslations("button");

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedContact, setSelectedContact] = useState<ContactItem | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [showCreate, setShowCreate] = useState(false);

  // 拉取全部联系人总数（用于侧栏「全部联系人」计数）
  useEffect(() => {
    let cancelled = false;
    api<{ total: number }>(`/api/v1/workspaces/${wid}/contacts?limit=1`)
      .then((d) => {
        if (!cancelled) setTotalCount(d.total);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [wid, selectedContact]);

  return (
    <div className="flex h-full min-h-0">
      {/* 左侧分组侧栏 */}
      <aside className="hidden md:flex w-[var(--sidebar-w)] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--shell-sidebar)]">
        <ContactGroupSidebar
          wid={wid}
          selectedGroupId={selectedGroupId}
          onSelectGroup={(gid) => {
            setSelectedGroupId(gid);
            setSelectedContact(null);
          }}
          totalCount={totalCount}
        />
      </aside>

      {/* 中间联系人列表 */}
      <main className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center justify-between px-[var(--space-4)] py-[var(--space-3)] border-b border-[var(--border-soft)]">
          <h1 className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)]">
            {t("title")}
          </h1>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)]"
          >
            <Plus size={14} />
            {t("create")}
          </button>
        </div>
        <div className="flex-1 min-h-0">
          <ContactList
            wid={wid}
            groupId={selectedGroupId}
            onSelect={setSelectedContact}
            selectedId={selectedContact?.id ?? null}
          />
        </div>
      </main>

      {/* 右侧详情侧栏（选中联系人时显示） */}
      {selectedContact && (
        <div className="hidden lg:flex w-80 shrink-0">
          <ContactDetail
            wid={wid}
            contactId={selectedContact.id}
            onClose={() => setSelectedContact(null)}
            onDeleted={() => setSelectedContact(null)}
            onUpdated={() => {
              /* 列表会在下次拉取时刷新；此处仅关闭无副作用 */
            }}
          />
        </div>
      )}

      {/* 新建联系人弹窗 */}
      {showCreate && (
        <CreateContactDialog
          wid={wid}
          defaultGroupId={selectedGroupId}
          onClose={() => setShowCreate(false)}
          onCreated={(c) => {
            setShowCreate(false);
            setSelectedContact(c);
          }}
        />
      )}
    </div>
  );
}

/** 新建联系人弹窗（内联组件） */
function CreateContactDialog({
  wid,
  defaultGroupId,
  onClose,
  onCreated,
}: {
  wid: string;
  defaultGroupId: string | null;
  onClose: () => void;
  onCreated: (contact: ContactItem) => void;
}) {
  const t = useTranslations("contact");
  const tButton = useTranslations("button");
  const [groups, setGroups] = useState<ContactGroupItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    department: "",
    position: "",
    notes: "",
    groupId: defaultGroupId ?? "",
  });

  useEffect(() => {
    api<ContactGroupItem[]>(`/api/v1/workspaces/${wid}/contact-groups`).catch(
      () => [] as ContactGroupItem[],
    ).then(setGroups);
  }, [wid]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const created = await api<ContactItem>(
        `/api/v1/workspaces/${wid}/contacts`,
        {
          method: "POST",
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
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("createFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  const fieldLabel =
    "flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)] mb-1.5";
  const fieldControl =
    "w-full h-9 px-2.5 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]";

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center p-4 sm:p-8 overflow-y-auto bg-[var(--overlay)]"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        onClose();
      }}
    >
      <div className="w-full max-w-lg my-auto bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-lg)]">
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
          <h2 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            {t("create")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
            aria-label={tButton("close")}
          >
            <X size={16} />
          </button>
        </header>

        <form onSubmit={submit} className="px-4 sm:px-5 py-4 space-y-4">
          <div>
            <label className={fieldLabel} htmlFor="cc-name">
              {t("name")}
            </label>
            <input
              id="cc-name"
              autoFocus
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              maxLength={100}
              required
              placeholder={t("name")}
              className={`${fieldControl} h-10`}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={fieldLabel} htmlFor="cc-email">
                {t("email")}
              </label>
              <input
                id="cc-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                maxLength={255}
                className={fieldControl}
              />
            </div>
            <div>
              <label className={fieldLabel} htmlFor="cc-phone">
                {t("phone")}
              </label>
              <input
                id="cc-phone"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                maxLength={50}
                className={fieldControl}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={fieldLabel} htmlFor="cc-dept">
                {t("department")}
              </label>
              <input
                id="cc-dept"
                value={form.department}
                onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                maxLength={100}
                className={fieldControl}
              />
            </div>
            <div>
              <label className={fieldLabel} htmlFor="cc-pos">
                {t("position")}
              </label>
              <input
                id="cc-pos"
                value={form.position}
                onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
                maxLength={100}
                className={fieldControl}
              />
            </div>
          </div>

          <div>
            <label className={fieldLabel} htmlFor="cc-group">
              {t("group")}
            </label>
            <select
              id="cc-group"
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
            <label className={fieldLabel} htmlFor="cc-notes">
              {t("notes")}
            </label>
            <textarea
              id="cc-notes"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={3}
              className="w-full px-2.5 py-2 resize-y border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
              <span className="flex-1">{error}</span>
              <button
                type="button"
                onClick={() => setError("")}
                className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
                aria-label={tButton("close")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
            >
              {tButton("cancel")}
            </button>
            <button
              type="submit"
              disabled={!form.name.trim() || submitting}
              className="inline-flex items-center gap-1.5 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)]"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {tButton("create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}