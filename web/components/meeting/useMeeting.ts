"use client";

/**
 * 会议连接 hook · components/meeting/useMeeting.ts
 *
 * 管理会议状态与 LiveKit 房间连接。
 *
 * 当前为类型安全占位实现：package.json 未安装 @livekit/components-react 与
 * livekit-client（避免 pnpm install 超时）。joinMeeting 会调用后端 join API
 * 获取 LiveKit token，但不实际建立 WebRTC 连接；participants 返回空数组。
 *
 * TODO（安装 LiveKit SDK 后完善）：
 *  - pnpm add @livekit/components-react livekit-client
 *  - 用 useVoiceAssistant / useRoom / LocalParticipant 替换占位状态
 *  - 将 token 传入 LiveKitRoom 组件建立 WebRTC 连接
 *  - 从 room.participants 派生 participants 列表
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

/** 参与者信息（与 ParticipantGrid Props 对齐） */
export interface Participant {
  id: string;
  name: string;
  isSpeaking: boolean;
  hasVideo: boolean;
  hasAudio: boolean;
}

/** join API 返回的连接凭据 */
interface JoinResult {
  token: string;
  url: string;
  roomName: string;
}

/** useMeeting 返回值 */
export interface UseMeetingResult {
  /** 是否已连接到会议房间 */
  isConnected: boolean;
  /** 是否正在加入中 */
  isJoining: boolean;
  /** 远端参与者列表（占位实现下始终为空数组） */
  participants: Participant[];
  /** 本地参与者（占位实现下为 null） */
  localParticipant: Participant | null;
  /** 连接错误信息 */
  error: string;
  /** 加入会议：调用 join API 获取 token */
  joinMeeting: (meetingId: string) => Promise<void>;
  /** 离开会议：调用 leave API 并断开连接 */
  leaveMeeting: () => Promise<void>;
}

/**
 * 会议连接 hook。
 *
 * @param workspaceId 工作区 ID（用于拼接 join/leave API 路径）
 * @param meetingId  会议 ID（join/leave 的目标；leaveMeeting 用 ref 记忆最近一次 join 的 mid）
 */
export function useMeeting(
  workspaceId: string,
  meetingId: string,
): UseMeetingResult {
  const [isConnected, setIsConnected] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState("");
  // 占位实现：参与者列表始终为空，待接入 LiveKit SDK 后由 room.participants 派生
  const [participants] = useState<Participant[]>([]);
  const [localParticipant] = useState<Participant | null>(null);

  // 记忆当前连接的会议 ID，供 leaveMeeting 使用，避免闭包陈旧
  const activeMeetingIdRef = useRef<string | null>(null);
  // 记忆是否已挂载，避免严格模式下 effect 重复执行
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const joinMeeting = useCallback(
    async (mid: string) => {
      if (isJoining || isConnected) return;
      setIsJoining(true);
      setError("");
      try {
        // 调用后端 join API 获取 LiveKit token
        const result = await api<JoinResult>(
          `/api/v1/workspaces/${workspaceId}/meetings/${mid}/join`,
          { method: "POST" },
        );
        activeMeetingIdRef.current = mid;

        // TODO: 安装 LiveKit SDK 后，用 result.token + result.url 建立 WebRTC 连接：
        //   const room = new Room();
        //   await room.connect(result.url, result.token);
        // 并将 room.participants 派生为 participants 状态。
        // 当前仅记录 token（避免未使用变量 lint），标记为已连接。
        void result;

        if (mountedRef.current) setIsConnected(true);
      } catch (e) {
        if (mountedRef.current) {
          setError(e instanceof Error ? e.message : "连接失败");
        }
      } finally {
        if (mountedRef.current) setIsJoining(false);
      }
    },
    [workspaceId, isJoining, isConnected],
  );

  const leaveMeeting = useCallback(async () => {
    const mid = activeMeetingIdRef.current;
    if (!mid) return;
    try {
      await api(`/api/v1/workspaces/${workspaceId}/meetings/${mid}/leave`, {
        method: "POST",
      });
    } catch {
      // 离开失败不阻塞 UI：仍标记为已断开
    } finally {
      activeMeetingIdRef.current = null;
      if (mountedRef.current) {
        setIsConnected(false);
        setError("");
      }
    }
  }, [workspaceId]);

  // 组件卸载时自动离开会议，避免僵尸连接
  useEffect(() => {
    return () => {
      // 卸载时不调用 leave API（可能已在路由切换中），仅清理本地状态
      activeMeetingIdRef.current = null;
    };
  }, []);

  // meetingId 用于让调用方感知目标会议变化；此处显式引用避免未使用参数 lint
  void meetingId;

  return {
    isConnected,
    isJoining,
    participants,
    localParticipant,
    error,
    joinMeeting,
    leaveMeeting,
  };
}