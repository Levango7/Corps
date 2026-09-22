"use client";

/**
 * 会议房间核心组件 · components/meetings/MeetingRoom.tsx
 *
 * 接入 LiveKit SDK 实现音视频会议 + 屏幕共享：
 *  1. 调用 POST /api/v1/workspaces/{wid}/meetings/{mid}/join 获取 { token, url, roomName }
 *  2. 用 <LiveKitRoom token serverUrl connect> 包裹内容
 *  3. 内部用 <VideoConference />（LiveKit 预置 UI：参与者网格 + 麦克风/摄像头/屏幕共享控制栏）
 *  4. 加上 <RoomAudioRenderer />（音频渲染）
 *  5. 连接状态：joining / connected / reconnecting / disconnected / error
 *  6. 离开时调用 POST /api/v1/workspaces/{wid}/meetings/{mid}/leave
 *     - beforeunload / pagehide 时用 navigator.sendBeacon 发送（High #5）
 *     - 组件卸载时也调用 leave API
 *  7. 错误处理：LiveKit 未配置（503）→ 显示"会议服务不可用"
 *  8. 区分主动挂断与意外断开（High #6）：
 *     - 主动挂断 → leave + onLeave
 *     - 意外断开 → "重连中..." + 重新 join 获取新 token（Medium #17），30s 超时才回 lobby
 *  9. 录制控制（Medium #16）：host 可见，调用 recording/start/stop API
 *
 * 全屏布局（fixed inset-0）。
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  LiveKitRoom,
  VideoConference,
  RoomAudioRenderer,
  useParticipants,
  useLocalParticipant,
  useDataChannel,
} from "@livekit/components-react";
import {
  Loader2,
  AlertCircle,
  WifiOff,
  Video,
  Circle,
  Square,
  Hand,
  Mic,
  MicOff,
  VideoIcon,
  VideoOff,
  Crown,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { api, ApiError } from "@/lib/api";

/** join API 返回的连接凭据 */
interface JoinResult {
  token: string;
  url: string;
  roomName: string;
}

/** 会议详情中参与者条目（用于判断 host 权限） */
interface ParticipantEntry {
  userId: string;
  role: string;
}

/** 会议详情（仅取所需字段） */
interface MeetingDetailForHost {
  createdBy?: string | null;
  participants: ParticipantEntry[];
}

export interface MeetingRoomProps {
  workspaceId: string;
  meetingId: string;
  onLeave?: () => void;
  /** 关联的 IM 会话 ID；存在时离开会议会自动发送 call_ended 系统消息 */
  conversationId?: string;
}

/** 连接状态机 */
type ConnectionState =
  | "joining"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

/** 录制状态 */
type RecordingState = "idle" | "starting" | "active" | "stopping";

/** 重连超时（ms） */
const RECONNECT_TIMEOUT_MS = 30_000;

export function MeetingRoom({ workspaceId, meetingId, onLeave, conversationId }: MeetingRoomProps) {
  const t = useTranslations("meetings.room");
  const tMeetings = useTranslations("meetings");
  const tButton = useTranslations("button");

  const [state, setState] = useState<ConnectionState>("joining");
  const [errorMsg, setErrorMsg] = useState("");
  /** 503 时后端返回的不可用标记 */
  const [serviceUnavailable, setServiceUnavailable] = useState(false);
  const [token, setToken] = useState<string | undefined>(undefined);
  const [serverUrl, setServerUrl] = useState<string | undefined>(undefined);

  // 录制相关状态
  const [isHost, setIsHost] = useState(false);
  const [recording, setRecording] = useState<RecordingState>("idle");

  // 记忆凭据，避免 effect 重复 join
  const joinedRef = useRef(false);
  // 记忆是否已调用 leave，避免重复
  const leftRef = useRef(false);
  // 记忆是否组件已卸载
  const mountedRef = useRef(false);
  // 标记用户是否主动挂断（区分意外断开）
  const intentionalLeaveRef = useRef(false);
  // 重连超时定时器
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // 组件卸载时调用 leave API（High #5）
      void callLeaveApiRef.current();
      // 清理重连超时
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, []);

  // 调用 leave API（幂等，失败不阻塞）
  const callLeaveApi = useCallback(async () => {
    if (leftRef.current) return;
    leftRef.current = true;
    try {
      await api(
        `/api/v1/workspaces/${workspaceId}/meetings/${meetingId}/leave`,
        { method: "POST" },
      );
    } catch {
      // 离开失败不阻塞 UI
    }
  }, [workspaceId, meetingId]);

  // 用 ref 存储 callLeaveApi，供卸载 effect 调用（避免依赖数组问题）
  const callLeaveApiRef = useRef(callLeaveApi);
  callLeaveApiRef.current = callLeaveApi;

  // 发送 call_ended 系统消息到关联会话（best-effort，失败不阻塞）
  const sendCallEndedMessage = useCallback(async () => {
    if (!conversationId) return;
    try {
      await api(
        `/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ type: "call_ended", body: "" }),
        },
      );
    } catch {
      // 发送 call_ended 失败不阻塞离开流程
    }
  }, [conversationId, workspaceId]);

  // ── High #5: beforeunload / pagehide 事件 ──
  // 页面卸载时用 navigator.sendBeacon 发送 leave 请求（无需 await）
  useEffect(() => {
    const leaveUrl = `/api/v1/workspaces/${workspaceId}/meetings/${meetingId}/leave`;

    const sendLeaveBeacon = () => {
      if (leftRef.current) return;
      leftRef.current = true;
      try {
        navigator.sendBeacon(leaveUrl);
      } catch {
        // sendBeacon 不可用时不阻塞
      }
    };

    const onBeforeUnload = () => sendLeaveBeacon();
    const onPageHide = () => sendLeaveBeacon();

    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [workspaceId, meetingId]);

  // 重新 join 获取新 token（用于 Medium #17 token 过期/刷新）
  const rejoin = useCallback(async (): Promise<boolean> => {
    try {
      const result = await api<JoinResult>(
        `/api/v1/workspaces/${workspaceId}/meetings/${meetingId}/join`,
        { method: "POST" },
      );
      if (!mountedRef.current) return false;
      // 更新 token，LiveKitRoom 会自动重连
      setToken(result.token);
      setServerUrl(result.url);
      return true;
    } catch {
      return false;
    }
  }, [workspaceId, meetingId]);

  // 挂载时调用 join API 获取 LiveKit token + 判断 host 权限
  useEffect(() => {
    let cancelled = false;
    if (joinedRef.current) return;
    joinedRef.current = true;

    (async () => {
      setState("joining");
      setErrorMsg("");
      setServiceUnavailable(false);
      try {
        const result = await api<JoinResult>(
          `/api/v1/workspaces/${workspaceId}/meetings/${meetingId}/join`,
          { method: "POST" },
        );
        if (cancelled) return;
        setToken(result.token);
        setServerUrl(result.url);
        // token/url 就绪后 LiveKitRoom 会自动连接（connect=true）

        // 并行获取用户 ID + 会议详情，判断 host 权限（用于录制按钮可见性）
        try {
          const [me, detail] = await Promise.all([
            api<{ id: string }>("/api/v1/users/me"),
            api<MeetingDetailForHost>(
              `/api/v1/workspaces/${workspaceId}/meetings/${meetingId}`,
            ),
          ]);
          if (cancelled) return;
          // host = 会议创建者 或 参与者中 role=host
          const isCreator = detail.createdBy === me.id;
          const participantRole = detail.participants.find(
            (p) => p.userId === me.id,
          )?.role;
          setIsHost(isCreator || participantRole === "host");
        } catch {
          // 获取 host 权限失败不阻塞会议，只是不显示录制按钮
        }
      } catch (e) {
        if (cancelled) return;
        const is503 =
          e instanceof ApiError && (e.status === 503 || e.code === 503);
        if (mountedRef.current) {
          setServiceUnavailable(is503);
          setErrorMsg(e instanceof Error ? e.message : t("connectionFailed"));
          setState("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workspaceId, meetingId, t]);

  // LiveKit 连接成功
  const handleConnected = useCallback(() => {
    if (!mountedRef.current) return;
    // 如果之前在重连中，清除超时定时器
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    setState("connected");
  }, []);

  // LiveKit 断开连接（用户主动离开或意外断开）
  const handleDisconnected = useCallback(() => {
    if (!mountedRef.current) return;

    // High #6: 区分主动挂断与意外断开
    if (intentionalLeaveRef.current) {
      // 主动挂断 → leave + sendCallEnded + onLeave
      setState("disconnected");
      void callLeaveApi();
      void sendCallEndedMessage();
      onLeave?.();
      return;
    }

    // 意外断开 → 显示"重连中..."，尝试重新 join 获取新 token（Medium #17）
    setState("reconnecting");

    // 尝试重新 join 获取新 token
    void rejoin().then((success) => {
      if (!mountedRef.current) return;
      if (!success) {
        // 重新 join 失败 → 清除超时，直接回 lobby
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
        setState("disconnected");
        void callLeaveApi();
        void sendCallEndedMessage();
        onLeave?.();
      }
      // join 成功 → token 已更新，LiveKitRoom 自动重连
      // 等待 onConnected 回调清除超时
    });

    // 设置 30s 重连超时
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    reconnectTimeoutRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      // 重连超时 → 回 lobby
      setState("disconnected");
      void callLeaveApi();
      void sendCallEndedMessage();
      onLeave?.();
    }, RECONNECT_TIMEOUT_MS);
  }, [callLeaveApi, onLeave, rejoin, sendCallEndedMessage]);

  // LiveKit 连接错误
  const handleError = useCallback(
    (error: Error) => {
      if (!mountedRef.current) return;
      // 清理重连超时
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      setErrorMsg(error.message || t("connectionFailed"));
      setState("error");
    },
    [t],
  );

  // 用户点击"返回"按钮（错误/断开状态下）— 主动离开
  const handleBack = useCallback(() => {
    intentionalLeaveRef.current = true;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    void callLeaveApi();
    void sendCallEndedMessage();
    onLeave?.();
  }, [callLeaveApi, onLeave, sendCallEndedMessage]);

  // ── Medium #16: 录制控制 ──
  const handleToggleRecording = useCallback(async () => {
    if (recording === "starting" || recording === "stopping") return;

    if (recording === "idle") {
      // 开始录制
      setRecording("starting");
      try {
        await api(
          `/api/v1/workspaces/${workspaceId}/meetings/${meetingId}/recording/start`,
          { method: "POST" },
        );
        if (mountedRef.current) setRecording("active");
      } catch {
        if (mountedRef.current) setRecording("idle");
      }
    } else {
      // 停止录制
      setRecording("stopping");
      try {
        await api(
          `/api/v1/workspaces/${workspaceId}/meetings/${meetingId}/recording/stop`,
          { method: "POST" },
        );
        if (mountedRef.current) setRecording("idle");
      } catch {
        if (mountedRef.current) setRecording("active");
      }
    }
  }, [recording, workspaceId, meetingId]);

  // ── 连接中 ──
  if (state === "joining") {
    return (
      <div
        className="fixed inset-0 z-[var(--z-modal)] flex flex-col items-center justify-center bg-[var(--bg)]"
        role="status"
        aria-live="polite"
      >
        <Loader2 size={28} className="animate-spin text-[var(--accent)] mb-3" />
        <p className="text-[length:var(--text-sm)] text-[var(--muted)]">
          {t("joining")}
        </p>
      </div>
    );
  }

  // ── 重连中（意外断开） ──
  if (state === "reconnecting") {
    return (
      <div
        className="fixed inset-0 z-[var(--z-modal)] flex flex-col items-center justify-center bg-[var(--bg)]"
        role="status"
        aria-live="polite"
      >
        <Loader2 size={28} className="animate-spin text-[var(--accent)] mb-3" />
        <p className="text-[length:var(--text-sm)] text-[var(--fg)] mb-2">
          {t("reconnecting")}
        </p>
        <p className="text-[length:var(--text-xs)] text-[var(--muted)]">
          {t("connectionFailed")}
        </p>
      </div>
    );
  }

  // ── 错误 ──
  if (state === "error") {
    return (
      <div
        className="fixed inset-0 z-[var(--z-modal)] flex flex-col items-center justify-center bg-[var(--bg)]"
        role="alert"
        aria-live="assertive"
      >
        {serviceUnavailable ? (
          <>
            <Video size={28} className="text-[var(--muted)] mb-3" />
            <p className="text-[length:var(--text-sm)] text-[var(--fg)] mb-2">
              {t("serviceUnavailable")}
            </p>
            <p className="text-[length:var(--text-xs)] text-[var(--muted)] mb-4 max-w-xs text-center">
              {t("serviceUnavailableHint")}
            </p>
          </>
        ) : (
          <>
            <AlertCircle size={28} className="text-[var(--danger)] mb-3" />
            <p className="text-[length:var(--text-sm)] text-[var(--danger)] mb-2">
              {t("connectionFailed")}
            </p>
            {errorMsg && (
              <p className="text-[length:var(--text-xs)] text-[var(--muted)] mb-4 max-w-xs text-center">
                {errorMsg}
              </p>
            )}
          </>
        )}
        <button
          type="button"
          onClick={handleBack}
          className="h-9 px-4 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
        >
          {t("leave")}
        </button>
      </div>
    );
  }

  // ── 已断开 ──
  if (state === "disconnected") {
    return (
      <div
        className="fixed inset-0 z-[var(--z-modal)] flex flex-col items-center justify-center bg-[var(--bg)]"
        role="status"
        aria-live="polite"
      >
        <WifiOff size={28} className="text-[var(--muted)] mb-3" />
        <p className="text-[length:var(--text-sm)] text-[var(--fg)] mb-4">
          {t("disconnected")}
        </p>
        <button
          type="button"
          onClick={handleBack}
          className="h-9 px-4 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
        >
          {t("leave")}
        </button>
      </div>
    );
  }

  // ── 已连接：渲染 LiveKit 房间 ──
  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex flex-col bg-[var(--bg)]">
      <LiveKitRoom
        token={token}
        serverUrl={serverUrl}
        connect={true}
        audio={true}
        video={true}
        onConnected={handleConnected}
        onDisconnected={handleDisconnected}
        onError={handleError}
        className="flex-1 flex flex-col"
      >
        {/*
         * Medium #16: 录制控制条（仅 host 可见）
         * 叠加在 VideoConference 上方，不影响 LiveKit 预置控制栏
         */}
        {isHost && (
          <div className="absolute top-[var(--space-3)] right-[var(--space-3)] z-[var(--z-sticky)] flex items-center gap-2">
            {recording === "active" && (
              <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)]">
                <Circle size={8} className="fill-current animate-pulse" />
                {tMeetings("recording")}
              </span>
            )}
            <button
              type="button"
              onClick={handleToggleRecording}
              disabled={recording === "starting" || recording === "stopping"}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)]"
            >
              {recording === "starting" || recording === "stopping" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : recording === "active" ? (
                <Square size={14} className="fill-current" />
              ) : (
                <Circle size={14} className="fill-current text-[var(--danger)]" />
              )}
              {recording === "active" || recording === "stopping"
                ? tMeetings("stopRecording")
                : tMeetings("startRecording")}
            </button>
          </div>
        )}
        {/*
         * VideoConference 是 LiveKit 预置的完整视频会议 UI：
         *  - 参与者视频网格（含聚焦/分页）
         *  - 控制栏（麦克风/摄像头/屏幕共享/挂断）
         *  - 非持久聊天
         */}
        <VideoConference className="flex-1" />
        {/* RoomAudioRenderer 不可见，负责渲染远端参与者音频 */}
        <RoomAudioRenderer />
        {/* L9 #35 + L10 #36：举手/设备信息 + 主持人转移控制面板 */}
        <MeetingRoomControls isHost={isHost} />
      </LiveKitRoom>
    </div>
  );
}

/**
 * L9 #35 + L10 #36：会议内部控制面板
 *
 * 在 LiveKitRoom context 内使用 hooks：
 * - useParticipants：获取所有参与者（含设备状态）
 * - useLocalParticipant：获取本地参与者设备状态
 * - useDataChannel("hand-raise")：举手消息收发
 * - useDataChannel("host-transfer")：主持人转移消息收发
 *
 * 面板叠加在左下角，不影响 VideoConference 的控制栏。
 */
function MeetingRoomControls({ isHost }: { isHost: boolean }) {
  const t = useTranslations("meetings.room");

  // 获取所有参与者 + 本地参与者设备状态
  const participants = useParticipants();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } =
    useLocalParticipant();

  // 举手状态（本地）
  const [handRaised, setHandRaised] = useState(false);
  // 收到的举手消息（participantId → raised）
  const [raisedHands, setRaisedHands] = useState<Record<string, boolean>>({});

  // 举手 data channel
  const { send: sendHandRaise } = useDataChannel("hand-raise", (msg) => {
    try {
      const data = JSON.parse(new TextDecoder().decode(msg.payload)) as {
        participantId: string;
        raised: boolean;
      };
      setRaisedHands((prev) => ({
        ...prev,
        [data.participantId]: data.raised,
      }));
    } catch {
      // 忽略非 JSON 消息
    }
  });

  // 主持人转移 data channel
  const { send: sendHostTransfer } = useDataChannel("host-transfer", (msg) => {
    try {
      const data = JSON.parse(new TextDecoder().decode(msg.payload)) as {
        newHostId: string;
      };
      // 收到转移消息：如果目标是自己，更新 metadata 标记为 host
      if (data.newHostId === localParticipant.identity) {
        void localParticipant.setMetadata(
          JSON.stringify({ ...JSON.parse(localParticipant.metadata ?? "{}"), role: "host" }),
        );
      }
    } catch {
      // 忽略非 JSON 消息
    }
  });

  // 切换举手
  const toggleHandRaise = useCallback(() => {
    const newRaised = !handRaised;
    setHandRaised(newRaised);
    const payload = new TextEncoder().encode(
      JSON.stringify({ participantId: localParticipant.identity, raised: newRaised }),
    );
    void sendHandRaise(payload, { reliable: true });
  }, [handRaised, localParticipant, sendHandRaise]);

  // L10 #36：主持人转移
  const [transferTarget, setTransferTarget] = useState("");
  const handleTransferHost = useCallback(() => {
    if (!transferTarget) return;
    const payload = new TextEncoder().encode(
      JSON.stringify({ newHostId: transferTarget }),
    );
    void sendHostTransfer(payload, { reliable: true });
    setTransferTarget("");
  }, [transferTarget, sendHostTransfer]);

  return (
    <>
      {/* 举手按钮（叠加在左下角） */}
      <button
        type="button"
        onClick={toggleHandRaise}
        className={[
          "absolute bottom-[var(--space-20)] left-[var(--space-3)] z-[var(--z-sticky)] inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] border text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] transition-colors duration-[var(--motion-fast)]",
          handRaised
            ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]"
            : "border-[var(--border)] bg-[var(--surface)] text-[var(--fg-2)] hover:bg-[var(--surface-2)]",
        ].join(" ")}
        aria-pressed={handRaised}
        title={t("handRaise")}
      >
        <Hand size={16} className={handRaised ? "fill-current" : ""} />
        {t("handRaise")}
      </button>

      {/* 参与者设备信息面板（叠加在右侧） */}
      <div className="absolute top-[var(--space-3)] left-[var(--space-3)] z-[var(--z-sticky)] max-w-[240px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-sm)] p-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--fg-2)] max-h-[60vh] overflow-y-auto">
        <div className="flex items-center gap-1.5 mb-[var(--space-1)] font-[weight:var(--weight-semibold)] text-[var(--meta)]">
          <Users size={12} />
          {t("participants")} · {participants.length}
        </div>
        <ul className="space-y-1">
          {participants.map((p) => {
            // 设备状态：从 participant 的 tracks 推断
            const micOn = p.isMicrophoneEnabled;
            const camOn = p.isCameraEnabled;
            const raised = raisedHands[p.identity];
            const isLocal = p.identity === localParticipant.identity;
            return (
              <li
                key={p.identity}
                className="flex items-center gap-1.5 py-0.5"
              >
                <span className="truncate flex-1">
                  {p.name ?? p.identity}
                  {isLocal && ` (${t("me")})`}
                </span>
                {/* 设备状态图标 */}
                {micOn ? (
                  <Mic size={11} className="text-[var(--success)]" />
                ) : (
                  <MicOff size={11} className="text-[var(--muted)]" />
                )}
                {camOn ? (
                  <VideoIcon size={11} className="text-[var(--success)]" />
                ) : (
                  <VideoOff size={11} className="text-[var(--muted)]" />
                )}
                {/* 举手标记 */}
                {raised && (
                  <Hand size={11} className="text-[var(--accent)] fill-current" />
                )}
              </li>
            );
          })}
        </ul>

        {/* L10 #36：主持人转移（仅 host 可见） */}
        {isHost && participants.length > 1 && (
          <div className="mt-[var(--space-2)] pt-[var(--space-2)] border-t border-[var(--border-soft)]">
            <div className="flex items-center gap-1 mb-1 font-[weight:var(--weight-semibold)] text-[var(--meta)]">
              <Crown size={12} />
              {t("transferHost")}
            </div>
            <div className="flex gap-1">
              <select
                value={transferTarget}
                onChange={(e) => setTransferTarget(e.target.value)}
                className="flex-1 h-7 px-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-xs)] text-[var(--fg)] outline-none"
              >
                <option value="">{t("selectParticipant")}</option>
                {participants
                  .filter((p) => p.identity !== localParticipant.identity)
                  .map((p) => (
                    <option key={p.identity} value={p.identity}>
                      {p.name ?? p.identity}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                onClick={handleTransferHost}
                disabled={!transferTarget}
                className="h-7 px-2 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)]"
              >
                {t("transfer")}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
