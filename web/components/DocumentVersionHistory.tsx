"use client";

/**
 * DocumentVersionHistory · 文档版本历史组件（云文档 Phase 1 §2.3）
 *
 * 功能：
 *  - 版本列表（时间线样式）：每个版本显示版本号、时间、作者、说明
 *  - 点击版本：查看该版本 Markdown 内容
 *  - 回滚按钮：确认对话框 → POST /versions/{vid}/restore
 *  - 版本对比视图：选择两个版本 → GET /versions/compare → 左右分栏 diff
 *  - 手动创建版本：POST /versions（附版本说明）
 *
 * 数据流：useEffect 拉 GET /documents/{id}/versions；
 * 对比/回滚/创建调对应 REST 端点。
 *
 * Design token 规范：所有色值/间距/圆角/字号走 var(--*)。
 * 图标：lucide-react，尺寸 14/16。
 */

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { api, ApiError } from "@/lib/api";
import {
  Check,
  Clock,
  Eye,
  GitCompare,
  History,
  Loader2,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";

// ── 类型定义（对应设计文档 §2.3.2 Prisma schema）──

interface VersionAuthor {
  id: string | null;
  name: string | null;
  email: string;
}

interface DocumentVersion {
  id: string;
  version: number;
  markdown: string;
  message: string | null;
  source: string; // publish | manual | auto | collaborative
  author: VersionAuthor | null;
  createdAt: string;
}

/** 版本对比 diff 结果（对应设计文档 §2.3.3 响应） */
interface VersionDiff {
  from: { version: number; createdAt: string; author: { name: string } | null };
  to: { version: number; createdAt: string; author: { name: string } | null };
  diff: {
    added: string[];
    removed: string[];
    modified: { before: string; after: string; line: number }[];
  };
  stats: { additions: number; deletions: number; modifications: number };
}

// ── 工具函数 ──

/** 相对时间格式化（简单实现，避免引入 dayjs） */
function formatRelative(dateStr: string, locale: string): string {
  const date = new Date(dateStr);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return locale.startsWith("zh") ? "刚刚" : "just now";
  if (diffMin < 60) return locale.startsWith("zh") ? `${diffMin} 分钟前` : `${diffMin}m ago`;
  if (diffHr < 24) return locale.startsWith("zh") ? `${diffHr} 小时前` : `${diffHr}h ago`;
  if (diffDay < 7) return locale.startsWith("zh") ? `${diffDay} 天前` : `${diffDay}d ago`;
  return date.toLocaleDateString(locale.startsWith("zh") ? "zh-CN" : "en-US");
}

/** 版本来源标签映射 */
function sourceLabel(source: string, t: ReturnType<typeof useTranslations>): string {
  switch (source) {
    case "publish":
      return t("sourcePublish");
    case "manual":
      return t("sourceManual");
    case "auto":
      return t("sourceAuto");
    case "collaborative":
      return t("sourceCollab");
    default:
      return source;
  }
}

// ── 主组件 ──

interface DocumentVersionHistoryProps {
  wid: string;
  docId: string;
  onClose: () => void;
}

export function DocumentVersionHistory({ wid, docId, onClose }: DocumentVersionHistoryProps) {
  const t = useTranslations("document");
  const locale = typeof window !== "undefined" ? document.documentElement.lang : "en";

  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 查看版本内容
  const [viewing, setViewing] = useState<DocumentVersion | null>(null);

  // 版本对比
  const [compareMode, setCompareMode] = useState(false);
  const [selectedForCompare, setSelectedForCompare] = useState<number | null>(null); // version number
  const [diffResult, setDiffResult] = useState<VersionDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  // 回滚确认
  const [rollbackTarget, setRollbackTarget] = useState<DocumentVersion | null>(null);
  const [busy, setBusy] = useState(false);

  // 创建版本
  const [creating, setCreating] = useState(false);
  const [createMessage, setCreateMessage] = useState("");

  // ── 加载版本列表 ──
  const loadVersions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api<DocumentVersion[]>(
        `/api/v1/workspaces/${wid}/documents/${docId}/versions`,
      );
      setVersions(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("versionLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [wid, docId, t]);

  useEffect(() => {
    loadVersions();
  }, [loadVersions]);

  // ── 查看版本 ──
  async function viewVersion(v: DocumentVersion) {
    setViewing(v);
  }

  // ── 版本对比 ──
  async function compareVersions(fromVersion: number, toVersion: number) {
    setDiffLoading(true);
    setError("");
    try {
      const data = await api<VersionDiff>(
        `/api/v1/workspaces/${wid}/documents/${docId}/versions/compare?from=${fromVersion}&to=${toVersion}`,
      );
      setDiffResult(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("versionCompareFailed"));
    } finally {
      setDiffLoading(false);
    }
  }

  // ── 回滚 ──
  async function confirmRollback() {
    if (!rollbackTarget || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/v1/workspaces/${wid}/documents/${docId}/versions/${rollbackTarget.id}/restore`, {
        method: "POST",
      });
      setRollbackTarget(null);
      await loadVersions();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("versionRollbackFailed"));
    } finally {
      setBusy(false);
    }
  }

  // ── 创建版本 ──
  async function createVersion(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/v1/workspaces/${wid}/documents/${docId}/versions`, {
        method: "POST",
        body: JSON.stringify({ message: createMessage.trim() || null }),
      });
      setCreateMessage("");
      setCreating(false);
      await loadVersions();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("versionCreateFailed"));
    } finally {
      setBusy(false);
    }
  }

  // ── 对比模式：选择处理 ──
  function handleCompareSelect(v: DocumentVersion) {
    if (selectedForCompare === null) {
      setSelectedForCompare(v.version);
    } else if (selectedForCompare === v.version) {
      setSelectedForCompare(null);
    } else {
      // 已选一个 + 点击另一个 → 执行对比
      const from = Math.min(selectedForCompare, v.version);
      const to = Math.max(selectedForCompare, v.version);
      setSelectedForCompare(null);
      setCompareMode(false);
      compareVersions(from, to);
    }
  }

  // ── 渲染 ──

  return (
    <div className="fixed inset-y-0 right-0 w-[400px] max-w-[90vw] border-l border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-lg)] z-[var(--z-modal)] flex flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-[var(--border)] px-[var(--space-4)] py-[var(--space-3)]">
        <div className="flex items-center gap-2">
          <History size={16} className="text-[var(--muted)]" />
          <h3 className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            {t("versionHistory")}
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-[var(--radius-sm)] text-[var(--meta)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
          aria-label={t("close")}
        >
          <X size={16} />
        </button>
      </div>

      {/* 操作栏 */}
      <div className="flex items-center gap-2 px-[var(--space-4)] py-[var(--space-2)] border-b border-[var(--border-soft)]">
        <button
          type="button"
          onClick={() => setCreating(!creating)}
          disabled={busy}
          className="inline-flex items-center gap-1.5 h-7 px-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-xs)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] disabled:opacity-50"
        >
          <Plus size={14} />
          {t("versionCreate")}
        </button>
        <button
          type="button"
          onClick={() => {
            setCompareMode(!compareMode);
            setSelectedForCompare(null);
          }}
          className={`inline-flex items-center gap-1.5 h-7 px-2 rounded-[var(--radius-sm)] border text-[length:var(--text-xs)] transition-colors duration-[var(--motion-fast)] ${
            compareMode
              ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]"
              : "border-[var(--border)] bg-[var(--surface)] text-[var(--fg-2)] hover:bg-[var(--surface-2)]"
          }`}
        >
          <GitCompare size={14} />
          {t("versionCompare")}
        </button>
        {compareMode && (
          <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
            {selectedForCompare === null ? t("compareSelectFirst") : t("compareSelectSecond")}
          </span>
        )}
      </div>

      {/* 创建版本输入 */}
      {creating && (
        <form
          onSubmit={createVersion}
          className="flex items-center gap-2 px-[var(--space-4)] py-[var(--space-2)] border-b border-[var(--border-soft)]"
        >
          <input
            value={createMessage}
            onChange={(e) => setCreateMessage(e.target.value)}
            placeholder={t("versionMessagePlaceholder")}
            disabled={busy}
            className="flex-1 h-8 px-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:border-[var(--accent)] focus-visible:ring-[var(--focus-ring)] placeholder:text-[var(--meta)]"
          />
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1 h-8 px-3 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)]"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {t("versionCreate")}
          </button>
        </form>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="mx-[var(--space-4)] mt-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-sm)] bg-[var(--danger-soft)] text-[length:var(--text-xs)] text-[var(--danger)]">
          {error}
        </div>
      )}

      {/* 版本列表 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-[var(--space-12)] text-[var(--muted)]">
            <Loader2 size={16} className="animate-spin mr-2" />
            <span className="text-[length:var(--text-sm)]">{t("loading")}</span>
          </div>
        ) : versions.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center px-[var(--space-4)] py-[var(--space-12)]">
            <Clock size={36} className="text-[var(--meta)] opacity-50 mb-[var(--space-3)]" />
            <p className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
              {t("versionEmpty")}
            </p>
            <p className="mt-1 text-[length:var(--text-xs)] text-[var(--meta)]">
              {t("versionEmptyHint")}
            </p>
          </div>
        ) : (
          <ul className="py-[var(--space-2)]">
            {versions.map((v, idx) => (
              <VersionItem
                key={v.id}
                version={v}
                isLatest={idx === 0}
                locale={locale}
                compareMode={compareMode}
                selectedForCompare={selectedForCompare}
                t={t}
                onView={() => viewVersion(v)}
                onCompareSelect={() => handleCompareSelect(v)}
                onRollback={() => setRollbackTarget(v)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* ── 版本内容查看模态 ── */}
      {viewing && (
        <VersionContentModal
          version={viewing}
          locale={locale}
          t={t}
          onClose={() => setViewing(null)}
        />
      )}

      {/* ── 版本对比视图 ── */}
      {diffResult && (
        <VersionDiffModal diff={diffResult} t={t} onClose={() => setDiffResult(null)} />
      )}
      {diffLoading && (
        <div className="fixed inset-0 z-[calc(var(--z-modal)+1)] flex items-center justify-center bg-[var(--bg)]/80">
          <Loader2 size={24} className="animate-spin text-[var(--accent)]" />
        </div>
      )}

      {/* ── 回滚确认对话框 ── */}
      {rollbackTarget && (
        <RollbackConfirmDialog
          version={rollbackTarget}
          t={t}
          busy={busy}
          onConfirm={confirmRollback}
          onCancel={() => setRollbackTarget(null)}
        />
      )}
    </div>
  );
}

// ── 版本列表项（时间线样式）──

function VersionItem({
  version,
  isLatest,
  locale,
  compareMode,
  selectedForCompare,
  t,
  onView,
  onCompareSelect,
  onRollback,
}: {
  version: DocumentVersion;
  isLatest: boolean;
  locale: string;
  compareMode: boolean;
  selectedForCompare: number | null;
  t: ReturnType<typeof useTranslations>;
  onView: () => void;
  onCompareSelect: () => void;
  onRollback: () => void;
}) {
  const isSelected = selectedForCompare === version.version;
  const authorName = version.author?.name || version.author?.email || t("unknownAuthor");

  return (
    <li className="relative">
      {/* 时间线竖线 */}
      {!isLatest && (
        <span className="absolute left-[27px] top-[var(--space-6)] bottom-0 w-px bg-[var(--border-soft)]" />
      )}
      {/* 时间线圆点 */}
      <span
        className={`absolute left-[22px] top-[var(--space-3)] w-2.5 h-2.5 rounded-full border-2 ${
          isLatest
            ? "border-[var(--accent)] bg-[var(--accent)]"
            : "border-[var(--border)] bg-[var(--surface)]"
        }`}
      />

      <div
        className={`ml-[44px] mr-[var(--space-4)] py-[var(--space-3)] border-b border-[var(--border-soft)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] ${
          isSelected ? "bg-[var(--accent-soft)]" : ""
        }`}
        onClick={compareMode ? onCompareSelect : undefined}
        role={compareMode ? "button" : undefined}
      >
        {/* 版本号 + 时间 */}
        <div className="flex items-center justify-between">
          <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
            v{version.version}
            {isLatest && (
              <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--accent-soft)] text-[length:var(--text-xs)] text-[var(--accent)]">
                {t("versionLatest")}
              </span>
            )}
          </span>
          <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
            {formatRelative(version.createdAt, locale)}
          </span>
        </div>

        {/* 作者 + 说明 */}
        <p className="mt-1 text-[length:var(--text-xs)] text-[var(--muted)]">
          {authorName} · {version.message || t("versionNoMessage")}
        </p>

        {/* 来源标签 */}
        <span className="mt-1 inline-block px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--surface-2)] text-[length:var(--text-xs)] text-[var(--meta)]">
          {sourceLabel(version.source, t)}
        </span>

        {/* 操作按钮（非对比模式） */}
        {!compareMode && (
          <div className="mt-[var(--space-2)] flex gap-[var(--space-2)]">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onView();
              }}
              className="inline-flex items-center gap-1 text-[length:var(--text-xs)] text-[var(--muted)] hover:text-[var(--accent)] transition-colors duration-[var(--motion-fast)]"
            >
              <Eye size={14} />
              {t("versionView")}
            </button>
            {!isLatest && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRollback();
                }}
                className="inline-flex items-center gap-1 text-[length:var(--text-xs)] text-[var(--muted)] hover:text-[var(--warn)] transition-colors duration-[var(--motion-fast)]"
              >
                <RotateCcw size={14} />
                {t("versionRollback")}
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

// ── 版本内容查看模态 ──

function VersionContentModal({
  version,
  locale,
  t,
  onClose,
}: {
  version: DocumentVersion;
  locale: string;
  t: ReturnType<typeof useTranslations>;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[calc(var(--z-modal)+1)] flex items-center justify-center bg-[var(--bg)]/80 p-[var(--space-4)]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[80vh] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-lg)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-[var(--space-4)] py-[var(--space-3)]">
          <div>
            <h4 className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
              {t("versionViewTitle", { version: version.version })}
            </h4>
            <p className="mt-0.5 text-[length:var(--text-xs)] text-[var(--meta)]">
              {new Date(version.createdAt).toLocaleString(locale.startsWith("zh") ? "zh-CN" : "en-US")}
              {version.message && ` · ${version.message}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-[var(--radius-sm)] text-[var(--meta)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
            aria-label={t("close")}
          >
            <X size={16} />
          </button>
        </div>
        {/* 内容 */}
        <div className="flex-1 overflow-y-auto p-[var(--space-4)]">
          <pre className="whitespace-pre-wrap break-words text-[length:var(--text-sm)] text-[var(--fg-2)] font-mono leading-relaxed">
            {version.markdown}
          </pre>
        </div>
      </div>
    </div>
  );
}

// ── 版本对比视图 ──

function VersionDiffModal({
  diff,
  t,
  onClose,
}: {
  diff: VersionDiff;
  t: ReturnType<typeof useTranslations>;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[calc(var(--z-modal)+1)] flex items-center justify-center bg-[var(--bg)]/80 p-[var(--space-4)]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[80vh] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-lg)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-[var(--space-4)] py-[var(--space-3)]">
          <div>
            <h4 className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
              {t("versionCompareTitle", { from: diff.from.version, to: diff.to.version })}
            </h4>
            {/* 统计 */}
            <p className="mt-0.5 text-[length:var(--text-xs)] text-[var(--meta)]">
              <span className="text-[var(--success)]">+{diff.stats.additions}</span>
              {" · "}
              <span className="text-[var(--danger)]">-{diff.stats.deletions}</span>
              {" · "}
              <span className="text-[var(--warn)]">~{diff.stats.modifications}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-[var(--radius-sm)] text-[var(--meta)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
            aria-label={t("close")}
          >
            <X size={16} />
          </button>
        </div>

        {/* diff 内容 */}
        <div className="flex-1 overflow-y-auto p-[var(--space-4)] space-y-[var(--space-2)]">
          {/* 新增行 */}
          {diff.diff.added.length > 0 && (
            <div>
              <p className="mb-1 text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--success)]">
                {t("diffAdded")}
              </p>
              {diff.diff.added.map((line, i) => (
                <pre
                  key={`add-${i}`}
                  className="whitespace-pre-wrap break-words px-[var(--space-2)] py-1 rounded-[var(--radius-sm)] bg-[var(--success-soft)] text-[length:var(--text-sm)] text-[var(--fg-2)] font-mono"
                >
                  + {line}
                </pre>
              ))}
            </div>
          )}

          {/* 删除行 */}
          {diff.diff.removed.length > 0 && (
            <div>
              <p className="mb-1 text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--danger)]">
                {t("diffRemoved")}
              </p>
              {diff.diff.removed.map((line, i) => (
                <pre
                  key={`rem-${i}`}
                  className="whitespace-pre-wrap break-words px-[var(--space-2)] py-1 rounded-[var(--radius-sm)] bg-[var(--danger-soft)] text-[length:var(--text-sm)] text-[var(--fg-2)] font-mono"
                >
                  - {line}
                </pre>
              ))}
            </div>
          )}

          {/* 修改行 */}
          {diff.diff.modified.length > 0 && (
            <div>
              <p className="mb-1 text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--warn)]">
                {t("diffModified")}
              </p>
              {diff.diff.modified.map((mod, i) => (
                <div
                  key={`mod-${i}`}
                  className="rounded-[var(--radius-sm)] bg-[var(--warn-soft)] overflow-hidden"
                >
                  <pre className="whitespace-pre-wrap break-words px-[var(--space-2)] py-1 text-[length:var(--text-sm)] text-[var(--danger)] font-mono line-through opacity-70">
                    - {mod.before}
                  </pre>
                  <pre className="whitespace-pre-wrap break-words px-[var(--space-2)] py-1 text-[length:var(--text-sm)] text-[var(--success)] font-mono">
                    + {mod.after}
                  </pre>
                </div>
              ))}
            </div>
          )}

          {/* 无差异 */}
          {diff.diff.added.length === 0 &&
            diff.diff.removed.length === 0 &&
            diff.diff.modified.length === 0 && (
              <p className="text-center py-[var(--space-8)] text-[length:var(--text-sm)] text-[var(--muted)]">
                {t("diffNoChanges")}
              </p>
            )}
        </div>
      </div>
    </div>
  );
}

// ── 回滚确认对话框 ──

function RollbackConfirmDialog({
  version,
  t,
  busy,
  onConfirm,
  onCancel,
}: {
  version: DocumentVersion;
  t: ReturnType<typeof useTranslations>;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[calc(var(--z-modal)+1)] flex items-center justify-center bg-[var(--bg)]/80 p-[var(--space-4)]"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-[var(--space-4)] py-[var(--space-3)] border-b border-[var(--border)]">
          <h4 className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            {t("versionRollbackTitle")}
          </h4>
        </div>
        <div className="px-[var(--space-4)] py-[var(--space-4)]">
          <p className="text-[length:var(--text-sm)] text-[var(--fg-2)]">
            {t("versionRollbackConfirm", { version: version.version })}
          </p>
        </div>
        <div className="flex justify-end gap-2 px-[var(--space-4)] py-[var(--space-3)] border-t border-[var(--border-soft)]">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-9 px-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)]"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-sm)] bg-[var(--warn)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:opacity-90 disabled:opacity-50 transition-opacity duration-[var(--motion-fast)]"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            {t("versionRollback")}
          </button>
        </div>
      </div>
    </div>
  );
}