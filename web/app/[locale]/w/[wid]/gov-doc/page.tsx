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
 * 交换留痕 / 流程意见 / 附件登记的 UI 在后续批补（API 已提供）。
 */
import { use, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { Plus, Loader2, ScrollText, Search } from "lucide-react";

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
                  <ScrollText size={16} className="shrink-0 text-[var(--muted)] mt-1" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
