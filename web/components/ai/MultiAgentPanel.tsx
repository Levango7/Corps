"use client";

/**
 * 多 Agent 协同面板（方向 D）。
 *
 * 交互流程：
 *  1. 左侧 Agent 列表（名称/角色/启用状态），右侧选中 Agent 详情
 *  2. 创建/编辑 Agent 表单：name/role/capabilities/systemPrompt/model/enabled
 *  3. 底部协调任务输入框 + 「执行」按钮 → POST /api/v1/ai/agents/coordinate
 *  4. 执行结果展示：各 Agent 分配的子任务 + 响应内容
 *
 * Design token 样式 + lucide-react 图标（Bot / Plus / Trash2 / Zap / Loader2 等）size 14/16。
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Bot,
  Plus,
  Trash2,
  Zap,
  Loader2,
  AlertCircle,
  X,
  Power,
  Save,
  CheckCircle2,
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/Toast";

/** Agent 类型（与后端 AiAgent 一致） */
interface Agent {
  id: string;
  name: string;
  role: string;
  capabilities: unknown;
  systemPrompt: string;
  model: string;
  enabled: boolean;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
}

/** 协调器分配结果 */
interface Assignment {
  agentName: string;
  subtask: string;
  reason: string;
}

/** Agent 响应结果 */
interface AgentResponse {
  agentId: string;
  agentName: string;
  response: string;
  handoff: string | null;
}

/** 协调结果 */
interface CoordinationResult {
  assignments: Assignment[];
  responses: AgentResponse[];
  messageIds: string[];
}

/** 合法角色枚举 */
const ROLE_OPTIONS = [
  { value: "task_breaker", labelKey: "roleTaskBreaker" },
  { value: "doc_writer", labelKey: "roleDocWriter" },
  { value: "follow_upper", labelKey: "roleFollowUpper" },
  { value: "analyst", labelKey: "roleAnalyst" },
] as const;

/** 合法模型枚举 */
const MODEL_OPTIONS = [
  { value: "deepseek-chat", label: "DeepSeek Chat" },
  { value: "deepseek-reasoner", label: "DeepSeek Reasoner" },
] as const;

/** 可选能力列表 */
const CAPABILITY_OPTIONS = [
  "task_breakdown",
  "doc_writing",
  "follow_up",
  "analysis",
  "summarization",
  "translation",
  "code_review",
  "decision_making",
] as const;

/** 输入框样式（design token） */
const fieldControl =
  "w-full px-2.5 py-2 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]";

/** MultiAgentPanel Props */
interface MultiAgentPanelProps {
  /** 工作区 ID */
  wid: string;
}

export default function MultiAgentPanel({ wid }: MultiAgentPanelProps) {
  const t = useTranslations("ai.aiAgent");
  const { toast } = useToast();

  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // 编辑/创建表单状态
  const [editing, setEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    role: "task_breaker" as string,
    capabilities: [] as string[],
    systemPrompt: "",
    model: "deepseek-chat" as string,
    enabled: true,
  });
  const [saving, setSaving] = useState(false);

  // 协调任务状态
  const [task, setTask] = useState("");
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<CoordinationResult | null>(null);

  // AbortController：组件卸载时中止进行中的请求
  const abortRef = useRef<AbortController | null>(null);

  /** 加载 Agent 列表 */
  async function loadAgents() {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError("");
    try {
      const data = await api<Agent[]>(
        `/api/v1/ai/agents?wid=${encodeURIComponent(wid)}`,
        { signal: ac.signal },
      );
      if (ac.signal.aborted) return;
      setAgents(data);
      // 默认选中第一个 Agent
      if (data.length > 0 && !selectedId) {
        setSelectedId(data[0].id);
      }
    } catch (e) {
      if (ac.signal.aborted || (e instanceof Error && e.name === "AbortError"))
        return;
      if (process.env.NODE_ENV === "development")
        console.error("[MultiAgentPanel] loadAgents error:", e);
      setError(t("loadFailed"));
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    loadAgents();
    return () => {
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wid]);

  /** 选中 Agent 时同步表单数据 */
  useEffect(() => {
    if (selectedId) {
      const agent = agents.find((a) => a.id === selectedId);
      if (agent) {
        setFormData({
          name: agent.name,
          role: agent.role,
          capabilities: Array.isArray(agent.capabilities)
            ? (agent.capabilities as string[]).filter(
                (c) => typeof c === "string",
              )
            : [],
          systemPrompt: agent.systemPrompt,
          model: agent.model,
          enabled: agent.enabled,
        });
      }
    }
  }, [selectedId, agents]);

  /** 开始创建新 Agent */
  function startCreate() {
    setIsCreating(true);
    setEditing(true);
    setSelectedId(null);
    setFormData({
      name: "",
      role: "task_breaker",
      capabilities: [],
      systemPrompt: "",
      model: "deepseek-chat",
      enabled: true,
    });
  }

  /** 开始编辑当前 Agent */
  function startEdit() {
    if (!selectedId) return;
    setIsCreating(false);
    setEditing(true);
  }

  /** 取消编辑 */
  function cancelEdit() {
    setEditing(false);
    setIsCreating(false);
    // 恢复表单数据
    if (selectedId) {
      const agent = agents.find((a) => a.id === selectedId);
      if (agent) {
        setFormData({
          name: agent.name,
          role: agent.role,
          capabilities: Array.isArray(agent.capabilities)
            ? (agent.capabilities as string[]).filter(
                (c) => typeof c === "string",
              )
            : [],
          systemPrompt: agent.systemPrompt,
          model: agent.model,
          enabled: agent.enabled,
        });
      }
    }
  }

  /** 保存 Agent（创建或更新） */
  async function saveAgent() {
    if (saving) return;
    if (!formData.name.trim() || !formData.systemPrompt.trim()) return;

    setSaving(true);
    setError("");
    try {
      if (isCreating) {
        const created = await api<Agent>("/api/v1/ai/agents", {
          method: "POST",
          body: JSON.stringify({
            wid,
            name: formData.name,
            role: formData.role,
            capabilities: formData.capabilities,
            systemPrompt: formData.systemPrompt,
            model: formData.model,
            enabled: formData.enabled,
          }),
        });
        setAgents((prev) => [...prev, created]);
        setSelectedId(created.id);
        toast("success", t("create"));
      } else if (selectedId) {
        const updated = await api<Agent>(
          `/api/v1/ai/agents/${selectedId}?wid=${encodeURIComponent(wid)}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              name: formData.name,
              role: formData.role,
              capabilities: formData.capabilities,
              systemPrompt: formData.systemPrompt,
              model: formData.model,
              enabled: formData.enabled,
            }),
          },
        );
        setAgents((prev) =>
          prev.map((a) => (a.id === selectedId ? updated ?? a : a)),
        );
        toast("success", t("edit"));
      }
      setEditing(false);
      setIsCreating(false);
    } catch (e) {
      if (process.env.NODE_ENV === "development")
        console.error("[MultiAgentPanel] saveAgent error:", e);
      setError(t("error"));
    } finally {
      setSaving(false);
    }
  }

  /** 删除当前 Agent */
  async function deleteAgent() {
    if (!selectedId) return;
    if (!window.confirm(t("confirmDelete", { name: formData.name }))) return;

    try {
      await api(
        `/api/v1/ai/agents/${selectedId}?wid=${encodeURIComponent(wid)}`,
        { method: "DELETE" },
      );
      setAgents((prev) => prev.filter((a) => a.id !== selectedId));
      setSelectedId(null);
      setEditing(false);
      setIsCreating(false);
      toast("success", t("edit"));
    } catch (e) {
      if (process.env.NODE_ENV === "development")
        console.error("[MultiAgentPanel] deleteAgent error:", e);
      setError(t("error"));
    }
  }

  /** 切换能力选中状态 */
  function toggleCapability(cap: string) {
    setFormData((prev) => ({
      ...prev,
      capabilities: prev.capabilities.includes(cap)
        ? prev.capabilities.filter((c) => c !== cap)
        : [...prev.capabilities, cap],
    }));
  }

  /** 执行协调任务 */
  async function executeTask() {
    if (executing || !task.trim()) return;

    setExecuting(true);
    setError("");
    setResult(null);
    try {
      const data = await api<CoordinationResult>(
        "/api/v1/ai/agents/coordinate",
        {
          method: "POST",
          body: JSON.stringify({ wid, task: task.trim() }),
        },
      );
      setResult(data);
      if (data.assignments.length === 0) {
        toast("warning", t("noAgents"));
      } else {
        toast("success", t("coordinate"));
      }
    } catch (e) {
      if (process.env.NODE_ENV === "development")
        console.error("[MultiAgentPanel] executeTask error:", e);
      setError(t("error"));
    } finally {
      setExecuting(false);
    }
  }

  const selectedAgent = selectedId
    ? agents.find((a) => a.id === selectedId)
    : null;

  return (
    <div
      className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-sm)]"
      aria-label={t("title")}
    >
      {/* ── 头部 ── */}
      <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
        <h2 className="flex items-center gap-2 text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          <Bot size={16} className="text-[var(--accent)]" />
          {t("title")}
        </h2>
        <button
          type="button"
          onClick={startCreate}
          disabled={editing}
          className="inline-flex items-center gap-1.5 h-8 px-3 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
        >
          <Plus size={14} />
          {t("create")}
        </button>
      </header>

      {/* ── 正文 ── */}
      <div className="px-5 py-4 space-y-[var(--space-3)]">
        {/* 错误态 */}
        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={() => setError("")}
              className="shrink-0 opacity-60 hover:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] rounded-[var(--radius-sm)]"
              aria-label="close"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* 加载态 */}
        {loading && (
          <div className="flex items-center justify-center py-8 text-[var(--muted)] text-[length:var(--text-sm)]">
            <Loader2 size={16} className="animate-spin mr-2" />
            {t("loadFailed")}
          </div>
        )}

        {/* 空态 */}
        {!loading && agents.length === 0 && !editing && (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--muted)] text-[length:var(--text-sm)] gap-2">
            <Bot size={32} className="opacity-40" />
            <p>{t("noAgents")}</p>
            <button
              type="button"
              onClick={startCreate}
              className="inline-flex items-center gap-1.5 h-8 px-3 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
            >
              <Plus size={14} />
              {t("create")}
            </button>
          </div>
        )}

        {/* Agent 列表 + 详情 */}
        {!loading && (agents.length > 0 || editing) && (
          <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-[var(--space-3)]">
            {/* 左侧 Agent 列表 */}
            <div className="space-y-1">
              <div className="text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--muted)] mb-1.5">
                {t("agents")}
              </div>
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(agent.id);
                    setEditing(false);
                    setIsCreating(false);
                  }}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-[var(--radius-md)] text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] ${
                    selectedId === agent.id
                      ? "bg-[var(--accent-soft)] text-[var(--accent-fg)]"
                      : "hover:bg-[var(--surface-2)] text-[var(--fg)]"
                  }`}
                >
                  <Bot size={14} className="shrink-0" />
                  <span className="flex-1 truncate text-[length:var(--text-sm)]">
                    {agent.name}
                  </span>
                  <span
                    className={`shrink-0 w-1.5 h-1.5 rounded-full ${
                      agent.enabled
                        ? "bg-[var(--success-fg)]"
                        : "bg-[var(--meta)]"
                    }`}
                    title={agent.enabled ? t("enabled") : t("disabled")}
                  />
                </button>
              ))}
            </div>

            {/* 右侧 Agent 详情/编辑 */}
            <div className="min-w-0">
              {editing ? (
                /* 编辑/创建表单 */
                <div className="space-y-[var(--space-3)] p-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border)]">
                  {/* name */}
                  <div>
                    <label
                      className="block text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] mb-1.5"
                      htmlFor="agent-name"
                    >
                      {t("name")}
                    </label>
                    <input
                      id="agent-name"
                      type="text"
                      value={formData.name}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          name: e.target.value,
                        }))
                      }
                      maxLength={100}
                      className={fieldControl}
                    />
                  </div>

                  {/* role */}
                  <div>
                    <label
                      className="block text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] mb-1.5"
                      htmlFor="agent-role"
                    >
                      {t("role")}
                    </label>
                    <select
                      id="agent-role"
                      value={formData.role}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          role: e.target.value,
                        }))
                      }
                      className={fieldControl}
                    >
                      {ROLE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {t(opt.labelKey)}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* capabilities */}
                  <div>
                    <label className="block text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] mb-1.5">
                      {t("capabilities")}
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {CAPABILITY_OPTIONS.map((cap) => {
                        const checked = formData.capabilities.includes(cap);
                        return (
                          <button
                            key={cap}
                            type="button"
                            onClick={() => toggleCapability(cap)}
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] ${
                              checked
                                ? "bg-[var(--accent)] text-[var(--accent-fg)] border-[var(--accent)]"
                                : "bg-[var(--surface)] text-[var(--fg)] border-[var(--border)] hover:border-[var(--accent)]"
                            }`}
                          >
                            {checked && <CheckCircle2 size={12} />}
                            {cap}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* systemPrompt */}
                  <div>
                    <label
                      className="block text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] mb-1.5"
                      htmlFor="agent-prompt"
                    >
                      {t("systemPrompt")}
                    </label>
                    <textarea
                      id="agent-prompt"
                      value={formData.systemPrompt}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          systemPrompt: e.target.value,
                        }))
                      }
                      maxLength={8000}
                      rows={5}
                      className={`${fieldControl} resize-y font-mono`}
                    />
                  </div>

                  {/* model */}
                  <div>
                    <label
                      className="block text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] mb-1.5"
                      htmlFor="agent-model"
                    >
                      {t("model")}
                    </label>
                    <select
                      id="agent-model"
                      value={formData.model}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          model: e.target.value,
                        }))
                      }
                      className={fieldControl}
                    >
                      {MODEL_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* enabled */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      role="switch"
                      onClick={() =>
                        setFormData((prev) => ({
                          ...prev,
                          enabled: !prev.enabled,
                        }))
                      }
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] ${
                        formData.enabled
                          ? "bg-[var(--accent)]"
                          : "bg-[var(--border)]"
                      }`}
                      aria-checked={formData.enabled}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                          formData.enabled ? "translate-x-5" : "translate-x-1"
                        }`}
                      />
                    </button>
                    <span className="text-[length:var(--text-sm)] text-[var(--fg)]">
                      {formData.enabled ? t("enabled") : t("disabled")}
                    </span>
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex items-center justify-end gap-2 pt-2">
                    {!isCreating && selectedId && (
                      <button
                        type="button"
                        onClick={deleteAgent}
                        className="inline-flex items-center gap-1.5 h-8 px-3 text-[var(--danger-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--danger-soft)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
                      >
                        <Trash2 size={14} />
                        {t("edit")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="inline-flex items-center gap-1.5 h-8 px-3 border border-[var(--border)] text-[var(--fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
                    >
                      {t("cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={saveAgent}
                      disabled={
                        saving ||
                        !formData.name.trim() ||
                        !formData.systemPrompt.trim()
                      }
                      className="inline-flex items-center gap-1.5 h-8 px-3 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
                    >
                      {saving ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          {t("edit")}
                        </>
                      ) : (
                        <>
                          <Save size={14} />
                          {isCreating ? t("create") : t("edit")}
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ) : selectedAgent ? (
                /* Agent 详情展示 */
                <div className="space-y-[var(--space-3)] p-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border)]">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
                      {selectedAgent.name}
                    </h3>
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] ${
                          selectedAgent.enabled
                            ? "bg-[var(--success-soft)] text-[var(--success-fg)]"
                            : "bg-[var(--surface-2)] text-[var(--muted)]"
                        }`}
                      >
                        <Power size={12} />
                        {selectedAgent.enabled
                          ? t("enabled")
                          : t("disabled")}
                      </span>
                      <button
                        type="button"
                        onClick={startEdit}
                        className="inline-flex items-center gap-1.5 h-8 px-3 border border-[var(--border)] text-[var(--fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
                      >
                        {t("edit")}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-[var(--space-2)] text-[length:var(--text-sm)]">
                    <div>
                      <span className="text-[var(--muted)]">
                        {t("role")}:
                      </span>
                      <span className="ml-1.5 text-[var(--fg)]">
                        {ROLE_OPTIONS.find(
                          (r) => r.value === selectedAgent.role,
                        )?.labelKey
                          ? t(ROLE_OPTIONS.find(
                              (r) => r.value === selectedAgent.role,
                            )!.labelKey)
                          : selectedAgent.role}
                      </span>
                    </div>
                    <div>
                      <span className="text-[var(--muted)]">
                        {t("model")}:
                      </span>
                      <span className="ml-1.5 text-[var(--fg)]">
                        {selectedAgent.model}
                      </span>
                    </div>
                  </div>

                  {Array.isArray(selectedAgent.capabilities) &&
                    (selectedAgent.capabilities as string[]).length > 0 && (
                      <div>
                        <span className="text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--muted)]">
                          {t("capabilities")}
                        </span>
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {(selectedAgent.capabilities as string[]).map(
                            (cap) => (
                              <span
                                key={cap}
                                className="inline-flex items-center px-2 py-0.5 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] bg-[var(--accent-soft)] text-[var(--accent-fg)]"
                              >
                                {cap}
                              </span>
                            ),
                          )}
                        </div>
                      </div>
                    )}

                  <div>
                    <span className="text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--muted)]">
                      {t("systemPrompt")}
                    </span>
                    <pre className="mt-1.5 p-2.5 rounded-[var(--radius-md)] bg-[var(--surface-2)] text-[length:var(--text-xs)] text-[var(--fg)] whitespace-pre-wrap break-words font-mono max-h-48 overflow-y-auto">
                      {selectedAgent.systemPrompt}
                    </pre>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full py-12 text-[var(--muted)] text-[length:var(--text-sm)]">
                  {t("noAgents")}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 协调任务输入框 */}
        {agents.length > 0 && (
          <div className="pt-4 border-t border-[var(--border-soft)] space-y-[var(--space-2)]">
            <label
              className="block text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]"
              htmlFor="coord-task"
            >
              {t("task")}
            </label>
            <div className="flex gap-2">
              <input
                id="coord-task"
                type="text"
                value={task}
                onChange={(e) => setTask(e.target.value)}
                maxLength={4000}
                placeholder={t("task")}
                disabled={executing}
                className={fieldControl}
              />
              <button
                type="button"
                onClick={executeTask}
                disabled={executing || !task.trim()}
                className="inline-flex items-center gap-1.5 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] shrink-0"
              >
                {executing ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    {t("executing")}
                  </>
                ) : (
                  <>
                    <Zap size={14} />
                    {t("coordinate")}
                  </>
                )}
              </button>
            </div>

            {/* 执行结果 */}
            {result && (
              <div className="space-y-2 pt-2">
                <div className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                  {t("result")}
                </div>
                {result.assignments.length === 0 ? (
                  <p className="text-[length:var(--text-sm)] text-[var(--muted)]">
                    {t("noAgents")}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {result.assignments.map((assignment, idx) => {
                      const response = result.responses[idx];
                      return (
                        <li
                          key={idx}
                          className="p-2.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] space-y-1.5"
                        >
                          <div className="flex items-center gap-2">
                            <Bot
                              size={14}
                              className="text-[var(--accent)] shrink-0"
                            />
                            <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                              {assignment.agentName}
                            </span>
                          </div>
                          <div className="text-[length:var(--text-xs)] text-[var(--muted)]">
                            <span className="font-[weight:var(--weight-medium)]">
                              {t("task")}:
                            </span>{" "}
                            {assignment.subtask}
                          </div>
                          <div className="text-[length:var(--text-xs)] text-[var(--meta)]">
                            {assignment.reason}
                          </div>
                          {response && (
                            <div className="pt-1.5 border-t border-[var(--border-soft)]">
                              <div className="text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--muted)] mb-0.5">
                                {t("response")}:
                              </div>
                              <p className="text-[length:var(--text-sm)] text-[var(--fg)] whitespace-pre-wrap break-words">
                                {response.response}
                              </p>
                              {response.handoff && (
                                <p className="mt-1.5 text-[length:var(--text-xs)] text-[var(--accent-fg)] bg-[var(--accent-soft)] px-2 py-1 rounded-[var(--radius-sm)]">
                                  {t("handoff")}: {response.handoff}
                                </p>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}