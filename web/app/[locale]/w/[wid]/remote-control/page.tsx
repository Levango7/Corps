"use client";

/**
 * 远程控制页面 · /w/[wid]/remote-control
 *
 * 入口：点击侧栏 "remote-control" 进入
 * 内容：远程控制面板 + 活跃会话时的远程查看器
 *
 * 数据流：
 * - 获取当前 workspaceId + currentUserId（从布局上下文）
 * - 加载 RemoteControlPanel（已有侧栏入口逻辑复用）
 * - 当有活跃会话且当前用户是控制方时，渲染 RemoteViewer
 *
 * 设计：
 * - 与其他页面风格一致（顶部标题 + 主体区域）
 * - 响应式：桌面双栏（左侧面板 + 右侧查看器），移动端抽屉切换
 * - 复用 RemoteControlPanel + RemoteViewer 组件
 */

import { useEffect, useState } from "react";
import { use } from "react";
import { useRouter } from "@/lib/i18n-navigation";
import { useTranslations } from "next-intl";
import { Loader2, Monitor, ChevronLeft, MonitorOff } from "lucide-react";
import { api } from "@/lib/api";
import { RemoteControlPanel } from "@/components/remote-control/RemoteControlPanel";
import { RemoteViewer } from "@/components/remote-control/RemoteViewer";
import { type RemoteControlSessionDTO } from "@/components/remote-control/RemoteControlPanel";

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
  initiatorId: string;
  targetId: string;
}

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
        // 静默失败
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 加载数据
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await Promise.all([
        api<RemoteControlSessionDTO[]>(`/api/v1/remote-control?workspaceId=${wid}`).then(
          setSessions,
        ),
      ]);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [wid]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-[var(--space-12)]">
        <Loader2 size={24} className="animate-spin text-[var(--accent)] mb-[var(--space-2)]" />
        <p className="text-[length:var(--text-sm)] text-[var(--muted)]">{t("connecting")}</p>
      </div>
    );
  }

  // 查找当前用户是否有活跃会话（作为控制方）
  const currentActiveSession = sessions.find(
    (s) => s.status === "active" && s.initiatorId === currentUserId,
  );

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
            onActiveSession={(session) =>
              setSessions((prev) => prev.map((s) => (s.id === session.id ? session : s)))
            }
          />
        </aside>

        {/* 右侧：远程查看器（仅活跃会话时显示） */}
        {currentActiveSession && (
          <div className="flex-1 relative min-w-0">
            <RemoteViewer
              sessionId={currentActiveSession.id}
              workspaceId={wid}
              session={currentActiveSession}
              onEnd={() =>
                setSessions((prev) =>
                  prev.map((s) =>
                    s.id === currentActiveSession.id ? { ...s, status: "ended" } : s,
                  ),
                )
              }
            />
          </div>
        )}

        {/* 无活跃会话时的空状态 */}
        {!currentActiveSession && (
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
