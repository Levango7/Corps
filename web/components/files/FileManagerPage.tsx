"use client";

/**
 * FileManagerPage · 云盘页面容器（/[locale]/w/[wid]/files）
 *
 * ADR-015 接线：把 `components/files/**` 里登记为"待接线"的组件挂到**已在运行**的
 * 文件 API 上——
 *   GET    /api/v1/workspaces/{wid}/files                                列表（分页信封）
 *   DELETE /api/v1/workspaces/{wid}/files/{fid}                          删除
 *   POST   /api/v1/workspaces/{wid}/files/upload                         上传（FileUploader 内部处理）
 *   GET    /api/v1/workspaces/{wid}/files/{fid}/versions                 版本历史（分页信封）
 *   POST   /api/v1/workspaces/{wid}/files/{fid}/versions/{vid}/restore   版本回滚
 *
 * 预览走「统一入口」路线（FilePreviewDialog → FilePreview，按扩展名分发到
 * PdfPreview / VideoPreview / TextPreview 等）。ADR-015 §2 的另一条 `previews/*`
 * 路线（含 Code/Markdown/Office 独有能力）**保留待接线**，本次不接——
 * 避免两套预览同时出现在链路上（选型理由见 ADR-015 状态段）。
 *
 * 版本管理（2026-10-14 续接）：行内「版本历史」按钮 → 弹层（FileVersionList）
 * → 回滚确认（FileVersionRestore）→ 成功后**同时**刷新版本列表与文件列表
 * （回滚会改写 FileAsset 的 storageKey/fileSize/currentVersion，行上数据必须跟着变）。
 *
 * MVP 边界（如实声明）：
 *  - 只做根目录：FileAsset.folderId 存在，但库里没有 Folder 模型，无目录树可导航。
 *  - 列表/版本都一次拉 100 条（API limit 上限），不做翻页 UI；超出后由后续迭代补。
 */

import { useCallback, useEffect, useState } from "react";
import type { FileAsset, FileVersion } from "@prisma/client";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { api, apiList } from "@/lib/api";
import { useToast } from "@/components/Toast";
import { FileBrowser } from "@/components/files/FileBrowser";
import { FilePreviewDialog } from "@/components/files/FilePreviewDialog";
import { FileVersionList } from "@/components/files/FileVersionList";
import { FileVersionRestore } from "@/components/files/FileVersionRestore";
import { ConfirmDialog } from "@/components/task/ConfirmDialog";

/** 列表一次拉取的上限（与 files/route.ts 的 zod limit 上限 100 对齐） */
const LIST_LIMIT = 100;

/** versions API 的 wire 形状：createdAt 经 JSON 序列化后是字符串（不是 Prisma 的 Date） */
type WireVersion = Omit<FileVersion, "createdAt"> & { createdAt: string };

export function FileManagerPage({ wid }: { wid: string }) {
  const t = useTranslations("files");
  const { toast } = useToast();

  const [files, setFiles] = useState<FileAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [previewFile, setPreviewFile] = useState<FileAsset | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileAsset | null>(null);
  const [deleting, setDeleting] = useState(false);
  // 版本历史弹层：目标文件 + 列表数据 + 当前版本号（currentVersion 以 versions API 的权威值为准）
  const [versionsTarget, setVersionsTarget] = useState<FileAsset | null>(null);
  const [versions, setVersions] = useState<FileVersion[]>([]);
  const [versionsCurrent, setVersionsCurrent] = useState(1);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<FileVersion | null>(null);
  const [restoring, setRestoring] = useState(false);

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

  // ─── 版本历史（弹层 + 回滚）──────────────────────────────────

  const loadVersions = useCallback(
    async (fileId: string) => {
      setVersionsLoading(true);
      try {
        // wire 形状的 createdAt 是字符串，而 FileVersionList 按 Prisma 的 Date 语义
        // 调 v.createdAt.toISOString()——不转换会在数据到达的瞬间抛 TypeError
        // 把整页打进路由级错误边界（真机走查实测）。
        const d = await api<{ items: WireVersion[]; currentVersion: number }>(
          `/api/v1/workspaces/${wid}/files/${fileId}/versions?limit=${LIST_LIMIT}`,
        );
        setVersions(d.items.map((v) => ({ ...v, createdAt: new Date(v.createdAt) })));
        setVersionsCurrent(d.currentVersion);
      } catch {
        // 拉不到就把弹层整个收掉——一个空壳弹窗比直接提示失败更让人困惑
        toast("error", t("versionList.loadFailed"));
        setVersionsTarget(null);
      } finally {
        setVersionsLoading(false);
      }
    },
    [wid, toast, t],
  );

  const openVersions = useCallback(
    (file: FileAsset) => {
      setVersionsTarget(file);
      setVersions([]);
      // 先用行上的 currentVersion 占位，versions API 返回权威值后覆盖
      setVersionsCurrent(file.currentVersion);
      void loadVersions(file.id);
    },
    [loadVersions],
  );

  const confirmRestore = useCallback(async () => {
    if (!restoreTarget || !versionsTarget) return;
    setRestoring(true);
    try {
      await api(
        `/api/v1/workspaces/${wid}/files/${versionsTarget.id}/versions/${restoreTarget.id}/restore`,
        { method: "POST" },
      );
      toast("success", t("versionList.restoreDone", { version: restoreTarget.version }));
      // 两个列表都要刷：回滚改写的是 FileAsset 本体的 storageKey/fileSize/currentVersion
      await loadVersions(versionsTarget.id);
      await load();
    } catch {
      toast("error", t("versionList.restoreFailed"));
    } finally {
      setRestoring(false);
      setRestoreTarget(null);
    }
  }, [restoreTarget, versionsTarget, wid, toast, t, loadVersions, load]);

  // 版本弹层开着时：ESC 关闭 + 锁背景滚动。
  // 回滚确认弹窗自带 ESC 处理，这里判 !restoreTarget 避免一次按键关掉两层。
  useEffect(() => {
    if (!versionsTarget) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !restoring && !restoreTarget) setVersionsTarget(null);
    };
    window.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [versionsTarget, restoring, restoreTarget]);

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
            onFileVersions={openVersions}
            onUploadComplete={load}
          />
        )}
      </div>

      {previewProps && <FilePreviewDialog open file={previewProps} />}

      {/* 版本历史弹层：FileVersionList 本体是一张卡片，这里补模态壳
          （遮罩/ESC/滚动锁）。关闭按钮放卡片上方而不是叠在卡片右上角——
          卡片头部的「共 N 个版本」就在右上，叠上去会互相遮。 */}
      {versionsTarget && (
        <div
          className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[var(--overlay)] p-[var(--space-4)]"
          role="presentation"
          onClick={() => {
            if (!restoring && !restoreTarget) setVersionsTarget(null);
          }}
        >
          <div
            className="w-full max-w-lg max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-end mb-[var(--space-1)]">
              <button
                type="button"
                aria-label={t("versionList.closeAria")}
                onClick={() => setVersionsTarget(null)}
                className="w-7 h-7 inline-flex items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-[var(--focus-ring)]"
              >
                <X size={14} />
              </button>
            </div>
            <FileVersionList
              file={versionsTarget}
              versions={versions}
              currentVersion={versionsCurrent}
              loading={versionsLoading}
              onRestore={(versionId) => {
                setRestoreTarget(versions.find((v) => v.id === versionId) ?? null);
              }}
            />
          </div>
        </div>
      )}

      {/* 回滚确认（组件自带模态样式） */}
      {restoreTarget && versionsTarget && (
        <FileVersionRestore
          version={restoreTarget.version}
          fileName={versionsTarget.fileName}
          loading={restoring}
          onCancel={() => {
            if (!restoring) setRestoreTarget(null);
          }}
          onConfirm={() => void confirmRestore()}
        />
      )}

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
