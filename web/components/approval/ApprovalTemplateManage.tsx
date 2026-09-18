"use client";

/**
 * 审批模板管理组件。
 *
 * 功能：
 * - 模板列表（名称、描述、节点数、状态）
 * - 创建 / 编辑模板弹窗（名称、描述、节点配置）
 * - 启用 / 禁用模板（PATCH）
 * - 删除模板（DELETE）
 * - 节点配置 UI：可添加 / 删除 / 排序节点，每个节点选择审批人角色或指定用户
 *
 * API：
 * - GET    /approvals/templates
 * - POST   /approvals/templates
 * - PATCH  /approvals/templates/{tid}
 * - DELETE /approvals/templates/{tid}
 *
 * 工作区成员列表（GET /members）用于"指定用户"审批人选择。
 */

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  Plus,
  Loader2,
  Trash2,
  Pencil,
  ArrowUp,
  ArrowDown,
  X,
  FileText,
  Power,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";

/** 审批模板 */
interface ApprovalTemplate {
  id: string;
  name: string;
  description?: string | null;
  active?: boolean;
  /** @deprecated 旧字段，保留兼容 */
  enabled?: boolean;
  nodes?: TemplateNode[] | null;
}

interface TemplateNode {
  name: string;
  order: number;
  approverRole?: string | null;
  approverUserId?: string | null;
}

/** 工作区成员 */
interface Member {
  id: string;
  name: string | null;
  email: string;
}

/** 可编辑的节点（前端临时态，含临时 id 便于 React key） */
interface EditableNode {
  tempId: string;
  name: string;
  approverRole: string;
  approverUserId: string;
}

interface ApprovalTemplateManageProps {
  workspaceId: string;
}

const fieldLabel =
  "flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)] mb-1.5";
const fieldControl =
  "w-full h-9 px-2.5 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]";

let tempIdCounter = 0;
function nextTempId() {
  tempIdCounter += 1;
  return `tmp-${tempIdCounter}`;
}

export function ApprovalTemplateManage({
  workspaceId,
}: ApprovalTemplateManageProps) {
  const t = useTranslations("approval");
  const tButton = useTranslations("button");

  const [templates, setTemplates] = useState<ApprovalTemplate[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 编辑弹窗状态
  const [editDialog, setEditDialog] = useState<{
    template: ApprovalTemplate | null; // null = 新建
  } | null>(null);

  async function loadTemplates() {
    setLoading(true);
    setError("");
    try {
      const data = await api<
        ApprovalTemplate[] | { items: ApprovalTemplate[] }
      >(`/api/v1/workspaces/${workspaceId}/approvals/templates`);
      const list = Array.isArray(data) ? data : (data.items ?? []);
      setTemplates(list);
    } catch (e) {
      setError(
        e instanceof ApiError || e instanceof Error
          ? e.message
          : t("loadFailed"),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTemplates();
    // 拉取成员列表用于节点审批人选择
    api<Member[]>(`/api/v1/workspaces/${workspaceId}/members`)
      .then(setMembers)
      .catch(() => {
        // 成员列表加载失败不阻塞模板管理
      });
  }, [workspaceId, t]);

  async function toggleEnabled(tpl: ApprovalTemplate) {
    // 后端字段为 active（非 enabled）
    const nextActive = !tpl.active;
    try {
      await api(
        `/api/v1/workspaces/${workspaceId}/approvals/templates/${tpl.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ active: nextActive }),
        },
      );
      setTemplates((prev) =>
        prev.map((item) =>
          item.id === tpl.id ? { ...item, active: nextActive } : item,
        ),
      );
    } catch (e) {
      setError(
        e instanceof ApiError || e instanceof Error
          ? e.message
          : t("operationFailed"),
      );
    }
  }

  async function deleteTemplate(tpl: ApprovalTemplate) {
    if (!window.confirm(t("confirmDeleteTemplate"))) return;
    try {
      await api(
        `/api/v1/workspaces/${workspaceId}/approvals/templates/${tpl.id}`,
        { method: "DELETE" },
      );
      setTemplates((prev) => prev.filter((item) => item.id !== tpl.id));
    } catch (e) {
      setError(
        e instanceof ApiError || e instanceof Error
          ? e.message
          : t("operationFailed"),
      );
    }
  }

  return (
    <div className="max-w-[var(--container-max)] mx-auto px-[var(--space-4)] py-[var(--space-6)]">
      <div className="flex items-center justify-between mb-[var(--space-5)]">
        <h1 className="text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)]">
          {t("templateManage")}
        </h1>
        <button
          onClick={() => setEditDialog({ template: null })}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)]"
        >
          <Plus size={14} />
          {t("addTemplate")}
        </button>
      </div>

      {error && (
        <p className="mb-3 text-[length:var(--text-sm)] text-[var(--danger)]">
          {error}
        </p>
      )}

      {loading ? (
        <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
          <Loader2 size={20} className="inline animate-spin mr-2" />
          {t("loading")}
        </div>
      ) : templates.length === 0 ? (
        <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
          <FileText size={36} className="mx-auto mb-3 opacity-50" />
          <p>{t("templateEmpty")}</p>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border-soft)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
          {templates.map((tpl) => {
            const nodeCount = tpl.nodes?.length ?? 0;
            return (
              <li
                key={tpl.id}
                className="px-[var(--space-4)] py-3 hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
              >
                <div className="flex items-center gap-2">
                  <FileText
                    size={15}
                    className="shrink-0 text-[var(--muted)]"
                  />
                  <span className="flex-1 min-w-0 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] truncate">
                    {tpl.name}
                  </span>
                  <span
                    className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] ${
                      tpl.active
                        ? "text-[var(--success)] bg-[var(--success-soft, var(--surface-2))]"
                        : "text-[var(--muted)] bg-[var(--surface-2)]"
                    }`}
                  >
                    {tpl.active ? (
                      <CheckCircle2 size={12} />
                    ) : (
                      <XCircle size={12} />
                    )}
                    {tpl.active ? t("templateEnabled") : t("templateDisabled")}
                  </span>
                </div>
                {tpl.description && (
                  <p className="mt-1 ml-6 text-[length:var(--text-xs)] text-[var(--muted)] break-words">
                    {tpl.description}
                  </p>
                )}
                <div className="mt-1.5 ml-6 flex items-center gap-3 text-[length:var(--text-xs)] text-[var(--meta)]">
                  <span>
                    {t("nodes")}: {nodeCount}
                  </span>
                </div>
                <div className="mt-2 ml-6 flex items-center gap-2">
                  <button
                    onClick={() => setEditDialog({ template: tpl })}
                    className="inline-flex items-center gap-1 h-7 px-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-xs)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                  >
                    <Pencil size={12} />
                    {t("edit")}
                  </button>
                  <button
                    onClick={() => toggleEnabled(tpl)}
                    className="inline-flex items-center gap-1 h-7 px-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-xs)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                  >
                    <Power size={12} />
                    {tpl.active ? t("disable") : t("enable")}
                  </button>
                  <button
                    onClick={() => deleteTemplate(tpl)}
                    className="inline-flex items-center gap-1 h-7 px-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-xs)] text-[var(--danger)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                  >
                    <Trash2 size={12} />
                    {t("delete")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* 编辑/新建弹窗 */}
      {editDialog && (
        <TemplateEditDialog
          workspaceId={workspaceId}
          template={editDialog.template}
          members={members}
          onClose={() => setEditDialog(null)}
          onSaved={() => {
            setEditDialog(null);
            loadTemplates();
          }}
        />
      )}
    </div>
  );
}

/** 模板编辑/新建弹窗 */
function TemplateEditDialog({
  workspaceId,
  template,
  members,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  template: ApprovalTemplate | null;
  members: Member[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("approval");
  const tButton = useTranslations("button");

  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [nodes, setNodes] = useState<EditableNode[]>(
    template?.nodes && template.nodes.length > 0
      ? template.nodes
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((n) => ({
            tempId: nextTempId(),
            name: n.name,
            approverRole: n.approverRole ?? "",
            approverUserId: n.approverUserId ?? "",
          }))
      : [{ tempId: nextTempId(), name: "", approverRole: "", approverUserId: "" }],
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function addNode() {
    setNodes((prev) => [
      ...prev,
      { tempId: nextTempId(), name: "", approverRole: "", approverUserId: "" },
    ]);
  }

  function removeNode(tempId: string) {
    setNodes((prev) =>
      prev.length > 1
        ? prev.filter((n) => n.tempId !== tempId)
        : [{ tempId: nextTempId(), name: "", approverRole: "", approverUserId: "" }],
    );
  }

  function moveNode(idx: number, dir: -1 | 1) {
    setNodes((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  function updateNode(
    tempId: string,
    field: keyof EditableNode,
    val: string,
  ) {
    setNodes((prev) =>
      prev.map((n) => (n.tempId === tempId ? { ...n, [field]: val } : n)),
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!name.trim()) {
      setError(t("templateNameRequired"));
      return;
    }
    // 过滤有效节点（有名称）
    const validNodes = nodes.filter((n) => n.name.trim());
    if (validNodes.length === 0) {
      setError(t("nodeRequired"));
      return;
    }
    // 校验每个节点有审批人
    for (const n of validNodes) {
      if (!n.approverRole && !n.approverUserId) {
        setError(t("approverRequired"));
        return;
      }
    }
    setSubmitting(true);
    setError("");
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        nodes: validNodes.map((n, i) => ({
          name: n.name.trim(),
          order: i + 1,
          approverRole: n.approverRole || null,
          approverUserId: n.approverUserId || null,
        })),
      };
      if (template) {
        await api(
          `/api/v1/workspaces/${workspaceId}/approvals/templates/${template.id}`,
          { method: "PATCH", body: JSON.stringify(payload) },
        );
      } else {
        await api(
          `/api/v1/workspaces/${workspaceId}/approvals/templates`,
          { method: "POST", body: JSON.stringify(payload) },
        );
      }
      onSaved();
    } catch (e) {
      setError(
        e instanceof ApiError || e instanceof Error
          ? e.message
          : t("operationFailed"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  const isEdit = template !== null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="template-edit-title"
      className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center p-4 sm:p-8 overflow-y-auto bg-[var(--overlay)]"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        onClose();
      }}
    >
      <div className="w-full max-w-lg my-auto bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-lg)]">
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
          <h2
            id="template-edit-title"
            className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]"
          >
            {isEdit ? t("editTemplate") : t("createTemplate")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            aria-label={tButton("close")}
          >
            <X size={16} />
          </button>
        </header>

        <form onSubmit={submit} className="px-4 sm:px-5 py-4 space-y-4">
          {/* 模板名称 */}
          <div>
            <label className={fieldLabel} htmlFor="tpl-name">
              {t("templateName")}
            </label>
            <input
              id="tpl-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              className={`${fieldControl} h-10`}
              aria-required="true"
            />
          </div>

          {/* 模板描述 */}
          <div>
            <label className={fieldLabel} htmlFor="tpl-desc">
              {t("templateDesc")}
            </label>
            <textarea
              id="tpl-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={500}
              className="w-full px-2.5 py-2 resize-y border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]"
            />
          </div>

          {/* 节点配置 */}
          <div>
            <label className={fieldLabel}>{t("nodes")}</label>
            <div className="space-y-2">
              {nodes.map((node, idx) => (
                <div
                  key={node.tempId}
                  className="px-3 py-2.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)]"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[var(--surface)] border border-[var(--border)] text-[length:var(--text-xs)] text-[var(--meta)] font-[weight:var(--weight-medium)]">
                      {idx + 1}
                    </span>
                    <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
                      {t("nodeOrder")}
                    </span>
                    <div className="flex-1" />
                    <button
                      type="button"
                      onClick={() => moveNode(idx, -1)}
                      disabled={idx === 0}
                      className="w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)]"
                      aria-label={t("nodeOrder")}
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveNode(idx, 1)}
                      disabled={idx === nodes.length - 1}
                      className="w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)]"
                      aria-label={t("nodeOrder")}
                    >
                      <ArrowDown size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeNode(node.tempId)}
                      className="w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:text-[var(--danger)] hover:bg-[var(--surface)] transition-colors duration-[var(--motion-fast)]"
                      aria-label={t("delete")}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <div className="space-y-2">
                    <input
                      value={node.name}
                      onChange={(e) =>
                        updateNode(node.tempId, "name", e.target.value)
                      }
                      maxLength={50}
                      placeholder={t("nodeName")}
                      className={fieldControl}
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[length:var(--text-xs)] text-[var(--meta)] mb-1">
                          {t("approverRole")}
                        </label>
                        <input
                          value={node.approverRole}
                          onChange={(e) =>
                            updateNode(
                              node.tempId,
                              "approverRole",
                              e.target.value,
                            )
                          }
                          maxLength={50}
                          placeholder={t("approverRole")}
                          className={fieldControl}
                        />
                      </div>
                      <div>
                        <label className="block text-[length:var(--text-xs)] text-[var(--meta)] mb-1">
                          {t("approverUser")}
                        </label>
                        <select
                          value={node.approverUserId}
                          onChange={(e) =>
                            updateNode(
                              node.tempId,
                              "approverUserId",
                              e.target.value,
                            )
                          }
                          className={fieldControl}
                        >
                          <option value="">—</option>
                          {members.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name || m.email}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={addNode}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-sm)] border border-dashed border-[var(--border)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
              >
                <Plus size={14} />
                {t("addNode")}
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--danger-soft, var(--surface-2))] text-[var(--danger-fg, var(--danger))] text-[length:var(--text-sm)]">
              <span className="flex-1">{error}</span>
              <button
                type="button"
                onClick={() => setError("")}
                className="shrink-0 opacity-60 hover:opacity-100 transition-opacity rounded-[var(--radius-sm)]"
                aria-label={tButton("close")}
              >
                <X size={14} />
              </button>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            >
              {tButton("cancel")}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {isEdit ? t("save") : t("createTemplate")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ApprovalTemplateManage;