"use client";

/**
 * 公开分享页：/documents/share/[token]——任何人可访问（含未登录访客）。
 * 数据：调用 /api/documents/share/{token} 拉取已发布快照，无登录态可用。
 *
 * F5 增强：
 *  - 检查有效期：shareExpiresAt < now → 显示「链接已过期」页面
 *  - 检查密码：
 *    - 无密码 → 直接显示内容
 *    - 有密码 → 显示 SharePasswordGate 组件
 *    - 密码验证：调用 POST /api/documents/share/{token}/verify（公开端点）
 *    - 正确则显示内容，错误则显示错误提示 + 剩余尝试次数
 *    - 错误 3 次 → 5 分钟 IP 级别锁定（后端返回 429 + lockedUntil）
 *
 * 防御性设计：若后端未返回 hasPassword / shareExpiresAt 字段（旧版兼容），
 * 默认按「无密码 / 永不过期」处理，直接展示内容。
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { PublicDocumentView } from "@/components/PublicDocumentView";
import { SharePasswordGate } from "@/components/SharePasswordGate";
import { AlertTriangle, Clock } from "lucide-react";

interface SharedDoc {
  id: string;
  title: string;
  publishedMarkdown: string;
  publishedAt: string;
  workspace: { name: string; slug: string } | null;
  author: { name: string | null } | null;
  /** F5 新增：分享过期时间（ISO 字符串；null=永不过期；后端增强后返回） */
  shareExpiresAt?: string | null;
  /** F5 新增：是否设置了密码（后端增强后返回） */
  hasPassword?: boolean;
}

/** 密码验证后返回的文档内容 */
interface VerifiedDoc {
  id: string;
  title: string;
  markdown: string;
}

export default function SharePage({ params }: { params: Promise<{ token: string }> }) {
  return <ShareClient params={params} />;
}

function ShareClient({ params }: { params: Promise<{ token: string }> }) {
  const t = useTranslations("document");
  const tGate = useTranslations("shareGate");
  const [data, setData] = useState<SharedDoc | null>(null);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  /** 是否需要密码（后端返回 hasPassword=true 时置 true） */
  const [needPassword, setNeedPassword] = useState(false);
  /** 密码验证通过后的文档内容（验证成功后展示） */
  const [verifiedContent, setVerifiedContent] = useState<VerifiedDoc | null>(null);
  /** 密码错误提示 */
  const [pwdError, setPwdError] = useState<string | null>(null);
  /** 剩余尝试次数 */
  const [remainingAttempts, setRemainingAttempts] = useState<number | undefined>(undefined);
  /** 锁定截止时间 */
  const [lockedUntil, setLockedUntil] = useState<Date | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { token } = await params;
      try {
        const res = await fetch(`/api/documents/share/${token}`);
        if (!res.ok) {
          if (!cancelled) setError(t("shareInvalid"));
          return;
        }
        const json = await res.json();
        const doc: SharedDoc = json.data;
        if (cancelled) return;

        // F5：检查有效期（防御性：shareExpiresAt 不存在则跳过）
        if (doc.shareExpiresAt && new Date(doc.shareExpiresAt) < new Date()) {
          setExpired(true);
          return;
        }

        // F5：检查密码（防御性：hasPassword 不存在则视为无密码）
        if (doc.hasPassword) {
          setNeedPassword(true);
          setData(doc);
          return;
        }

        // 无密码：直接显示内容
        setData(doc);
      } catch {
        if (!cancelled) setError(t("shareInvalid"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params, t]);

  /** 密码验证：调用公开 verify 端点 */
  async function handleVerifyPassword(password: string) {
    const { token } = await params;
    setVerifying(true);
    setPwdError(null);
    try {
      const res = await fetch(`/api/documents/share/${token}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        const json = await res.json();
        setVerifiedContent(json.data as VerifiedDoc);
        setNeedPassword(false);
        setPwdError(null);
        setRemainingAttempts(undefined);
        setLockedUntil(null);
      } else if (res.status === 401) {
        // 密码错误
        const json = await res.json().catch(() => null);
        setPwdError(json?.message || tGate("passwordIncorrect"));
        // 后端可能返回剩余次数（headers 或 body），此处从 body 提取
        if (json?.remainingAttempts !== undefined) {
          setRemainingAttempts(json.remainingAttempts as number);
        } else {
          // 未知剩余次数，递减显示
          setRemainingAttempts((prev) =>
            prev === undefined ? 2 : Math.max(0, prev - 1),
          );
        }
      } else if (res.status === 429) {
        // 锁定：5 分钟后重试
        const json = await res.json().catch(() => null);
        setPwdError(json?.message || tGate("passwordIncorrect"));
        setLockedUntil(new Date(Date.now() + 5 * 60 * 1000));
      } else if (res.status === 403) {
        // 过期
        const json = await res.json().catch(() => null);
        setPwdError(json?.message || t("shareExpired"));
        setExpired(true);
        setNeedPassword(false);
      } else {
        setPwdError(t("shareInvalid"));
      }
    } catch {
      setPwdError(t("shareInvalid"));
    } finally {
      setVerifying(false);
    }
  }

  // ── 错误状态 ──
  if (error) {
    return (
      <div className="min-h-[50dvh] flex items-center justify-center text-[var(--muted)]">
        {error}
      </div>
    );
  }

  // ── 过期状态 ──
  if (expired) {
    return (
      <div className="min-h-[50dvh] flex items-center justify-center px-[var(--space-4)]">
        <div className="flex flex-col items-center gap-3 text-center max-w-sm">
          <Clock size={32} className="text-[var(--muted)]" />
          <h1 className="text-[length:var(--text-xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            {t("shareExpiredTitle")}
          </h1>
          <p className="text-[length:var(--text-sm)] text-[var(--muted)]">
            {t("shareExpiredHint")}
          </p>
        </div>
      </div>
    );
  }

  // ── 密码门 ──
  if (needPassword) {
    return (
      <>
        {/* 背景占位：显示文档标题（若有）但不泄露内容 */}
        {data && (
          <div className="min-h-[50dvh] flex items-center justify-center px-[var(--space-4)]">
            <div className="flex flex-col items-center gap-2 text-center max-w-sm">
              <AlertTriangle size={28} className="text-[var(--muted)] opacity-50" />
              <p className="text-[length:var(--text-sm)] text-[var(--muted)]">
                {t("sharePasswordRequired")}
              </p>
            </div>
          </div>
        )}
        <SharePasswordGate
          open={needPassword}
          onSubmit={handleVerifyPassword}
          error={pwdError}
          remainingAttempts={remainingAttempts}
          lockedUntil={lockedUntil}
        />
      </>
    );
  }

  // ── 密码验证通过：显示验证后返回的内容 ──
  if (verifiedContent) {
    return (
      <PublicDocumentView
        title={verifiedContent.title}
        markdown={verifiedContent.markdown}
        workspace={data?.workspace ?? null}
        author={data?.author ?? null}
        publishedAt={data?.publishedAt ?? null}
        redacted
      />
    );
  }

  // ── 加载中 / 无密码直接显示 ──
  if (!data) {
    return <div className="min-h-[50dvh]" />;
  }
  return (
    <PublicDocumentView
      title={data.title}
      markdown={data.publishedMarkdown}
      workspace={data.workspace}
      author={data.author}
      publishedAt={data.publishedAt}
      redacted
    />
  );
}
