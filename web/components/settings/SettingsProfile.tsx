"use client";

// 设置 - 个人资料区：用户名 + 头像 URL + 保存。
// 拆分自 settings/page.tsx 第 457-535 行 + 相关状态/函数。子组件自管状态。

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";

const sectionClass =
  "bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-4 sm:p-5";
const inputClass =
  "w-full h-9 px-3 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 disabled:bg-[var(--surface-2)] disabled:text-[var(--muted)] placeholder:text-[var(--meta)]";
const labelClass =
  "block text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] mb-1.5";

interface SettingsProfileProps {
  onError: (msg: string) => void;
}

export function SettingsProfile({ onError }: SettingsProfileProps) {
  const t = useTranslations("settings");
  const tErr = useTranslations("error");

  const [userName, setUserName] = useState("");
  const [userImage, setUserImage] = useState("");
  const [userInitial, setUserInitial] = useState<{
    name: string | null;
    image: string | null;
  } | null>(null);
  const [userBusy, setUserBusy] = useState(false);
  const [userSaved, setUserSaved] = useState(false);
  const [userImageError, setUserImageError] = useState("");

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
    onError("");
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
      onError(e instanceof Error ? e.message : tErr("saveFailed"));
    } finally {
      setUserBusy(false);
    }
  }

  const userDirty =
    userInitial !== null &&
    (userName.trim() !== (userInitial.name ?? "") ||
      userImage.trim() !== (userInitial.image ?? ""));

  return (
    <section className={sectionClass}>
      <h2 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mb-4">
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
          className="w-full sm:w-auto h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
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
  );
}