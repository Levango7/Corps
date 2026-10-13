"use client";

/**
 * FileManagerPage · 云盘页面容器（/[locale]/w/[wid]/files）
 *
 * ADR-015 接线：把 `components/files/**` 里登记为"待接线"的组件挂到**已在运行**的
 * 文件 API 上——
 *   GET    /api/v1/workspaces/{wid}/files            列表（分页信封）
 *   DELETE /api/v1/workspaces/{wid}/files/{fid}      删除
 *   POST   /api/v1/workspaces/{wid}/files/upload     上传（FileUploader 内部处理）
 *
 * 预览走「统一入口」路线（FilePreviewDialog → FilePreview，按扩展名分发到
 * PdfPreview / VideoPreview / TextPreview 等）。ADR-015 §2 的另一条 `previews/*`
 * 路线（含 Code/Markdown/Office 独有能力）**保留待接线**，本次不接——
 * 避免两套预览同时出现在链路上（选型理由见 ADR-015 状态段）。
 *
 * MVP 边界（如实声明）：
 *  - 只做根目录：FileAsset.folderId 存在，但库里没有 Folder 模型，无目录树可导航。
 *  - 列表一次拉 100 条（列表 API 的 limit 上限），不做翻页 UI；超出后由后续迭代补。
 */

import { useCallback, useEffect, useState } from "react";
import type { FileAsset } from "@prisma/client";
import { useTranslations } from "next-intl";
import { api, apiList } from "@/lib/api";
import { useToast } from "@/components/Toast";
import { FileBrowser } from "@/components/files/FileBrowser";
import { FilePreviewDialog } from "@/components/files/FilePreviewDialog";
import { ConfirmDialog } from "@/components/task/ConfirmDialog";

/** 列表一次拉取的上限（与 files/route.ts 的 zod limit 上限 100 对齐） */
const LIST_LIMIT = 100;

export function FileManagerPage({ wid }: { wid: string }) {
  const t = useTranslations("files");
  const { toast } = useToast();

  const [files, setFiles] = useState<FileAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [previewFile, setPreviewFile] = useState<FileAsset | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileAsset | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      setFiles(await apiList<FileAsset>(`/api/v1/workspaces/${wid}/files?limit=${LIST_LIMIT}`));
    } catch {
      // 失败不清空已有列表：上传后刷新失败时，旧列表比空白页更接近事实
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [wid]);

  useEffect(() => {
    void load();
  }, [load]);

  // FileBrowser 的 onFileDelete 只给 fileId；删除确认弹窗要显示文件名，需要完整对象
  const requestDelete = useCallback(
    (fileId: string) => {
      setDeleteTarget(files.find((f) => f.id === fileId) ?? null);
    },
    [files],
  );

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api(`/api/v1/workspaces/${wid}/files/${deleteTarget.id}`, { method: "DELETE" });
      setFiles((prev) => prev.filter((f) => f.id !== deleteTarget.id));
      toast("success", t("page.deleteDone"));
    } catch {
      toast("error", t("page.deleteFailed"));
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, wid, toast, t]);

  const previewProps = previewFile
    ? {
        url: `/api/v1/workspaces/${wid}/files/${previewFile.id}/download`,
        fileName: previewFile.fileName,
        // FilePreview 按扩展名分发（pdf/office/图片/视频/音频/文本），取末段扩展名
        fileType: previewFile.fileName.split(".").pop()?.toLowerCase() ?? "",
        onClose: () => setPreviewFile(null),
      }
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-[var(--space-2)] px-[var(--space-4)] py-[var(--space-3)] border-b border-[var(--border)] bg-[var(--surface)]">
        <h1 className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)]">
          {t("page.title")}
        </h1>
        {!loading && (
          <span className="text-[length:var(--text-sm)] text-[var(--fg-2)]">
            {t("page.count", { count: files.length })}
          </span>
        )}
      </header>

      <div className="flex-1 min-h-0">
        {loading ? (
          <div className="flex h-full items-center justify-center text-[length:var(--text-sm)] text-[var(--fg-2)]">
            {t("page.loading")}
          </div>
        ) : loadFailed && files.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-[var(--space-3)]">
            <p className="text-[length:var(--text-sm)] text-[var(--fg-2)]">
              {t("page.loadFailed")}
            </p>
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center h-8 px-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none"
            >
              {t("page.retry")}
            </button>
          </div>
        ) : (
          <FileBrowser
            files={files}
            workspaceId={wid}
            onFileClick={setPreviewFile}
            onFileDelete={requestDelete}
            onUploadComplete={load}
          />
        )}
      </div>

      {previewProps && <FilePreviewDialog open file={previewProps} />}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
        deleting={deleting}
        labels={{
          aria: t("page.deleteConfirmAria"),
          title: t("page.deleteConfirmTitle"),
          description: t("page.deleteConfirmBody", { name: deleteTarget?.fileName ?? "" }),
          confirm: t("page.deleteConfirm"),
          cancel: t("page.deleteCancel"),
        }}
      />
    </div>
  );
}
