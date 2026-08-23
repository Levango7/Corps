"use client";

import { use, useCallback, useEffect, useState } from "react";
import { Settings as SettingsIcon, Check, Loader2, AlertTriangle, Sun, Moon, Monitor } from "lucide-react";
import { api } from "@/lib/api";

type Role = "owner" | "admin" | "member";
type ThemePref = "light" | "dark" | "system";

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

const THEMES: { id: ThemePref; label: string; icon: typeof Sun }[] = [
  { id: "light", label: "浅色", icon: Sun },
  { id: "dark", label: "深色", icon: Moon },
  { id: "system", label: "跟随系统", icon: Monitor },
];

function applyTheme(pref: ThemePref) {
  const resolved =
    pref === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : pref;
  document.documentElement.setAttribute("data-theme", resolved);
  localStorage.setItem("corps_theme", pref);
}

export default function SettingsPage({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = use(params);
  const [ws, setWs] = useState<Workspace | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [theme, setTheme] = useState<ThemePref>("system");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  // 个人资料
  const [userName, setUserName] = useState("");
  const [userImage, setUserImage] = useState("");
  const [userInitial, setUserInitial] = useState<{ name: string | null; image: string | null } | null>(null);
  const [userBusy, setUserBusy] = useState(false);
  const [userSaved, setUserSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<Workspace>(`/api/v1/workspaces/${wid}`);
      setWs(data);
      setName(data.name);
      setSlug(data.slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  }, [wid]);

  useEffect(() => {
    load();
    const stored = (localStorage.getItem("corps_theme") as ThemePref | null) ?? "system";
    setTheme(stored);
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
      setError(e instanceof Error ? e.message : "保存失败");
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
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  function pickTheme(t: ThemePref) {
    setTheme(t);
    applyTheme(t);
  }

  const canEdit = ws ? ["owner", "admin"].includes(ws.role) : false;
  const dirty = ws ? name.trim() !== ws.name || slug.trim() !== ws.slug : false;
  const userDirty =
    userInitial !== null &&
    (userName.trim() !== (userInitial.name ?? "") || userImage.trim() !== (userInitial.image ?? ""));

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
          设置
        </h1>
        <p className="mt-1 text-[length:var(--text-sm)] text-[var(--muted)]">
          工作区基础信息与个人显示偏好。
        </p>
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
          个人资料
        </h2>

        <div className="space-y-4">
          <div>
            <label htmlFor="user-name" className={labelClass}>
              姓名
            </label>
            <input
              id="user-name"
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              className={inputClass}
              placeholder="你的显示名称"
            />
          </div>

          <div>
            <label htmlFor="user-image" className={labelClass}>
              头像 URL
            </label>
            <input
              id="user-image"
              type="url"
              value={userImage}
              onChange={(e) => setUserImage(e.target.value)}
              className={inputClass}
              placeholder="https://..."
            />
            {userImage.trim() && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={userImage.trim()}
                className="mt-2 w-16 h-16 rounded-full border border-[var(--border)] object-cover"
                alt="头像预览"
              />
            )}
            <p className="mt-1.5 text-[length:var(--text-xs)] text-[var(--meta)]">
              留空则使用姓名首字母作为默认头像。
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
            保存修改
          </button>
          {userSaved && (
            <span className="flex items-center gap-1.5 text-[length:var(--text-sm)] text-[var(--success-fg)]">
              <Check size={15} className="text-[var(--success)]" />
              已保存
            </span>
          )}
        </div>
      </section>

      {/* 工作区 */}
      <section className={`${sectionClass} mt-5`}>
        <h2 className="text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--fg)] mb-4">
          工作区
        </h2>

        <div className="space-y-4">
          <div>
            <label htmlFor="ws-name" className={labelClass}>
              名称
            </label>
            <input
              id="ws-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canEdit}
              className={inputClass}
              placeholder="例如：增长组"
            />
          </div>

          <div>
            <label htmlFor="ws-slug" className={labelClass}>
              标识
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
              仅小写字母、数字与连字符。用于对外引用，全局唯一。
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
              保存修改
            </button>
            {saved && (
              <span className="flex items-center gap-1.5 text-[length:var(--text-sm)] text-[var(--success-fg)]">
                <Check size={15} className="text-[var(--success)]" />
                已保存
              </span>
            )}
          </div>
        )}
        {!canEdit && ws && (
          <p className="mt-4 pt-4 border-t border-[var(--border-soft)] text-[length:var(--text-xs)] text-[var(--meta)]">
            你的角色为「成员」，仅拥有者或管理员可修改工作区信息。
          </p>
        )}
      </section>

      {/* 外观 */}
      <section className={`${sectionClass} mt-5`}>
        <h2 className="text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--fg)] mb-1">
          外观
        </h2>
        <p className="text-[length:var(--text-xs)] text-[var(--meta)] mb-4">
          只影响你自己的浏览器，不改变团队其他成员。
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          {THEMES.map((t) => {
            const Icon = t.icon;
            const active = theme === t.id;
            return (
              <button
                key={t.id}
                onClick={() => pickTheme(t.id)}
                className="w-full sm:flex-1 flex flex-col items-center gap-2 py-3 rounded-[var(--radius-md)] border transition-colors duration-[var(--motion-fast)]"
                style={{
                  borderColor: active ? "var(--accent)" : "var(--border)",
                  background: active ? "var(--accent-soft)" : "var(--surface)",
                  color: active ? "var(--accent)" : "var(--fg-2)",
                }}
              >
                <Icon size={18} />
                <span className="text-[length:var(--text-sm)] font-[var(--weight-medium)]">
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 概况 */}
      {ws && (
        <section className={`${sectionClass} mt-5`}>
          <h2 className="text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--fg)] mb-4">
            概况
          </h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 gap-x-4 text-[length:var(--text-sm)]">
            {[
              ["成员", `${ws.memberCount} 人`],
              ["任务", `${ws.taskCount} 条`],
              ["套餐", ws.plan],
              ["创建于", new Date(ws.createdAt).toLocaleDateString("zh-CN")],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-2">
                <dt className="text-[var(--muted)]">{k}</dt>
                <dd className="text-[var(--fg)] tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 pt-4 border-t border-[var(--border-soft)]">
            <div className="text-[length:var(--text-xs)] text-[var(--meta)] mb-1">工作区 ID</div>
            <code className="font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] text-[var(--fg-2)] break-all">
              {ws.id}
            </code>
          </div>
        </section>
      )}

      {/* 危险操作 */}
      {ws?.role === "owner" && (
        <section className="mt-5 rounded-[var(--radius-lg)] p-4 sm:p-5 border border-[var(--danger)] bg-[var(--danger-soft)]">
          <h2 className="text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--danger-fg)] mb-1">
            危险操作
          </h2>
          <p className="text-[length:var(--text-sm)] text-[var(--danger-fg)] opacity-90">
            删除工作区功能将在后续版本开放。
          </p>
        </section>
      )}
    </div>
  );
}
