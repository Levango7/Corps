"use client";

/**
 * React 封装：把 RemoteControlSession（WebRTC）接到 SignalingClient（SSE + POST）。
 *
 * 为什么需要它：RemoteControlSession 只产出 SDP/ICE 事件，自己不搬运；
 * SignalingClient 只搬运消息，不懂 WebRTC。此前两者都已实现但**零处互相调用**，
 * 远程控制的媒体层因此从未真正接通。本 hook 是那根缺失的线。
 *
 * 用法（控制方）：
 *   const session = useRemoteControlSession({
 *     workspaceId, sessionId, role: "controller",
 *     selfUserId, peerUserId, enabled: !!activeSession,
 *   });
 *   if (session) return <RemoteViewer session={session} ... />;
 *
 * 安全：信令服务端会校验 fromUserId == 当前登录用户、且双方都是会话参与方
 * （见 app/api/v1/remote-control/signal/route.ts），伪造方身份会被拒。
 */

import { useEffect, useState } from "react";
import { RemoteControlSession, type SessionRole } from "@/lib/webrtc/peer-connection";
import { SignalingClient, type SignalingMessage } from "@/lib/webrtc/signaling";

export interface UseRemoteControlSessionOptions {
  /** 工作区 ID（信令通道隔离 + 服务端工作区校验） */
  workspaceId: string;
  /** 会话 ID；null 表示当前没有活跃会话，不建连接 */
  sessionId: string | null;
  /** 本端角色 */
  role: SessionRole;
  /** 本端用户 ID（信令 fromUserId） */
  selfUserId: string;
  /** 对端用户 ID（信令 toUserId） */
  peerUserId: string | null;
  /** 是否允许建连（通常由"是否存在活跃会话"决定） */
  enabled: boolean;
}

export function useRemoteControlSession({
  workspaceId,
  sessionId,
  role,
  selfUserId,
  peerUserId,
  enabled,
}: UseRemoteControlSessionOptions): RemoteControlSession | null {
  const [session, setSession] = useState<RemoteControlSession | null>(null);

  useEffect(() => {
    if (!enabled || !sessionId || !selfUserId || !peerUserId) return;
    if (typeof window === "undefined") return;

    const rtc = new RemoteControlSession({ role, sessionId });
    const signaling = new SignalingClient({ workspaceId });
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    // 本端 SDP → 信令
    rtc.onSdpReady((sdp, type) => {
      const message: SignalingMessage = {
        type,
        fromUserId: selfUserId,
        toUserId: peerUserId,
        sessionId,
        workspaceId,
        sdp,
      };
      void signaling.send(message).catch((err) => {
        console.error("[useRemoteControlSession] send sdp failed:", err);
      });
    });

    // 本端 ICE → 信令
    rtc.onIceCandidateReady((candidate) => {
      const message: SignalingMessage = {
        type: "ice-candidate",
        fromUserId: selfUserId,
        toUserId: peerUserId,
        sessionId,
        workspaceId,
        candidate,
      };
      void signaling.send(message).catch((err) => {
        console.error("[useRemoteControlSession] send ice failed:", err);
      });
    });

    // 对端消息 → 本端 WebRTC
    unsubscribe = signaling.onMessage((msg: SignalingMessage) => {
      if (msg.sessionId !== sessionId) return;
      switch (msg.type) {
        case "offer":
          // 被控方接收 offer（需已添加屏幕轨道，见 startScreenShare 注释）
          if (role === "controlled") {
            void rtc.accept(msg.sdp).catch((err) => {
              console.error("[useRemoteControlSession] accept failed:", err);
            });
          }
          break;
        case "answer":
          if (role === "controller") {
            void rtc.handleAnswer(msg.sdp).catch((err) => {
              console.error("[useRemoteControlSession] handleAnswer failed:", err);
            });
          }
          break;
        case "ice-candidate":
          void rtc.handleIceCandidate(msg.candidate);
          break;
        case "end-control":
          rtc.close();
          break;
        default:
          break;
      }
    });

    // 建立 SSE，随后由控制方发起 offer
    void signaling
      .connect()
      .then(() => {
        if (cancelled) return;
        setSession(rtc);
        if (role === "controller") {
          void rtc.initiate().catch((err) => {
            console.error("[useRemoteControlSession] initiate failed:", err);
          });
        }
      })
      .catch((err) => {
        console.error("[useRemoteControlSession] signaling connect failed:", err);
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
      signaling.disconnect();
      rtc.close();
      setSession(null);
    };
  }, [workspaceId, sessionId, role, selfUserId, peerUserId, enabled]);

  return session;
}
