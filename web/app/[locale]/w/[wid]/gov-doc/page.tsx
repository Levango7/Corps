"use client";

/**
 * 公文管理页面 · /w/[locale]/w/[wid]/gov-doc
 *
 * A1 能力（设计文档 GOV-DOC-P1-design-v0.md §6）：收发文登记 + 交换留痕入口。
 *  - 列表：文号 / 标题 / 方向 / 密级 / 紧急程度 / 状态 / 来源或去向 / 登记时间
 *  - 登记：标题必填，方向 / 密级 / 紧急程度走枚举选择，其余可选
 *  - 状态机：拟稿 → 审核 → 签发 → 交换/归档（状态跃迁走 PATCH，详见 API 注释）
 *  - OFD 预览：选型待核（§8-1），本页只登记不渲染（见 ofdPending 提示）
 *
 * 交换留痕 / 流程意见 / 附件登记：卡片展开区懒加载 GET，登记表单限可管理角色（API 由 A1 提供）。
 */
import { use, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import {
  Plus,
  Loader2,
  ScrollText,
  Search,
  ChevronDown,
  ChevronUp,
  ArrowLeftRight,
  MessageSquare,
  Paperclip,
} from "lucide-react";

type GovDocStatus = "draft" | "review" | "signed" | "exchanged" | "archived";
type Direction = "incoming" | "outgoing";

interface GovDocItem {
  id: string;
  docNo: string | null;
  title: string;
  direction: Direction;
  secretLevel: string;
  urgency: string;
  source: string | null;
  destination: string | null;
  status: GovDocStatus;
  createdAt: string;
  creator: { id: string; name: string | null; email: string } | null;
}

interface GovDocExchange {
  id: string;
  direction: Direction;
  channel: string;
  operatorId: string | null;
  operator: { id: string; name: string | null; email: string } | null;
  exchangedAt: string;
  note: string | null;
  createdAt: string;
}

interface GovDocOpinion {
  id: string;
  conclusion: "agree" | "reject" | "amend";
  content: string;
  authorId: string | null;
  author: { id: string; name: string | null; email: string } | null;
  createdAt: string;
}

interface GovDocAttachment {
  id: string;
  version: number;
  fileHash: string;
  previewRef: string | null;
  createdAt: string;
}

const STATUS_TOKEN: Record<GovDocStatus, string> = {
  draft: "var(--surface-2)",
  review: "var(--accent-soft)",
  signed: "var(--accent-soft)",
  exchanged: "var(--accent-soft)",
  archived: "var(--surface-2)",
};

export default function GovDocPage({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = use(params);
  const t = useTranslations("govDoc");
  const tButton = useTranslations("button");
  const tErr = useTranslations("error");

  const [items, setItems] = useState<GovDocItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<string>("member");
  const [formOpen, setFormOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // 登记表单字段（title 必填，其余可选；枚举走 select 防止脏数据）
  const [fTitle, setFTitle] = useState("");
  const [fDirection, setFDirection] = useState<Direction>("incoming");
  const [fSecretLevel, setFSecretLevel] = useState("internal");
  const [fUrgency, setFUrgency] = useState("normal");
  const [fDocNo, setFDocNo] = useState("");
  const [fSource, setFSource] = useState("");
  const [fDestination, setFDestination] = useState("");
  const [fRemarks, setFRemarks] = useState("");

  const canManage = role === "owner" || role === "admin" || role === "member";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await api<{ items: GovDocItem[]; total: number }>(
          `/api/v1/workspaces/${wid}/gov-docs?limit=100`,
        );
        if (!cancelled) {
          setItems(data.items);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error && e.message.includes("fetch")
              ? tErr("networkConnectFailed")
              : t("loadFailed"),
          );
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wid, refreshKey, t, tErr]);

  // 当前用户角色（viewer 只读：登记按钮不展示）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api<{ items: Array<{ role: string; isSelf: boolean }> }>(
          `/api/v1/workspaces/${wid}/members?limit=100`,
        );
        if (cancelled) return;
        const self = data.items.find((m) => m.isSelf);
        if (self) setRole(self.role);
      } catch {
        // 角色获取失败降级为 member（可读不可登记）
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wid]);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.trim().toLowerCase();
    return items.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        (d.docNo ?? "").toLowerCase().includes(q) ||
        (d.source ?? "").toLowerCase().includes(q) ||
        (d.destination ?? "").toLowerCase().includes(q),
    );
  }, [items, search]);

  const statusLabel = (s: GovDocStatus) => t(`status${s.charAt(0).toUpperCase()}${s.slice(1)}`);
  const directionLabel = (d: Direction) => t(d);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!fTitle.trim()) return;
    setActionError(null);
    try {
      await api<GovDocItem>(`/api/v1/workspaces/${wid}/gov-docs`, {
        method: "POST",
        body: JSON.stringify({
          title: fTitle.trim(),
          direction: fDirection,
          secretLevel: fSecretLevel,
          urgency: fUrgency,
          docNo: fDocNo.trim() || undefined,
          source: fDirection === "incoming" && fSource.trim() ? fSource.trim() : undefined,
          destination:
            fDirection === "outgoing" && fDestination.trim() ? fDestination.trim() : undefined,
          remarks: fRemarks.trim() || undefined,
        }),
      });
      setFormOpen(false);
      setFTitle("");
      setFDocNo("");
      setFSource("");
      setFDestination("");
      setFRemarks("");
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("createFailed"));
    }
  }

  return (
    <main className="flex-1 min-w-0">
      <div className="max-w-[var(--container-max)] mx-auto px-[var(--space-4)] py-[var(--space-6)]">
        <div className="flex items-center justify-between mb-[var(--space-5)]">
          <div>
            <h1 className="flex items-center gap-2 text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)]">
              <ScrollText size={20} className="text-[var(--accent)]" />
              {t("title")}
            </h1>
            <p className="mt-1 text-[length:var(--text-sm)] text-[var(--muted)]">{t("subtitle")}</p>
          </div>
          {canManage && (
            <button
              onClick={() => setFormOpen((v) => !v)}
              aria-expanded={formOpen}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
            >
              <Plus size={14} />
              {t("create")}
            </button>
          )}
        </div>

        {/* OFD 选型待核提示（设计文档 §8-1：能力清单不写「支持 OFD」） */}
        <p className="mb-[var(--space-4)] text-[length:var(--text-xs)] text-[var(--meta)]">
          {t("ofdPending")}
        </p>

        {formOpen && canManage && (
          <form
            onSubmit={submit}
            className="mb-[var(--space-4)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)] space-y-3"
            aria-label={t("formTitle")}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="block mb-1 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
                  {t("docTitle")} *
                </span>
                <input
                  type="text"
                  value={fTitle}
                  onChange={(e) => setFTitle(e.target.value)}
                  aria-label={t("docTitle")}
                  required
                  maxLength={200}
                  className="w-full h-9 px-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                />
              </label>
              <label className="block">
                <span className="block mb-1 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
                  {t("docNo")}
                </span>
                <input
                  type="text"
                  value={fDocNo}
                  onChange={(e) => setFDocNo(e.target.value)}
                  aria-label={t("docNo")}
                  maxLength={64}
                  className="w-full h-9 px-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                />
              </label>
              <label className="block">
                <span className="block mb-1 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
                  {t("direction")}
                </span>
                <select
                  value={fDirection}
                  onChange={(e) => setFDirection(e.target.value as Direction)}
                  className="w-full h-9 px-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                >
                  <option value="incoming">{directionLabel("incoming")}</option>
                  <option value="outgoing">{directionLabel("outgoing")}</option>
                </select>
              </label>
              <label className="block">
                <span className="block mb-1 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
                  {t("secretLevel")}
                </span>
                <select
                  value={fSecretLevel}
                  onChange={(e) => setFSecretLevel(e.target.value)}
                  className="w-full h-9 px-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                >
                  <option value="internal">{t("internal")}</option>
                  <option value="secret">{t("secret")}</option>
                  <option value="confidential">{t("confidential")}</option>
                  <option value="topsecret">{t("topsecret")}</option>
                </select>
              </label>
              <label className="block">
                <span className="block mb-1 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
                  {t("urgency")}
                </span>
                <select
                  value={fUrgency}
                  onChange={(e) => setFUrgency(e.target.value)}
                  className="w-full h-9 px-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                >
                  <option value="normal">{t("normal")}</option>
                  <option value="urgent">{t("urgent")}</option>
                  <option value="extraurgent">{t("extraurgent")}</option>
                </select>
              </label>
              {fDirection === "incoming" ? (
                <label className="block">
                  <span className="block mb-1 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
                    {t("source")}
                  </span>
                  <input
                    type="text"
                    value={fSource}
                    onChange={(e) => setFSource(e.target.value)}
                    aria-label={t("source")}
                    maxLength={200}
                    className="w-full h-9 px-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                  />
                </label>
              ) : (
                <label className="block">
                  <span className="block mb-1 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
                    {t("destination")}
                  </span>
                  <input
                    type="text"
                    value={fDestination}
                    onChange={(e) => setFDestination(e.target.value)}
                    aria-label={t("destination")}
                    maxLength={200}
                    className="w-full h-9 px-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                  />
                </label>
              )}
            </div>
            <label className="block">
              <span className="block mb-1 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
                {t("remarks")}
              </span>
              <textarea
                value={fRemarks}
                onChange={(e) => setFRemarks(e.target.value)}
                aria-label={t("remarks")}
                rows={2}
                className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              />
            </label>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={!fTitle.trim()}
                className="h-9 px-4 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
              >
                {t("save")}
              </button>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="h-9 px-4 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              >
                {tButton("cancel")}
              </button>
            </div>
          </form>
        )}

        {actionError && (
          <div
            role="alert"
            className="mb-[var(--space-4)] rounded-[var(--radius-md)] p-3 text-[length:var(--text-sm)] flex items-center justify-between bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] text-[var(--danger)]"
          >
            <span>{actionError}</span>
            <button
              onClick={() => setActionError(null)}
              className="underline hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            >
              {t("close")}
            </button>
          </div>
        )}

        {!loading && items.length > 0 && (
          <div className="relative mb-[var(--space-4)] max-w-sm">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("docTitle")}
              aria-label={t("docTitle")}
              className="w-full h-9 pl-9 pr-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] placeholder:text-[var(--meta)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            />
          </div>
        )}

        {error && (
          <div className="mb-[var(--space-4)] rounded-[var(--radius-md)] p-3 text-[length:var(--text-sm)] flex items-center justify-between bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] text-[var(--danger)]">
            <span>{error}</span>
            <button
              onClick={() => setRefreshKey((k) => k + 1)}
              className="underline hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] text-[var(--danger)]"
            >
              {tButton("retry")}
            </button>
          </div>
        )}

        {loading ? (
          <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
            <Loader2 size={20} className="inline animate-spin mr-2" />
            {t("noGovDocs")}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
            <ScrollText size={36} className="mx-auto mb-3 opacity-50" />
            <p className="mb-1">{t("noGovDocs")}</p>
            <p className="text-[length:var(--text-sm)]">{t("emptyHint")}</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {filtered.map((doc) => (
              <li
                key={doc.id}
                className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-4)] py-[var(--space-3)]"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-[length:var(--text-base)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
                        {doc.title}
                      </span>
                      {doc.docNo && (
                        <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
                          {doc.docNo}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[length:var(--text-xs)] text-[var(--fg-2)] flex-wrap">
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--surface-2)] text-[var(--muted)]">
                        {directionLabel(doc.direction)}
                      </span>
                      <span
                        className="inline-flex items-center px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[var(--fg-2)]"
                        style={{ background: STATUS_TOKEN[doc.status] }}
                      >
                        {statusLabel(doc.status)}
                      </span>
                      <span>
                        {t("secretLevel")}: {t(doc.secretLevel)}
                      </span>
                      <span>
                        {t("urgency")}: {t(doc.urgency)}
                      </span>
                    </div>
                    {(doc.source || doc.destination) && (
                      <div className="mt-1 text-[length:var(--text-xs)] text-[var(--muted)]">
                        {doc.direction === "incoming" && doc.source ? (
                          <>
                            {t("source")}: {doc.source}
                          </>
                        ) : doc.destination ? (
                          <>
                            {t("destination")}: {doc.destination}
                          </>
                        ) : null}
                      </div>
                    )}
                    <div className="mt-1 text-[length:var(--text-xs)] text-[var(--meta)]">
                      {t("createdAt")}: {new Date(doc.createdAt).toLocaleString()}
                      {doc.creator?.name || doc.creator?.email ? (
                        <>
                          {" · "}
                          {doc.creator.name || doc.creator.email}
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 mt-1">
                    <button
                      type="button"
                      onClick={() => setExpandedId((cur) => (cur === doc.id ? null : doc.id))}
                      aria-expanded={expandedId === doc.id}
                      aria-label={expandedId === doc.id ? t("collapse") : t("expand")}
                      className="inline-flex items-center gap-1 h-8 px-2 rounded-[var(--radius-sm)] border border-[var(--border)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                    >
                      {expandedId === doc.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      {expandedId === doc.id ? t("collapse") : t("expand")}
                    </button>
                    <ScrollText size={16} className="text-[var(--muted)]" />
                  </div>
                </div>
                {expandedId === doc.id && (
                  <GovDocDetail wid={wid} docId={doc.id} canManage={canManage} />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

interface PanelProps {
  wid: string;
  docId: string;
  canManage: boolean;
}

function GovDocDetail({ wid, docId, canManage }: PanelProps) {
  return (
    <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] p-[var(--space-3)] space-y-4">
      <ExchangePanel wid={wid} docId={docId} canManage={canManage} />
      <OpinionPanel wid={wid} docId={docId} canManage={canManage} />
      <AttachmentPanel wid={wid} docId={docId} canManage={canManage} />
    </div>
  );
}

function ExchangePanel({ wid, docId, canManage }: PanelProps) {
  const t = useTranslations("govDoc");
  const tButton = useTranslations("button");
  const tErr = useTranslations("error");
  const [items, setItems] = useState<GovDocExchange[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [fDirection, setFDirection] = useState<Direction>("outgoing");
  const [fChannel, setFChannel] = useState("");
  const [fExchangedAt, setFExchangedAt] = useState("");
  const [fNote, setFNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await api<{ items: GovDocExchange[] }>(
          `/api/v1/workspaces/${wid}/gov-docs/${docId}/exchanges`,
        );
        if (!cancelled) {
          setItems(data.items);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error && e.message.includes("fetch")
              ? tErr("networkConnectFailed")
              : t("loadExchangesFailed"),
          );
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wid, docId, refreshKey, t, tErr]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!fChannel.trim()) return;
    setActionError(null);
    setSubmitting(true);
    try {
      await api<GovDocExchange>(`/api/v1/workspaces/${wid}/gov-docs/${docId}/exchanges`, {
        method: "POST",
        body: JSON.stringify({
          direction: fDirection,
          channel: fChannel.trim(),
          exchangedAt: fExchangedAt ? new Date(fExchangedAt).toISOString() : undefined,
          note: fNote.trim() || undefined,
        }),
      });
      setRefreshKey((k) => k + 1);
      setFChannel("");
      setFExchangedAt("");
      setFNote("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("createFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-label={t("exchanges")}>
      <h3 className="mb-2 flex items-center gap-1.5 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
        <ArrowLeftRight size={14} className="text-[var(--accent)]" />
        {t("exchanges")}
      </h3>
      {error && (
        <div className="mb-2 rounded-[var(--radius-sm)] p-2 text-[length:var(--text-xs)] flex items-center justify-between bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] text-[var(--danger)]">
          <span>{error}</span>
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            className="underline hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          >
            {tButton("retry")}
          </button>
        </div>
      )}
      {actionError && (
        <div
          role="alert"
          className="mb-2 rounded-[var(--radius-sm)] p-2 text-[length:var(--text-xs)] flex items-center justify-between bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] text-[var(--danger)]"
        >
          <span>{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            className="underline hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          >
            {t("close")}
          </button>
        </div>
      )}
      {canManage && (
        <form
          onSubmit={submit}
          className="mb-3 grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-3"
          aria-label={t("exchangeCreate")}
        >
          <label className="block">
            <span className="block mb-1 text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
              {t("direction")}
            </span>
            <select
              value={fDirection}
              onChange={(e) => setFDirection(e.target.value as Direction)}
              className="w-full h-9 px-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            >
              <option value="incoming">{t("incoming")}</option>
              <option value="outgoing">{t("outgoing")}</option>
            </select>
          </label>
          <label className="block">
            <span className="block mb-1 text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
              {t("exchangeChannel")} *
            </span>
            <input
              type="text"
              value={fChannel}
              onChange={(e) => setFChannel(e.target.value)}
              aria-label={t("exchangeChannel")}
              required
              maxLength={50}
              className="w-full h-9 px-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            />
          </label>
          <label className="block">
            <span className="block mb-1 text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
              {t("exchangeTime")}
            </span>
            <input
              type="datetime-local"
              value={fExchangedAt}
              onChange={(e) => setFExchangedAt(e.target.value)}
              aria-label={t("exchangeTime")}
              className="w-full h-9 px-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            />
          </label>
          <label className="block">
            <span className="block mb-1 text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
              {t("remarks")}
            </span>
            <input
              type="text"
              value={fNote}
              onChange={(e) => setFNote(e.target.value)}
              aria-label={t("remarks")}
              maxLength={200}
              className="w-full h-9 px-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            />
          </label>
          <div className="sm:col-span-2 flex items-center gap-2">
            <button
              type="submit"
              disabled={!fChannel.trim() || submitting}
              className="h-9 px-4 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
            >
              {submitting && <Loader2 size={14} className="inline animate-spin mr-1" />}
              {t("exchangeCreate")}
            </button>
          </div>
        </form>
      )}
      {loading ? (
        <p className="text-[length:var(--text-xs)] text-[var(--muted)]">
          <Loader2 size={12} className="inline animate-spin mr-1" />
          {t("exchanges")}
        </p>
      ) : items.length === 0 ? (
        <p className="text-[length:var(--text-xs)] text-[var(--muted)]">{t("exchangeEmpty")}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((x) => (
            <li
              key={x.id}
              className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[length:var(--text-xs)] text-[var(--fg-2)]"
            >
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--surface-2)] text-[var(--muted)]">
                {t(x.direction)}
              </span>
              <span>{x.channel}</span>
              <span className="text-[var(--muted)]">
                {t("exchangeTime")}: {new Date(x.exchangedAt).toLocaleString()}
              </span>
              {x.operator?.name || x.operator?.email ? (
                <span className="text-[var(--muted)]">{x.operator.name || x.operator.email}</span>
              ) : null}
              {x.note && <span className="w-full text-[var(--muted)]">{x.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OpinionPanel({ wid, docId, canManage }: PanelProps) {
  const t = useTranslations("govDoc");
  const tButton = useTranslations("button");
  const tErr = useTranslations("error");
  const [items, setItems] = useState<GovDocOpinion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [fConclusion, setFConclusion] = useState<"agree" | "reject" | "amend">("agree");
  const [fContent, setFContent] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await api<{ items: GovDocOpinion[] }>(
          `/api/v1/workspaces/${wid}/gov-docs/${docId}/opinions`,
        );
        if (!cancelled) {
          setItems(data.items);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error && e.message.includes("fetch")
              ? tErr("networkConnectFailed")
              : t("loadOpinionsFailed"),
          );
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wid, docId, refreshKey, t, tErr]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!fContent.trim()) return;
    setActionError(null);
    setSubmitting(true);
    try {
      await api<GovDocOpinion>(`/api/v1/workspaces/${wid}/gov-docs/${docId}/opinions`, {
        method: "POST",
        body: JSON.stringify({ conclusion: fConclusion, content: fContent.trim() }),
      });
      setRefreshKey((k) => k + 1);
      setFContent("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("createFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-label={t("opinions")}>
      <h3 className="mb-2 flex items-center gap-1.5 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
        <MessageSquare size={14} className="text-[var(--accent)]" />
        {t("opinions")}
      </h3>
      {error && (
        <div className="mb-2 rounded-[var(--radius-sm)] p-2 text-[length:var(--text-xs)] flex items-center justify-between bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] text-[var(--danger)]">
          <span>{error}</span>
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            className="underline hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          >
            {tButton("retry")}
          </button>
        </div>
      )}
      {actionError && (
        <div
          role="alert"
          className="mb-2 rounded-[var(--radius-sm)] p-2 text-[length:var(--text-xs)] flex items-center justify-between bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] text-[var(--danger)]"
        >
          <span>{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            className="underline hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          >
            {t("close")}
          </button>
        </div>
      )}
      {canManage && (
        <form
          onSubmit={submit}
          className="mb-3 space-y-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-3"
          aria-label={t("opinionCreate")}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="block">
              <span className="block mb-1 text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
                {t("opinionConclusion")}
              </span>
              <select
                value={fConclusion}
                onChange={(e) => setFConclusion(e.target.value as "agree" | "reject" | "amend")}
                className="w-full h-9 px-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              >
                <option value="agree">{t("agree")}</option>
                <option value="reject">{t("reject")}</option>
                <option value="amend">{t("amend")}</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="block mb-1 text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
              {t("opinionContent")} *
            </span>
            <textarea
              value={fContent}
              onChange={(e) => setFContent(e.target.value)}
              aria-label={t("opinionContent")}
              required
              rows={2}
              maxLength={2000}
              className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            />
          </label>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={!fContent.trim() || submitting}
              className="h-9 px-4 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
            >
              {submitting && <Loader2 size={14} className="inline animate-spin mr-1" />}
              {t("opinionCreate")}
            </button>
          </div>
        </form>
      )}
      {loading ? (
        <p className="text-[length:var(--text-xs)] text-[var(--muted)]">
          <Loader2 size={12} className="inline animate-spin mr-1" />
          {t("opinions")}
        </p>
      ) : items.length === 0 ? (
        <p className="text-[length:var(--text-xs)] text-[var(--muted)]">{t("opinionEmpty")}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((o) => (
            <li
              key={o.id}
              className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 space-y-1"
            >
              <div className="flex items-center gap-2 flex-wrap text-[length:var(--text-xs)]">
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--accent-soft)] text-[var(--fg-2)]">
                  {t(o.conclusion)}
                </span>
                {o.author?.name || o.author?.email ? (
                  <span className="text-[var(--muted)]">{o.author.name || o.author.email}</span>
                ) : null}
                <span className="text-[var(--muted)]">
                  {new Date(o.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="text-[length:var(--text-sm)] text-[var(--fg)] break-words">
                {o.content}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AttachmentPanel({ wid, docId, canManage }: PanelProps) {
  const t = useTranslations("govDoc");
  const tButton = useTranslations("button");
  const tErr = useTranslations("error");
  const [items, setItems] = useState<GovDocAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [fVersion, setFVersion] = useState("");
  const [fFileHash, setFFileHash] = useState("");
  const [fPreviewRef, setFPreviewRef] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await api<{ items: GovDocAttachment[] }>(
          `/api/v1/workspaces/${wid}/gov-docs/${docId}/attachments`,
        );
        if (!cancelled) {
          setItems(data.items);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error && e.message.includes("fetch")
              ? tErr("networkConnectFailed")
              : t("loadAttachmentsFailed"),
          );
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wid, docId, refreshKey, t, tErr]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!fFileHash.trim()) return;
    setActionError(null);
    setSubmitting(true);
    const v = fVersion.trim();
    try {
      await api<GovDocAttachment>(`/api/v1/workspaces/${wid}/gov-docs/${docId}/attachments`, {
        method: "POST",
        body: JSON.stringify({
          version: v ? Number(v) : undefined,
          fileHash: fFileHash.trim(),
          previewRef: fPreviewRef.trim() || undefined,
        }),
      });
      setRefreshKey((k) => k + 1);
      setFVersion("");
      setFFileHash("");
      setFPreviewRef("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("createFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-label={t("attachments")}>
      <h3 className="mb-2 flex items-center gap-1.5 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
        <Paperclip size={14} className="text-[var(--accent)]" />
        {t("attachments")}
      </h3>
      {error && (
        <div className="mb-2 rounded-[var(--radius-sm)] p-2 text-[length:var(--text-xs)] flex items-center justify-between bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] text-[var(--danger)]">
          <span>{error}</span>
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            className="underline hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          >
            {tButton("retry")}
          </button>
        </div>
      )}
      {actionError && (
        <div
          role="alert"
          className="mb-2 rounded-[var(--radius-sm)] p-2 text-[length:var(--text-xs)] flex items-center justify-between bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] text-[var(--danger)]"
        >
          <span>{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            className="underline hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          >
            {t("close")}
          </button>
        </div>
      )}
      {canManage && (
        <form
          onSubmit={submit}
          className="mb-3 grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-3"
          aria-label={t("attachmentCreate")}
        >
          <label className="block">
            <span className="block mb-1 text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
              {t("attachmentVersion")}
            </span>
            <input
              type="number"
              min={1}
              step={1}
              value={fVersion}
              onChange={(e) => setFVersion(e.target.value)}
              aria-label={t("attachmentVersion")}
              className="w-full h-9 px-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            />
          </label>
          <label className="block">
            <span className="block mb-1 text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
              {t("attachmentHash")} *
            </span>
            <input
              type="text"
              value={fFileHash}
              onChange={(e) => setFFileHash(e.target.value)}
              aria-label={t("attachmentHash")}
              required
              maxLength={128}
              className="w-full h-9 px-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="block mb-1 text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
              {t("attachmentPreview")}
            </span>
            <input
              type="text"
              value={fPreviewRef}
              onChange={(e) => setFPreviewRef(e.target.value)}
              aria-label={t("attachmentPreview")}
              maxLength={500}
              className="w-full h-9 px-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            />
          </label>
          <div className="sm:col-span-2 flex items-center gap-2">
            <button
              type="submit"
              disabled={!fFileHash.trim() || submitting}
              className="h-9 px-4 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
            >
              {submitting && <Loader2 size={14} className="inline animate-spin mr-1" />}
              {t("attachmentCreate")}
            </button>
          </div>
        </form>
      )}
      {loading ? (
        <p className="text-[length:var(--text-xs)] text-[var(--muted)]">
          <Loader2 size={12} className="inline animate-spin mr-1" />
          {t("attachments")}
        </p>
      ) : items.length === 0 ? (
        <p className="text-[length:var(--text-xs)] text-[var(--muted)]">{t("attachmentEmpty")}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[length:var(--text-xs)] text-[var(--fg-2)]"
            >
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--surface-2)] text-[var(--muted)]">
                {t("attachmentVersion")}: {a.version}
              </span>
              <span title={a.fileHash}>{shortHash(a.fileHash)}</span>
              {a.previewRef && (
                <span className="text-[var(--muted)]">
                  {t("attachmentPreview")}: {a.previewRef}
                </span>
              )}
              <span className="text-[var(--muted)]">{new Date(a.createdAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[length:var(--text-xs)] text-[var(--meta)]">
        {t("attachmentPending")}
      </p>
    </section>
  );
}

function shortHash(h: string) {
  return h.length > 16 ? `${h.slice(0, 12)}…${h.slice(-4)}` : h;
}
