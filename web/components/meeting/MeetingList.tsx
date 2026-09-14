"use client";

/**
 * 会议列表组件 · components/meeting/MeetingList.tsx
 *
 * 功能：
 *  - 获取会议列表（GET /api/v1/workspaces/{wid}/meetings）
 *  - 按状态分组（进行中 active / 已预约 scheduled / 已结束 ended）
 *  - 每条：标题、时间、参与人数、状态标签、操作按钮（加入/结束）
 *  - 分页（page + limit）
 *
 * design token 样式，lucide-react 图标（Video, Calendar, Users, PhoneOff）。
 */

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/lib/i18n-navigation";
import {
  Video,
  Calendar,
  Users,
  PhoneOff,
  Loader2,
  Plus,
  AlertCircle,
} from "lucide-react";
import { api } from "@/lib/api";
import { MeetingCreate } from "./MeetingCreate";

/** 会议状态 */
type MeetingStatus = "active" | "scheduled" | "ended";

/** 会议列表项 */
interface MeetingItem {
  id: string;
  title: string;
  status: MeetingStatus;
  startedAt: string | null;
  endedAt: string | null;
  scheduledAt: string | null;
  participantCount: number;
  maxParticipants: number | null;
}

/** 列表 API 响应（分页） */
interface MeetingListResponse {
  items: MeetingItem[];
  total: number;
  page: number;
  limit: number;
}

/** 每页条数 */
const PAGE_LIMIT = 20;

export interface MeetingListProps {
  workspaceId: string;
}

export function MeetingList({ workspaceId }: MeetingListProps) {
  const t = useTranslations("meeting");
  const router = useRouter();

  const [items, setItems] = useState<MeetingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // 拉取会议列表
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const data = await api<MeetingListResponse>(
          `/api/v1/workspaces/${workspaceId}/meetings?page=${page}&limit=${PAGE_LIMIT}`,
        );
        if (!cancelled) {
          setItems(data.items);
          setTotal(data.total);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : t("loadFailed"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, page, t]);

  // 加入会议：跳转到会议详情页（会议房间）
  const handleJoin = useCallback(
    (mid: string) => {
      router.push(`/w/${workspaceId}/meetings/${mid}`);
    },
    [router, workspaceId],
  );

  // 结束会议
  const handleEnd = useCallback(
    async (mid: string) => {
      if (actioningId) return;
      setActioningId(mid);
      try {
        await api(`/api/v1/workspaces/${workspaceId}/meetings/${mid}`, {
          method: "DELETE",
        });
        // 从列表中更新状态为已结束
        setItems((prev) =>
          prev.map((m) =>
            m.id === mid ? { ...m, status: "ended" as MeetingStatus } : m,
          ),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : t("endFailed"));
      } finally {
        setActioningId(null);
      }
    },
    [actioningId, workspaceId, t],
  );

  // 按状态分组
  const activeMeetings = items.filter((m) => m.status === "active");
  const scheduledMeetings = items.filter((m) => m.status === "scheduled");
  const endedMeetings = items.filter((m) => m.status === "ended");

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  return (
    <div className="max-w-[var(--container-max)] mx-auto px-[var(--space-4)] py-[var(--space-6)]">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-[var(--space-5)]">
        <h1 className="text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)]">
          {t("title")}
        </h1>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)]"
        >
          <Plus size={14} />
          {t("create")}
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 mb-[var(--space-4)] px-3 py-2 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError("")}
            className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
            aria-label={t("dismiss")}
          >
            ×
          </button>
        </div>
      )}

      {loading ? (
        <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
          <Loader2 size={20} className="inline animate-spin mr-2" />
          {t("loading")}
        </div>
      ) : items.length === 0 ? (
        <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
          <Video size={36} className="mx-auto mb-3 opacity-50" />
          <p className="text-[length:var(--text-sm)]">{t("noMeetings")}</p>
        </div>
      ) : (
        <div className="space-y-[var(--space-6)]">
          {/* 进行中 */}
          {activeMeetings.length > 0 && (
            <MeetingGroup
              label={t("activeMeetings")}
              items={activeMeetings}
              onJoin={handleJoin}
              onEnd={handleEnd}
              actioningId={actioningId}
            />
          )}

          {/* 已预约 */}
          {scheduledMeetings.length > 0 && (
            <MeetingGroup
              label={t("scheduledMeetings")}
              items={scheduledMeetings}
              onJoin={handleJoin}
              onEnd={handleEnd}
              actioningId={actioningId}
            />
          )}

          {/* 已结束 */}
          {endedMeetings.length > 0 && (
            <MeetingGroup
              label={t("endedMeetings")}
              items={endedMeetings}
              onJoin={handleJoin}
              onEnd={handleEnd}
              actioningId={actioningId}
            />
          )}
        </div>
      )}

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-[var(--space-6)]">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="h-8 px-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)]"
          >
            {t("prevPage")}
          </button>
          <span className="text-[length:var(--text-sm)] text-[var(--muted)]">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="h-8 px-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)]"
          >
            {t("nextPage")}
          </button>
        </div>
      )}

      {/* 创建会议弹窗 */}
      {showCreate && (
        <MeetingCreate
          workspaceId={workspaceId}
          onClose={() => setShowCreate(false)}
          onCreated={(meeting) => {
            setShowCreate(false);
            // 创建成功后加入会议
            handleJoin(meeting.id);
          }}
        />
      )}
    </div>
  );
}

/** 会议分组 */
function MeetingGroup({
  label,
  items,
  onJoin,
  onEnd,
  actioningId,
}: {
  label: string;
  items: MeetingItem[];
  onJoin: (mid: string) => void;
  onEnd: (mid: string) => void;
  actioningId: string | null;
}) {
  const t = useTranslations("meeting");
  return (
    <section>
      <h2 className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--meta)] uppercase tracking-wide mb-[var(--space-2)]">
        {label} · {items.length}
      </h2>
      <ul className="divide-y divide-[var(--border-soft)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
        {items.map((m) => (
          <MeetingRow
            key={m.id}
            meeting={m}
            onJoin={onJoin}
            onEnd={onEnd}
            actioning={actioningId === m.id}
          />
        ))}
      </ul>
    </section>
  );
}

/** 单条会议行 */
function MeetingRow({
  meeting,
  onJoin,
  onEnd,
  actioning,
}: {
  meeting: MeetingItem;
  onJoin: (mid: string) => void;
  onEnd: (mid: string) => void;
  actioning: boolean;
}) {
  const t = useTranslations("meeting");

  const time = meeting.startedAt || meeting.scheduledAt || meeting.endedAt;
  const timeLabel = time ? new Date(time).toLocaleString() : "—";

  return (
    <li className="flex items-center gap-3 px-[var(--space-4)] py-3 hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]">
      <Video size={15} className="shrink-0 text-[var(--muted)]" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] truncate">
            {meeting.title}
          </span>
          <StatusBadge status={meeting.status} />
        </div>
        <div className="mt-1 flex items-center gap-3 text-[length:var(--text-xs)] text-[var(--muted)]">
          <span className="inline-flex items-center gap-1">
            <Calendar size={12} />
            {timeLabel}
          </span>
          <span className="inline-flex items-center gap-1">
            <Users size={12} />
            {meeting.participantCount}
            {meeting.maxParticipants ? ` / ${meeting.maxParticipants}` : ""}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {(meeting.status === "active" || meeting.status === "scheduled") && (
          <button
            type="button"
            onClick={() => onJoin(meeting.id)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)]"
          >
            <Video size={14} />
            {t("join")}
          </button>
        )}
        {meeting.status === "active" && (
          <button
            type="button"
            onClick={() => onEnd(meeting.id)}
            disabled={actioning}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)]"
          >
            {actioning ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <PhoneOff size={14} />
            )}
            {t("end")}
          </button>
        )}
      </div>
    </li>
  );
}

/** 状态标签 */
function StatusBadge({ status }: { status: MeetingStatus }) {
  const t = useTranslations("meeting");
  const styles: Record<MeetingStatus, string> = {
    active:
      "bg-[var(--success-soft)] text-[var(--success)] border-[var(--success)]",
    scheduled:
      "bg-[var(--surface-2)] text-[var(--meta)] border-[var(--border)]",
    ended: "bg-[var(--surface-2)] text-[var(--muted)] border-[var(--border)]",
  };
  const labels: Record<MeetingStatus, string> = {
    active: t("activeMeetings"),
    scheduled: t("scheduledMeetings"),
    ended: t("endedMeetings"),
  };
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded-[var(--radius-sm)] border text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}
