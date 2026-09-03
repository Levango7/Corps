"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { DocumentEditor } from "@/components/DocumentEditor";

export default function DocumentEditPage({
  params,
}: {
  params: Promise<{ wid: string; id: string }>;
}) {
  return <DocumentEditPageClient params={params} />;
}

function DocumentEditPageClient({ params }: { params: Promise<{ wid: string; id: string }> }) {
  const t = useTranslations("document");
  const [wid, setWid] = useState<string | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [data, setData] = useState<Parameters<typeof DocumentEditor>[0]["initial"] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { wid: w, id: i } = await params;
      setWid(w);
      setId(i);
      try {
        const doc = await api<{
          id: string;
          title: string;
          markdown: string;
          publishedMarkdown: string | null;
          publishedAt: string | null;
          shareToken: string | null;
        }>(`/api/v1/workspaces/${w}/documents/${i}`);
        if (!cancelled) {
          setData({
            title: doc.title,
            markdown: doc.markdown,
            publishedMarkdown: doc.publishedMarkdown,
            publishedAt: doc.publishedAt,
            shareToken: doc.shareToken,
          });
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t("loadFailed"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params, t]);

  if (error) {
    return <p className="p-[var(--space-8)] text-center text-[var(--danger)]">{error}</p>;
  }
  if (!wid || !id || !data) {
    return <p className="p-[var(--space-8)] text-center text-[var(--muted)]">{t("loading")}</p>;
  }
  return <DocumentEditor wid={wid} id={id} initial={data} />;
}
