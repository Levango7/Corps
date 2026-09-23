"use client";

/**
 * 会议详情页（会议房间） · app/[locale]/w/[wid]/meetings/[mid]/page.tsx
 *
 * 客户端组件，管理 lobby → room 流程：
 *  1. 解包 params 获取 wid/mid
 *  2. fetch GET /api/v1/workspaces/{wid}/meetings/{mid} 获取会议标题
 *  3. lobby 状态：渲染 MeetingLobby（设备预览 + 加入按钮）
 *     - 传入 currentUserName（Medium #18）
 *  4. room 状态：渲染 MeetingRoom（LiveKit 音视频会议 + 屏幕共享）
 *  5. ended 状态：显示"会议已结束"页面（Medium #19）
 *  6. 离开后返回会议列表页
 *  7. fetch 失败用 i18n 而非硬编码英文（Medium #20）
 *
 * Next.js 16 中 params 为 Promise，在 useEffect 中 await 解包。
 */

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "@/lib/i18n-navigation";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Video, ArrowLeft, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { MeetingLobby } from "@/components/meetings/MeetingLobby";
import { MeetingRoom } from "@/components/meetings/MeetingRoom";
import dynamic from "next/dynamic";

// P0-2: code splitting — MeetingFlowPanel 改为 dynamic import 懒加载
const MeetingFlowPanel = dynamic(
  () => import("@/components/ai/MeetingFlowPanel"),
  { ssr: false, loading: () => <div className="animate-pulse h-32 rounded-lg bg-[var(--surface-2)]" /> },
);

/** 会议详情（仅取所需字段） */
interface MeetingDetail {
  id: string;
  title: string;
  status: string;
  participants: Array<{ id: string }>;
}

/** 页面阶段 */
type Stage = "loading" | "lobby" | "room" | "ended";

export default function MeetingRoomPage({
  params,
}: {
  params: Promise<{ wid: string; mid: string }>;
}) {
  const t = useTranslations("meeting");
  const router = useRouter();
  const searchParams = useSearchParams();
  const conversationId = searchParams.get("conversationId") ?? undefined;
  const skipLobby = searchParams.get("skipLobby") === "true";
  const [wid, setWid] = useState<string | null>(null);
  const [mid, setMid] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("loading");
  const [meetingTitle, setMeetingTitle] = useState("");
  // 当前用户名（Medium #18：传入 MeetingLobby 预填 PreJoin 输入框）
  const [currentUserName, setCurrentUserName] = useState<string | undefined>(
    undefined,
  );
  // AI 会议流程面板开关（会后阶段：会议已结束时点击"AI 会议流程"按钮打开）
  const [showAiFlow, setShowAiFlow] = useState(false);
  // AI 服务是否已配置（挂载时探测一次，未配置时按钮置灰，避免点击后才收到 503）
  const [aiConfigured, setAiConfigured] = useState(false);

  // 挂载时探测 AI 服务是否已配置（与任务详情页"AI 拆分子任务"按钮同模式）
  useEffect(() => {
    api<{ configured: boolean }>("/api/v1/ai/configured")
      .then((data) => setAiConfigured(data?.configured ?? false))
      .catch(() => setAiConfigured(false));
  }, []);

  // 解包 params + fetch 会议详情 + 当前用户名
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { wid: w, mid: m } = await params;
      if (cancelled) return;
      setWid(w);
      setMid(m);

      // 并行获取会议详情 + 当前用户名
      const [detailResult, meResult] = await Promise.allSettled([
        api<MeetingDetail>(`/api/v1/workspaces/${w}/meetings/${m}`),
        api<{ id: string; name: string | null; email: string }>(
          "/api/v1/users/me",
        ),
      ]);

      if (cancelled) return;

      // Medium #18：设置当前用户名（优先 name，回退 email）
      if (meResult.status === "fulfilled") {
        setCurrentUserName(
          meResult.value.name ?? meResult.value.email ?? undefined,
        );
      }

      // 会议详情
      if (detailResult.status === "fulfilled") {
        const detail = detailResult.value;
        setMeetingTitle(detail.title);
        // Medium #19：检查 status === "ended"，显示"会议已结束"页面
        if (detail.status === "ended") {
          setStage("ended");
        } else if (skipLobby) {
          // 即时通话场景：跳过大厅，直接进入会议室
          setStage("room");
        } else {
          setStage("lobby");
        }
      } else {
        // Medium #20：fetch 失败用 i18n 而非硬编码 "Meeting"
        setMeetingTitle(t("title"));
        // skipLobby 时即使 fetch 失败也直接进入会议室
        setStage(skipLobby ? "room" : "lobby");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params, t, skipLobby]);

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

  // Medium #19：会议已结束
  if (stage === "ended") {
    return (
      <div
        className="fixed inset-0 z-[var(--z-modal)] flex flex-col items-center justify-center bg-[var(--bg)] px-[var(--space-4)]"
        role="status"
        aria-live="polite"
      >
        <button
          type="button"
          onClick={goToList}
          className="absolute top-[var(--space-4)] left-[var(--space-4)] inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[var(--fg-2)] text-[length:var(--text-sm)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
          aria-label={t("leave")}
        >
          <ArrowLeft size={16} />
          {t("leave")}
        </button>
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[var(--surface-2)] text-[var(--muted)] mb-[var(--space-3)]">
          <Video size={20} />
        </div>
        <h1 className="text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)] mb-[var(--space-1)]">
          {meetingTitle}
        </h1>
        <p className="text-[length:var(--text-sm)] text-[var(--muted)]">
          {t("endedMeetings")}
        </p>
        {/* AI 会议流程按钮（会后阶段）—— 点击打开 MeetingFlowPanel 侧边栏 */}
        <button
          type="button"
          onClick={() => setShowAiFlow(true)}
          disabled={!aiConfigured}
          title={!aiConfigured ? t("aiFlowDisabled") : undefined}
          className="mt-[var(--space-5)] inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
        >
          <Sparkles size={14} className="text-[var(--accent)]" />
          {t("aiFlow")}
        </button>
        {/* AI 会议全流程面板（侧边栏，右侧贴边覆盖） */}
        {showAiFlow && (
          <div className="fixed inset-y-0 right-0 z-[var(--z-modal)]">
            <MeetingFlowPanel
              wid={wid}
              meetingId={mid}
              onClose={() => setShowAiFlow(false)}
            />
          </div>
        )}
      </div>
    );
  }

  // 大厅阶段
  if (stage === "lobby") {
    return (
      <MeetingLobby

        meetingTitle={meetingTitle}
        currentUserName={currentUserName}
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
      conversationId={conversationId}
    />
  );
}
