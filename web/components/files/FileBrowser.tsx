"use client";

/**
 * FileBrowser · 文件浏览器主容器（Phase 4B 云盘）
 *
 * 负责文件列表/网格视图切换、搜索筛选、选中状态管理、集成上传区域。
 * 顶部工具栏：搜索框 + 视图切换按钮 + 上传按钮（compact FileUploader）。
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 * 图标：lucide-react，尺寸 14。
 * 动效：transition 用 var(--motion-base)，motion-reduce 时禁用。
 */

import { useState, useMemo, useCallback } from "react";
import type { FileAsset } from "@prisma/client";
import { Search, List, LayoutGrid } from "lucide-react";
import { FileListItem } from "./FileListItem";
import { FileGridItem } from "./FileGridItem";
import { FileUploader } from "./FileUploader";
import EmptyState from "@/components/EmptyState";

// ─── Props ──────────────────────────────────────────────────────

export interface FileBrowserProps {
  files: FileAsset[];
  /** 当前文件夹 ID（传给 FileUploader） */
  currentFolderId?: string;
  /** 工作区 ID（传给 FileUploader；未提供时不渲染上传按钮） */
  workspaceId?: string;
  /** 初始视图模式，默认 "list" */
  viewMode?: "list" | "grid";
  onFileClick?: (file: FileAsset) => void;
  onFileDelete?: (fileId: string) => void;
  onFileMove?: (fileId: string, targetFolderId: string) => void;
  onUploadComplete?: () => void;
}

// ─── 样式常量 ──────────────────────────────────────────────────

/** 工具栏图标按钮基础样式 */
const TOOL_BTN =
  "inline-flex items-center justify-center w-8 h-8 rounded-[var(--radius-sm)] " +
  "border border-[var(--border)] bg-[var(--surface)] text-[var(--fg-2)] " +
  "transition-colors duration-[var(--motion-base)] motion-reduce:transition-none " +
  "hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-[var(--focus-ring)] " +
  "cursor-pointer";

/** 工具栏按钮激活态 */
const TOOL_BTN_ACTIVE =
  "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-soft-fg)]";

// ─── 组件 ────────────────────────────────────────────────────────

export function FileBrowser({
  files,
  currentFolderId,
  workspaceId,
  viewMode = "list",
  onFileClick,
  onFileDelete,
  onUploadComplete,
}: FileBrowserProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [currentView, setCurrentView] = useState<"list" | "grid">(viewMode);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ─── 搜索过滤 ────────────────────────────────────────────────

  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) return files;
    const q = searchQuery.toLowerCase();
    return files.filter((f) => f.fileName.toLowerCase().includes(q));
  }, [files, searchQuery]);

  // ─── 选中状态管理 ────────────────────────────────────────────

  const toggleSelect = useCallback((fileId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  }, []);

  const handleDelete = useCallback(
    (fileId: string) => {
      // 同步从选中集合中移除
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(fileId);
        return next;
      });
      onFileDelete?.(fileId);
    },
    [onFileDelete],
  );

  // ─── 派生状态 ────────────────────────────────────────────────

  const isFilteredEmpty = filteredFiles.length === 0;
  const isSearchActive = searchQuery.trim().length > 0;

  // ─── 渲染 ────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col h-full bg-[var(--bg)]"
      data-testid="file-browser"
    >
      {/* ─── 顶部工具栏 ─── */}
      <header className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)]">
        {/* 搜索框 */}
        <div className="relative flex-1 min-w-[160px] max-w-[300px]">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--meta)] pointer-events-none"
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索文件..."
            aria-label="搜索文件"
            className="w-full h-8 pl-8 pr-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] placeholder:text-[var(--meta)] focus-visible:outline-none focus-visible:ring-[var(--focus-ring)] transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none"
          />
        </div>

        {/* 右侧：视图切换 + 上传 */}
        <div className="flex items-center gap-1 ml-auto">
          {/* 视图切换 */}
          <div
            className="flex items-center gap-1"
            role="group"
            aria-label="视图切换"
          >
            <button
              type="button"
              onClick={() => setCurrentView("list")}
              aria-pressed={currentView === "list"}
              aria-label="列表视图"
              className={`${TOOL_BTN} ${currentView === "list" ? TOOL_BTN_ACTIVE : ""}`}
            >
              <List size={14} />
            </button>
            <button
              type="button"
              onClick={() => setCurrentView("grid")}
              aria-pressed={currentView === "grid"}
              aria-label="网格视图"
              className={`${TOOL_BTN} ${currentView === "grid" ? TOOL_BTN_ACTIVE : ""}`}
            >
              <LayoutGrid size={14} />
            </button>
          </div>

          {/* 上传按钮（compact FileUploader） */}
          {workspaceId && (
            <FileUploader
              workspaceId={workspaceId}
              folderId={currentFolderId}
              onUploadComplete={onUploadComplete}
              compact
            />
          )}
        </div>
      </header>

      {/* ─── 内容区 ─── */}
      <main className="flex-1 min-h-0 overflow-auto">
        {isFilteredEmpty ? (
          isSearchActive ? (
            <EmptyState
              type="search"
              title="未找到匹配文件"
              description={`没有名称包含 "${searchQuery.trim()}" 的文件`}
            />
          ) : (
            <EmptyState
              type="folder"
              title="暂无文件"
              description="拖拽文件到上传区域，或点击上传按钮添加文件"
            />
          )
        ) : currentView === "list" ? (
          /* 列表视图 */
          <div role="table" className="flex flex-col">
            {filteredFiles.map((file) => (
              <FileListItem
                key={file.id}
                file={file}
                selected={selectedIds.has(file.id)}
                onClick={() => onFileClick?.(file)}
                onSelect={() => toggleSelect(file.id)}
                onDelete={
                  onFileDelete ? () => handleDelete(file.id) : undefined
                }
              />
            ))}
          </div>
        ) : (
          /* 网格视图 */
          <div
            role="grid"
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 p-4"
          >
            {filteredFiles.map((file) => (
              <FileGridItem
                key={file.id}
                file={file}
                selected={selectedIds.has(file.id)}
                onClick={() => onFileClick?.(file)}
                onSelect={() => toggleSelect(file.id)}
                onDelete={
                  onFileDelete ? () => handleDelete(file.id) : undefined
                }
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}