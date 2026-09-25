"use client";

// 设置 - 危险操作区：删除工作区（两步确认） + 删除账户（预览 + 邮箱确认）。
// 拆分自 settings/page.tsx 第 881-1068 行 + 相关状态/函数。子组件自管状态。

import { useState } from "react";
import { Trash2, UserX, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/lib/i18n-navigation";
import { api } from "@/lib/api";
import type { DeletionPreview as AccountDeletionPreview } from "@/lib/account-deletion";
import type { Workspace } from "./types";

const inputClass =
  "w-full h-9 px-3 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 disabled:bg-[var(--surface-2)] disabled:text-[var(--muted)] placeholder:text-[var(--meta)]";
const labelClass =
  "block text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] mb-1.5";

interface SettingsDangerZoneProps {
  ws: Workspace | null;
  wid: string;
  onError: (msg: string) => void;
}

export function SettingsDangerZone({ ws, wid, onError }: SettingsDangerZoneProps) {
  const t = useTranslations("settings");
  const tAccount = useTranslations("accountDeletion");

  const tRole = useTranslations("role");
  const router = useRouter();

  // 删除工作区确认流程
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState("");
  const [deleting, setDeleting] = useState(false);

  // 删除账户（阶段 2-3）：预览 + 邮箱确认
  const [accountDeleteOpen, setAccountDeleteOpen] = useState(false);
  const [accountPreview, setAccountPreview] = useState<AccountDeletionPreview | null>(null);
  const [accountPreviewLoading, setAccountPreviewLoading] = useState(false);
  const [accountDeleteInput, setAccountDeleteInput] = useState("");
  const [accountDeleting, setAccountDeleting] = useState(false);

  // 删除工作区（两步确认：勾选确认 + 输入工作区名匹配）
  async function handleDeleteWorkspace() {
    if (!ws || deleting) return;
    if (deleteInput.trim() !== ws.name) {
      onError(t("deleteNameMismatch"));
      return;
    }
    setDeleting(true);
    onError("");
    try {
      await api(`/api/v1/workspaces/${wid}`, { method: "DELETE" });
      // 删除成功后跳转到首页
      router.push("/");
    } catch (e) {
      onError(e instanceof Error ? e.message : t("deleteFailed"));
    } finally {
      setDeleting(false);
    }
  }

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
    onError("");
    try {
      // 请求体带邮箱做服务端二次确认；不匹配服务端拒绝（400）
      await api("/api/v1/users/me/account", {
        method: "DELETE",
        body: JSON.stringify({ confirmEmail: accountDeleteInput.trim() }),
      });
      // 账户已删（cookie 已过期）：整页跳转登录页
      router.push("/auth/login");
    } catch (e) {
      onError(e instanceof Error ? e.message : tAccount("failed"));
      setAccountDeleting(false);
    }
  }

  return (
    <>
      {/* 危险操作（P4：删除工作区两步确认流程） */}
      {ws?.role === "owner" && (
        <section className="mt-5 rounded-[var(--radius-lg)] p-4 sm:p-5 border border-[var(--danger)] bg-[var(--danger-soft)]">
          <h2 className="flex items-center gap-2 text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--danger-fg)] mb-1">
            <Trash2 size={16} />
            {t("dangerTitle")}
          </h2>
          <p className="text-[length:var(--text-sm)] text-[var(--danger-fg)] opacity-90 mb-4">
            {t("dangerHint")}
          </p>

          {!deleteConfirm ? (
            <button
              onClick={() => setDeleteConfirm(true)}
              className="h-9 px-4 border border-[var(--danger)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--danger-fg)] hover:bg-[var(--danger)] hover:text-[var(--accent-fg)] transition-colors duration-[var(--motion-base)] flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
            >
              <Trash2 size={15} />
              {t("deleteInit")}
            </button>
          ) : (
            <div className="space-y-3">
              <div className="p-3 rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] text-[length:var(--text-sm)] text-[var(--danger-fg)]">
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
                  className="h-9 px-4 bg-[var(--danger)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--danger)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
                >
                  {deleting && <Loader2 size={15} className="animate-spin" />}
                  {t("deleteConfirm")}
                </button>
                <button
                  onClick={() => {
                    setDeleteConfirm(false);
                    setDeleteInput("");
                  }}
                  className="h-9 px-4 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
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
        <h2 className="flex items-center gap-2 text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--danger-fg)] mb-1">
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
            className="h-9 px-4 border border-[var(--danger)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--danger-fg)] hover:bg-[var(--danger)] hover:text-[var(--accent-fg)] transition-colors duration-[var(--motion-base)] flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
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
                    <p className="text-[var(--danger-fg)] font-[weight:var(--weight-medium)]">
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
                          · {w.name}（{tRole(w.role)}）
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
            <div className="p-3 rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] text-[length:var(--text-sm)] text-[var(--danger-fg)]">
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
                className="h-9 px-4 bg-[var(--danger)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
              >
                {accountDeleting && <Loader2 size={15} className="animate-spin" />}
                {tAccount("confirm")}
              </button>
              <button
                onClick={() => {
                  setAccountDeleteOpen(false);
                  setAccountDeleteInput("");
                }}
                className="h-9 px-4 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
              >
                {tAccount("cancel")}
              </button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}