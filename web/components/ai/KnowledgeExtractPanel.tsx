"use client";

/**
 * AI 知识提取面板。
 *
 * 功能：
 *  - 选择来源类型（文档/会议/聊天/任务）和来源 ID
 *  - 点击"提取"触发 POST /api/v1/ai/knowledge/extract
 *  - 显示提取进度和结果（新增节点数、边数）
 *  - 样式全走 design token（var(--*)），lucide-react 图标 size 14/16
 */

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Sparkles,
  FileText,
  Calendar,
  MessageSquare,
  CheckSquare,
  Loader2,
  CheckCircle2,

} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/Toast";

interface KnowledgeExtractPanelProps {
  /** 工作区 ID */
  wid: string;
}

/** 来源类型选项 */
const SOURCE_TYPES = [
  { value: "document", Icon: FileText },
  { value: "meeting", Icon: Calendar },
  { value: "chat", Icon: MessageSquare },
  { value: "task", Icon: CheckSquare },
] as const;

/** 提取结果 */
interface ExtractResult {
  nodes: { id: string; type: string; label: string; content: string }[];
  edges: {
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    relation: string;
    weight: number;
  }[];
}

export function KnowledgeExtractPanel({ wid }: KnowledgeExtractPanelProps) {
  const t = useTranslations("ai.aiKnowledge");
  const { toast } = useToast();

  const [sourceType, setSourceType] = useState<string>("document");
  const [sourceId, setSourceId] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [result, setResult] = useState<{ nodes: number; edges: number } | null>(
    null,
  );

  /** 提取知识 */
  const handleExtract = useCallback(async () => {
    if (!sourceId.trim()) {
      toast("error", t("error"));
      return;
    }
    setExtracting(true);
    setResult(null);
    try {
      const data = await api<ExtractResult>("/api/v1/ai/knowledge/extract", {
        method: "POST",
        body: JSON.stringify({ wid, sourceType, sourceId: sourceId.trim() }),
      });
      const nodeCount = data?.nodes?.length ?? 0;
      const edgeCount = data?.edges?.length ?? 0;
      setResult({ nodes: nodeCount, edges: edgeCount });
      toast(
        "success",
        t("extracted", { nodes: nodeCount, edges: edgeCount }),
      );
    } catch (e) {
      if (process.env.NODE_ENV === "development") {
        console.error(
          "[KnowledgeExtractPanel] extract error:",
          e instanceof Error ? e.message : e,
        );
      }
      toast("error", t("error"));
    } finally {
      setExtracting(false);
    }
  }, [wid, sourceType, sourceId, t, toast]);

  return (
    <div
      className="flex h-full flex-col bg-[var(--surface)]"
      aria-label={t("extract")}
    >
      {/* 标题栏 */}
      <header className="flex items-center gap-[var(--space-2)] border-b border-[var(--border)] px-[var(--space-5)] py-[var(--space-3)]">
        <Sparkles size={16} className="text-[var(--accent)]" />
        <h1 className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          {t("extract")}
        </h1>
      </header>

      {/* 表单 */}
      <div className="flex flex-1 flex-col gap-[var(--space-4)] p-[var(--space-5)]">
        {/* 来源类型选择 */}
        <div className="flex flex-col gap-[var(--space-2)]">
          <label className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
            {t("sourceType")}
          </label>
          <div className="grid grid-cols-2 gap-[var(--space-2)] sm:grid-cols-4">
            {SOURCE_TYPES.map(({ value, Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setSourceType(value)}
                className={`inline-flex items-center justify-center gap-[var(--space-1)] rounded-[var(--radius-sm)] border px-[var(--space-2)] py-[var(--space-2)] text-[length:var(--text-sm)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] ${
                  sourceType === value
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--fg)]"
                    : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
                }`}
              >
                <Icon size={14} />
                {t(value)}
              </button>
            ))}
          </div>
        </div>

        {/* 来源 ID 输入 */}
        <div className="flex flex-col gap-[var(--space-2)]">
          <label className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
            {t("sourceId")}
          </label>
          <input
            type="text"
            value={sourceId}
            onChange={(e) => setSourceId(e.currentTarget.value)}
            placeholder="UUID"
            className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-ring)]"
          />
        </div>

        {/* 提取按钮 */}
        <button
          type="button"
          onClick={() => void handleExtract()}
          disabled={extracting || !sourceId.trim()}
          className="inline-flex items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-sm)] bg-[var(--accent)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--surface)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
        >
          {extracting ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              {t("extracting")}
            </>
          ) : (
            <>
              <Sparkles size={14} />
              {t("extract")}
            </>
          )}
        </button>

        {/* 结果展示 */}
        {result && !extracting && (
          <div className="flex items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-[var(--success)] bg-[var(--success-soft)] px-[var(--space-3)] py-[var(--space-2)]">
            <CheckCircle2 size={16} className="text-[var(--success)]" />
            <span className="text-[length:var(--text-sm)] text-[var(--fg)]">
              {t("extracted", { nodes: result.nodes, edges: result.edges })}
            </span>
          </div>
        )}

        {/* 错误提示占位（toast 已处理，此处保留布局一致性） */}
        {extracting && (
          <div className="flex items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-[var(--accent)] bg-[var(--accent-soft)] px-[var(--space-3)] py-[var(--space-2)]">
            <Loader2 size={16} className="animate-spin text-[var(--accent)]" />
            <span className="text-[length:var(--text-sm)] text-[var(--fg-2)]">
              {t("extracting")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}