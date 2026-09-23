"use client";

/**
 * 审批列表页客户端包装。
 *
 * 职责：渲染 ApprovalList + 顶部操作栏（发起审批 + 模板管理入口）
 * + ApprovalSubmit 弹窗 + ApprovalTemplateManage 全屏覆盖。
 *
 * 发起审批成功后通过 key 重建 ApprovalList 刷新数据。
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Settings, UserCog, X } from "lucide-react";
import { ApprovalList } from "./ApprovalList";
import { ApprovalSubmit } from "./ApprovalSubmit";
import { ApprovalTemplateManage } from "./ApprovalTemplateManage";
import { ApprovalDelegateSettings } from "./ApprovalDelegateSettings";

interface ApprovalListPageClientProps {
  workspaceId: string;
}

export function ApprovalListPageClient({
  workspaceId,
}: ApprovalListPageClientProps) {
  const t = useTranslations("approval");
  const [submitOpen, setSubmitOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [delegateOpen, setDelegateOpen] = useState(false);
  // refreshKey：发起审批成功后递增，触发 ApprovalList 重建刷新数据
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="relative">
      {/* 顶部操作栏 */}
      <div className="max-w-[var(--container-max)] mx-auto px-[var(--space-4)] pt-[var(--space-4)] flex items-center justify-end gap-2 flex-wrap">
        <button
          onClick={() => setTemplateOpen(true)}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[var(--fg-2)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
        >
          <Settings size={14} />
          {t("templateManage")}
        </button>
        <button
          onClick={() => setDelegateOpen(true)}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[var(--fg-2)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
        >
          <UserCog size={14} />
          {t("delegateSettings")}
        </button>
        <button
          onClick={() => setSubmitOpen(true)}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)]"
        >
          <Plus size={14} />
          {t("submit")}
        </button>
      </div>

      {/* 审批列表（key 重建刷新） */}
      <ApprovalList key={refreshKey} workspaceId={workspaceId} />

      {/* 发起审批弹窗 */}
      {submitOpen && (
        <ApprovalSubmit
          workspaceId={workspaceId}
          onClose={() => setSubmitOpen(false)}
          onSubmitted={() => setRefreshKey((k) => k + 1)}
        />
      )}

      {/* 模板管理全屏覆盖 */}
      {templateOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[var(--z-modal)] overflow-y-auto bg-[var(--bg)]"
        >
          <button
            onClick={() => setTemplateOpen(false)}
            className="fixed top-[var(--space-4)] right-[var(--space-4)] z-10 inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[var(--fg-2)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] shadow-[var(--elev-sm)]"
            aria-label={t("close")}
          >
            <X size={14} />
            {t("close")}
          </button>
          <ApprovalTemplateManage workspaceId={workspaceId} />
        </div>
      )}

      {/* 委托设置全屏覆盖 */}
      {delegateOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[var(--z-modal)] overflow-y-auto bg-[var(--bg)]"
        >
          <button
            onClick={() => setDelegateOpen(false)}
            className="fixed top-[var(--space-4)] right-[var(--space-4)] z-10 inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[var(--fg-2)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] shadow-[var(--elev-sm)]"
            aria-label={t("close")}
          >
            <X size={14} />
            {t("close")}
          </button>
          <ApprovalDelegateSettings workspaceId={workspaceId} />
        </div>
      )}
    </div>
  );
}

export default ApprovalListPageClient;
