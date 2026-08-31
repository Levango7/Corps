"use client";

import { use, useCallback, useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  CreditCard,
  Check,
  ExternalLink,
  Loader2,
  AlertTriangle,
  Users,
  Info,
  ArrowRight,
  X,
  Wallet,
} from "lucide-react";
import { api } from "@/lib/api";
import { useTranslations } from "next-intl";

type Plan = "free" | "pro";
type PaymentMethod = "card" | "wechat" | "alipay";

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

// 套餐卡数据（阶段 2-6 i18n）：nameKey/unitKey/seatsKey/features/details 均为 billing ns
// 翻译 key，渲染处经 t() 解析；price 保持字面量（币种格式随通道不同）。
const PLANS: {
  id: Plan;
  nameKey: string;
  price: string;
  unitKey: string;
  seatsKey: string;
  features: string[];
  details: string[];
}[] = [
  {
    id: "free",
    nameKey: "planFree",
    price: "¥0",
    unitKey: "unitForever",
    seatsKey: "seatsFree",
    features: ["featBoard", "featComments", "featDecisions10"],
    details: ["detailSeats10", "detailDecisions10", "detailBasicExport", "detailCommunity"],
  },
  {
    id: "pro",
    nameKey: "planPro",
    price: "¥59",
    unitKey: "unitPerSeatMonth",
    seatsKey: "seatsPerSeat",
    features: ["featUnlimitedDecisions", "featFilterViews", "featEmail", "featCsv"],
    details: [
      "featUnlimitedDecisions",
      "featFilterViews",
      "featEmail",
      "featCsv",
      "seatsPerSeat",
      "featEmailSupport",
    ],
  },
];

const SUB_STATUS_LABEL: Record<string, { labelKey: string; tone: "ok" | "warn" | "muted" }> = {
  active: { labelKey: "subActive", tone: "ok" },
  trialing: { labelKey: "subTrialing", tone: "ok" },
  past_due: { labelKey: "subPastDue", tone: "warn" },
  canceled: { labelKey: "subCanceled", tone: "muted" },
  incomplete: { labelKey: "subIncomplete", tone: "warn" },
};

export default function BillingPage({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = use(params);

  const t = useTranslations("billing");
  const tButton = useTranslations("button");
  const search = useSearchParams();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // Phase 2：支付方式选择（缺省 card 保持存量行为）
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("card");
  // 计费周期（pricing-strategy.md：年付 ¥590/人/年，相当于每月 ¥49.2）
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "yearly">("monthly");
  // 微信二维码模态框状态
  const [wechatQr, setWechatQr] = useState<{ url: string; orderId: string } | null>(null);
  // �轮询定时器引用
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const justPaid = search.get("success") === "1";
  const canceled = search.get("canceled") === "1";

  const load = useCallback(async () => {
    try {
      setStatus(await api<BillingStatus>(`/api/v1/workspaces/${wid}/billing/status`));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadFailed"));
    }
  }, [wid]);

  useEffect(() => {
    load();
  }, [load]);

  // 清理轮询定时器
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function upgrade(plan: Plan) {
    setError("");
    // 支付方式 → provider 参数映射
    const providerMap: Record<PaymentMethod, "stripe" | "wechatpay-native" | "alipay-page"> = {
      card: "stripe",
      wechat: "wechatpay-native",
      alipay: "alipay-page",
    };
    const provider = providerMap[paymentMethod];

    // 跳转型通道（信用卡/支付宝）需确认；微信扫码弹模态框无需 confirm
    if (paymentMethod !== "wechat") {
      const channelLabel = paymentMethod === "card" ? "Stripe" : t("alipay");
      if (!window.confirm(t("payRedirectConfirm", { channel: channelLabel }))) return;
    }

    setBusy(plan);
    try {
      const resp = await api<{
        url?: string;
        qrCodeUrl?: string;
        providerOrderId?: string;
        providerId?: string;
      }>(`/api/v1/workspaces/${wid}/billing/checkout`, {
        method: "POST",
        body: JSON.stringify({ planId: plan, provider, period: billingPeriod }),
      });

      if (resp.qrCodeUrl) {
        // 微信 Native 支付：显示二维码模态框并轮询订阅状态
        setWechatQr({ url: resp.qrCodeUrl, orderId: resp.providerOrderId ?? "" });
        startPolling();
      } else if (resp.url) {
        // Stripe / 支付宝：跳转到通道页面
        window.location.href = resp.url;
      } else {
        setError(t("payNoResult"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("payCreateFailed"));
    } finally {
      setBusy(null);
    }
  }

  /** 微信支付状态轮询：每 3 秒查一次 status，订阅变 active 即关闭模态框 */
  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    let attempts = 0;
    const maxAttempts = 60; // 最长轮询 3 分钟（60 × 3s）
    pollRef.current = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        if (pollRef.current) clearInterval(pollRef.current);
        setError(t("payPollTimeout"));
        setWechatQr(null);
        return;
      }
      try {
        const s = await api<BillingStatus>(`/api/v1/workspaces/${wid}/billing/status`);
        setStatus(s);
        if (s.plan === "pro" && s.subscription?.status === "active") {
          if (pollRef.current) clearInterval(pollRef.current);
          setWechatQr(null);
        }
      } catch {
        // 轮询失败不中断，继续重试
      }
    }, 3000);
  }

  /** 关闭微信二维码模态框并停止轮询 */
  function closeWechatQr() {
    if (pollRef.current) clearInterval(pollRef.current);
    setWechatQr(null);
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
      setError(e instanceof Error ? e.message : t("portalFailed"));
    } finally {
      setBusy(null);
    }
  }

  const isOwner = status?.role === "owner";
  const sub = status?.subscription;
  const subMeta = sub
    ? (SUB_STATUS_LABEL[sub.status] ?? { label: sub.status, tone: "muted" })
    : null;
  const seatsUsed = status?.seatsUsed ?? 0;
  const seatLimit = status?.seatLimit ?? 0;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-[length:var(--text-2xl)] font-[var(--weight-semibold)] text-[var(--fg)]">
          <CreditCard size={20} className="text-[var(--muted)]" />
          {t("title")}
        </h1>
        <p className="mt-1 text-[length:var(--text-sm)] text-[var(--muted)]">{t("subtitle")}</p>
        {/* 互链到 /pricing 定价页（spec §1，当前窗口跳转走 next/link 客户端路由） */}
        <Link
          href="/pricing"
          className="mt-3 inline-flex items-center gap-1 text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors duration-[var(--motion-base)]"
        >
          {t("viewFullComparison")} <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>

      {justPaid && (
        <div className="mb-4 flex items-start gap-2 px-4 py-3 rounded-[var(--radius-md)] bg-[var(--success-soft)] text-[var(--success-fg)] text-[length:var(--text-sm)]">
          <Check size={16} className="shrink-0 mt-0.5 text-[var(--success)]" />
          <span>{t("justPaid")}</span>
        </div>
      )}
      {canceled && (
        <div className="mb-4 px-4 py-3 rounded-[var(--radius-md)] bg-[var(--surface-2)] text-[var(--fg-2)] text-[length:var(--text-sm)] border border-[var(--border)]">
          {t("checkoutCanceled")}
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
          <div className="space-y-3" aria-busy="true" aria-label={t("loadingStatus")}>
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
              <div className="text-[length:var(--text-xs)] text-[var(--meta)] mb-1">
                {t("currentPlan")}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[length:var(--text-lg)] font-[var(--weight-semibold)] text-[var(--fg)]">
                  {t(PLANS.find((p) => p.id === status.plan)?.nameKey ?? "planFree")}
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
                    {t(subMeta.labelKey)}
                  </span>
                )}
              </div>
              {sub?.currentPeriodEnd && (
                <div className="mt-1 text-[length:var(--text-xs)] text-[var(--meta)]">
                  {t("currentPeriodEnd", {
                    date: new Date(sub.currentPeriodEnd).toLocaleDateString(),
                  })}
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)] mb-1">
                <Users size={13} />
                {t("seats")}
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
                {t("manageBilling")}
              </button>
            )}
          </div>
        )}
      </div>

      {/* 支付方式选择（Phase 2：国内支付接入） */}
      {isOwner && status?.stripeReady && (
        <div className="mb-5 sm:mb-6 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-4 sm:p-5">
          <div className="text-[length:var(--text-xs)] text-[var(--meta)] mb-3">
            {t("paymentMethod")}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setPaymentMethod("card")}
              className={`inline-flex items-center gap-2 h-10 px-4 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] transition-colors duration-[var(--motion-fast)] ${
                paymentMethod === "card"
                  ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                  : "bg-[var(--surface-2)] text-[var(--fg-2)] hover:bg-[var(--surface-3)]"
              }`}
            >
              <CreditCard size={16} />
              {t("methodCard")}
            </button>
            <button
              onClick={() => setPaymentMethod("wechat")}
              className={`inline-flex items-center gap-2 h-10 px-4 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] transition-colors duration-[var(--motion-fast)] ${
                paymentMethod === "wechat"
                  ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                  : "bg-[var(--surface-2)] text-[var(--fg-2)] hover:bg-[var(--surface-3)]"
              }`}
            >
              <Wallet size={16} />
              {t("methodWechat")}
            </button>
            <button
              onClick={() => setPaymentMethod("alipay")}
              className={`inline-flex items-center gap-2 h-10 px-4 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] transition-colors duration-[var(--motion-fast)] ${
                paymentMethod === "alipay"
                  ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                  : "bg-[var(--surface-2)] text-[var(--fg-2)] hover:bg-[var(--surface-3)]"
              }`}
            >
              <Wallet size={16} />
              {t("methodAlipay")}
            </button>
          </div>
          <p className="mt-2 text-[length:var(--text-xs)] text-[var(--meta)]">
            {paymentMethod === "card" && t("descCard")}
            {paymentMethod === "wechat" && t("descWechat")}
            {paymentMethod === "alipay" && t("descAlipay")}
          </p>
        </div>
      )}

      {/* 计费周期切换（年付对齐定价页口径：¥590/人/年，立省 ¥118） */}
      {isOwner && (
        <div className="mb-4 flex items-center gap-2">
          <button
            onClick={() => setBillingPeriod("monthly")}
            className={`h-8 px-3 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] transition-colors duration-[var(--motion-fast)] ${
              billingPeriod === "monthly"
                ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                : "bg-[var(--surface-2)] text-[var(--fg-2)] hover:bg-[var(--surface-3)]"
            }`}
          >
            {t("periodMonthly")}
          </button>
          <button
            onClick={() => setBillingPeriod("yearly")}
            className={`h-8 px-3 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] transition-colors duration-[var(--motion-fast)] ${
              billingPeriod === "yearly"
                ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                : "bg-[var(--surface-2)] text-[var(--fg-2)] hover:bg-[var(--surface-3)]"
            }`}
          >
            {t("periodYearly")}
          </button>
        </div>
      )}

      {/* 套餐卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {PLANS.map((p) => {
          const current = status?.plan === p.id;
          const upgradable = isOwner && !current && p.id !== "free" && status?.stripeReady;
          // Pro 卡片价格/单位随计费周期切换；免费档固定 ¥0
          const price = p.id === "pro" && billingPeriod === "yearly" ? "¥590" : p.price;
          const unit =
            p.id === "pro"
              ? billingPeriod === "yearly"
                ? t("unitPerSeatYear")
                : t("unitPerSeatMonth")
              : t(p.unitKey);
          const seats =
            p.id === "pro" && billingPeriod === "yearly" ? t("yearlyAvg") : t(p.seatsKey);
          return (
            <div
              key={p.id}
              className={`flex flex-col bg-[var(--surface)] rounded-[var(--radius-lg)] p-4 sm:p-5 ${current ? "border-2 border-[var(--accent)]" : "border border-[var(--border)]"}`}
              style={{ boxShadow: "var(--elev-sm)" }}
            >
              <div className="flex items-baseline justify-between">
                <span className="text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--fg)]">
                  {t(p.nameKey)}
                </span>
                {current && (
                  <span className="px-2 py-0.5 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] text-[length:var(--text-xs)] font-[var(--weight-medium)]">
                    {t("currentBadge")}
                  </span>
                )}
              </div>

              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-[length:var(--text-3xl)] font-[var(--weight-semibold)] text-[var(--fg)] tabular-nums tracking-[-0.02em]">
                  {price}
                </span>
                <span className="text-[length:var(--text-xs)] text-[var(--meta)]">{unit}</span>
              </div>
              <div className="mt-1 text-[length:var(--text-xs)] text-[var(--meta)]">{seats}</div>

              <ul className="mt-4 space-y-2 flex-1">
                {p.features.map((f) => (
                  <li
                    key={f}
                    className="flex items-start gap-2 text-[length:var(--text-sm)] text-[var(--fg-2)]"
                  >
                    <Check size={14} className="shrink-0 mt-0.5 text-[var(--success)]" />
                    {t(f)}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => upgrade(p.id)}
                disabled={!upgradable || busy === p.id}
                title={!upgradable ? t("upgradeDisabledTitle") : undefined}
                className="mt-5 h-9 w-full rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] transition-colors duration-[var(--motion-base)] flex items-center justify-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60"
                style={{
                  background: upgradable ? "var(--accent)" : "var(--surface-2)",
                  color: upgradable ? "var(--accent-fg)" : "var(--meta)",
                }}
              >
                {busy === p.id && <Loader2 size={15} className="animate-spin" />}
                {current
                  ? t("inUse")
                  : p.id === "free"
                    ? t("included")
                    : upgradable
                      ? tButton("upgrade")
                      : t("unavailable")}
              </button>

              <details className="mt-3 group">
                <summary className="cursor-pointer text-[length:var(--text-xs)] text-[var(--meta)] hover:text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] select-none">
                  {t("fullComparison")}
                </summary>
                <ul className="mt-2 space-y-1.5">
                  {p.details.map((d) => (
                    <li
                      key={d}
                      className="flex items-start gap-1.5 text-[length:var(--text-xs)] text-[var(--fg-2)]"
                    >
                      <Check size={12} className="shrink-0 mt-0.5 text-[var(--success)]" />
                      {t(d)}
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
            {t("stripeNotConfiguredPrefix")}
            <code className="font-[family-name:var(--font-mono)] text-[length:var(--text-xs)]">
              STRIPE_SECRET_KEY
            </code>
            {" / "}
            <code className="font-[family-name:var(--font-mono)] text-[length:var(--text-xs)]">
              STRIPE_PRICE_ID
            </code>
            {t("stripeNotConfiguredSuffix")}
          </span>
        </div>
      )}

      {status && !isOwner && (
        <p className="mt-5 text-[length:var(--text-xs)] text-[var(--meta)]">
          {t("ownerOnlyNotice")}
        </p>
      )}

      {/* 微信支付二维码模态框（Phase 2：Native 扫码支付） */}
      {wechatQr && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-label={t("wechatQrAria")}
        >
          <div className="bg-[var(--surface)] rounded-[var(--radius-lg)] shadow-[var(--elev-lg)] p-6 max-w-sm w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[length:var(--text-lg)] font-[var(--weight-semibold)] text-[var(--fg)]">
                {t("wechatPayTitle")}
              </h2>
              <button
                onClick={closeWechatQr}
                className="text-[var(--muted)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
                aria-label={tButton("close")}
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex flex-col items-center">
              {/* 二维码渲染：使用在线 API 生成（生产环境建议替换为本地 QR 码库） */}
              {/* eslint-disable-next-line @next/next/no-img-element -- 外部二维码服务，next/image 无法代理 */}
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(wechatQr.url)}`}
                alt={t("wechatQr")}
                width={240}
                height={240}
                className="rounded-[var(--radius-md)]"
              />
              <p className="mt-4 text-[length:var(--text-sm)] text-[var(--fg-2)] text-center">
                {t("wechatScanHint")}
              </p>
              <div className="mt-3 flex items-center gap-2 text-[length:var(--text-xs)] text-[var(--meta)]">
                <Loader2 size={12} className="animate-spin" />
                {t("waitingPayment")}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
