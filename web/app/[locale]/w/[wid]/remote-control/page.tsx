"use client";

/**
 * 远程控制页面 · /w/[wid]/remote-control
 *
 * 入口：侧栏「远程控制」（注册表 collaboration 组首位）
 * 内容：远程控制面板 + 活跃会话时的远程查看器
 *
 * 数据流：
 * - wid 来自路由 params；currentUserId 来自 /api/v1/users/me（与 board 页同口径）
 * - RemoteControlPanel 负责会话列表与接受/拒绝/结束（API 驱动）
 * - 当前用户是活跃会话的发起方时，创建 RemoteControlSession 并接信令，
 *   渲染 RemoteViewer（视频流 + 键鼠输入回传）
 *
 * 设计：
 * - 与其他页面风格一致（顶部标题 + 主体区域）
 * - 响应式：桌面双栏（左侧面板 + 右侧查看器），移动端上下堆叠
 */

import { useEffect, useState } from "react";
import { use } from "react";
import { useRouter } from "@/lib/i18n-navigation";
import { useTranslations } from "next-intl";
import { Loader2, Monitor, ChevronLeft, MonitorOff } from "lucide-react";
import { api } from "@/lib/api";
import { RemoteControlPanel } from "@/components/remote-control/RemoteControlPanel";
import { RemoteViewer } from "@/components/remote-control/RemoteViewer";
import type { RemoteControlSessionDTO } from "@/components/remote-control/RemoteControlPanel";
import { useRemoteControlSession } from "@/lib/use-remote-control-session";

export default function RemoteControlPage({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = use(params);
  const router = useRouter();
  const t = useTranslations("remoteControl");

  const [sessions, setSessions] = useState<RemoteControlSessionDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState("");

  // 加载当前用户 ID
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await api<{ user: { id: string } }>("/api/v1/users/me");
        if (!cancelled) setCurrentUserId(me.user.id);
      } catch {
        // 静默失败：拿不到 userId 时面板仍可渲染（发起/接受按钮会因缺 id 降级）
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 加载会话列表
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await api<RemoteControlSessionDTO[]>(
          `/api/v1/remote-control?workspaceId=${wid}`,
        );
        if (!cancelled) setSessions(data);
      } catch (err) {
        console.error("[RemoteControlPage] loadSessions failed:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wid]);

  // 当前用户作为控制方的活跃会话
  const activeSession = sessions.find(
    (s) => s.status === "active" && s.initiatorId === currentUserId,
  );

  // WebRTC 会话（仅活跃会话时创建；信令经 SSE + POST）
  const session = useRemoteControlSession({
    workspaceId: wid,
    sessionId: activeSession?.id ?? null,
    role: "controller",
    selfUserId: currentUserId,
    peerUserId: activeSession?.targetId ?? null,
    enabled: !!activeSession,
  });

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-[var(--space-12)]">
        <Loader2 size={24} className="animate-spin text-[var(--accent)] mb-[var(--space-2)]" />
        <p className="text-[length:var(--text-sm)] text-[var(--muted)]">{t("connecting")}</p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex flex-col">
      {/* 页面头部 */}
      <header className="px-[var(--space-4)] py-[var(--space-3)] border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="flex items-center justify-between">
          <h1 className="text-[length:var(--text-xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            <Monitor size={20} className="text-[var(--accent)] mr-2" />
            {t("title")}
          </h1>
          <button
            type="button"
            className="h-8 w-8 rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
            onClick={() => router.back()}
            aria-label={t("back")}
          >
            <ChevronLeft size={20} />
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* 左侧：控制面板 */}
        <aside className="w-full md:w-80 flex-shrink-0 border-r border-[var(--border)] bg-[var(--surface)]">
          <RemoteControlPanel
            workspaceId={wid}
            currentUserId={currentUserId}
            onActiveSession={(updated) =>
              setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
            }
          />
        </aside>

        {/* 右侧：远程查看器（仅活跃会话时显示） */}
        {activeSession && session ? (
          <div className="flex-1 relative min-w-0">
            <RemoteViewer
              sessionId={activeSession.id}
              workspaceId={wid}
              session={session}
              onEnd={() =>
                setSessions((prev) =>
                  prev.map((s) => (s.id === activeSession.id ? { ...s, status: "ended" } : s)),
                )
              }
            />
          </div>
        ) : (
          /* 无活跃会话时的空状态 */
          <div className="flex-1 flex flex-col items-center justify-center px-4">
            <MonitorOff size={64} className="text-[var(--muted)] mb-4" />
            <h2 className="text-[length:var(--text-lg)] font-medium text-[var(--fg)] mb-2">
              {t("noActiveSession")}
            </h2>
            <p className="text-[var(--muted)] text-center max-w-xs">{t("noActiveSessionDesc")}</p>
          </div>
        )}
      </main>
    </div>
  );
}
