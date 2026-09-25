"use client";

/**
 * M4 实时协作基础：工作区成员在线状态组件
 *
 * 职责：
 * - 拉取 /api/v1/workspaces/{wid}/presence 获取成员在线状态列表
 * - 用绿点（var(--success)）表示在线，灰点（var(--meta)）表示离线
 * - 定期心跳：每 2 分钟 POST /presence 刷新自己的 onlineAt
 * - 自动刷新：每 30 秒重新拉取成员在线状态
 * - lucide-react 图标尺寸 14（项目约定）
 * - 所有样式走 design token（var(--*)），无裸 hex
 *
 * 用法：
 *   <OnlinePresence wid={wid} />
 *   <OnlinePresence wid={wid} max={10} />
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Users } from "lucide-react";
import { api } from "@/lib/api";

/** 心跳间隔：2 分钟（小于服务端 5 分钟在线窗口，保证在线判定不抖动） */
const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000;
/** 成员列表刷新间隔：30 秒 */
const REFRESH_INTERVAL_MS = 30 * 1000;

/** 成员在线状态项（与 presence GET 响应 data.items 对齐） */
interface PresenceMember {
  userId: string;
  name: string;
  image: string | null;
  role: string;
  online: boolean;
  onlineAt: string | null;
}

/** presence GET 响应 data */
interface PresenceData {
  items: PresenceMember[];
  total: number;
  onlineCount: number;
}

interface OnlinePresenceProps {
  /** 工作区 ID */
  wid: string;
  /** 最多显示多少个成员，超出折叠为 +N，默认 8 */
  max?: number;
  /** 是否启用心跳（默认 true；嵌入到非主页面时可关闭） */
  heartbeat?: boolean;
}

/** 从用户名提取首字母（最多 1 字符），用于无 avatar 时的占位 */
function getInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed[0].toUpperCase();
}

export default function OnlinePresence({ wid, max = 8, heartbeat = true }: OnlinePresenceProps) {
  const t = useTranslations("presence");
  const [data, setData] = useState<PresenceData | null>(null);
  const [error, setError] = useState(false);
  /** 心跳定时器引用（避免组件卸载后仍发请求） */
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** 刷新定时器引用 */
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** 拉取成员在线状态 */
  const load = useCallback(async () => {
    try {
      const result = await api<PresenceData>(`/api/v1/workspaces/${wid}/presence`);
      setData(result);
      setError(false);
    } catch {
      // 静默失败：不阻断页面其他部分
      setError(true);
    }
  }, [wid]);

  /** 发送心跳：POST /presence 更新自己的 onlineAt */
  const sendHeartbeat = useCallback(async () => {
    try {
      await api<{ onlineAt: string }>(`/api/v1/workspaces/${wid}/presence`, {
        method: "POST",
      });
    } catch {
      // 心跳失败静默（网络抖动等，下次定时器会重试）
    }
  }, [wid]);

  useEffect(() => {
    // 首次加载 + 立即发一次心跳
    load();
    if (heartbeat) {
      sendHeartbeat();
      heartbeatTimerRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    }
    // 定期刷新成员列表
    refreshTimerRef.current = setInterval(load, REFRESH_INTERVAL_MS);

    return () => {
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [load, sendHeartbeat, heartbeat]);

  if (error && !data) {
    return (
      <div
        className="flex items-center gap-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--muted)]"
        role="status"
        aria-live="polite"
      >
        <Users size={14} aria-hidden />
        <span>{t("loadFailed")}</span>
      </div>
    );
  }

  if (!data) {
    // 骨架屏：占位避免内容跳动
    return (
      <div
        className="flex items-center gap-[var(--space-2)]"
        aria-busy="true"
        aria-label={t("loading")}
      >
        {Array.from({ length: 5 }).map((_, i) => (
          <span key={i} className="h-7 w-7 rounded-full bg-[var(--surface-hover)] animate-pulse" />
        ))}
      </div>
    );
  }

  const visible = data.items.slice(0, max);
  const overflow = data.total - visible.length;

  return (
    <div
      className="flex items-center gap-[var(--space-2)]"
      aria-label={t("onlineCount", { count: data.onlineCount })}
    >
      <Users size={14} className="text-[var(--muted)]" aria-hidden />
      <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
        {data.onlineCount}/{data.total}
      </span>
      <div className="flex items-center gap-[var(--space-1)]">
        {visible.map((member) => (
          <div
            key={member.userId}
            className="relative"
            title={`${member.name} · ${member.online ? t("online") : t("offline")}`}
          >
            {member.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={member.image}
                alt={member.name}
                className="h-7 w-7 rounded-full border border-[var(--border)] object-cover"
              />
            ) : (
              <span className="h-7 w-7 rounded-full bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] flex items-center justify-center">
                {getInitial(member.name)}
              </span>
            )}
            {/* 在线/离线指示点：绿点在线，灰点离线 */}
            <span
              className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-[var(--surface)] ${
                member.online ? "bg-[var(--success)]" : "bg-[var(--meta)]"
              }`}
              aria-hidden
            />
          </div>
        ))}
        {overflow > 0 && (
          <span className="text-[length:var(--text-xs)] text-[var(--muted)]">+{overflow}</span>
        )}
      </div>
    </div>
  );
}
