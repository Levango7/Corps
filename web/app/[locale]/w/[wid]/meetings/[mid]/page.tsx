"use client";

/**
 * 会议详情页（会议房间） · app/[locale]/w/[wid]/meetings/[mid]/page.tsx
 *
 * 客户端组件，渲染 MeetingRoom（全屏会议界面）。
 * Next.js 16 中 params 为 Promise，在 useEffect 中 await 解包获取 wid/mid。
 * 离开时用 locale 感知 router 返回会议列表页。
 *
 * 参考 documents/[id]/page.tsx 的客户端 params 解包模式。
 */

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "@/lib/i18n-navigation";
import { MeetingRoom } from "@/components/meeting/MeetingRoom";

export default function MeetingRoomPage({
  params,
}: {
  params: Promise<{ wid: string; mid: string }>;
}) {
  const router = useRouter();
  const [wid, setWid] = useState<string | null>(null);
  const [mid, setMid] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { wid: w, mid: m } = await params;
      if (!cancelled) {
        setWid(w);
        setMid(m);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params]);

  const handleLeave = useCallback(() => {
    if (wid) router.push(`/w/${wid}/meetings`);
  }, [router, wid]);

  if (!wid || !mid) return null;

  return <MeetingRoom meetingId={mid} workspaceId={wid} onLeave={handleLeave} />;
}
