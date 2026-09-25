"use client";

/**
 * 会议纪要详情/编辑页 · app/[locale]/w/[wid]/meeting-minutes/[mid]/page.tsx
 *
 * 客户端组件：
 *  - 默认渲染 MinutesDetail（只读展示）
 *  - URL 带 ?edit=1 时渲染 MinutesEditor（编辑）
 *
 * Next.js 16 中 params 为 Promise，在 useEffect 中 await 解包获取 wid/mid。
 * 参考 documents/[id]/page.tsx 的客户端 params 解包模式。
 */

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { MinutesDetail } from "@/components/minutes/MinutesDetail";
import { MinutesEditor } from "@/components/minutes/MinutesEditor";

interface Attendee {
  userId?: string;
  name: string;
  role?: string;
}
interface ActionItem {
  title: string;
  assigneeId?: string;
  dueDate?: string;
  done: boolean;
}

interface MinutesData {
  id: string;
  title: string;
  content: string;
  attendees: Attendee[];
  actionItems: ActionItem[];
  createdAt: string;
  updatedAt: string;
  creator: { id: string; name: string | null; email: string } | null;
}

export default function MinutesDetailPage({
  params,
}: {
  params: Promise<{ wid: string; mid: string }>;
}) {
  const t = useTranslations("minutes");
  const searchParams = useSearchParams();
  const isEdit = searchParams.get("edit") === "1";

  const [wid, setWid] = useState<string | null>(null);
  const [mid, setMid] = useState<string | null>(null);
  const [data, setData] = useState<MinutesData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { wid: w, mid: m } = await params;
      setWid(w);
      setMid(m);
      try {
        const minutes = await api<MinutesData>(`/api/v1/workspaces/${w}/meeting-minutes/${m}`);
        if (!cancelled) setData(minutes);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t("loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params, t]);

  if (error) {
    return <p className="p-[var(--space-8)] text-center text-[var(--danger)]">{error}</p>;
  }
  if (loading || !wid || !mid || !data) {
    return <p className="p-[var(--space-8)] text-center text-[var(--muted)]">{t("loading")}</p>;
  }

  if (isEdit) {
    return (
      <MinutesEditor
        wid={wid}
        mid={mid}
        initial={{
          title: data.title,
          content: data.content,
          attendees: data.attendees ?? [],
          actionItems: data.actionItems ?? [],
        }}
      />
    );
  }

  return <MinutesDetail wid={wid} mid={mid} data={data} />;
}
