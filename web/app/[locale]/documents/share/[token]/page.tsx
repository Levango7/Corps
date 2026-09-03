"use client";

/**
 * 公开分享页：/documents/share/[token]——任何人可访问（含未登录访客）。
 * 数据：调用 /api/documents/share/{token} 拉取已发布快照，无登录态可用。
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { PublicDocumentView } from "@/components/PublicDocumentView";

interface SharedDoc {
  id: string;
  title: string;
  publishedMarkdown: string;
  publishedAt: string;
  workspace: { name: string; slug: string } | null;
  author: { name: string | null } | null;
}

export default function SharePage({ params }: { params: Promise<{ token: string }> }) {
  return <ShareClient params={params} />;
}

function ShareClient({ params }: { params: Promise<{ token: string }> }) {
  const t = useTranslations("document");
  const [data, setData] = useState<SharedDoc | null>(null);
  const [error, setError] = useState("");

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
        if (!cancelled) setData(json.data);
      } catch {
        if (!cancelled) setError(t("shareInvalid"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params, t]);

  if (error) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center text-[var(--muted)]">
        {error}
      </div>
    );
  }
  if (!data) {
    return <div className="min-h-[50vh]" />;
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
