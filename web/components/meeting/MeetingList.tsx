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
  Pencil,
  Play,
  User,
  MoreVertical,
} from "lucide-react";
import { api } from "@/lib/api";
import { MeetingCreate, type EditableMeeting } from "./MeetingCreate";

/** 会议状态 */
type MeetingStatus = "active" | "scheduled" | "ended";

/** 会议列表项（后端返回 _count.participants，非 participantCount） */
interface MeetingItem {
  id: string;
  title: string;
  status: MeetingStatus;
  startedAt: string | null;
  endedAt: string | null;
  scheduledAt: string | null;
  /** 后端 Prisma _count 投影 */
  _count: { participants: number };
  maxParticipants: number | null;
  /** 创建者 ID（用于编辑权限判断） */
  createdBy?: string | null;
  /** 录制 URL（已结束会议可查看回放） */
  recordingUrl?: string | null;
  /** 描述（L5 #31：列表展示 + 编辑时回填） */
  description?: string | null;
  /** 类型（编辑时回填） */
  type?: string;
  /** 录制开关（编辑时回填） */
  recordingEnabled?: boolean;
  /** 创建者信息（L5 #31：列表展示创建者名称） */
  creator?: { id: string; name: string | null; email: string } | null;
}

/** 列表 API 响应（分页） */
interface MeetingListResponse {
  items: MeetingItem[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
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
  const [editingMeeting, setEditingMeeting] = useState<MeetingItem | null>(null);
  // 当前用户 ID + 角色（用于编辑按钮可见性判断）
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);

  // 拉取当前用户 ID + 工作区角色（用于编辑权限判断）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [me, membersRes] = await Promise.all([
          api<{ id: string; name: string | null; email: string }>("/api/v1/users/me"),
          api<{
            items: Array<{ id: string; role: string; isSelf: boolean }>;
          }>(`/api/v1/workspaces/${workspaceId}/members?limit=100`),
        ]);
        if (cancelled) return;
        setCurrentUserId(me.id);
        const selfMember = membersRes.items.find((m) => m.isSelf);
        if (selfMember) setCurrentUserRole(selfMember.role);
      } catch {
        // 获取用户信息失败不阻塞列表渲染
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  // 拉取会议列表 + L7 #33：30 秒轮询刷新（实时更新会议状态/参与者数）
  useEffect(() => {
    let cancelled = false;

    const fetchMeetings = async () => {
      try {
        const data = await api<MeetingListResponse>(
          `/api/v1/workspaces/${workspaceId}/meetings?page=${page}&limit=${PAGE_LIMIT}`,
        );
        if (!cancelled) {
          setItems(data.items);
          setTotal(data.total);
          setError("");
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : t("loadFailed"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    // 首次加载显示 loading
    setLoading(true);
    void fetchMeetings();

    // L7 #33：30 秒轮询刷新（不显示 loading，静默更新）
    // 页面可见性优化：仅在页面可见时轮询，切到后台时暂停
    const pollInterval = setInterval(() => {
      if (!cancelled && document.visibilityState === "visible") {
        void fetchMeetings();
      }
    }, 30_000);

    // 页面从后台切回前台时立即刷新一次
    const onVisibilityChange = () => {
      if (!cancelled && document.visibilityState === "visible") {
        void fetchMeetings();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      clearInterval(pollInterval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
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

  // 编辑会议：打开 MeetingCreate 编辑模式
  const handleEdit = useCallback((meeting: MeetingItem) => {
    setEditingMeeting(meeting);
  }, []);

  // 编辑成功后更新列表
  const handleEditSaved = useCallback(
    (updated: { id: string; title: string }) => {
      setItems((prev) =>
        prev.map((m) =>
          m.id === updated.id ? { ...m, title: updated.title } : m,
        ),
      );
      setEditingMeeting(null);
    },
    [],
  );

  // 判断当前用户是否可编辑某会议（创建者或 admin/owner）
  const canEdit = useCallback(
    (meeting: MeetingItem): boolean => {
      if (!currentUserId) return false;
      if (meeting.createdBy === currentUserId) return true;
      if (currentUserRole === "admin" || currentUserRole === "owner") return true;
      return false;
    },
    [currentUserId, currentUserRole],
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
              onEdit={handleEdit}
              actioningId={actioningId}
              canEdit={canEdit}
            />
          )}

          {/* 已预约 */}
          {scheduledMeetings.length > 0 && (
            <MeetingGroup
              label={t("scheduledMeetings")}
              items={scheduledMeetings}
              onJoin={handleJoin}
              onEnd={handleEnd}
              onEdit={handleEdit}
              actioningId={actioningId}
              canEdit={canEdit}
            />
          )}

          {/* 已结束 */}
          {endedMeetings.length > 0 && (
            <MeetingGroup
              label={t("endedMeetings")}
              items={endedMeetings}
              onJoin={handleJoin}
              onEnd={handleEnd}
              onEdit={handleEdit}
              actioningId={actioningId}
              canEdit={canEdit}
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

      {/* 编辑会议弹窗 */}
      {editingMeeting && (
        <MeetingCreate
          workspaceId={workspaceId}
          onClose={() => setEditingMeeting(null)}
          onCreated={handleEditSaved}
          meeting={
            {
              id: editingMeeting.id,
              title: editingMeeting.title,
              description: editingMeeting.description,
              type: editingMeeting.type,
              scheduledAt: editingMeeting.scheduledAt,
              maxParticipants: editingMeeting.maxParticipants,
              recordingEnabled: editingMeeting.recordingEnabled,
            } satisfies EditableMeeting
          }
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
  onEdit,
  actioningId,
  canEdit,
}: {
  label: string;
  items: MeetingItem[];
  onJoin: (mid: string) => void;
  onEnd: (mid: string) => void;
  onEdit: (meeting: MeetingItem) => void;
  actioningId: string | null;
  canEdit: (meeting: MeetingItem) => boolean;
}) {

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
            onEdit={onEdit}
            actioning={actioningId === m.id}
            canEdit={canEdit(m)}
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
  onEdit,
  actioning,
  canEdit,
}: {
  meeting: MeetingItem;
  onJoin: (mid: string) => void;
  onEnd: (mid: string) => void;
  onEdit: (meeting: MeetingItem) => void;
  actioning: boolean;
  canEdit: boolean;
}) {
  const t = useTranslations("meeting");
  const tButton = useTranslations("button");
  const [menuOpen, setMenuOpen] = useState(false);

  const time = meeting.startedAt || meeting.scheduledAt || meeting.endedAt;
  const timeLabel = time ? new Date(time).toLocaleString() : "—";
  // 录制回放可用：已结束且有非 pending 的 recordingUrl
  const hasRecording =
    meeting.status === "ended" &&
    meeting.recordingUrl &&
    !meeting.recordingUrl.startsWith("egress:");

  // 是否有次要操作（查看录制/编辑）
  const hasSecondaryActions = hasRecording || (meeting.status === "scheduled" && canEdit);

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
            {meeting._count.participants}
            {meeting.maxParticipants ? ` / ${meeting.maxParticipants}` : ""}
          </span>
          {/* L5 #31：显示创建者名称 */}
          {meeting.creator && (meeting.creator.name || meeting.creator.email) && (
            <span className="inline-flex items-center gap-1">
              <User size={12} />
              {meeting.creator.name ?? meeting.creator.email}
            </span>
          )}
        </div>
        {/* L5 #31：显示会议描述（截断显示） */}
        {meeting.description && (
          <p className="mt-1 text-[length:var(--text-xs)] text-[var(--meta)] truncate">
            {meeting.description}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {/* 手机端次要操作下拉菜单 */}
        {hasSecondaryActions && (
          <div className="relative md:hidden">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="inline-flex items-center justify-center h-8 w-8 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
              aria-label="More actions"
            >
              <MoreVertical size={14} />
            </button>
            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-[var(--z-dropdown)]"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 top-full mt-1 min-w-[140px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-md)] py-1 z-[calc(var(--z-dropdown)+1)]">
                  {hasRecording && (
                    <a
                      href={meeting.recordingUrl as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 px-3 py-2 text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                    >
                      <Play size={14} />
                      {tButton("viewAll")}
                    </a>
                  )}
                  {meeting.status === "scheduled" && canEdit && (
                    <button
                      type="button"
                      onClick={() => {
                        onEdit(meeting);
                        setMenuOpen(false);
                      }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                    >
                      <Pencil size={14} />
                      {tButton("edit")}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* 主要操作：加入 — 始终显示（手机端仅图标） */}
        {(meeting.status === "active" || meeting.status === "scheduled") && (
          <button
            type="button"
            onClick={() => onJoin(meeting.id)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)]"
          >
            <Video size={14} />
            <span className="hidden sm:inline">{t("join")}</span>
          </button>
        )}
        {/* 主要操作：结束 — 始终显示（手机端仅图标） */}
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
            <span className="hidden sm:inline">{t("end")}</span>
          </button>
        )}

        {/* md 以上：次要操作按钮直接显示 */}
        {hasRecording && (
          <a
            href={meeting.recordingUrl as string}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden md:inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
          >
            <Play size={14} />
            {tButton("viewAll")}
          </a>
        )}
        {meeting.status === "scheduled" && canEdit && (
          <button
            type="button"
            onClick={() => onEdit(meeting)}
            className="hidden md:inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
          >
            <Pencil size={14} />
            {tButton("edit")}
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
