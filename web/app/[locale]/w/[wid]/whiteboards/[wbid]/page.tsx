"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/Skeleton";
import { SafeComponent } from "@/components/SafeComponent";

// 白板编辑器是 540+ 行的重型客户端组件（元素创建/拖拽/调整大小/内联编辑/自动保存），
// 仅此页面使用。dynamic import + ssr:false 将其拆分为独立 chunk，
// 避免计入白板列表页等其他路由的首屏 bundle。
const WhiteboardCanvas = dynamic(
  () => import("@/components/whiteboard/WhiteboardCanvas").then((m) => m.WhiteboardCanvas),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[600px] w-full" />,
  },
);

/**
 * 单个白板编辑页：全屏画布 + 工具栏。
 *
 * 先拉取白板详情（GET /whiteboards/{wbid}），再渲染 WhiteboardCanvas。
 */
export default function WhiteboardEditPage({
  params,
}: {
  params: Promise<{ wid: string; wbid: string }>;
}) {
  return <WhiteboardEditPageClient params={params} />;
}

function WhiteboardEditPageClient({ params }: { params: Promise<{ wid: string; wbid: string }> }) {
  const t = useTranslations("whiteboard");
  const [wid, setWid] = useState<string | null>(null);
  const [wbid, setWbid] = useState<string | null>(null);
  const [data, setData] = useState<{
    id: string;
    title: string;
    data: unknown;
  } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { wid: w, wbid: b } = await params;
      setWid(w);
      setWbid(b);
      try {
        const wb = await api<{
          id: string;
          title: string;
          data: unknown;
        }>(`/api/v1/workspaces/${w}/whiteboards/${b}`);
        if (!cancelled) {
          setData({ id: wb.id, title: wb.title, data: wb.data });
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t("noWhiteboards"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params, t]);

  if (error) {
    return <p className="p-[var(--space-8)] text-center text-[var(--danger)]">{error}</p>;
  }
  if (!wid || !wbid || !data) {
    return <p className="p-[var(--space-8)] text-center text-[var(--muted)]">{t("loading")}</p>;
  }
  return (
    <SafeComponent name="白板编辑器">
      <WhiteboardCanvas wid={wid} wbid={wbid} initialTitle={data.title} initialData={data.data} />
    </SafeComponent>
  );
}
