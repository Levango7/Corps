"use client";

/**
 * 会议详情页（会议房间） · app/[locale]/w/[wid]/meetings/[mid]/page.tsx
 *
 * 客户端组件，管理 lobby → room 流程：
 *  1. 解包 params 获取 wid/mid
 *  2. fetch GET /api/v1/workspaces/{wid}/meetings/{mid} 获取会议标题
 *  3. lobby 状态：渲染 MeetingLobby（设备预览 + 加入按钮）
 *  4. room 状态：渲染 MeetingRoom（LiveKit 音视频会议 + 屏幕共享）
 *  5. 离开后返回会议列表页
 *
 * Next.js 16 中 params 为 Promise，在 useEffect 中 await 解包。
 */

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "@/lib/i18n-navigation";
import { api } from "@/lib/api";
import { MeetingLobby } from "@/components/meetings/MeetingLobby";
import { MeetingRoom } from "@/components/meetings/MeetingRoom";

/** 会议详情（仅取所需字段） */
interface MeetingDetail {
  id: string;
  title: string;
  status: string;
  participants: Array<{ id: string }>;
}

/** 页面阶段 */
type Stage = "loading" | "lobby" | "room";

export default function MeetingRoomPage({
  params,
}: {
  params: Promise<{ wid: string; mid: string }>;
}) {
  const router = useRouter();
  const [wid, setWid] = useState<string | null>(null);
  const [mid, setMid] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("loading");
  const [meetingTitle, setMeetingTitle] = useState("");

  // 解包 params + fetch 会议详情
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { wid: w, mid: m } = await params;
      if (cancelled) return;
      setWid(w);
      setMid(m);

      // 获取会议标题用于大厅显示
      try {
        const detail = await api<MeetingDetail>(
          `/api/v1/workspaces/${w}/meetings/${m}`,
        );
        if (!cancelled) {
          setMeetingTitle(detail.title);
          setStage("lobby");
        }
      } catch {
        // 获取详情失败仍允许进入会议（用默认标题）
        if (!cancelled) {
          setMeetingTitle("Meeting");
          setStage("lobby");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params]);

  // 返回会议列表
  const goToList = useCallback(() => {
    if (wid) router.push(`/w/${wid}/meetings`);
  }, [router, wid]);

  // 从大厅加入会议
  const handleJoin = useCallback(() => {
    setStage("room");
  }, []);

  // 从会议房间离开 → 回到大厅（而非直接列表，让用户可重新加入）
  const handleLeaveRoom = useCallback(() => {
    setStage("lobby");
  }, []);

  // 加载中
  if (stage === "loading" || !wid || !mid) return null;

  // 大厅阶段
  if (stage === "lobby") {
    return (
      <MeetingLobby
        workspaceId={wid}
        meetingId={mid}
        meetingTitle={meetingTitle}
        onJoin={handleJoin}
        onCancel={goToList}
      />
    );
  }

  // 会议房间阶段
  return (
    <MeetingRoom
      workspaceId={wid}
      meetingId={mid}
      onLeave={handleLeaveRoom}
    />
  );
}
