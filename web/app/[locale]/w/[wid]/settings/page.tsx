"use client";

import { use, useCallback, useEffect, useState } from "react";
import {
  Settings as SettingsIcon,
  Check,
  Loader2,
  AlertTriangle,
  Sun,
  Moon,
  Monitor,
  Download,
  Trash2,
  Bell,
  LayoutGrid,
  List,
  UserX,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import type { DeletionPreview as AccountDeletionPreview } from "@/lib/account-deletion";
import {
  exportTasksCsv,
  exportDecisionsCsv,
  type CsvTask,
  type CsvDecision,
} from "@/lib/csv-export";

type Role = "owner" | "admin" | "member";
type ThemePref = "light" | "dark" | "system";
type DefaultView = "board" | "list";

interface Workspace {
  id: string;
  name: string;
  slug: string;
  plan: string;
  seatLimit: number;
  memberCount: number;
  taskCount: number;
  createdAt: string;
  role: Role;
}

const THEMES: { id: ThemePref; labelKey: string; icon: typeof Sun }[] = [
  { id: "light", labelKey: "themeLight", icon: Sun },
  { id: "dark", labelKey: "themeDark", icon: Moon },
  { id: "system", labelKey: "themeSystem", icon: Monitor },
];

const VIEWS: { id: DefaultView; icon: typeof LayoutGrid }[] = [
  { id: "board", icon: LayoutGrid },
  { id: "list", icon: List },
];

function applyTheme(pref: ThemePref) {
  const resolved =
    pref === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : pref;
  document.documentElement.style.transition = "background-color 0.2s";
  document.documentElement.setAttribute("data-theme", resolved);
  localStorage.setItem("corps_theme", pref);
}

/** 通知偏好持久化 key */
const NOTIF_PREF_KEY = "corps_notif_pref";
/** 默认视图持久化 key */
const DEFAULT_VIEW_KEY = "corps_default_view";

interface NotifPref {
  emailEnabled: boolean;
  mentionEnabled: boolean;
}

function loadNotifPref(): NotifPref {
  try {
    const raw = localStorage.getItem(NOTIF_PREF_KEY);
    if (raw) return JSON.parse(raw) as NotifPref;
  } catch {
    /* ignore */
  }
  return { emailEnabled: true, mentionEnabled: true };
}

function saveNotifPref(pref: NotifPref): void {
  localStorage.setItem(NOTIF_PREF_KEY, JSON.stringify(pref));
}

export default function SettingsPage({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = use(params);
  const t = useTranslations("settings");
  const tExport = useTranslations("export");
  const tAccount = useTranslations("accountDeletion");
  const tTheme = useTranslations("theme");
  const tErr = useTranslations("error");
  const [ws, setWs] = useState<Workspace | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [theme, setTheme] = useState<ThemePref>("system");
  const [defaultView, setDefaultView] = useState<DefaultView>("board");
  const [notifPref, setNotifPref] = useState<NotifPref>({
    emailEnabled: true,
    mentionEnabled: true,
  });
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  // 个人资料
  const [userName, setUserName] = useState("");
  const [userImage, setUserImage] = useState("");
  const [userInitial, setUserInitial] = useState<{
    name: string | null;
    image: string | null;
  } | null>(null);
  const [userBusy, setUserBusy] = useState(false);
  const [userSaved, setUserSaved] = useState(false);
  const [userImageError, setUserImageError] = useState("");
  // CSV 导出状态
  const [exportingTasks, setExportingTasks] = useState(false);
  const [exportingDecisions, setExportingDecisions] = useState(false);
  // 删除工作区确认流程
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState("");
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<Workspace>(`/api/v1/workspaces/${wid}`);
      setWs(data);
      setName(data.name);
      setSlug(data.slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadFailed"));
    }
  }, [wid]);

  useEffect(() => {
    load();
    const stored = (localStorage.getItem("corps_theme") as ThemePref | null) ?? "system";
    setTheme(stored);
    const storedView = (localStorage.getItem(DEFAULT_VIEW_KEY) as DefaultView | null) ?? "board";
    setDefaultView(storedView);
    setNotifPref(loadNotifPref());
  }, [load]);

  // 加载当前用户资料
  useEffect(() => {
    api<{ name: string | null; email: string; image: string | null }>("/api/v1/users/me")
      .then((u) => {
        setUserName(u.name ?? "");
        setUserImage(u.image ?? "");
        setUserInitial({ name: u.name, image: u.image });
      })
      .catch(() => {});
  }, []);

  async function saveUserProfile() {
    if (userBusy) return;
    setError("");
    setUserSaved(false);
    setUserBusy(true);
    try {
      const payload: Record<string, string> = {};
      const nextName = userName.trim();
      const nextImage = userImage.trim();
      if (nextName !== (userInitial?.name ?? "")) payload.name = nextName;
      if (nextImage !== (userInitial?.image ?? "")) payload.image = nextImage;
      if (Object.keys(payload).length === 0) {
        setUserBusy(false);
        return;
      }
      const updated = await api<{ name: string | null; image: string | null }>("/api/v1/users/me", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setUserInitial({ name: updated.name, image: updated.image });
      setUserSaved(true);
      setTimeout(() => setUserSaved(false), 2400);
    } catch (e) {
      setError(e instanceof Error ? e.message : tErr("saveFailed"));
    } finally {
      setUserBusy(false);
    }
  }

  async function save() {
    if (!ws || busy) return;
    setError("");
    setSaved(false);
    setBusy(true);
    try {
      const payload: Record<string, string> = {};
      if (name.trim() !== ws.name) payload.name = name.trim();
      if (slug.trim() !== ws.slug) payload.slug = slug.trim();
      if (Object.keys(payload).length === 0) {
        setBusy(false);
        return;
      }
      await api(`/api/v1/workspaces/${wid}`, { method: "PATCH", body: JSON.stringify(payload) });
      setSaved(true);
      await load();
      setTimeout(() => setSaved(false), 2400);
    } catch (e) {
      setError(e instanceof Error ? e.message : tErr("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  function pickTheme(tp: ThemePref) {
    setTheme(tp);
    applyTheme(tp);
  }

  function pickView(v: DefaultView) {
    setDefaultView(v);
    localStorage.setItem(DEFAULT_VIEW_KEY, v);
  }

  function updateNotifPref(patch: Partial<NotifPref>) {
    setNotifPref((prev) => {
      const next = { ...prev, ...patch };
      saveNotifPref(next);
      return next;
    });
  }

  // CSV 导出：拉取任务列表并导出
  async function handleExportTasks() {
    if (exportingTasks || !ws) return;
    setExportingTasks(true);
    setError("");
    try {
      const tasks = await api<CsvTask[]>(`/api/v1/workspaces/${wid}/tasks`);
      exportTasksCsv(tasks, ws.slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : tExport("tasksFailed"));
    } finally {
      setExportingTasks(false);
    }
  }

  // CSV 导出：拉取决策列表并导出
  async function handleExportDecisions() {
    if (exportingDecisions || !ws) return;
    setExportingDecisions(true);
    setError("");
    try {
      const decisions = await api<CsvDecision[]>(`/api/v1/workspaces/${wid}/decisions`);
      exportDecisionsCsv(decisions, ws.slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : tExport("decisionsFailed"));
    } finally {
      setExportingDecisions(false);
    }
  }

  // 删除工作区（两步确认：勾选确认 + 输入工作区名匹配）
  async function handleDeleteWorkspace() {
    if (!ws || deleting) return;
    if (deleteInput.trim() !== ws.name) {
      setError(t("deleteNameMismatch"));
      return;
    }
    setDeleting(true);
    setError("");
    try {
      await api(`/api/v1/workspaces/${wid}`, { method: "DELETE" });
      // 删除成功后跳转到首页
      window.location.href = "/";
    } catch (e) {
      setError(e instanceof Error ? e.message : t("deleteFailed"));
    } finally {
      setDeleting(false);
    }
  }

  // ─── 删除账户（阶段 2-3）：预览 + 邮箱确认 ───────────────────────
  const [accountDeleteOpen, setAccountDeleteOpen] = useState(false);
  const [accountPreview, setAccountPreview] = useState<AccountDeletionPreview | null>(null);
  const [accountPreviewLoading, setAccountPreviewLoading] = useState(false);
  const [accountDeleteInput, setAccountDeleteInput] = useState("");
  const [accountDeleting, setAccountDeleting] = useState(false);

  async function loadAccountPreview() {
    setAccountPreviewLoading(true);
    setAccountPreview(null);
    try {
      setAccountPreview(await api<AccountDeletionPreview>("/api/v1/users/me/account"));
    } catch {
      setAccountPreview(null); // 展示 previewFailed 提示，不阻断删除流程
    } finally {
      setAccountPreviewLoading(false);
    }
  }

  async function handleDeleteAccount() {
    if (accountDeleting) return;
    setAccountDeleting(true);
    setError("");
    try {
      // 请求体带邮箱做服务端二次确认；不匹配服务端拒绝（400）
      await api("/api/v1/users/me/account", {
        method: "DELETE",
        body: JSON.stringify({ confirmEmail: accountDeleteInput.trim() }),
      });
      // 账户已删（cookie 已过期）：整页跳转登录页
      window.location.href = "/auth/login";
    } catch (e) {
      setError(e instanceof Error ? e.message : tAccount("failed"));
      setAccountDeleting(false);
    }
  }

  const canEdit = ws ? ["owner", "admin"].includes(ws.role) : false;
  const dirty = ws ? name.trim() !== ws.name || slug.trim() !== ws.slug : false;
  const userDirty =
    userInitial !== null &&
    (userName.trim() !== (userInitial.name ?? "") ||
      userImage.trim() !== (userInitial.image ?? ""));

  const inputClass =
    "w-full h-9 px-3 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:bg-[var(--surface-2)] disabled:text-[var(--muted)] placeholder:text-[var(--meta)]";
  const labelClass =
    "block text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--fg-2)] mb-1.5";
  const sectionClass =
    "bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-4 sm:p-5";

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-[length:var(--text-2xl)] font-[var(--weight-semibold)] text-[var(--fg)]">
          <SettingsIcon size={20} className="text-[var(--muted)]" />
          {t("title")}
        </h1>
        <p className="mt-1 text-[length:var(--text-sm)] text-[var(--muted)]">{t("subtitle")}</p>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 px-4 py-3 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
          <AlertTriangle size={16} className="shrink-0 mt-0.5 text-[var(--danger)]" />
          <span>{error}</span>
        </div>
      )}

      {/* 个人资料 */}
      <section className={sectionClass}>
        <h2 className="text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--fg)] mb-4">
          {t("profileTitle")}
        </h2>

        <div className="space-y-4">
          <div>
            <label htmlFor="user-name" className={labelClass}>
              {t("profileName")}
            </label>
            <input
              id="user-name"
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              className={inputClass}
              placeholder={t("profileNamePlaceholder")}
            />
          </div>

          <div>
            <label htmlFor="user-image" className={labelClass}>
              {t("profileAvatar")}
            </label>
            <input
              id="user-image"
              type="url"
              value={userImage}
              onChange={(e) => setUserImage(e.target.value)}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && !/^https?:\/\/.+/i.test(v)) setUserImageError(t("profileAvatarInvalid"));
                else setUserImageError("");
              }}
              className={inputClass}
              placeholder="https://..."
            />
            {userImageError && (
              <p className="mt-1.5 text-[length:var(--text-xs)] text-[var(--danger-fg)]">
                {userImageError}
              </p>
            )}
            {userImage.trim() && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={userImage.trim()}
                className="mt-2 w-16 h-16 rounded-full border border-[var(--border)] object-cover"
                alt={t("profileAvatarAlt")}
              />
            )}
            <p className="mt-1.5 text-[length:var(--text-xs)] text-[var(--meta)]">
              {t("profileAvatarHint")}
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mt-5 pt-4 border-t border-[var(--border-soft)]">
          <button
            onClick={saveUserProfile}
            disabled={!userDirty || userBusy}
            className="w-full sm:w-auto h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] flex items-center justify-center gap-1.5"
          >
            {userBusy && <Loader2 size={15} className="animate-spin" />}
            {t("save")}
          </button>
          {!userDirty && !userBusy && (
            <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
              {t("noChanges")}
            </span>
          )}
          {userSaved && (
            <span className="flex items-center gap-1.5 text-[length:var(--text-sm)] text-[var(--success-fg)]">
              <Check size={15} className="text-[var(--success)]" />
              {t("saved")}
            </span>
          )}
        </div>
      </section>

      {/* 工作区 */}
      <section className={`${sectionClass} mt-5`}>
        <h2 className="text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--fg)] mb-4">
          {t("workspaceTitle")}
        </h2>

        <div className="space-y-4">
          <div>
            <label htmlFor="ws-name" className={labelClass}>
              {t("workspaceName")}
            </label>
            <input
              id="ws-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canEdit}
              className={inputClass}
              placeholder={t("workspaceNamePlaceholder")}
            />
          </div>

          <div>
            <label htmlFor="ws-slug" className={labelClass}>
              {t("workspaceSlug")}
            </label>
            <input
              id="ws-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
              disabled={!canEdit}
              className={`${inputClass} font-[family-name:var(--font-mono)] text-[length:var(--text-sm)]`}
              placeholder="growth-team"
            />
            <p className="mt-1.5 text-[length:var(--text-xs)] text-[var(--meta)]">
              {t("workspaceSlugHint")}
            </p>
          </div>
        </div>

        {canEdit && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mt-5 pt-4 border-t border-[var(--border-soft)]">
            <button
              onClick={save}
              disabled={!dirty || busy}
              className="w-full sm:w-auto h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] flex items-center justify-center gap-1.5"
            >
              {busy && <Loader2 size={15} className="animate-spin" />}
              {t("save")}
            </button>
            {!dirty && !busy && (
              <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
                {t("noChanges")}
              </span>
            )}
            {saved && (
              <span className="flex items-center gap-1.5 text-[length:var(--text-sm)] text-[var(--success-fg)]">
                <Check size={15} className="text-[var(--success)]" />
                {t("saved")}
              </span>
            )}
          </div>
        )}
        {!canEdit && ws && (
          <p className="mt-4 pt-4 border-t border-[var(--border-soft)] text-[length:var(--text-xs)] text-[var(--meta)]">
            {t("workspaceNoPermission")}
          </p>
        )}
      </section>

      {/* 默认任务视图（P4：工作区设置增强） */}
      <section className={`${sectionClass} mt-5`}>
        <h2 className="text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--fg)] mb-1">
          {t("defaultViewTitle")}
        </h2>
        <p className="text-[length:var(--text-xs)] text-[var(--meta)] mb-4">
          {t("defaultViewHint")}
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const active = defaultView === v.id;
            return (
              <button
                key={v.id}
                onClick={() => pickView(v.id)}
                className="w-full sm:flex-1 flex items-center justify-center gap-2 py-2.5 rounded-[var(--radius-md)] border transition-colors duration-[var(--motion-fast)]"
                style={{
                  borderColor: active ? "var(--accent)" : "var(--border)",
                  background: active ? "var(--accent-soft)" : "var(--surface)",
                  color: active ? "var(--accent)" : "var(--fg-2)",
                }}
              >
                <Icon size={16} />
                <span className="text-[length:var(--text-sm)] font-[var(--weight-medium)]">
                  {v.id === "board" ? t("viewBoard") : t("viewList")}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 通知偏好（P4：工作区设置增强） */}
      <section className={`${sectionClass} mt-5`}>
        <h2 className="flex items-center gap-2 text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--fg)] mb-1">
          <Bell size={16} className="text-[var(--muted)]" />
          {t("notifTitle")}
        </h2>
        <p className="text-[length:var(--text-xs)] text-[var(--meta)] mb-4">{t("notifHint")}</p>
        <div className="space-y-3">
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div>
              <div className="text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--fg)]">
                {t("notifEmail")}
              </div>
              <div className="text-[length:var(--text-xs)] text-[var(--meta)] mt-0.5">
                {t("notifEmailHint")}
              </div>
            </div>
            <input
              type="checkbox"
              checked={notifPref.emailEnabled}
              onChange={(e) => updateNotifPref({ emailEnabled: e.target.checked })}
              className="w-4 h-4 accent-[var(--accent)]"
            />
          </label>
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div>
              <div className="text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--fg)]">
                {t("notifMention")}
              </div>
              <div className="text-[length:var(--text-xs)] text-[var(--meta)] mt-0.5">
                {t("notifMentionHint")}
              </div>
            </div>
            <input
              type="checkbox"
              checked={notifPref.mentionEnabled}
              onChange={(e) => updateNotifPref({ mentionEnabled: e.target.checked })}
              className="w-4 h-4 accent-[var(--accent)]"
            />
          </label>
        </div>
      </section>

      {/* 外观 */}
      <section className={`${sectionClass} mt-5`}>
        <h2 className="text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--fg)] mb-1">
          {t("appearanceTitle")}
        </h2>
        <p className="text-[length:var(--text-xs)] text-[var(--meta)] mb-4">
          {t("appearanceHint")}
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          {THEMES.map((tp) => {
            const Icon = tp.icon;
            const active = theme === tp.id;
            return (
              <button
                key={tp.id}
                onClick={() => pickTheme(tp.id)}
                className="w-full sm:flex-1 flex flex-col items-center gap-2 py-2.5 rounded-[var(--radius-md)] border transition-colors duration-[var(--motion-fast)]"
                style={{
                  borderColor: active ? "var(--accent)" : "var(--border)",
                  background: active ? "var(--accent-soft)" : "var(--surface)",
                  color: active ? "var(--accent)" : "var(--fg-2)",
                }}
              >
                <Icon size={18} />
                <span className="text-[length:var(--text-sm)] font-[var(--weight-medium)]">
                  {tTheme(tp.labelKey)}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 数据导出（P4：CSV 导出） */}
      <section className={`${sectionClass} mt-5`}>
        <h2 className="flex items-center gap-2 text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--fg)] mb-1">
          <Download size={16} className="text-[var(--muted)]" />
          {tExport("title")}
        </h2>
        <p className="text-[length:var(--text-xs)] text-[var(--meta)] mb-4">{tExport("hint")}</p>
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={handleExportTasks}
            disabled={exportingTasks}
            className="w-full sm:w-auto h-9 px-4 border border-[var(--border)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] flex items-center justify-center gap-1.5"
          >
            {exportingTasks ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Download size={15} />
            )}
            {tExport("tasks")}
          </button>
          <button
            onClick={handleExportDecisions}
            disabled={exportingDecisions}
            className="w-full sm:w-auto h-9 px-4 border border-[var(--border)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] flex items-center justify-center gap-1.5"
          >
            {exportingDecisions ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Download size={15} />
            )}
            {tExport("decisions")}
          </button>
        </div>
      </section>

      {/* 概况 */}
      {ws && (
        <section className={`${sectionClass} mt-5`}>
          <h2 className="text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--fg)] mb-4">
            {t("overviewTitle")}
          </h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-y-3 sm:gap-x-4 text-[length:var(--text-sm)]">
            {[
              [t("overviewMembers"), `${ws.memberCount} ${t("overviewMembersUnit")}`],
              [t("overviewTasks"), `${ws.taskCount} ${t("overviewTasksUnit")}`],
              [t("overviewPlan"), ws.plan],
              [t("overviewCreated"), new Date(ws.createdAt).toLocaleDateString("zh-CN")],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-2">
                <dt className="text-[var(--muted)]">{k}</dt>
                <dd className="text-[var(--fg)] tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 pt-4 border-t border-[var(--border-soft)]">
            <div className="text-[length:var(--text-xs)] text-[var(--meta)] mb-1">
              {t("overviewWsId")}
            </div>
            <code className="font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] text-[var(--fg-2)] break-all">
              {ws.id}
            </code>
          </div>
        </section>
      )}

      {/* 危险操作（P4：删除工作区两步确认流程） */}
      {ws?.role === "owner" && (
        <section className="mt-5 rounded-[var(--radius-lg)] p-4 sm:p-5 border border-[var(--danger)] bg-[var(--danger-soft)]">
          <h2 className="flex items-center gap-2 text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--danger-fg)] mb-1">
            <Trash2 size={16} />
            {t("dangerTitle")}
          </h2>
          <p className="text-[length:var(--text-sm)] text-[var(--danger-fg)] opacity-90 mb-4">
            {t("dangerHint")}
          </p>

          {!deleteConfirm ? (
            <button
              onClick={() => setDeleteConfirm(true)}
              className="h-9 px-4 border border-[var(--danger)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--danger-fg)] hover:bg-[var(--danger)] hover:text-[var(--accent-fg)] transition-colors duration-[var(--motion-base)] flex items-center gap-1.5"
            >
              <Trash2 size={15} />
              {t("deleteInit")}
            </button>
          ) : (
            <div className="space-y-3">
              <div className="p-3 rounded-[var(--radius-md)] bg-[var(--danger)] bg-opacity-10 text-[length:var(--text-sm)] text-[var(--danger-fg)]">
                {t("deleteConfirmHint", { name: ws.name })}
              </div>
              <div>
                <label htmlFor="delete-confirm-input" className={labelClass}>
                  {t("deleteConfirmLabel", { name: ws.name })}
                </label>
                <input
                  id="delete-confirm-input"
                  type="text"
                  value={deleteInput}
                  onChange={(e) => setDeleteInput(e.target.value)}
                  className={inputClass}
                  placeholder={ws.name}
                  autoComplete="off"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDeleteWorkspace}
                  disabled={deleting || deleteInput.trim() !== ws.name}
                  className="h-9 px-4 bg-[var(--danger)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] hover:bg-[var(--danger)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] flex items-center gap-1.5"
                >
                  {deleting && <Loader2 size={15} className="animate-spin" />}
                  {t("deleteConfirm")}
                </button>
                <button
                  onClick={() => {
                    setDeleteConfirm(false);
                    setDeleteInput("");
                  }}
                  className="h-9 px-4 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                >
                  {t("deleteCancel")}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* 删除账户（阶段 2-3：隐私政策"账户设置里可删除"承诺兑现）
          用户级操作（影响所有工作区），三步：展开 → 预览 → 输入邮箱确认删除 */}
      <section className="mt-5 rounded-[var(--radius-lg)] p-4 sm:p-5 border border-[var(--danger)] bg-[var(--danger-soft)]">
        <h2 className="flex items-center gap-2 text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--danger-fg)] mb-1">
          <UserX size={16} />
          {tAccount("title")}
        </h2>
        <p className="text-[length:var(--text-sm)] text-[var(--danger-fg)] opacity-90 mb-4">
          {tAccount("hint")}
        </p>

        {!accountDeleteOpen ? (
          <button
            onClick={() => {
              setAccountDeleteOpen(true);
              loadAccountPreview();
            }}
            className="h-9 px-4 border border-[var(--danger)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--danger-fg)] hover:bg-[var(--danger)] hover:text-[var(--accent-fg)] transition-colors duration-[var(--motion-base)] flex items-center gap-1.5"
          >
            <UserX size={15} />
            {tAccount("init")}
          </button>
        ) : (
          <div className="space-y-3">
            {/* 数据预览 */}
            {accountPreviewLoading ? (
              <div className="flex items-center gap-2 text-[length:var(--text-sm)] text-[var(--fg-2)]">
                <Loader2 size={15} className="animate-spin" />
                {tAccount("previewLoading")}
              </div>
            ) : accountPreview ? (
              <div className="space-y-2 p-3 rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)]">
                {accountPreview.ownedWorkspaces.length > 0 && (
                  <div>
                    <p className="text-[var(--danger-fg)] font-[var(--weight-medium)]">
                      {tAccount("previewOwned", { count: accountPreview.ownedWorkspaces.length })}
                    </p>
                    <ul className="mt-1 space-y-0.5 text-[var(--fg-2)]">
                      {accountPreview.ownedWorkspaces.map((w) => (
                        <li key={w.id}>
                          · {w.name}（{w.memberCount} {tAccount("previewMembers")}，{" "}
                          {tAccount("previewWillDelete")}）
                        </li>
                      ))}
                    </ul>
                    {accountPreview.stats.ownedTasks > 0 && (
                      <p className="mt-1 text-[var(--muted)] text-[length:var(--text-xs)]">
                        {tAccount("previewStats", {
                          tasks: accountPreview.stats.ownedTasks,
                          decisions: accountPreview.stats.ownedDecisions,
                          messages: accountPreview.stats.messages,
                        })}
                      </p>
                    )}
                  </div>
                )}
                {accountPreview.joinedWorkspaces.length > 0 && (
                  <div>
                    <p className="text-[var(--fg)]">
                      {tAccount("previewJoined", {
                        count: accountPreview.joinedWorkspaces.length,
                      })}
                    </p>
                    <ul className="mt-1 space-y-0.5 text-[var(--muted)]">
                      {accountPreview.joinedWorkspaces.map((w) => (
                        <li key={w.id}>
                          · {w.name}（{w.role}）
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {accountPreview.activeSubscription && (
                  <p className="text-[var(--danger-fg)]">
                    {tAccount("previewSubscription", {
                      provider: accountPreview.activeSubscription.provider ?? "-",
                    })}
                  </p>
                )}
              </div>
            ) : (
              <div className="p-3 rounded-[var(--radius-md)] bg-[var(--surface-2)] text-[length:var(--text-sm)] text-[var(--fg-2)]">
                {tAccount("previewFailed")}
              </div>
            )}

            {/* 邮箱确认 */}
            <div className="p-3 rounded-[var(--radius-md)] bg-[var(--danger)] bg-opacity-10 text-[length:var(--text-sm)] text-[var(--danger-fg)]">
              {tAccount("confirmHint")}
            </div>
            <div>
              <label htmlFor="account-delete-input" className={labelClass}>
                {tAccount("confirmLabel")}
              </label>
              <input
                id="account-delete-input"
                type="email"
                value={accountDeleteInput}
                onChange={(e) => setAccountDeleteInput(e.target.value)}
                className={inputClass}
                placeholder={tAccount("confirmPlaceholder")}
                autoComplete="off"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleDeleteAccount}
                disabled={accountDeleting || !accountDeleteInput.includes("@")}
                className="h-9 px-4 bg-[var(--danger)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] flex items-center gap-1.5"
              >
                {accountDeleting && <Loader2 size={15} className="animate-spin" />}
                {tAccount("confirm")}
              </button>
              <button
                onClick={() => {
                  setAccountDeleteOpen(false);
                  setAccountDeleteInput("");
                }}
                className="h-9 px-4 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
              >
                {tAccount("cancel")}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
