"use client";

/**
 * 文档编辑器：标题输入 + markdown 大文本框（自动保存到 working draft）+ 操作栏。
 *
 * 设计取舍：
 * - 用纯 textarea 而非第三方 markdown 编辑器：决策记录那套 textarea+Markdown 预览
 *   已被任务详情页验证可用，复用一致 UX；不引入富文本以免增加 bundle 与 XSS 面。
 * - 自动保存：onBlur（与任务描述/决策编辑器同模式）——避免每键保存风暴，
 *   失焦节流足够覆盖 99% 输入完成场景。
 * - 发布 = 把当前 markdown 快照到 publishedMarkdown + 打 publishedAt。
 * - 分享（F5 增强）：点击「分享」打开设置对话框，可配置有效期 / 密码保护 /
 *   查看访问日志 / 撤销分享。调用 PATCH /share 保存，GET /share/logs 拉日志。
 * - 导出（F4）：点击「导出」打开 ExportPreview 模态框，预览 + 打印/保存 PDF。
 */

import { useState, useRef, useTransition, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/lib/i18n-navigation";
import {
  Loader2,
  Share2,
  X,
  Globe,
  Eye,
  Download,
  Columns2,
  Zap,
  Check,
  Calendar,
  KeyRound,
  History,
  Trash2,
  ChevronDown,
  Lock,
  AlertTriangle,
  Plus,
} from "lucide-react";
import { api } from "@/lib/api";
import Markdown from "@/components/Markdown";
import { MarkdownToolbar, useEditorKeys } from "@/components/MarkdownToolbar";
import { QuickDiagram } from "@/components/QuickDiagram";
import { useToast } from "@/components/Toast";
import { ExportPreview } from "@/components/ExportPreview";
import { ACTION_TEMPLATES } from "@/lib/decision-action-parser";

interface DocumentEditorProps {
  wid: string;
  id: string;
  initial: {
    title: string;
    markdown: string;
    publishedMarkdown: string | null;
    publishedAt: string | null;
    shareToken: string | null;
  };
}

/** 分享访问日志条目（与 ShareAccessLog Prisma 模型对应） */
interface ShareAccessLog {
  id: string;
  entityType: string;
  entityId: string;
  ip: string;
  userAgent: string | null;
  accessedAt: string;
}

/** 分享有效期选择模式 */
type ExpiryMode = "never" | "7d" | "30d" | "custom";

/** 从 User-Agent 提取浏览器摘要（用于访问日志展示） */
function uaSummary(ua: string | null): string {
  if (!ua) return "—";
  if (/Edg\//.test(ua)) return "Edge";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  if (/PostmanRuntime\//.test(ua)) return "Postman";
  if (/curl\//.test(ua)) return "curl";
  return ua.length > 40 ? ua.slice(0, 40) + "…" : ua;
}

export function DocumentEditor({ wid, id, initial }: DocumentEditorProps) {
  const t = useTranslations("document");
  const tDiagram = useTranslations("diagramQuick");
  const tDecision = useTranslations("decision");
  const router = useRouter();
  const { toast } = useToast();
  const [title, setTitle] = useState(initial.title);
  const [markdown, setMarkdown] = useState(initial.markdown);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [shareToken, setShareToken] = useState(initial.shareToken);
  const [publishedAt, setPublishedAt] = useState(initial.publishedAt);
  // S1 修复：SSR 阶段 window 未定义，需 typeof window 守卫避免 ReferenceError。
  // 仅在客户端且有 shareToken 时才构造 URL；服务端渲染返回 null，hydration 后由
  // 下方的 useEffect 同步补全（见下）。
  const [shareUrl, setShareUrl] = useState<string | null>(
    initial.shareToken && typeof window !== "undefined"
      ? `${window.location.origin}/documents/share/${initial.shareToken}`
      : null,
  );
  // S1 修复续：若 SSR 阶段跳过了 URL 构造（typeof window === "undefined"）但
  // initial.shareToken 存在，客户端 hydration 后补全 shareUrl，避免链接丢失。
  useEffect(() => {
    if (initial.shareToken && shareUrl === null && typeof window !== "undefined") {
      setShareUrl(`${window.location.origin}/documents/share/${initial.shareToken}`);
    }
    // 仅在挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [preview, setPreview] = useState(false);
  /** 分屏模式（v0.6）：编辑与预览并排实时渲染（Obsidian 式），与单页切换互斥 */
  const [split, setSplit] = useState(false);
  const [busy, setBusy] = useState<"save" | "publish" | "share" | null>(null);
  const [error, setError] = useState("");
  const [, startTransition] = useTransition();
  // LI-10：复制分享链接成功反馈（短暂打勾替代文案，2s 后恢复）
  const [copied, setCopied] = useState(false);
  // 自动保存成功反馈：短暂显示"已保存"提示（2s 后消失）
  const [savedFlash, setSavedFlash] = useState(false);

  // ── F5：分享设置对话框状态 ──
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareExpiresAt, setShareExpiresAt] = useState<string | null>(null);
  const [hasPassword, setHasPassword] = useState(false);
  const [sharePasswordInput, setSharePasswordInput] = useState("");
  const [expiryMode, setExpiryMode] = useState<ExpiryMode>("never");
  const [customExpiryDate, setCustomExpiryDate] = useState("");
  const [accessLogs, setAccessLogs] = useState<ShareAccessLog[]>([]);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [revokeConfirm, setRevokeConfirm] = useState(false);

  // ── F4：导出预览模态框 ──
  const [exportOpen, setExportOpen] = useState(false);

  // Typora 式快捷键层（Ctrl+B/I/K、列表续行、Tab 缩进）——与工具栏共用实现
  const handleKeyDown = useEditorKeys({
    textareaRef: editorRef,
    value: markdown,
    onChange: setMarkdown,
  });
  /** 快速图表对话框：插入 ```mermaid 块到正文（追加到末尾，编辑器语义里"出一张图"） */
  const [quickDiagramOpen, setQuickDiagramOpen] = useState(false);

  // ── F1 增强：行动项模板插入下拉菜单 ──
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);

  // Escape 关闭模板下拉菜单
  useEffect(() => {
    if (!templateMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTemplateMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [templateMenuOpen]);

  // ── F5 增强：分享自定义路径（shareSlug）──
  const [shareSlug, setShareSlug] = useState<string>("");
  const [shareSlugSaved, setShareSlugSaved] = useState<string | null>(null);

  function insertDiagramBlock(block: string) {
    const sep = markdown.endsWith("\n") || markdown === "" ? "" : "\n\n";
    setMarkdown(markdown + sep + block);
  }

  /**
   * F1 增强：插入行动项模板到编辑器。
   * - 模板中的 {dueDate} 占位符替换为当前日期 + 7 天（YYYY-MM-DD）
   * - 优先插入到光标位置（textarea selectionStart），无光标信息时追加到末尾
   * - 自动补足分隔换行，避免与上下文粘连
   */
  function handleInsertTemplate(templateMarkdown: string) {
    const due = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const dueDateStr = due.toISOString().slice(0, 10);
    const filled = templateMarkdown.replace(/\{dueDate\}/g, dueDateStr);
    const ta = editorRef.current;
    if (ta && ta.selectionStart != null && ta.selectionEnd != null) {
      // 光标位置插入
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const before = markdown.slice(0, start);
      const after = markdown.slice(end);
      // 在光标前补换行（若非行首且非空）
      const needLeadingNL = before.length > 0 && !before.endsWith("\n");
      const needTrailingNL = after.length > 0 && !after.startsWith("\n");
      const inserted =
        (needLeadingNL ? "\n" : "") + filled + (needTrailingNL ? "\n" : "");
      const next = before + inserted + after;
      setMarkdown(next);
      // 还原光标到插入内容末尾
      requestAnimationFrame(() => {
        const pos = start + inserted.length;
        ta.focus();
        ta.setSelectionRange(pos, pos);
      });
    } else {
      // 末尾追加
      const sep = markdown.endsWith("\n") || markdown === "" ? "" : "\n\n";
      setMarkdown(markdown + sep + filled);
    }
    setTemplateMenuOpen(false);
  }

  async function save(opts: { publish?: boolean } = {}) {
    if (busy) return;
    setBusy(opts.publish ? "publish" : "save");
    setError("");
    try {
      const res = await api<{
        id: string;
        publishedMarkdown: string | null;
        publishedAt: string | null;
      }>(`/api/v1/workspaces/${wid}/documents/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ title, markdown, publish: !!opts.publish }),
      });
      if (opts.publish && res.publishedAt) {
        setPublishedAt(res.publishedAt);
      }
      // 自动保存成功：短暂显示"已保存"提示（非发布场景）
      if (!opts.publish) {
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 2000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setBusy(null);
    }
  }

  /** LI-10：复制分享链接并给出 2s 视觉反馈 */
  async function copyShareUrl() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* 剪贴板权限失败：提示用户复制失败 */
      toast("error", t("copyFailed"));
    }
  }

  // ── F5：分享设置对话框 ──────────────────────────────────────────

  /** 打开分享对话框：若无 token 先生成，再加载当前设置 + 访问日志 */
  async function openShareDialog() {
    if (busy) return;
    setError("");
    let token = shareToken;
    // 若还没有 shareToken，先生成（PATCH shareToken="rotate" 触发服务端生成）
    if (!token) {
      setBusy("share");
      try {
        const res = await api<{ id: string; shareToken: string | null }>(
          `/api/v1/workspaces/${wid}/documents/${id}`,
          {
            method: "PATCH",
            body: JSON.stringify({ shareToken: "rotate" }),
          },
        );
        if (res.shareToken) {
          token = res.shareToken;
          setShareToken(token);
          setShareUrl(`${window.location.origin}/documents/share/${token}`);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : t("shareFailed"));
        setBusy(null);
        return;
      }
      setBusy(null);
    }
    setShareDialogOpen(true);
    setRevokeConfirm(false);
    setSharePasswordInput("");
    // 加载当前分享设置（GET /share）
    try {
      const settings = await api<{
        shareToken: string | null;
        shareExpiresAt: string | null;
        hasPassword: boolean;
        shareSlug?: string | null;
      }>(`/api/v1/workspaces/${wid}/documents/${id}/share`);
      setHasPassword(settings.hasPassword);
      // F5 增强：加载已保存的自定义路径
      const slug = settings.shareSlug ?? "";
      setShareSlug(slug);
      setShareSlugSaved(slug);
      if (settings.shareExpiresAt) {
        setShareExpiresAt(settings.shareExpiresAt);
        const days = Math.round(
          (new Date(settings.shareExpiresAt).getTime() - Date.now()) / 86400000,
        );
        if (days >= 6 && days <= 8) setExpiryMode("7d");
        else if (days >= 29 && days <= 31) setExpiryMode("30d");
        else {
          setExpiryMode("custom");
          setCustomExpiryDate(settings.shareExpiresAt.slice(0, 10));
        }
      } else {
        setShareExpiresAt(null);
        setExpiryMode("never");
      }
    } catch {
      // 加载设置失败：用默认值，不阻断对话框
      setExpiryMode("never");
      setHasPassword(false);
      setShareExpiresAt(null);
    }
    // 加载访问日志
    loadAccessLogs();
  }

  /** 加载访问日志（GET /share/logs，取最近 20 条） */
  async function loadAccessLogs() {
    setLogsLoading(true);
    try {
      const res = await api<{
        items: ShareAccessLog[];
        pagination: { page: number; pageSize: number; total: number; totalPages: number };
      }>(`/api/v1/workspaces/${wid}/documents/${id}/share/logs?pageSize=20`);
      setAccessLogs(res.items);
    } catch {
      toast("error", t("shareLoadLogsFailed"));
    } finally {
      setLogsLoading(false);
    }
  }

  /** 保存分享设置（PATCH /share：有效期 + 密码 + 自定义路径） */
  async function saveShareSettings() {
    if (busy) return;
    setBusy("share");
    setError("");
    try {
      const body: {
        expiresAt: string | null;
        password?: string;
        shareSlug?: string | null;
      } = {
        expiresAt: null,
      };
      // 计算过期时间
      if (expiryMode === "7d") {
        body.expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
      } else if (expiryMode === "30d") {
        body.expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
      } else if (expiryMode === "custom" && customExpiryDate) {
        body.expiresAt = new Date(customExpiryDate + "T23:59:59").toISOString();
      }
      // 密码（仅当用户输入了新密码时才传）
      if (sharePasswordInput) {
        body.password = sharePasswordInput;
      }
      // F5 增强：自定义路径（仅当用户修改了 slug 才传，避免无谓写）
      if (shareSlug !== (shareSlugSaved ?? "")) {
        body.shareSlug = shareSlug.trim() || null;
      }
      await api(`/api/v1/workspaces/${wid}/documents/${id}/share`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      if (sharePasswordInput) setHasPassword(true);
      setSharePasswordInput("");
      setShareExpiresAt(body.expiresAt);
      // 同步已保存 slug 状态
      if (body.shareSlug !== undefined) {
        setShareSlugSaved(body.shareSlug ?? "");
      }
      toast("success", t("shareSettingsSaved"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("shareFailed"));
    } finally {
      setBusy(null);
    }
  }

  /** 移除密码保护（PATCH /share password=null） */
  async function removePassword() {
    if (busy) return;
    setBusy("share");
    setError("");
    try {
      await api(`/api/v1/workspaces/${wid}/documents/${id}/share`, {
        method: "PATCH",
        body: JSON.stringify({ password: null }),
      });
      setHasPassword(false);
      setSharePasswordInput("");
      toast("success", t("shareSettingsSaved"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("shareFailed"));
    } finally {
      setBusy(null);
    }
  }

  /** 撤销分享（清除 shareToken + shareExpiresAt + sharePassword） */
  async function revokeShare() {
    if (busy) return;
    setBusy("share");
    setError("");
    try {
      // 先清除 token（PATCH document shareToken=null）
      await api(`/api/v1/workspaces/${wid}/documents/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ shareToken: null }),
      });
      // 再清除过期 + 密码（PATCH /share）
      await api(`/api/v1/workspaces/${wid}/documents/${id}/share`, {
        method: "PATCH",
        body: JSON.stringify({ expiresAt: null, password: null }),
      });
      setShareToken(null);
      setShareUrl(null);
      setShareExpiresAt(null);
      setHasPassword(false);
      setSharePasswordInput("");
      setExpiryMode("never");
      setShareDialogOpen(false);
      setRevokeConfirm(false);
      toast("success", t("shareRevoked"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("shareFailed"));
    } finally {
      setBusy(null);
    }
  }

  // 分享对话框 Escape 关闭 + body 滚动锁
  useEffect(() => {
    if (!shareDialogOpen) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        setShareDialogOpen(false);
        setRevokeConfirm(false);
      }
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [shareDialogOpen]);

  function back() {
    startTransition(() => router.push(`/w/${wid}/documents`));
  }

  /** 今日日期 YYYY-MM-DD（用于 date input min 属性） */
  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div className="max-w-3xl mx-auto px-[var(--space-4)] py-[var(--space-6)]">
      {/* 标题 */}
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => save()}
        maxLength={255}
        placeholder={t("titlePlaceholder")}
        className="w-full px-0 py-2 bg-transparent text-[length:var(--text-3xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)] outline-none border-b border-transparent focus:border-[var(--border)] placeholder:text-[var(--meta)]"
      />

      {/* 工具栏 */}
      <div className="flex items-center justify-between mt-3 mb-4 gap-2 flex-nowrap overflow-x-auto scrollbar-hide">
        <div className="flex items-center gap-2 text-[length:var(--text-xs)] text-[var(--muted)] min-w-0">
          {/* LI-10：自动保存中指示器 */}
          {busy === "save" && (
            <span className="inline-flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" />
              {t("saving")}
            </span>
          )}
          {/* 自动保存成功反馈：短暂显示"已保存"提示 */}
          {savedFlash && busy !== "save" && (
            <span className="inline-flex items-center gap-1 text-[var(--success)]">
              <Check size={12} />
              {t("saved")}
            </span>
          )}
          {publishedAt && (
            <span>
              {t("publishedAt", {
                date: new Date(publishedAt).toLocaleString(),
              })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-nowrap justify-end shrink-0">
          <button
            onClick={back}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--muted)] hover:text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
          >
            <X size={14} />
            {t("backToList")}
          </button>
          <button
            onClick={() => setPreview((v) => !v)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] border border-[var(--border)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
          >
            <Eye size={14} />
            {preview ? t("editMode") : t("previewMode")}
          </button>
          <button
            onClick={() => {
              setSplit((v) => !v);
              setPreview(false);
            }}
            aria-pressed={split}
            className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] border text-[length:var(--text-sm)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] ${
              split
                ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--surface-2)]"
                : "border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)]"
            }`}
            title={t("splitHint")}
          >
            <Columns2 size={14} />
            {t("splitMode")}
          </button>
          {/* 快速图表：不进正文也能出图，确认后一键插入（v0.6 增补） */}
          <button
            onClick={() => setQuickDiagramOpen(true)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] border border-[var(--border)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
            title={tDiagram("title")}
          >
            <Zap size={14} />
            <span className="hidden sm:inline">{tDiagram("title")}</span>
          </button>
          {/* F1 增强：插入行动项模板（下拉菜单，复用 ACTION_TEMPLATES） */}
          <div className="relative">
            <button
              onClick={() => setTemplateMenuOpen((v) => !v)}
              title={tDecision("insertTemplate")}
              aria-label={tDecision("insertTemplate")}
              aria-expanded={templateMenuOpen}
              aria-haspopup="menu"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] border border-[var(--border)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
            >
              <Plus size={14} />
              <span className="hidden sm:inline">{tDecision("insertTemplate")}</span>
              <ChevronDown size={12} className="text-[var(--muted)]" />
            </button>
            {templateMenuOpen && (
              <>
                {/* 点击外部关闭 */}
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setTemplateMenuOpen(false)}
                  aria-hidden="true"
                />
                <ul
                  role="menu"
                  aria-label={tDecision("templateMenuOpen")}
                  className="absolute right-0 top-9 z-20 min-w-[220px] rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface)] shadow-[var(--elev-md)] py-1"
                >
                  {ACTION_TEMPLATES.map((tpl) => (
                    <li key={tpl.id} role="menuitem">
                      <button
                        onClick={() => handleInsertTemplate(tpl.markdown)}
                        className="w-full text-left px-3 py-1.5 hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                      >
                        <div className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
                          {tpl.name}
                        </div>
                        <div className="text-[length:var(--text-xs)] text-[var(--meta)]">
                          {tpl.description}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          {/* F5：分享按钮 → 打开分享设置对话框 */}
          <button
            onClick={openShareDialog}
            disabled={busy !== null}
            title={busy !== null ? t("saving") : undefined}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] border border-[var(--border)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
          >
            <Share2 size={14} />
            {t("share")}
          </button>
          {/* F4：导出按钮 → 打开 ExportPreview 模态框 */}
          <button
            onClick={() => setExportOpen(true)}
            title={t("exportHint")}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] border border-[var(--border)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
          >
            <Download size={14} />
            {t("export")}
          </button>
          <button
            onClick={() => save({ publish: true })}
            disabled={busy !== null}
            title={busy !== null ? t("saving") : undefined}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
          >
            {busy === "publish" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Globe size={14} />
            )}
            {t("publish")}
          </button>
        </div>
      </div>

      {/* 分享链接条（快捷展示，详细设置在对话框内） */}
      {shareUrl && (
        <div className="mb-3 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--surface-2)] border border-[var(--border)] flex items-center gap-2 text-[length:var(--text-xs)]">
          <span className="text-[var(--muted)] shrink-0">{t("shareUrl")}:</span>
          <input
            value={shareUrl}
            readOnly
            className="flex-1 min-w-0 bg-transparent text-[var(--fg-2)] font-[family-name:var(--font-mono)] outline-none truncate"
          />
          <button
            onClick={copyShareUrl}
            className="shrink-0 inline-flex items-center gap-1 text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] rounded-[var(--radius-sm)]"
          >
            {copied ? <Check size={12} /> : null}
            {copied ? t("copied") : t("copy")}
          </button>
          <button
            onClick={openShareDialog}
            className="shrink-0 inline-flex items-center gap-1 text-[var(--muted)] hover:text-[var(--fg-2)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] rounded-[var(--radius-sm)]"
          >
            {t("shareSettings")}
          </button>
        </div>
      )}

      {/* 编辑/预览/分屏 */}
      {preview ? (
        <div className="prose prose-sm max-w-none rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-6)] min-h-[60dvh]">
          <Markdown source={markdown} />
        </div>
      ) : split ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
          <div>
            <div className="mb-2">
              <MarkdownToolbar textareaRef={editorRef} value={markdown} onChange={setMarkdown} />
            </div>
            <textarea
              ref={editorRef}
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => save()}
              placeholder={t("markdownPlaceholder")}
              className="w-full h-[60dvh] p-[var(--space-4)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] font-[family-name:var(--font-mono)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)] resize-y"
            />
          </div>
          <div className="prose prose-sm max-w-none rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)] min-h-[60dvh] overflow-y-auto lg:max-h-[calc(60dvh+2rem)]">
            <Markdown source={markdown} />
          </div>
        </div>
      ) : (
        <>
          <div className="mb-2">
            <MarkdownToolbar textareaRef={editorRef} value={markdown} onChange={setMarkdown} />
          </div>
          <textarea
            ref={editorRef}
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => save()}
            placeholder={t("markdownPlaceholder")}
            className="w-full h-[60dvh] p-[var(--space-4)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] font-[family-name:var(--font-mono)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)] resize-y"
          />
        </>
      )}

      {error && (
        <div className="mt-2 flex items-start gap-2 text-[length:var(--text-sm)] text-[var(--danger)]">
          <span className="flex-1">{error}</span>
          <button
            onClick={() => setError("")}
            className="shrink-0 opacity-60 hover:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] rounded-[var(--radius-sm)]"
            aria-label={t("backToList")}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* 快速图表对话框（编辑模式下从顶栏唤起） */}
      <QuickDiagram
        open={quickDiagramOpen}
        onClose={() => setQuickDiagramOpen(false)}
        onInsert={insertDiagramBlock}
      />

      {/* ── F5：分享设置对话框 ── */}
      {shareDialogOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("shareDialogTitle")}
          className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[var(--overlay)] p-4"
          onClick={() => {
            setShareDialogOpen(false);
            setRevokeConfirm(false);
          }}
        >
          <div
            className="flex flex-col w-full max-w-lg max-h-[85dvh] rounded-[var(--radius-lg)] bg-[var(--surface)] border border-[var(--border)] shadow-[var(--elev-lg)] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头部 */}
            <header className="flex items-center gap-2 px-[var(--space-4)] py-2.5 border-b border-[var(--border-soft)] shrink-0">
              <Share2 size={16} className="text-[var(--muted)]" />
              <span className="flex-1 min-w-0 text-[length:var(--text-base)] font-[weight:var(--weight-semibold)] text-[var(--fg)] truncate">
                {t("shareDialogTitle")}
              </span>
              <button
                onClick={() => {
                  setShareDialogOpen(false);
                  setRevokeConfirm(false);
                }}
                aria-label={t("close")}
                className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-[var(--radius-sm)] text-[var(--meta)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
              >
                <X size={16} />
              </button>
            </header>

            {/* 内容区 */}
            <div className="flex-1 min-h-0 overflow-auto px-[var(--space-5)] py-[var(--space-4)] space-y-5">
              {/* 分享链接 */}
              {shareUrl && (
                <div>
                  <label className="block text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] mb-1.5">
                    {t("shareUrl")}
                  </label>
                  <div className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--surface-2)] border border-[var(--border)]">
                    <input
                      value={shareUrl}
                      readOnly
                      className="flex-1 min-w-0 bg-transparent text-[var(--fg-2)] font-[family-name:var(--font-mono)] text-[length:var(--text-xs)] outline-none truncate"
                    />
                    <button
                      onClick={copyShareUrl}
                      className="shrink-0 inline-flex items-center gap-1 text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] rounded-[var(--radius-sm)]"
                    >
                      {copied ? <Check size={12} /> : null}
                      {copied ? t("copied") : t("copy")}
                    </button>
                  </div>
                </div>
              )}

              {/* F5 增强：自定义路径（shareSlug） */}
              <div>
                <label className="flex items-center gap-1.5 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] mb-1.5">
                  <Share2 size={14} className="text-[var(--muted)]" />
                  {t("customSlug")}
                </label>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 inline-flex items-center h-9 px-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] text-[length:var(--text-sm)] text-[var(--meta)] font-[family-name:var(--font-mono)]">
                    {t("customSlugPrefix")}
                  </span>
                  <input
                    type="text"
                    value={shareSlug}
                    onChange={(e) => setShareSlug(e.target.value)}
                    placeholder={t("customSlugPlaceholder")}
                    maxLength={50}
                    pattern="[a-z0-9-]*"
                    className="flex-1 min-w-0 h-9 px-3 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[var(--fg)] text-[length:var(--text-sm)] font-[family-name:var(--font-mono)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] placeholder:text-[var(--meta)]"
                  />
                </div>
                <p className="mt-1.5 text-[length:var(--text-xs)] text-[var(--meta)]">
                  {t("customSlugHint")}
                </p>
              </div>

              {/* 有效期 */}
              <div>
                <label className="flex items-center gap-1.5 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] mb-2">
                  <Calendar size={14} className="text-[var(--muted)]" />
                  {t("shareExpiry")}
                </label>
                <div className="flex flex-wrap gap-2">
                  {(["never", "7d", "30d", "custom"] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setExpiryMode(mode)}
                      aria-pressed={expiryMode === mode}
                      className={`h-8 px-3 rounded-[var(--radius-md)] border text-[length:var(--text-sm)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] ${
                        expiryMode === mode
                          ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--surface-2)]"
                          : "border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)]"
                      }`}
                    >
                      {t(`shareExpiry_${mode}`)}
                    </button>
                  ))}
                </div>
                {expiryMode === "custom" && (
                  <input
                    type="date"
                    value={customExpiryDate}
                    onChange={(e) => setCustomExpiryDate(e.target.value)}
                    min={todayStr}
                    className="mt-2 w-full h-9 px-3 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[var(--fg)] text-[length:var(--text-sm)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
                  />
                )}
                {shareExpiresAt && expiryMode !== "custom" && (
                  <p className="mt-1.5 text-[length:var(--text-xs)] text-[var(--meta)]">
                    {t("shareCurrentExpiry", {
                      date: new Date(shareExpiresAt).toLocaleString(),
                    })}
                  </p>
                )}
              </div>

              {/* 密码保护 */}
              <div>
                <label className="flex items-center gap-1.5 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] mb-2">
                  <KeyRound size={14} className="text-[var(--muted)]" />
                  {t("sharePassword")}
                </label>
                {hasPassword && !sharePasswordInput && (
                  <div className="flex items-center gap-2 mb-2">
                    <span className="inline-flex items-center gap-1.5 text-[length:var(--text-sm)] text-[var(--success)]">
                      <Lock size={13} />
                      {t("sharePasswordEnabled")}
                    </span>
                    <button
                      onClick={removePassword}
                      disabled={busy !== null}
                      className="shrink-0 text-[length:var(--text-xs)] text-[var(--danger)] hover:underline disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] rounded-[var(--radius-sm)]"
                    >
                      {t("sharePasswordClear")}
                    </button>
                  </div>
                )}
                <input
                  type="password"
                  value={sharePasswordInput}
                  onChange={(e) => setSharePasswordInput(e.target.value)}
                  autoComplete="new-password"
                  placeholder={
                    hasPassword
                      ? t("sharePasswordChangePlaceholder")
                      : t("sharePasswordPlaceholder")
                  }
                  className="w-full h-9 px-3 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[var(--fg)] text-[length:var(--text-sm)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] placeholder:text-[var(--meta)]"
                />
                {sharePasswordInput && (
                  <p className="mt-1.5 text-[length:var(--text-xs)] text-[var(--meta)]">
                    {t("sharePasswordSetHint")}
                  </p>
                )}
              </div>

              {/* 访问日志（可展开） */}
              <div>
                <button
                  onClick={() => setLogsExpanded((v) => !v)}
                  aria-expanded={logsExpanded}
                  className="flex items-center gap-1.5 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] hover:text-[var(--fg)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] rounded-[var(--radius-sm)]"
                >
                  <ChevronDown
                    size={14}
                    className={`text-[var(--muted)] transition-transform duration-[var(--motion-fast)] ${
                      logsExpanded ? "" : "-rotate-90"
                    }`}
                  />
                  <History size={14} className="text-[var(--muted)]" />
                  {t("shareAccessLogs")}
                </button>
                {logsExpanded && (
                  <div className="mt-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] overflow-hidden">
                    {logsLoading ? (
                      <div className="px-3 py-4 text-center text-[length:var(--text-sm)] text-[var(--muted)]">
                        <Loader2 size={14} className="inline animate-spin mr-1.5" />
                        {t("loading")}
                      </div>
                    ) : accessLogs.length === 0 ? (
                      <div className="px-3 py-4 text-center text-[length:var(--text-sm)] text-[var(--meta)]">
                        {t("shareNoLogs")}
                      </div>
                    ) : (
                      <div className="divide-y divide-[var(--border-soft)]">
                        {accessLogs.map((log) => (
                          <div
                            key={log.id}
                            className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-2 text-[length:var(--text-xs)] items-center"
                          >
                            <span className="text-[var(--fg-2)] font-[family-name:var(--font-mono)] truncate">
                              {log.ip}
                            </span>
                            <span className="text-[var(--meta)] tabular-nums whitespace-nowrap">
                              {new Date(log.accessedAt).toLocaleString()}
                            </span>
                            <span className="text-[var(--meta)] whitespace-nowrap">
                              {uaSummary(log.userAgent)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 底部操作栏 */}
            <footer className="flex items-center justify-between gap-2 px-[var(--space-4)] py-[var(--space-3)] border-t border-[var(--border-soft)] shrink-0">
              {/* 撤销分享（两步确认） */}
              {revokeConfirm ? (
                <div className="flex items-center gap-2">
                  <span className="text-[length:var(--text-xs)] text-[var(--danger)]">
                    {t("shareRevokeConfirm")}
                  </span>
                  <button
                    onClick={revokeShare}
                    disabled={busy !== null}
                    className="inline-flex items-center gap-1 h-8 px-3 rounded-[var(--radius-md)] bg-[var(--danger)] text-[var(--danger-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:opacity-90 disabled:opacity-50 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                  >
                    {busy === "share" ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Trash2 size={13} />
                    )}
                    {t("shareRevokeConfirmBtn")}
                  </button>
                  <button
                    onClick={() => setRevokeConfirm(false)}
                    className="h-8 px-3 rounded-[var(--radius-md)] border border-[var(--border)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                  >
                    {t("cancel")}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setRevokeConfirm(true)}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] border border-[var(--border)] text-[length:var(--text-sm)] text-[var(--danger)] hover:bg-[var(--danger-soft)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
                >
                  <Trash2 size={14} />
                  {t("shareRevoke")}
                </button>
              )}
              <button
                onClick={saveShareSettings}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 h-9 px-[var(--space-4)] rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
              >
                {busy === "share" && !revokeConfirm ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Check size={15} />
                )}
                {t("shareSave")}
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* ── F4：导出预览模态框 ── */}
      <ExportPreview
        title={title}
        markdown={markdown}
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        metaLine={`corps · ${new Date().toLocaleString()}`}
      />

      <div className="mt-3 flex items-center justify-between gap-3 print:hidden">
        <p className="text-[length:var(--text-xs)] text-[var(--muted)]">{t("autosaveHint")}</p>
        {/* 字数统计（v0.6）：去 Markdown 标记后的近似可读字数 */}
        <p className="text-[length:var(--text-xs)] text-[var(--meta)] tabular-nums">
          {t("wordCount", {
            count: markdown
              .replace(/[#>*`\-_|~[\]()]/g, " ")
              .split(/\s+/)
              .filter(Boolean).length,
          })}
        </p>
      </div>
      {/* 打印专用容器：仅在导出模态未打开时渲染（避免与 ExportPreview 的 print-area 重复） */}
      {!exportOpen && (
        <div className="hidden print:block print-area" aria-hidden="true">
          <h1 className="text-[length:var(--text-xl)] font-[weight:var(--weight-semibold)] mb-2">{title}</h1>
          <p className="text-[length:var(--text-xs)] text-[var(--meta)] mb-4">
            corps · {new Date().toLocaleString()}
          </p>
          <Markdown source={markdown} />
        </div>
      )}
    </div>
  );
}
