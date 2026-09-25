"use client";

/**
 * 远程查看器 · components/remote-control/RemoteViewer.tsx
 *
 * 功能：
 *  - 显示远程屏幕画面（<video> 元素接收 MediaStream）
 *  - 捕获本地键盘/鼠标事件并通过 DataChannel 发送给被控方
 *  - 全屏支持
 *  - 断线重连提示
 *
 * 使用方式：
 *  - 控制方（controller）：接收被控方的屏幕流，捕获本地输入发送
 *  - 被控方（controlled）：本地屏幕流由 RemoteControlSession 管理，此组件不渲染视频
 *
 * design token 样式，lucide-react 图标（size 14/16），
 * useTranslations("remoteControl") 国际化。
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  Maximize2,
  Minimize2,
  PhoneOff,
  Loader2,
  AlertCircle,
  WifiOff,
  Monitor,
} from "lucide-react";
import {
  RemoteControlSession,
  type RemoteControlSessionState,
  mouseMove,
  mouseClick,
  mouseScroll,
  keyPress,
  mapMouseButton,
} from "@/lib/webrtc/peer-connection";
import { api } from "@/lib/api";

// ─── 类型 ──────────────────────────────────────────────────────

export interface RemoteViewerProps {
  /** 远程控制会话 ID */
  sessionId: string;
  /** 当前工作区 ID */
  workspaceId: string;
  /** 会话角色：controller（控制方，查看远程屏幕）*/
  role: "controller";
  /** 远程控制会话实例（已建立 WebRTC 连接） */
  session: RemoteControlSession;
  /** 结束会话回调 */
  onEnd: () => void;
}

// ─── 组件 ──────────────────────────────────────────────────────

export function RemoteViewer({ sessionId, workspaceId, _role, session, onEnd }: RemoteViewerProps) {
  const t = useTranslations("remoteControl");

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [sessionState, setSessionState] = useState<RemoteControlSessionState>(session.state);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState("");

  // 注册远程流回调
  useEffect(() => {
    const unsubscribeStream = session.onRemoteStream((stream) => {
      setRemoteStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // 自动播放（静音以绕过浏览器自动播放策略）
        videoRef.current.play().catch(() => {
          // 自动播放被阻止，用户交互后可手动播放
        });
      }
    });

    const unsubscribeState = session.onStateChange((state) => {
      setSessionState(state);
      if (state === "failed") {
        setError(t("failed"));
      } else if (state === "disconnected") {
        setError(t("disconnected"));
      } else {
        setError("");
      }
    });

    return () => {
      unsubscribeStream();
      unsubscribeState();
    };
  }, [session, t]);

  // 全屏切换
  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (err) {
      console.error("[RemoteViewer] fullscreen failed:", err);
    }
  }, []);

  // 监听全屏状态变更（ESC 退出）
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  // ─── 输入事件捕获 ──────────────────────────────────────────

  /** 将鼠标坐标转换为相对于视频画面的归一化坐标（0-1） */
  const getRelativeCoords = useCallback(
    (e: React.MouseEvent<HTMLVideoElement>): { x: number; y: number } => {
      const video = videoRef.current;
      if (!video) return { x: 0, y: 0 };
      const rect = video.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
    },
    [],
  );

  /** 鼠标移动 */
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLVideoElement>) => {
      if (sessionState !== "connected") return;
      const { x, y } = getRelativeCoords(e);
      session.sendInputEvent(mouseMove(x, y));
    },
    [session, sessionState, getRelativeCoords],
  );

  /** 鼠标点击 */
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLVideoElement>) => {
      if (sessionState !== "connected") return;
      e.preventDefault(); // 防止文本选择
      const { x, y } = getRelativeCoords(e);
      const button = mapMouseButton(e.button);
      session.sendInputEvent(mouseClick(x, y, button, "down"));
    },
    [session, sessionState, getRelativeCoords],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLVideoElement>) => {
      if (sessionState !== "connected") return;
      const { x, y } = getRelativeCoords(e);
      const button = mapMouseButton(e.button);
      session.sendInputEvent(mouseClick(x, y, button, "up"));
    },
    [session, sessionState, getRelativeCoords],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLVideoElement>) => {
      if (sessionState !== "connected") return;
      const { x, y } = getRelativeCoords(e);
      const button = mapMouseButton(e.button);
      session.sendInputEvent(mouseClick(x, y, button, "double"));
    },
    [session, sessionState, getRelativeCoords],
  );

  /** 鼠标滚轮 */
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLVideoElement>) => {
      if (sessionState !== "connected") return;
      const { x, y } = getRelativeCoords(e);
      session.sendInputEvent(mouseScroll(x, y, e.deltaY));
    },
    [session, sessionState, getRelativeCoords],
  );

  /** 键盘按键 */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (sessionState !== "connected") return;
      // 阻止默认行为（防止页面滚动等）
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab", " "].includes(e.key)) {
        e.preventDefault();
      }
      const event = keyPress(e.key, "down", {
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
        meta: e.metaKey,
      });
      session.sendInputEvent(event);
    },
    [session, sessionState],
  );

  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (sessionState !== "connected") return;
      const event = keyPress(e.key, "up", {
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
        meta: e.metaKey,
      });
      session.sendInputEvent(event);
    },
    [session, sessionState],
  );

  // 结束会话
  const handleEnd = useCallback(async () => {
    session.close();
    try {
      await api(`/api/v1/remote-control/${sessionId}?workspaceId=${workspaceId}`, {
        method: "DELETE",
      });
    } catch (err) {
      console.error("[RemoteViewer] end session failed:", err);
    }
    onEnd();
  }, [session, sessionId, workspaceId, onEnd]);

  // ─── 渲染 ──────────────────────────────────────────────────

  const isConnected = sessionState === "connected";
  const isConnecting =
    sessionState === "connecting" || sessionState === "initiating" || sessionState === "accepting";

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[var(--z-modal)] flex flex-col bg-[var(--bg)]"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
    >
      {/* 顶部状态栏 */}
      <div className="flex items-center justify-between px-[var(--space-4)] py-[var(--space-2)] bg-[var(--surface)] border-b border-[var(--border)]">
        <div className="flex items-center gap-[var(--space-2)]">
          <Monitor size={16} className="text-[var(--accent)]" />
          <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
            {t("youAreControlling")}
          </span>
          {/* 状态指示器 */}
          <span className="flex items-center gap-[var(--space-1)] text-[length:var(--text-xs)]">
            {isConnected && (
              <>
                <span className="w-2 h-2 rounded-full bg-[var(--success)]" />
                <span className="text-[var(--success)]">{t("connected")}</span>
              </>
            )}
            {isConnecting && (
              <>
                <Loader2 size={12} className="animate-spin text-[var(--accent)]" />
                <span className="text-[var(--accent)]">{t("connecting")}</span>
              </>
            )}
            {sessionState === "disconnected" && (
              <>
                <WifiOff size={12} className="text-[var(--warn)]" />
                <span className="text-[var(--warn)]">{t("disconnected")}</span>
              </>
            )}
            {sessionState === "failed" && (
              <>
                <AlertCircle size={12} className="text-[var(--danger)]" />
                <span className="text-[var(--danger)]">{t("failed")}</span>
              </>
            )}
          </span>
        </div>

        <div className="flex items-center gap-[var(--space-1)]">
          {/* 全屏按钮 */}
          <button
            type="button"
            onClick={toggleFullscreen}
            title={t("fullscreen")}
            className="flex items-center justify-center w-8 h-8 rounded-[var(--radius-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          {/* 结束按钮 */}
          <button
            type="button"
            onClick={handleEnd}
            title={t("end")}
            className="flex items-center gap-[var(--space-1)] h-8 px-3 rounded-[var(--radius-sm)] bg-[var(--danger)] text-[var(--danger-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--danger-soft)] transition-colors duration-[var(--motion-fast)]"
          >
            <PhoneOff size={14} />
            {t("end")}
          </button>
        </div>
      </div>

      {/* 视频画面区域 */}
      <div className="flex-1 relative flex items-center justify-center bg-[var(--surface)] overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onDoubleClick={handleDoubleClick}
          onWheel={handleWheel}
          className="max-w-full max-h-full object-contain cursor-crosshair"
          style={{ display: remoteStream ? "block" : "none" }}
        />

        {/* 连接中遮罩 */}
        {isConnecting && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--bg)] bg-opacity-80">
            <Loader2 size={32} className="animate-spin text-[var(--accent)] mb-[var(--space-3)]" />
            <p className="text-[length:var(--text-sm)] text-[var(--muted)]">{t("connecting")}</p>
          </div>
        )}

        {/* 错误遮罩 */}
        {error && sessionState !== "connected" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--bg)] bg-opacity-80">
            <AlertCircle size={32} className="text-[var(--danger)] mb-[var(--space-3)]" />
            <p className="text-[length:var(--text-sm)] text-[var(--danger)] mb-[var(--space-4)]">
              {error}
            </p>
            <button
              type="button"
              onClick={handleEnd}
              className="h-9 px-4 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)]"
            >
              {t("end")}
            </button>
          </div>
        )}

        {/* 无流提示 */}
        {!remoteStream && !isConnecting && !error && (
          <div className="flex flex-col items-center justify-center">
            <Monitor size={48} className="text-[var(--muted)] mb-[var(--space-3)]" />
            <p className="text-[length:var(--text-sm)] text-[var(--muted)]">{t("screenShare")}</p>
          </div>
        )}
      </div>

      {/* 底部提示栏 */}
      {isConnected && (
        <div className="px-[var(--space-4)] py-[var(--space-2)] bg-[var(--surface)] border-t border-[var(--border)] text-center">
          <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
            {t("inputControl")} · {t("fullscreen")}: F11
          </span>
        </div>
      )}
    </div>
  );
}
