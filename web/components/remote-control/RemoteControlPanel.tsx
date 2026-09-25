"use client";

/**
 * 远程控制面板 · components/remote-control/RemoteControlPanel.tsx
 *
 * 功能：
 *  - 发起远程控制请求（选择工作区成员作为目标用户）
 *  - 显示活跃会话列表（我发起的 + 发给我的）
 *  - 接受/拒绝传入的请求
 *  - 结束进行中的会话
 *  - 通过信令事件总线实时接收会话状态变更
 *
 * design token 样式，lucide-react 图标（size 14/16），
 * useTranslations("remoteControl") 国际化。
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  Monitor,
  MonitorOff,
  Check,
  X,
  PhoneOff,
  Loader2,
  AlertCircle,
  Send,
  ArrowDownToLine,
  ArrowUpFromLine,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import {
  SignalingClient,
  type SignalingMessage,
} from "@/lib/webrtc/signaling";


// ─── 类型 ──────────────────────────────────────────────────────

/** 远程控制会话 DTO */
interface RemoteControlSessionDTO {
  id: string;
  workspaceId: string;
  initiatorId: string;
  targetId: string;
  status: string; // pending | active | rejected | ended | failed
  endReason: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 工作区成员（简化） */
interface WorkspaceMember {
  userId: string;
  name: string | null;
  email: string;
  image: string | null;
  role: string;
}

// ─── 组件 ──────────────────────────────────────────────────────

export interface RemoteControlPanelProps {
  /** 当前工作区 ID */
  workspaceId: string;
  /** 当前用户 ID */
  currentUserId: string;
  /** 远程查看器渲染回调（当会话进入 active 状态时调用） */
  onActiveSession?: (session: RemoteControlSessionDTO) => void;
}

export function RemoteControlPanel({
  workspaceId,
  currentUserId,
  onActiveSession,
}: RemoteControlPanelProps) {
  const t = useTranslations("remoteControl");

  const [sessions, setSessions] = useState<RemoteControlSessionDTO[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [showUserSelect, setShowUserSelect] = useState(false);

  // 信令客户端（用于接收会话事件通知）
  const signalingRef = useRef<SignalingClient | null>(null);

  // 加载会话列表
  const loadSessions = useCallback(async () => {
    try {
      const data = await api<RemoteControlSessionDTO[]>(
        `/api/v1/remote-control?workspaceId=${workspaceId}`,
      );
      setSessions(data);
    } catch (err) {
      console.error("[RemoteControlPanel] loadSessions failed:", err);
    }
  }, [workspaceId]);

  // 加载工作区成员列表（用于选择目标用户）
  const loadMembers = useCallback(async () => {
    try {
      const data = await api<{ items: WorkspaceMember[] }>(
        `/api/v1/workspaces/${workspaceId}/members?limit=100`,
      );
      // 过滤掉自己
      setMembers(data.items.filter((m) => m.userId !== currentUserId));
    } catch (err) {
      console.error("[RemoteControlPanel] loadMembers failed:", err);
    }
  }, [workspaceId, currentUserId]);

  // 初始化加载
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      await Promise.all([loadSessions(), loadMembers()]);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSessions, loadMembers]);

  // 信令客户端：接收会话事件通知（实时更新列表）
  useEffect(() => {
    if (typeof window === "undefined") return;

    // 通过服务端事件总线订阅会话事件
    // 注意：subscribeSessionEvents 是服务端 EventEmitter，客户端需通过 SSE 接收
    // 这里复用 SignalingClient 的 SSE 连接，会话事件通过同一通道推送
    const client = new SignalingClient({ workspaceId });
    signalingRef.current = client;

    const unsubscribe = client.onMessage((_msg: SignalingMessage) => {
      // 收到信令消息时刷新会话列表（简化处理）
      void loadSessions();
    });

    void client.connect();

    return () => {
      unsubscribe();
      client.disconnect();
      signalingRef.current = null;
    };
  }, [workspaceId, loadSessions]);

  // 发起远程控制请求
  const handleRequest = useCallback(async () => {
    if (!selectedUserId) return;
    setError("");
    setActioningId("new");
    try {
      await api("/api/v1/remote-control", {
        method: "POST",
        body: JSON.stringify({
          targetUserId: selectedUserId,
          workspaceId,
        }),
      });
      setShowUserSelect(false);
      setSelectedUserId("");
      await loadSessions();
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : t("failed");
      setError(msg);
    } finally {
      setActioningId(null);
    }
  }, [selectedUserId, workspaceId, loadSessions, t]);

  // 接受/拒绝/结束会话
  const handleSessionAction = useCallback(
    async (
      sessionId: string,
      action: "accept" | "reject" | "end",
    ) => {
      setError("");
      setActioningId(sessionId);
      try {
        const updated = await api<RemoteControlSessionDTO>(
          `/api/v1/remote-control/${sessionId}?workspaceId=${workspaceId}`,
          {
            method: "PATCH",
            body: JSON.stringify({ action }),
          },
        );
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? updated : s)),
        );
        // 若接受且当前用户是发起方，触发远程查看器
        if (
          action === "accept" &&
          updated.status === "active" &&
          updated.initiatorId === currentUserId
        ) {
          onActiveSession?.(updated);
        }
      } catch (err) {
        const msg =
          err instanceof ApiError ? err.message : t("failed");
        setError(msg);
      } finally {
        setActioningId(null);
      }
    },
    [workspaceId, currentUserId, onActiveSession, t],
  );

  // 分组：传入请求（发给我的，pending）+ 传出请求（我发起的，pending）+ 活跃会话
  const incomingPending = sessions.filter(
    (s) => s.targetId === currentUserId && s.status === "pending",
  );
  const outgoingPending = sessions.filter(
    (s) => s.initiatorId === currentUserId && s.status === "pending",
  );
  const activeSessions = sessions.filter((s) => s.status === "active");

  // 获取用户显示名
  const getUserName = (userId: string): string => {
    const member = members.find((m) => m.userId === userId);
    return member?.name ?? member?.email ?? userId.slice(0, 8);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-[var(--space-12)]">
        <Loader2 size={24} className="animate-spin text-[var(--accent)] mb-[var(--space-2)]" />
        <p className="text-[length:var(--text-sm)] text-[var(--muted)]">
          {t("connecting")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[var(--space-4)]">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-[var(--space-2)] text-[length:var(--text-base)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          <Monitor size={16} className="text-[var(--accent)]" />
          {t("title")}
        </h2>
        <button
          type="button"
          onClick={() => setShowUserSelect((v) => !v)}
          className="flex items-center gap-[var(--space-1)] h-8 px-3 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)]"
        >
          <Send size={14} />
          {t("request")}
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-sm)] bg-[var(--danger-soft)] text-[var(--danger)] text-[length:var(--text-sm)]">
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {/* 用户选择面板 */}
      {showUserSelect && (
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)]">
          <label className="block text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] mb-[var(--space-2)]">
            {t("selectUser")}
          </label>
          <select
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            className="w-full h-9 px-[var(--space-2)] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] text-[length:var(--text-sm)] text-[var(--fg)] focus:border-[var(--accent)] focus:outline-none"
          >
            <option value="">{t("selectUser")}</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name ?? m.email}
              </option>
            ))}
          </select>
          <div className="flex justify-end gap-[var(--space-2)] mt-[var(--space-3)]">
            <button
              type="button"
              onClick={() => {
                setShowUserSelect(false);
                setSelectedUserId("");
              }}
              className="h-8 px-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
            >
              {t("no")}
            </button>
            <button
              type="button"
              onClick={handleRequest}
              disabled={!selectedUserId || actioningId === "new"}
              className="flex items-center gap-[var(--space-1)] h-8 px-3 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)]"
            >
              {actioningId === "new" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
              {t("request")}
            </button>
          </div>
        </div>
      )}

      {/* 传入请求 */}
      {incomingPending.length > 0 && (
        <SessionGroup
          label={t("incoming")}
          icon={<ArrowDownToLine size={14} className="text-[var(--accent)]" />}
          sessions={incomingPending}
          currentUserId={currentUserId}
          getUserName={getUserName}
          actioningId={actioningId}
          onAction={handleSessionAction}
          t={t}
        />
      )}

      {/* 传出请求 */}
      {outgoingPending.length > 0 && (
        <SessionGroup
          label={t("outgoing")}
          icon={<ArrowUpFromLine size={14} className="text-[var(--meta)]" />}
          sessions={outgoingPending}
          currentUserId={currentUserId}
          getUserName={getUserName}
          actioningId={actioningId}
          onAction={handleSessionAction}
          t={t}
        />
      )}

      {/* 活跃会话 */}
      {activeSessions.length > 0 && (
        <SessionGroup
          label={t("active")}
          icon={<Monitor size={14} className="text-[var(--success)]" />}
          sessions={activeSessions}
          currentUserId={currentUserId}
          getUserName={getUserName}
          actioningId={actioningId}
          onAction={handleSessionAction}
          t={t}
        />
      )}

      {/* 空状态 */}
      {sessions.length === 0 && !showUserSelect && (
        <div className="flex flex-col items-center justify-center py-[var(--space-12)] text-center">
          <MonitorOff size={32} className="text-[var(--muted)] mb-[var(--space-3)]" />
          <p className="text-[length:var(--text-sm)] text-[var(--muted)]">
            {t("noActiveSessions")}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── 会话分组子组件 ────────────────────────────────────────────

interface SessionGroupProps {
  label: string;
  icon: React.ReactNode;
  sessions: RemoteControlSessionDTO[];
  currentUserId: string;
  getUserName: (userId: string) => string;
  actioningId: string | null;
  onAction: (sessionId: string, action: "accept" | "reject" | "end") => void;
  t: ReturnType<typeof useTranslations>;
}

function SessionGroup({
  label,
  icon,
  sessions,
  currentUserId,
  getUserName,
  actioningId,
  onAction,
  t,
}: SessionGroupProps) {
  return (
    <section>
      <h3 className="flex items-center gap-[var(--space-1)] text-[length:var(--text-xs)] font-[weight:var(--weight-semibold)] text-[var(--meta)] uppercase tracking-wide mb-[var(--space-2)]">
        {icon}
        {label} · {sessions.length}
      </h3>
      <ul className="divide-y divide-[var(--border-soft)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
        {sessions.map((s) => {
          const isInitiator = s.initiatorId === currentUserId;
          const isTarget = s.targetId === currentUserId;
          const otherUserId = isInitiator ? s.targetId : s.initiatorId;
          const otherName = getUserName(otherUserId);
          const isActioning = actioningId === s.id;

          return (
            <li
              key={s.id}
              className="flex items-center justify-between px-[var(--space-3)] py-[var(--space-3)]"
            >
              <div className="flex flex-col gap-[var(--space-1)] min-w-0">
                <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] truncate">
                  {isInitiator ? t("youAreControlling") : t("beingControlled")}{" "}
                  {otherName}
                </span>
                <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
                  {s.status === "pending" && t("waitingForAccept")}
                  {s.status === "active" && t("connected")}
                  {s.status === "rejected" && t("requestRejected")}
                  {s.status === "ended" && t("sessionEnded")}
                  {s.status === "failed" && t("failed")}
                </span>
              </div>

              <div className="flex items-center gap-[var(--space-1)] shrink-0">
                {/* 目标方对 pending 请求：接受/拒绝 */}
                {isTarget && s.status === "pending" && (
                  <>
                    <button
                      type="button"
                      onClick={() => onAction(s.id, "accept")}
                      disabled={isActioning}
                      title={t("accept")}
                      className="flex items-center justify-center w-8 h-8 rounded-[var(--radius-sm)] bg-[var(--success)] text-[var(--success-fg)] hover:bg-[var(--success-soft)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)]"
                    >
                      {isActioning ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Check size={14} />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => onAction(s.id, "reject")}
                      disabled={isActioning}
                      title={t("reject")}
                      className="flex items-center justify-center w-8 h-8 rounded-[var(--radius-sm)] bg-[var(--danger)] text-[var(--danger-fg)] hover:bg-[var(--danger-soft)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)]"
                    >
                      <X size={14} />
                    </button>
                  </>
                )}

                {/* 活跃会话：结束按钮 */}
                {s.status === "active" && (
                  <button
                    type="button"
                    onClick={() => onAction(s.id, "end")}
                    disabled={isActioning}
                    title={t("end")}
                    className="flex items-center justify-center w-8 h-8 rounded-[var(--radius-sm)] bg-[var(--danger)] text-[var(--danger-fg)] hover:bg-[var(--danger-soft)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)]"
                  >
                    {isActioning ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <PhoneOff size={14} />
                    )}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}