"use client";

/**
 * FileVersionList · 云盘文件版本历史列表（Phase 4D §文件版本管理 UI）
 *
 * 功能：
 *  - 版本列表：每行显示版本号、变更说明、时间、上传者
 *  - 当前版本：实心圆点（●）+ "当前版本" 标签
 *  - 非当前版本：空心圆点（○）+ "回滚到此版本" 按钮
 *  - 版本按版本号倒序排列（最新在上）
 *  - loading 状态：spinner
 *  - 空状态："暂无版本历史"
 *
 * Design token 规范：所有色值/间距/圆角/字号走 var(--*)，禁止裸 hex。
 * 图标：lucide-react，尺寸 14。
 * 动效：transition 用 var(--motion-fast)，motion-reduce 时禁用；
 *       prefers-reduced-motion 全局降级块已在 globals.css 中处理。
 * 来源：经验 2026-09-11-prefers-reduced-motion-global-block-and-max-duration
 */

import { useMemo } from "react";
import { History, RotateCcw, Check, Loader2 } from "lucide-react";
import type { FileAsset, FileVersion } from "@prisma/client";

// ── Props ──────────────────────────────────────────────────────

export interface FileVersionListProps {
  file: FileAsset;
  versions: FileVersion[]; // 从 API 获取的版本列表
  currentVersion: number; // 当前版本号
  onRestore?: (versionId: string) => void; // 回滚到指定版本
  loading?: boolean;
}

// ── 辅助函数 ──────────────────────────────────────────────────

/**
 * 时间格式化：YYYY-MM-DD HH:mm
 * 用原生 Date API，避免引入 dayjs 等依赖。
 */
function formatDateTime(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

/**
 * 上传者显示：用户名或 ID（简化）。
 * FileVersion.uploadedBy 是 User.id（UUID），简化显示前 8 位；
 * null 表示上传者已注销（onDelete: SetNull），显示"未知"。
 */
function uploaderLabel(uploadedBy: string | null): string {
  if (!uploadedBy) return "未知";
  // UUID 取前 8 位作为简化标识
  return uploadedBy.slice(0, 8);
}

// ── 样式常量 ──────────────────────────────────────────────────

/** 回滚按钮基础样式 */
const RESTORE_BTN =
  "inline-flex items-center gap-1 h-7 px-2 rounded-[var(--radius-sm)] " +
  "text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] " +
  "border border-[var(--border)] bg-[var(--surface)] text-[var(--fg-2)] " +
  "transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none " +
  "hover:bg-[var(--surface-2)] hover:text-[var(--accent)] " +
  "focus-visible:outline-none focus-visible:ring-[var(--focus-ring)] cursor-pointer";

// ── 主组件 ──────────────────────────────────────────────────────

export function FileVersionList({
  file,
  versions,
  currentVersion,
  onRestore,
  loading,
}: FileVersionListProps) {
  // 版本按版本号倒序排列（最新在上）
  const sortedVersions = useMemo(
    () => [...versions].sort((a, b) => b.version - a.version),
    [versions],
  );

  // ── 渲染：loading 状态 ──
  if (loading) {
    return (
      <section
        className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]"
        data-testid="file-version-list"
        aria-busy="true"
      >
        <header className="flex items-center gap-2 px-[var(--space-4)] py-[var(--space-3)] border-b border-[var(--border)]">
          <History size={14} className="text-[var(--muted)]" />
          <h3 className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            版本历史
          </h3>
        </header>
        <div className="flex items-center justify-center py-[var(--space-10)] text-[var(--muted)]">
          <Loader2 size={14} className="animate-spin mr-2" />
          <span className="text-[length:var(--text-sm)]">加载中…</span>
        </div>
      </section>
    );
  }

  // ── 渲染：主界面 ──
  return (
    <section
      className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]"
      data-testid="file-version-list"
      aria-label={`${file.fileName} 版本历史`}
    >
      {/* 头部 */}
      <header className="flex items-center gap-2 px-[var(--space-4)] py-[var(--space-3)] border-b border-[var(--border)]">
        <History size={14} className="text-[var(--muted)]" />
        <h3 className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          版本历史
        </h3>
        <span className="ml-auto text-[length:var(--text-xs)] text-[var(--meta)]">
          共 {sortedVersions.length} 个版本
        </span>
      </header>

      {/* 版本列表 / 空状态 */}
      {sortedVersions.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center px-[var(--space-4)] py-[var(--space-10)]">
          <History
            size={28}
            className="text-[var(--meta)] opacity-50 mb-[var(--space-2)]"
            aria-hidden="true"
          />
          <p className="text-[length:var(--text-sm)] text-[var(--muted)]">
            暂无版本历史
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border-soft)]">
          {sortedVersions.map((v) => {
            const isCurrent = v.version === currentVersion;
            return (
              <li
                key={v.id}
                className="flex items-center gap-[var(--space-3)] px-[var(--space-4)] py-[var(--space-3)] transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none hover:bg-[var(--surface-2)]"
              >
                {/* 圆点：当前版本实心 ●，其他空心 ○ */}
                <span
                  className={
                    "shrink-0 w-2.5 h-2.5 rounded-full border-2 " +
                    (isCurrent
                      ? "border-[var(--accent)] bg-[var(--accent)]"
                      : "border-[var(--border)] bg-[var(--surface)]")
                  }
                  aria-hidden="true"
                />

                {/* 版本号 */}
                <span className="shrink-0 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                  v{v.version}
                </span>

                {/* 变更说明 / 当前版本标签 */}
                <span className="min-w-0 flex-1 truncate text-[length:var(--text-sm)] text-[var(--fg-2)]">
                  {isCurrent ? (
                    <span className="inline-flex items-center gap-1 text-[var(--accent)]">
                      <Check size={14} aria-hidden="true" />
                      当前版本
                    </span>
                  ) : (
                    v.message || "—"
                  )}
                </span>

                {/* 时间 */}
                <time
                  className="shrink-0 text-[length:var(--text-xs)] text-[var(--meta)] tabular-nums"
                  dateTime={v.createdAt.toISOString()}
                >
                  {formatDateTime(v.createdAt)}
                </time>

                {/* 上传者 */}
                <span className="shrink-0 text-[length:var(--text-xs)] text-[var(--muted)]">
                  {uploaderLabel(v.uploadedBy)}
                </span>

                {/* 操作：非当前版本且提供 onRestore 时显示回滚按钮 */}
                {!isCurrent && onRestore && (
                  <button
                    type="button"
                    onClick={() => onRestore(v.id)}
                    className={"shrink-0 " + RESTORE_BTN}
                    aria-label={`回滚到 v${v.version}`}
                  >
                    <RotateCcw size={14} aria-hidden="true" />
                    回滚到此版本
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}