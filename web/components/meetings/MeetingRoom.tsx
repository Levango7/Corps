"use client";

/**
 * 会议房间核心组件 · components/meetings/MeetingRoom.tsx
 *
 * 接入 LiveKit SDK 实现音视频会议 + 屏幕共享：
 *  1. 调用 POST /api/v1/workspaces/{wid}/meetings/{mid}/join 获取 { token, url, roomName }
 *  2. 用 <LiveKitRoom token serverUrl connect> 包裹内容
 *  3. 内部用 <VideoConference />（LiveKit 预置 UI：参与者网格 + 麦克风/摄像头/屏幕共享控制栏）
 *  4. 加上 <RoomAudioRenderer />（音频渲染）
 *  5. 连接状态：connecting / connected / disconnected / error
 *  6. 离开时调用 POST /api/v1/workspaces/{wid}/meetings/{mid}/leave
 *  7. 错误处理：LiveKit 未配置（503）→ 显示"会议服务不可用"
 *
 * 全屏布局（fixed inset-0）。
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  LiveKitRoom,
  VideoConference,
  RoomAudioRenderer,
} from "@livekit/components-react";
import { Loader2, AlertCircle, WifiOff, Video } from "lucide-react";
import { useTranslations } from "next-intl";
import { api, ApiError } from "@/lib/api";

/** join API 返回的连接凭据 */
interface JoinResult {
  token: string;
  url: string;
  roomName: string;
}

export interface MeetingRoomProps {
  workspaceId: string;
  meetingId: string;
  onLeave?: () => void;
}

/** 连接状态机 */
type ConnectionState = "joining" | "connected" | "disconnected" | "error";

export function MeetingRoom({ workspaceId, meetingId, onLeave }: MeetingRoomProps) {
  const t = useTranslations("meetings.room");

  const [state, setState] = useState<ConnectionState>("joining");
  const [errorMsg, setErrorMsg] = useState("");
  /** 503 时后端返回的不可用标记 */
  const [serviceUnavailable, setServiceUnavailable] = useState(false);
  const [token, setToken] = useState<string | undefined>(undefined);
  const [serverUrl, setServerUrl] = useState<string | undefined>(undefined);

  // 记忆凭据，避免 effect 重复 join
  const joinedRef = useRef(false);
  // 记忆是否已调用 leave，避免重复
  const leftRef = useRef(false);
  // 记忆是否组件已卸载
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 挂载时调用 join API 获取 LiveKit token
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

  // LiveKit 连接成功
  const handleConnected = useCallback(() => {
    if (mountedRef.current) setState("connected");
  }, []);

  // LiveKit 断开连接（用户主动离开或意外断开）
  const handleDisconnected = useCallback(() => {
    if (!mountedRef.current) return;
    setState("disconnected");
    // 断开后调用 leave API 通知后端
    void callLeaveApi();
    // 通知父组件离开（返回会议列表）
    onLeave?.();
  }, [callLeaveApi, onLeave]);

  // LiveKit 连接错误
  const handleError = useCallback(
    (error: Error) => {
      if (!mountedRef.current) return;
      setErrorMsg(error.message || t("connectionFailed"));
      setState("error");
    },
    [t],
  );

  // 用户点击"返回"按钮（错误/断开状态下）
  const handleBack = useCallback(() => {
    void callLeaveApi();
    onLeave?.();
  }, [callLeaveApi, onLeave]);

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
         * VideoConference 是 LiveKit 预置的完整视频会议 UI：
         *  - 参与者视频网格（含聚焦/分页）
         *  - 控制栏（麦克风/摄像头/屏幕共享/挂断）
         *  - 非持久聊天
         */}
        <VideoConference className="flex-1" />
        {/* RoomAudioRenderer 不可见，负责渲染远端参与者音频 */}
        <RoomAudioRenderer />
      </LiveKitRoom>
    </div>
  );
}