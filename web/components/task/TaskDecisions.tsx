"use client";

// 任务决策记录区：决策列表 + 新增决策编辑器 + 决策卡片 + 行动项面板
// + 打印专用容器 + 版本历史弹窗 + 快速图表 + 单条导出预览。
// 拆分自 task/[id]/page.tsx 第 616-832 行 + 版本历史弹窗 1107-1164 行。

import { useEffect, useRef, useState } from "react";
import { FileText, Download, Plus, X, Loader2, History, Zap } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";
import Markdown from "@/components/Markdown";
import { ActionItemPanel } from "@/components/ActionItemPanel";
import { MarkdownToolbar, useEditorKeys } from "@/components/MarkdownToolbar";
import { QuickDiagram } from "@/components/QuickDiagram";
import { ExportPreview } from "@/components/ExportPreview";
import { DecisionHistoryDialog } from "./DecisionHistoryDialog";
import type { Decision, DecisionVersion, Task } from "./types";

interface TaskDecisionsProps {
  task: Task;
  decisions: Decision[];
  wid: string;
  id: string;
  base: string;
  /** F1 决策驱动执行：保存决策后父组件 +1，触发 ActionItemPanel 重新拉取行动项 */
  decisionRefreshSignal: number;
  onDecisionsChange: (updater: (prev: Decision[]) => Decision[]) => void;
  onDecisionRefresh: () => void;
  onError: (msg: string) => void;
  relTime: (iso: string) => string;
}

export function TaskDecisions({
  task,
  decisions,
  wid,
  id,
  base,
  decisionRefreshSignal,
  onDecisionsChange,
  onDecisionRefresh,
  onError,
  relTime,
}: TaskDecisionsProps) {
  const t = useTranslations("task");
  const tButton = useTranslations("button");
  const tErr = useTranslations("error");
  const tQuick = useTranslations("diagramQuick");
  const locale = useLocale();

  const [decisionDraft, setDecisionDraft] = useState("");
  const [decisionOpen, setDecisionOpen] = useState(false);
  // 决策编辑器 textarea ref（MarkdownToolbar 定位光标用）
  const decisionEditorRef = useRef<HTMLTextAreaElement>(null);
  // 决策编辑器快捷键层（v0.6：与文档编辑器共用 Typora 式按键处理）
  const decisionKeyDown = useEditorKeys({
    textareaRef: decisionEditorRef,
    value: decisionDraft,
    onChange: setDecisionDraft,
  });
  /** 快速图表对话框（v0.6 增补）：插入 ```mermaid 块到决策草稿末尾 */
  const [quickDiagramOpen, setQuickDiagramOpen] = useState(false);
  function insertDiagramToDecision(block: string) {
    const sep = decisionDraft.endsWith("\n") || decisionDraft === "" ? "" : "\n\n";
    setDecisionDraft(decisionDraft + sep + block);
  }
  // 决策编辑/预览切换：edit=编辑 textarea，preview=渲染 markdown
  const [decisionMode, setDecisionMode] = useState<"edit" | "preview">("edit");
  // 打印模式：true 时挂载 .print-area（导出 PDF 专用），afterprint 后卸载——
  // 平时 DOM 中不存在打印内容，避免 getByText 多元素歧义（E2E strict violation 修复）
  const [printMode, setPrintMode] = useState(false);
  // F4 单条决策导出预览：非 null 时打开 ExportPreview 模态框，传入决策标题 + markdown
  const [exportPreview, setExportPreview] = useState<{
    title: string;
    markdown: string;
    metaLine?: string;
  } | null>(null);
  // 决策保存中（addDecision 按钮 loading）
  const [decisionSaving, setDecisionSaving] = useState(false);

  // ── 决策版本历史 ──
  const [historyFor, setHistoryFor] = useState<Decision | null>(null);
  const [versions, setVersions] = useState<DecisionVersion[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ── 版本历史弹窗：Escape 关闭 ──
  useEffect(() => {
    if (!historyFor) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setHistoryFor(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [historyFor]);

  async function addDecision() {
    if (!decisionDraft.trim() || decisionSaving) return;
    setDecisionSaving(true);
    try {
      const created = await api<Decision>(`${base}/tasks/${id}/decisions`, {
        method: "POST",
        body: JSON.stringify({ markdown: decisionDraft.trim() }),
      });
      onDecisionsChange((prev) => [created, ...prev]);
      setDecisionDraft("");
      setDecisionOpen(false);
      // F1：保存决策后触发 ActionItemPanel 重新拉取行动项（决策可能含新行动项）
      onDecisionRefresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : tErr("saveFailed"));
    } finally {
      setDecisionSaving(false);
    }
  }

  // 打开某条决策的版本历史
  async function showHistory(d: Decision) {
    setHistoryFor(d);
    setHistoryLoading(true);
    try {
      const v = await api<DecisionVersion[]>(`${base}/tasks/${id}/decisions/${d.id}/versions`);
      setVersions(v);
    } catch {
      setVersions([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  return (
    <>
      <section id="decisions" className="mt-[var(--space-6)] scroll-mt-[var(--topbar-h)]">
        <div className="flex items-center justify-between mb-[var(--space-3)]">
          <h2 className="flex items-center gap-[var(--space-2)] text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            <FileText size={16} className="text-[var(--muted)]" />
            {t("decisionsTitle")}
            {decisions.length > 0 && (
              <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-regular)] text-[var(--meta)]">
                {decisions.length}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setPrintMode(true);
              }}
              disabled={decisions.length === 0}
              title={t("exportPdfHint")}
              className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] active:bg-[var(--surface-3)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
            >
              <Download size={15} />
              {t("exportPdf")}
            </button>
            <button
              onClick={() => setDecisionOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] active:bg-[var(--surface-3)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
            >
              {decisionOpen ? <X size={15} /> : <Plus size={15} />}
              {decisionOpen ? tButton("cancel") : t("addDecision")}
            </button>
          </div>
        </div>

        {decisionOpen && (
          <div className="mb-[var(--space-4)] bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-[var(--space-4)]">
            {/* 编辑/预览切换 tab */}
            <div className="inline-flex items-center gap-[var(--space-1)] mb-[var(--space-3)] p-[var(--space-1)] rounded-[var(--radius-md)] bg-[var(--surface-2)]">
              <button
                type="button"
                onClick={() => setDecisionMode("edit")}
                aria-pressed={decisionMode === "edit"}
                className={`px-[var(--space-3)] h-7 rounded-[var(--radius-sm)] text-[length:var(--text-sm)] transition-colors duration-[var(--motion-fast)] ${
                  decisionMode === "edit"
                    ? "bg-[var(--surface)] text-[var(--fg)] shadow-[var(--elev-sm)]"
                    : "text-[var(--muted)] hover:text-[var(--fg-2)]"
                }`}
              >
                {t("editTab")}
              </button>
              <button
                type="button"
                onClick={() => setDecisionMode("preview")}
                aria-pressed={decisionMode === "preview"}
                className={`px-[var(--space-3)] h-7 rounded-[var(--radius-sm)] text-[length:var(--text-sm)] transition-colors duration-[var(--motion-fast)] ${
                  decisionMode === "preview"
                    ? "bg-[var(--surface)] text-[var(--fg)] shadow-[var(--elev-sm)]"
                    : "text-[var(--muted)] hover:text-[var(--fg-2)]"
                }`}
              >
                {t("previewTab")}
              </button>
            </div>

            {decisionMode === "edit" ? (
              <>
                <div className="flex items-center gap-[var(--space-2)]">
                  <MarkdownToolbar
                    textareaRef={decisionEditorRef}
                    value={decisionDraft}
                    onChange={setDecisionDraft}
                  />
                  {/* 快速图表入口（v0.6 增补）：出一张图插入决策草稿 */}
                  <button
                    type="button"
                    onClick={() => setQuickDiagramOpen(true)}
                    title={tQuick("title")}
                    aria-label={tQuick("title")}
                    className="shrink-0 inline-flex items-center gap-1 h-7 px-2 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
                  >
                    <Zap size={13} />
                    <span className="hidden sm:inline">{tQuick("title")}</span>
                  </button>
                </div>
                <textarea
                  ref={decisionEditorRef}
                  value={decisionDraft}
                  onChange={(e) => setDecisionDraft(e.target.value)}
                  onKeyDown={decisionKeyDown}
                  rows={6}
                  placeholder={t("decisionTemplate")}
                  className="w-full resize-y bg-transparent font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] text-[var(--fg-2)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:border-[var(--accent)] border border-transparent rounded-[var(--radius-sm)] leading-[var(--leading-relaxed)] placeholder:text-[var(--meta)] transition-shadow duration-[var(--motion-fast)]"
                />
              </>
            ) : (
              <div className="min-h-[120px] px-[var(--space-3)] py-[var(--space-2)] border border-[var(--border-soft)] rounded-[var(--radius-sm)] bg-[var(--surface-2)] text-[length:var(--text-sm)] text-[var(--fg-2)] leading-[var(--leading-relaxed)] overflow-y-auto">
                {decisionDraft.trim() ? (
                  <Markdown source={decisionDraft} />
                ) : (
                  <span className="text-[var(--meta)]">{t("noPreviewContent")}</span>
                )}
              </div>
            )}

            <div className="flex items-center justify-between mt-[var(--space-3)] pt-[var(--space-3)] border-t border-[var(--border-soft)]">
              <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
                {t("decisionHint")}
              </span>
              <button
                onClick={addDecision}
                disabled={!decisionDraft.trim() || decisionSaving}
                className="inline-flex items-center gap-1.5 h-8 px-[var(--space-3)] bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
              >
                {decisionSaving ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : null}
                {t("saveAsVersion", { version: (decisions[0]?.version ?? 0) + 1 })}
              </button>
            </div>
          </div>
        )}

        {decisions.length === 0 && !decisionOpen ? (
          <div className="px-[var(--space-4)] py-[var(--space-8)] rounded-[var(--radius-lg)] border border-dashed border-[var(--border)] text-center">
            <p className="text-[length:var(--text-sm)] text-[var(--muted)]">
              {t("decisionsEmpty")}
            </p>
          </div>
        ) : (
          <div className="space-y-[var(--space-3)]">
            {decisions.map((d) => (
              <article
                key={d.id}
                className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] hover:shadow-[var(--elev-hover)] transition-shadow duration-[var(--motion-fast)] overflow-hidden"
              >
                <header className="flex items-center gap-[var(--space-2)] px-[var(--space-4)] py-2.5 bg-[var(--surface-2)] border-b border-[var(--border-soft)]">
                  <span className="px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--surface)] border border-[var(--border)] text-[length:var(--text-xs)] font-[family-name:var(--font-mono)] text-[var(--fg-2)]">
                    v{d.version}
                  </span>
                  <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
                    {d.author ? d.author.name || d.author.email : t("deletedUser")} ·{" "}
                    {relTime(d.createdAt)}
                  </span>
                  <button
                    onClick={() =>
                      setExportPreview({
                        title: `${task.title} · ${t("decisionsTitle")} v${d.version}`,
                        markdown: d.markdown,
                        metaLine: `v${d.version} · ${
                          d.author ? d.author.name || d.author.email : t("deletedUser")
                        } · ${new Date(d.createdAt).toLocaleString()}`,
                      })
                    }
                    aria-label={t("exportPdf")}
                    title={t("exportPdfHint")}
                    className="ml-auto inline-flex items-center justify-center w-8 h-8 rounded-[var(--radius-sm)] text-[var(--meta)] hover:bg-[var(--surface)] hover:text-[var(--fg-2)] active:bg-[var(--surface-3)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
                  >
                    <Download size={14} />
                  </button>
                  <button
                    onClick={() => showHistory(d)}
                    aria-label={t("versionHistory")}
                    className="inline-flex items-center justify-center w-8 h-8 rounded-[var(--radius-sm)] text-[var(--meta)] hover:bg-[var(--surface)] hover:text-[var(--fg-2)] active:bg-[var(--surface-3)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
                  >
                    <History size={14} />
                  </button>
                </header>
                <div className="px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--text-base)]">
                  <Markdown source={d.markdown} />
                </div>
                {/* F1 决策驱动执行：决策卡片底部嵌入行动项追踪面板 */}
                <div className="px-[var(--space-4)] pb-[var(--space-3)]">
                  <ActionItemPanel
                    decisionId={d.id}
                    workspaceId={wid}
                    taskId={id}
                    locale={locale}
                    refreshSignal={decisionRefreshSignal}
                  />
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* 打印专用容器（导出 PDF）：屏幕隐藏，打印时仅此区可见 */}
      {printMode && (
        <div
          className="hidden print:block print-area"
          aria-hidden="true"
          ref={(el) => {
            // 挂载即触发打印；afterprint 卸载 printMode（容器随条件渲染移除）
            if (el) {
              requestAnimationFrame(() => window.print());
              const off = () => {
                setPrintMode(false);
                window.removeEventListener("afterprint", off);
              };
              window.addEventListener("afterprint", off);
            }
          }}
        >
          <h1 className="text-[length:var(--text-xl)] font-[weight:var(--weight-semibold)] mb-4">
            {task.title} · {t("decisionsTitle")}
          </h1>
          {decisions.map((d) => (
            <section key={d.id} className="mb-8">
              <p className="text-[length:var(--text-xs)] text-[var(--meta)] mb-2">
                v{d.version} · {d.author.name || d.author.email} ·{" "}
                {new Date(d.createdAt).toLocaleString()}
              </p>
              <Markdown source={d.markdown} />
            </section>
          ))}
          {decisions.length === 0 && <p>—</p>}
        </div>
      )}

      {/* 决策版本历史弹窗 */}
      <DecisionHistoryDialog
        historyFor={historyFor}
        onClose={() => setHistoryFor(null)}
        versions={versions}
        historyLoading={historyLoading}
        relTime={relTime}
      />

      {/* 快速图表对话框（决策区入口唤起） */}
      <QuickDiagram
        open={quickDiagramOpen}
        onClose={() => setQuickDiagramOpen(false)}
        onInsert={insertDiagramToDecision}
      />

      {/* F4 单条决策导出预览模态框 */}
      <ExportPreview
        title={exportPreview?.title ?? ""}
        markdown={exportPreview?.markdown ?? ""}
        metaLine={exportPreview?.metaLine}
        open={exportPreview !== null}
        onClose={() => setExportPreview(null)}
      />
    </>
  );
}