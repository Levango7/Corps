"use client";

/**
 * AI 工具面板（Tool Panel）。
 *
 * 展示当前工作区可用的 AI 工具列表，点击工具卡片展开/折叠参数表单，
 * 填写参数后执行工具并显示结果。供 AI 编排调试 / 人工确认有副作用操作。
 *
 * 技术要点：
 *  - GET /api/v1/ai/tools 拉取工具元信息（name + description + JSON Schema）
 *  - POST /api/v1/ai/tools/execute 执行工具，传入 workspaceId
 *  - 参数表单按 JSON Schema properties 动态渲染（string/number → text input，boolean → checkbox）
 *  - AbortController 防竞态：新请求开始时 abort 旧请求，避免过期响应覆盖新状态
 *  - 样式全走 design token（var(--*)），lucide-react 图标 size 14/16
 *  - useTranslations("ai.aiTool") i18n hook
 *
 * AI 安全约束：工具执行结果仅展示，不自动触发后续操作。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Loader2,
  Wrench,
  Play,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  XCircle,
  X,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";

// ─── 类型 ────────────────────────────────────────────────────────────────────

interface ToolPanelProps {
  /** 工作区 ID */
  workspaceId: string;
}

interface JsonSchema {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  [key: string]: unknown;
}

interface ToolInfo {
  name: string;
  description: string;
  parameters: JsonSchema;
}

interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// ─── 辅助：参数表单值类型 ────────────────────────────────────────────────────

type ParamValue = string | number | boolean | undefined;
type ParamMap = Record<string, ParamValue>;

/**
 * 根据参数值类型与 schema 类型推断，将字符串输入转为对应 JS 类型。
 * number/integer → Number（NaN 时回退原字符串）；boolean → checkbox 已是布尔。
 */
function coerce_param(raw: ParamValue, schemaType?: string): unknown {
  if (raw === undefined || raw === "") return undefined;
  if (schemaType === "number" || schemaType === "integer") {
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  return raw;
}

// ─── 组件 ────────────────────────────────────────────────────────────────────

export function ToolPanel({ workspaceId }: ToolPanelProps) {
  const t = useTranslations("ai.aiTool");

  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedName, setExpandedName] = useState<string | null>(null);
  const [params, setParams] = useState<ParamMap>({});
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<ToolResult | null>(null);
  const [execError, setExecError] = useState<string | null>(null);

  // AbortController 防竞态：新请求开始时 abort 旧请求
  const loadAbortRef = useRef<AbortController | null>(null);
  const execAbortRef = useRef<AbortController | null>(null);

  // 加载工具列表
  const load_tools = useCallback(async () => {
    // abort 上一次未完成的加载
    loadAbortRef.current?.abort();
    const ac = new AbortController();
    loadAbortRef.current = ac;

    setLoading(true);
    setLoadError(null);
    try {
      const data = await api<{ tools: ToolInfo[] }>("/api/v1/ai/tools");
      if (ac.signal.aborted) return;
      setTools(data.tools ?? []);
    } catch (e) {
      if (ac.signal.aborted) return;
      setLoadError(e instanceof ApiError ? e.message : t("error"));
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load_tools();
    return () => loadAbortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 展开/折叠工具
  const handle_toggle = useCallback((name: string) => {
    setExpandedName((prev) => (prev === name ? null : name));
    setParams({});
    setResult(null);
    setExecError(null);
  }, []);

  // 参数输入变更
  const handle_param_change = useCallback((key: string, value: ParamValue) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  }, []);

  // 执行工具
  const handle_execute = useCallback(
    async (tool: ToolInfo) => {
      // abort 上一次未完成的执行
      execAbortRef.current?.abort();
      const ac = new AbortController();
      execAbortRef.current = ac;

      setExecuting(true);
      setResult(null);
      setExecError(null);
      try {
        // 组装参数：按 schema 类型转换
        const schemaProps = tool.parameters.properties ?? {};
        const args: Record<string, unknown> = {};
        for (const [key, schema] of Object.entries(schemaProps)) {
          const coerced = coerce_param(params[key], schema.type);
          if (coerced !== undefined) args[key] = coerced;
        }

        const data = await api<{ result: ToolResult }>(
          "/api/v1/ai/tools/execute",
          {
            method: "POST",
            body: JSON.stringify({
              toolName: tool.name,
              args,
              workspaceId,
            }),
          },
        );
        if (ac.signal.aborted) return;
        setResult(data.result);
      } catch (e) {
        if (ac.signal.aborted) return;
        setExecError(e instanceof ApiError ? e.message : t("error"));
      } finally {
        if (!ac.signal.aborted) setExecuting(false);
      }
    },
    [params, workspaceId, t],
  );

  // 清除结果
  const handle_clear = useCallback(() => {
    setResult(null);
    setExecError(null);
    setParams({});
  }, []);

  // ─── 渲染 ──────────────────────────────────────────────────────────────────

  return (
    <section className="flex flex-col rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
      {/* 头部 */}
      <header className="flex items-center gap-[var(--space-3)] border-b border-[var(--border)] px-[var(--space-3)] py-[var(--space-3)]">
        <Wrench size={16} className="text-[var(--accent)]" />
        <div className="flex min-w-0 flex-col">
          <h2 className="text-[length:var(--text-base)] font-semibold text-[var(--fg)]">
            {t("title")}
          </h2>
          <span className="truncate text-[length:var(--text-xs)] text-[var(--muted)]">
            {t("description")}
          </span>
        </div>
        <span className="ml-auto text-[length:var(--text-xs)] text-[var(--muted)]">
          {tools.length > 0 && `${tools.length}`}
        </span>
      </header>

      <div className="flex flex-col gap-[var(--space-3)] p-[var(--space-3)]">
        {/* 加载中 */}
        {loading && (
          <div className="flex items-center gap-[var(--space-3)] text-[var(--muted)]">
            <Loader2 size={14} className="animate-spin" />
            <span className="text-[length:var(--text-sm)]">{t("loading")}</span>
          </div>
        )}

        {/* 加载错误 */}
        {loadError && (
          <div className="flex items-center gap-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--danger)] px-[var(--space-3)] py-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--danger)]">
            <XCircle size={14} />
            <span className="break-all">{loadError}</span>
          </div>
        )}

        {/* 空状态 */}
        {!loading && !loadError && tools.length === 0 && (
          <div className="flex items-center gap-[var(--space-3)] text-[var(--muted)]">
            <Wrench size={14} />
            <span className="text-[length:var(--text-sm)]">{t("noTools")}</span>
          </div>
        )}

        {/* 工具列表 */}
        {!loading &&
          tools.map((tool) => {
            const expanded = expandedName === tool.name;
            const schemaProps = tool.parameters.properties ?? {};
            const requiredSet = new Set(tool.parameters.required ?? []);
            return (
              <div
                key={tool.name}
                className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]"
              >
                {/* 工具头（可点击展开） */}
                <button
                  type="button"
                  onClick={() => handle_toggle(tool.name)}
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-[var(--space-3)] px-[var(--space-3)] py-[var(--space-3)] text-left transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                >
                  {expanded ? (
                    <ChevronDown
                      size={14}
                      className="shrink-0 text-[var(--muted)]"
                    />
                  ) : (
                    <ChevronRight
                      size={14}
                      className="shrink-0 text-[var(--muted)]"
                    />
                  )}
                  <div className="flex min-w-0 flex-col gap-[2px]">
                    <span className="font-mono text-[length:var(--text-sm)] font-medium text-[var(--fg)]">
                      {tool.name}
                    </span>
                    <span className="truncate text-[length:var(--text-xs)] text-[var(--muted)]">
                      {tool.description}
                    </span>
                  </div>
                </button>

                {/* 展开内容：参数表单 + 执行按钮 + 结果 */}
                {expanded && (
                  <div className="border-t border-[var(--border)] px-[var(--space-3)] py-[var(--space-3)]">
                    {/* 参数表单 */}
                    {Object.keys(schemaProps).length > 0 ? (
                      <div className="mb-[var(--space-3)] flex flex-col gap-[var(--space-3)]">
                        <span className="text-[length:var(--text-xs)] font-medium uppercase tracking-wide text-[var(--muted)]">
                          {t("inputParameters")}
                        </span>
                        {Object.entries(schemaProps).map(([key, schema]) => {
                          const isEnum = Array.isArray(schema.enum);
                          const isBoolean = schema.type === "boolean";
                          const isRequired = requiredSet.has(key);
                          return (
                            <label
                              key={key}
                              className="flex flex-col gap-[var(--space-3)]"
                            >
                              <span className="flex items-center gap-[var(--space-3)] text-[length:var(--text-xs)] text-[var(--fg-2)]">
                                <span className="font-mono">{key}</span>
                                {isRequired && (
                                  <span className="text-[var(--danger)]">*</span>
                                )}
                                {schema.description && (
                                  <span className="truncate text-[var(--muted)]">
                                    — {schema.description}
                                  </span>
                                )}
                              </span>
                              {isEnum ? (
                                <select
                                  value={(params[key] as string) ?? ""}
                                  onChange={(e) =>
                                    handle_param_change(key, e.target.value)
                                  }
                                  className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                                >
                                  <option value="">—</option>
                                  {schema.enum!.map((opt) => (
                                    <option key={String(opt)} value={String(opt)}>
                                      {String(opt)}
                                    </option>
                                  ))}
                                </select>
                              ) : isBoolean ? (
                                <input
                                  type="checkbox"
                                  checked={params[key] === true}
                                  onChange={(e) =>
                                    handle_param_change(key, e.target.checked)
                                  }
                                  className="h-4 w-4 rounded-[var(--radius-md)] border border-[var(--border)] accent-[var(--accent)]"
                                />
                              ) : (
                                <input
                                  type={
                                    schema.type === "number" ||
                                    schema.type === "integer"
                                      ? "number"
                                      : "text"
                                  }
                                  value={(params[key] as string) ?? ""}
                                  onChange={(e) =>
                                    handle_param_change(key, e.target.value)
                                  }
                                  placeholder={schema.description ?? ""}
                                  className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--fg)] placeholder:text-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                                />
                              )}
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="mb-[var(--space-3)] text-[length:var(--text-xs)] text-[var(--muted)]">
                        {t("inputParameters")}: ∅
                      </div>
                    )}

                    {/* 执行按钮 */}
                    <div className="flex items-center gap-[var(--space-3)]">
                      <button
                        type="button"
                        onClick={() => void handle_execute(tool)}
                        disabled={executing}
                        className="inline-flex items-center gap-[var(--space-3)] rounded-[var(--radius-md)] bg-[var(--accent)] px-[var(--space-3)] py-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--accent-fg)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                      >
                        {executing ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Play size={14} />
                        )}
                        {executing ? t("executing") : t("execute")}
                      </button>
                      <button
                        type="button"
                        onClick={handle_clear}
                        disabled={executing}
                        className="inline-flex items-center gap-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                      >
                        <X size={14} />
                        {t("clear")}
                      </button>
                    </div>

                    {/* 执行错误 */}
                    {execError && (
                      <div className="mt-[var(--space-3)] flex items-start gap-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--danger)] px-[var(--space-3)] py-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--danger)]">
                        <XCircle size={14} className="mt-[2px] shrink-0" />
                        <span className="break-all">{execError}</span>
                      </div>
                    )}

                    {/* 执行结果 */}
                    {result && (
                      <div className="mt-[var(--space-3)] flex flex-col gap-[var(--space-3)]">
                        <div className="flex items-center gap-[var(--space-3)] text-[length:var(--text-xs)] font-medium uppercase tracking-wide text-[var(--muted)]">
                          {result.success ? (
                            <CheckCircle
                              size={14}
                              className="text-[var(--success)]"
                            />
                          ) : (
                            <XCircle
                              size={14}
                              className="text-[var(--danger)]"
                            />
                          )}
                          {t("outputResult")}
                          <span
                            className={
                              result.success
                                ? "text-[var(--success)]"
                                : "text-[var(--danger)]"
                            }
                          >
                            {result.success ? t("success") : t("failed")}
                          </span>
                        </div>
                        {result.error && (
                          <div className="rounded-[var(--radius-md)] border border-[var(--danger)] px-[var(--space-3)] py-[var(--space-3)] text-[length:var(--text-xs)] text-[var(--danger)]">
                            <span className="break-all">{result.error}</span>
                          </div>
                        )}
                        {result.data !== undefined && (
                          <pre className="max-h-[240px] overflow-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-3)] text-[length:var(--text-xs)] text-[var(--fg-2)]">
                            <code className="break-all">
                              {JSON.stringify(result.data, null, 2)}
                            </code>
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </section>
  );
}
