"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  CreditCard,
  Check,
  ExternalLink,
  Loader2,
  AlertTriangle,
  Users,
  Info,
} from "lucide-react";
import { api } from "@/lib/api";

type Plan = "free" | "pro";

interface BillingStatus {
  plan: Plan;
  seatLimit: number;
  memberCount: number;
  seatsUsed: number;
  role: "owner" | "admin" | "member";
  stripeReady: boolean;
  subscription: {
    status: string;
    quantity: number;
    currentPeriodEnd: string | null;
    canManage: boolean;
  } | null;
}

const PLANS: {
  id: Plan;
  name: string;
  price: string;
  unit: string;
  seats: string;
  features: string[];
  details: string[];
}[] = [
  {
    id: "free",
    name: "免费",
    price: "¥0",
    unit: "永久",
    seats: "最多 10 人",
    features: ["任务看板", "评论与 @提醒", "决策记录（最近 10 条）"],
    details: ["最多 10 人席位", "决策记录上限 10 条", "基础导出", "社区支持"],
  },
  {
    id: "pro",
    name: "专业",
    price: "¥59",
    unit: "每人 / 月",
    seats: "按席位计费",
    features: ["无限决策记录", "任务筛选与视图", "邮件通知", "导出 CSV"],
    details: ["无限决策记录", "任务筛选与视图", "邮件通知", "导出 CSV", "按席位计费", "邮件支持"],
  },
];

const SUB_STATUS_LABEL: Record<string, { label: string; tone: "ok" | "warn" | "muted" }> = {
  active: { label: "订阅生效中", tone: "ok" },
  trialing: { label: "试用中", tone: "ok" },
  past_due: { label: "支付失败，服务未中断", tone: "warn" },
  canceled: { label: "已取消", tone: "muted" },
  incomplete: { label: "待完成支付", tone: "warn" },
};

export default function BillingPage({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = use(params);
  const search = useSearchParams();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const justPaid = search.get("success") === "1";
  const canceled = search.get("canceled") === "1";

  const load = useCallback(async () => {
    try {
      setStatus(await api<BillingStatus>(`/api/v1/workspaces/${wid}/billing/status`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  }, [wid]);

  useEffect(() => {
    load();
  }, [load]);

  async function upgrade(plan: Plan) {
    setError("");
    if (!window.confirm("将跳转到 Stripe 完成支付，是否继续？")) return;
    setBusy(plan);
    try {
      const { url } = await api<{ url: string }>(`/api/v1/workspaces/${wid}/billing/checkout`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (url) window.location.href = url;
      else setError("Stripe 未返回结算链接");
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建结算会话失败");
    } finally {
      setBusy(null);
    }
  }

  async function openPortal() {
    setError("");
    setBusy("portal");
    try {
      const { url } = await api<{ url: string }>(`/api/v1/workspaces/${wid}/billing/portal`, {
        method: "POST",
      });
      if (url) window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "打开账单门户失败");
    } finally {
      setBusy(null);
    }
  }

  const isOwner = status?.role === "owner";
  const sub = status?.subscription;
  const subMeta = sub ? SUB_STATUS_LABEL[sub.status] ?? { label: sub.status, tone: "muted" } : null;
  const seatsUsed = status?.seatsUsed ?? 0;
  const seatLimit = status?.seatLimit ?? 0;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-[length:var(--text-2xl)] font-[var(--weight-semibold)] text-[var(--fg)]">
          <CreditCard size={20} className="text-[var(--muted)]" />
          计费
        </h1>
        <p className="mt-1 text-[length:var(--text-sm)] text-[var(--muted)]">
          按实际席位付费，随时调整人数。
        </p>
      </div>

      {justPaid && (
        <div className="mb-4 flex items-start gap-2 px-4 py-3 rounded-[var(--radius-md)] bg-[var(--success-soft)] text-[var(--success-fg)] text-[length:var(--text-sm)]">
          <Check size={16} className="shrink-0 mt-0.5 text-[var(--success)]" />
          <span>支付已提交。订阅状态由 Stripe 回调确认，稍后刷新即可看到最新结果。</span>
        </div>
      )}
      {canceled && (
        <div className="mb-4 px-4 py-3 rounded-[var(--radius-md)] bg-[var(--surface-2)] text-[var(--fg-2)] text-[length:var(--text-sm)] border border-[var(--border)]">
          已取消本次结算，套餐未变更。
        </div>
      )}
      {error && (
        <div className="mb-4 flex items-start gap-2 px-4 py-3 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
          <AlertTriangle size={16} className="shrink-0 mt-0.5 text-[var(--danger)]" />
          <span>{error}</span>
        </div>
      )}

      {/* 当前状态 */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-4 sm:p-5 mb-5 sm:mb-6">
        {!status ? (
          <div className="space-y-3" aria-busy="true" aria-label="正在读取账单状态">
            <div className="space-y-1.5">
              <div className="h-3 w-16 rounded bg-[var(--surface-2)] animate-pulse" />
              <div className="h-5 w-28 rounded bg-[var(--surface-2)] animate-pulse" />
            </div>
            <div className="space-y-1.5">
              <div className="h-3 w-12 rounded bg-[var(--surface-2)] animate-pulse" />
              <div className="h-5 w-20 rounded bg-[var(--surface-2)] animate-pulse" />
              <div className="h-1 w-32 rounded-full bg-[var(--surface-2)] animate-pulse" />
            </div>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-start sm:justify-between gap-4">
            <div>
              <div className="text-[length:var(--text-xs)] text-[var(--meta)] mb-1">当前套餐</div>
              <div className="flex items-center gap-2">
                <span className="text-[length:var(--text-lg)] font-[var(--weight-semibold)] text-[var(--fg)]">
                  {PLANS.find((p) => p.id === status.plan)?.name ?? status.plan}
                </span>
                {subMeta && (
                  <span
                    className="px-2 py-0.5 rounded-full text-[length:var(--text-xs)]"
                    style={{
                      background:
                        subMeta.tone === "ok"
                          ? "var(--success-soft)"
                          : subMeta.tone === "warn"
                            ? "var(--warn-soft)"
                            : "var(--surface-2)",
                      color:
                        subMeta.tone === "ok"
                          ? "var(--success-fg)"
                          : subMeta.tone === "warn"
                            ? "var(--warn-fg)"
                            : "var(--muted)",
                    }}
                  >
                    {subMeta.label}
                  </span>
                )}
              </div>
              {sub?.currentPeriodEnd && (
                <div className="mt-1 text-[length:var(--text-xs)] text-[var(--meta)]">
                  当前周期至 {new Date(sub.currentPeriodEnd).toLocaleDateString("zh-CN")}
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)] mb-1">
                <Users size={13} />
                席位
              </div>
              <div className="text-[length:var(--text-lg)] font-[var(--weight-semibold)] text-[var(--fg)] tabular-nums">
                {seatsUsed}
                {seatLimit > 0 && (
                  <span className="text-[length:var(--text-sm)] font-[var(--weight-regular)] text-[var(--muted)]">
                    {" "}
                    / {seatLimit}
                  </span>
                )}
              </div>
              {seatLimit > 0 && (
                <div className="mt-1.5 w-32 h-1 rounded-full bg-[var(--surface-3)] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-[width] duration-[var(--motion-slow)]"
                    style={{
                      width: `${Math.min(100, (seatsUsed / seatLimit) * 100)}%`,
                      background: seatsUsed >= seatLimit ? "var(--warn)" : "var(--accent)",
                    }}
                  />
                </div>
              )}
            </div>

            {isOwner && sub?.canManage && (
              <button
                onClick={openPortal}
                disabled={busy === "portal"}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 h-9 px-3 border border-[var(--border)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)]"
              >
                {busy === "portal" ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <ExternalLink size={15} />
                )}
                管理账单
              </button>
            )}
          </div>
        )}
      </div>

      {/* 套餐卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {PLANS.map((p) => {
          const current = status?.plan === p.id;
          const upgradable = isOwner && !current && p.id !== "free" && status?.stripeReady;
          return (
            <div
              key={p.id}
              className={`flex flex-col bg-[var(--surface)] rounded-[var(--radius-lg)] p-4 sm:p-5 ${current ? "border-2 border-[var(--accent)]" : "border border-[var(--border)]"}`}
              style={{ boxShadow: "var(--elev-sm)" }}
            >
              <div className="flex items-baseline justify-between">
                <span className="text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--fg)]">
                  {p.name}
                </span>
                {current && (
                  <span className="px-2 py-0.5 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] text-[length:var(--text-xs)] font-[var(--weight-medium)]">
                    当前
                  </span>
                )}
              </div>

              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-[length:var(--text-3xl)] font-[var(--weight-semibold)] text-[var(--fg)] tabular-nums tracking-[-0.02em]">
                  {p.price}
                </span>
                <span className="text-[length:var(--text-xs)] text-[var(--meta)]">{p.unit}</span>
              </div>
              <div className="mt-1 text-[length:var(--text-xs)] text-[var(--meta)]">{p.seats}</div>

              <ul className="mt-4 space-y-2 flex-1">
                {p.features.map((f) => (
                  <li
                    key={f}
                    className="flex items-start gap-2 text-[length:var(--text-sm)] text-[var(--fg-2)]"
                  >
                    <Check size={14} className="shrink-0 mt-0.5 text-[var(--success)]" />
                    {f}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => upgrade(p.id)}
                disabled={!upgradable || busy === p.id}
                title={!upgradable ? "Stripe 未配置或非拥有者" : undefined}
                className="mt-5 h-9 w-full rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] transition-colors duration-[var(--motion-base)] flex items-center justify-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60"
                style={{
                  background: upgradable ? "var(--accent)" : "var(--surface-2)",
                  color: upgradable ? "var(--accent-fg)" : "var(--meta)",
                }}
              >
                {busy === p.id && <Loader2 size={15} className="animate-spin" />}
                {current ? "使用中" : p.id === "free" ? "包含在内" : upgradable ? "升级" : "不可用"}
              </button>

              <details className="mt-3 group">
                <summary className="cursor-pointer text-[length:var(--text-xs)] text-[var(--meta)] hover:text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] select-none">
                  查看完整对比
                </summary>
                <ul className="mt-2 space-y-1.5">
                  {p.details.map((d) => (
                    <li
                      key={d}
                      className="flex items-start gap-1.5 text-[length:var(--text-xs)] text-[var(--fg-2)]"
                    >
                      <Check size={12} className="shrink-0 mt-0.5 text-[var(--success)]" />
                      {d}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          );
        })}
      </div>

      {status && !status.stripeReady && (
        <div className="mt-5 flex items-start gap-2 px-4 py-3 rounded-[var(--radius-md)] bg-[var(--surface-2)] text-[var(--fg-2)] text-[length:var(--text-sm)]">
          <Info size={16} className="shrink-0 mt-0.5 text-[var(--muted)]" />
          <span>
            当前环境未配置 Stripe 测试密钥（<code className="font-[family-name:var(--font-mono)] text-[length:var(--text-xs)]">STRIPE_SECRET_KEY</code>
            {" / "}
            <code className="font-[family-name:var(--font-mono)] text-[length:var(--text-xs)]">STRIPE_PRICE_ID</code>），升级入口已隐藏。配置后刷新即可启用。
          </span>
        </div>
      )}

      {status && !isOwner && (
        <p className="mt-5 text-[length:var(--text-xs)] text-[var(--meta)]">
          只有工作区拥有者可以更改套餐或管理付款方式。
        </p>
      )}
    </div>
  );
}
