"use client";

/**
 * FileUploader · 拖拽上传组件（Phase 4B 云盘）
 *
 * 支持拖拽上传 + 点击上传，显示每个文件的真实上传进度（XHR progress 事件）。
 * compact 模式渲染为内联按钮（工具栏用），非 compact 渲染为拖拽区域。
 *
 * API: POST /api/v1/workspaces/${workspaceId}/files/upload (multipart/form-data)
 *   - field "file": File 对象（后端校验大小 ≤ 50MB + MIME 白名单）
 *   - field "folderId": 可选文件夹 ID
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 * 图标：lucide-react，尺寸 14。
 * 动效：transition 用 var(--motion-fast/base)，motion-reduce 时禁用。
 */

import {
  useState,
  useRef,
  useCallback,
  type DragEvent,
  type ChangeEvent,
} from "react";
import { UploadCloud, X, Check, AlertCircle, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

// ─── 类型定义 ──────────────────────────────────────────────────

export interface FileUploaderProps {
  workspaceId: string;
  folderId?: string;
  onUploadComplete?: () => void;
  compact?: boolean;
}

interface UploadTask {
  id: string;
  fileName: string;
  fileSize: number;
  progress: number; // 0-100
  status: "uploading" | "done" | "error";
  error?: string;
}

// ─── 辅助函数 ──────────────────────────────────────────────────

/** 文件大小格式化（与 FileListItem 一致，避免循环依赖） */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** 生成简易唯一 ID（不依赖 crypto.randomUUID 以兼容非安全上下文） */
function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** 允许的文件扩展名（与后端 ALLOWED_TYPES 对齐，用于文件选择器过滤） */
const ACCEPT_ATTR =
  ".png,.jpg,.jpeg,.gif,.webp,.svg,.pdf,.docx,.xlsx,.pptx,.mp4,.webm,.mp3,.wav,.js,.ts,.py,.go,.md,.json,.txt";

// ─── 样式常量 ──────────────────────────────────────────────────

/** compact 模式按钮样式 */
const COMPACT_BTN =
  "inline-flex items-center gap-1.5 h-8 px-2.5 rounded-[var(--radius-sm)] " +
  "text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] " +
  "border border-[var(--border)] bg-[var(--surface)] text-[var(--fg-2)] " +
  "transition-colors duration-[var(--motion-base)] motion-reduce:transition-none " +
  "hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-[var(--focus-ring)] " +
  "cursor-pointer";

// ─── 组件 ────────────────────────────────────────────────────────

export function FileUploader({
  workspaceId,
  folderId,
  onUploadComplete,
  compact = false,
}: FileUploaderProps) {
  const t = useTranslations("files.fileUploader");
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ─── 单文件上传（XHR 获取真实进度）──────────────────────────

  const uploadOne = useCallback(
    (file: File, taskId: string): Promise<void> => {
      return new Promise((resolve) => {
        const url = `/api/v1/workspaces/${workspaceId}/files/upload`;
        const formData = new FormData();
        formData.append("file", file);
        if (folderId) formData.append("folderId", folderId);

        const xhr = new XMLHttpRequest();

        // 上传进度
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const progress = (e.loaded / e.total) * 100;
            setTasks((prev) =>
              prev.map((t) => (t.id === taskId ? { ...t, progress } : t)),
            );
          }
        };

        // 上传完成
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            setTasks((prev) =>
              prev.map((t) =>
                t.id === taskId ? { ...t, status: "done", progress: 100 } : t,
              ),
            );
          } else {
            let error = t("uploadFailed");
            try {
              const r = JSON.parse(xhr.responseText);
              if (typeof r.message === "string") error = r.message;
            } catch {
              // 响应非 JSON，使用默认错误消息
            }
            setTasks((prev) =>
              prev.map((t) =>
                t.id === taskId ? { ...t, status: "error", error } : t,
              ),
            );
          }
          resolve();
        };

        // 网络错误
        xhr.onerror = () => {
          setTasks((prev) =>
            prev.map((t2) =>
              t2.id === taskId ? { ...t2, status: "error", error: t("networkError") } : t2,
            ),
          );
          resolve();
        };

        xhr.open("POST", url);
        xhr.send(formData);
      });
    },
    [workspaceId, folderId, t],
  );

  // ─── 处理文件列表 ────────────────────────────────────────────

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      // 创建上传任务
      const newTasks: UploadTask[] = files.map((f) => ({
        id: genId(),
        fileName: f.name,
        fileSize: f.size,
        progress: 0,
        status: "uploading",
      }));
      setTasks((prev) => [...prev, ...newTasks]);

      // 并行上传，等待全部完成
      await Promise.all(
        files.map((file, i) => uploadOne(file, newTasks[i].id)),
      );

      // 全部完成，通知父组件刷新列表
      onUploadComplete?.();
    },
    [uploadOne, onUploadComplete],
  );

  // ─── 事件处理 ────────────────────────────────────────────────

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    void handleFiles(files);
    // 重置 input value 以便重复选择同一文件
    e.target.value = "";
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    void handleFiles(files);
  };

  const triggerFileInput = () => {
    inputRef.current?.click();
  };

  const removeTask = (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  };

  // ─── 渲染 ────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-2">
      {/* 隐藏的文件输入 */}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        onChange={handleInputChange}
        className="sr-only"
        aria-hidden="true"
      />

      {/* 上传触发区：compact 按钮 / 拖拽区域 */}
      {compact ? (
        <button type="button" onClick={triggerFileInput} className={COMPACT_BTN}>
          <UploadCloud size={14} />
          <span>{t("upload")}</span>
        </button>
      ) : (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={triggerFileInput}
          role="button"
          tabIndex={0}
          aria-label={t("dropAria")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              triggerFileInput();
            }
          }}
          className={
            "flex flex-col items-center justify-center gap-2 px-4 py-8 " +
            "rounded-[var(--radius-md)] border-2 border-dashed " +
            "transition-colors duration-[var(--motion-base)] motion-reduce:transition-none " +
            "cursor-pointer focus-visible:outline-none focus-visible:ring-[var(--focus-ring)] " +
            (isDragging
              ? "border-[var(--accent)] bg-[var(--surface-2)]"
              : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)] hover:bg-[var(--surface-2)]")
          }
        >
          <UploadCloud
            size={24}
            className={isDragging ? "text-[var(--accent)]" : "text-[var(--muted)]"}
          />
          <p className="text-[length:var(--text-sm)] text-[var(--fg-2)]">
            {isDragging ? t("releaseToUpload") : t("clickOrDrop")}
          </p>
          <p className="text-[length:var(--text-xs)] text-[var(--meta)]">
            {t("hint")}
          </p>
        </div>
      )}

      {/* 上传进度列表 */}
      {tasks.length > 0 && (
        <ul className="flex flex-col gap-1 list-none p-0 m-0">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-[var(--radius-sm)] bg-[var(--surface-2)]"
            >
              {/* 状态图标 */}
              {task.status === "uploading" && (
                <Loader2
                  size={14}
                  className="shrink-0 text-[var(--accent)] animate-spin motion-reduce:[animation:none]"
                />
              )}
              {task.status === "done" && (
                <Check size={14} className="shrink-0 text-[var(--success)]" />
              )}
              {task.status === "error" && (
                <AlertCircle size={14} className="shrink-0 text-[var(--danger)]" />
              )}

              {/* 文件名 + 进度条 */}
              <div className="flex-1 min-w-0 flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[length:var(--text-xs)] text-[var(--fg-2)]">
                    {task.fileName}
                  </span>
                  <span className="shrink-0 text-[length:var(--text-xs)] text-[var(--meta)] tabular-nums">
                    {task.status === "error"
                      ? task.error ?? t("error")
                      : task.status === "done"
                        ? formatFileSize(task.fileSize)
                        : `${Math.round(task.progress)}%`}
                  </span>
                </div>
                {/* 进度条 */}
                <div className="h-1 rounded-[var(--radius-pill)] bg-[var(--surface-3)] overflow-hidden">
                  <div
                    className={
                      "h-full rounded-[var(--radius-pill)] transition-all duration-[var(--motion-fast)] motion-reduce:transition-none " +
                      (task.status === "error"
                        ? "bg-[var(--danger)]"
                        : task.status === "done"
                          ? "bg-[var(--success)]"
                          : "bg-[var(--accent)]")
                    }
                    style={{
                      width: `${task.status === "error" ? 100 : task.progress}%`,
                    }}
                  />
                </div>
              </div>

              {/* 关闭按钮（done/error 时显示） */}
              {task.status !== "uploading" && (
                <button
                  type="button"
                  aria-label={t("removeAria")}
                  onClick={() => removeTask(task.id)}
                  className="shrink-0 w-5 h-5 inline-flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--meta)] hover:bg-[var(--surface-3)] hover:text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-[var(--focus-ring)]"
                >
                  <X size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}