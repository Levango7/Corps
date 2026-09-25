"use client";

/**
 * 会议纪要详情（只读展示） · components/minutes/MinutesDetail.tsx
 *
 * 功能：
 *  - 标题展示
 *  - Markdown 内容渲染（简单处理：whitespace-pre-wrap + 加粗/标题）
 *  - 参会人员清单
 *  - 行动项清单（完成状态勾选展示）
 *  - 编辑 / 删除按钮
 *
 * design token + lucide-react（size 14/16）+ useTranslations。
 */

import { useTranslations } from "next-intl";
import { useRouter } from "@/lib/i18n-navigation";
import { Pencil, Trash2, Loader2, Users, CheckSquare, Calendar, User } from "lucide-react";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";

interface Attendee {
  userId?: string;
  name: string;
  role?: string;
}
interface ActionItem {
  title: string;
  assigneeId?: string;
  dueDate?: string;
  done: boolean;
}

interface MinutesDetailProps {
  wid: string;
  mid: string;
  data: {
    id: string;
    title: string;
    content: string;
    attendees: Attendee[];
    actionItems: ActionItem[];
    createdAt: string;
    updatedAt: string;
    creator: { id: string; name: string | null; email: string } | null;
  };
}

/**
 * 简单 Markdown 渲染：
 *  - # / ## / ### 标题
 *  - **bold**
 *  - 其余按段落 + whitespace-pre-wrap 展示
 *  不依赖外部 markdown 库，满足纪要基本排版需求。
 */
function MarkdownView({ md }: { md: string }) {
  const lines = md.split("\n");
  return (
    <div className="space-y-2">
      {lines.map((line, i) => {
        // 标题
        const h3 = line.match(/^###\s+(.*)/);
        if (h3)
          return (
            <h3
              key={i}
              className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]"
            >
              {renderInline(h3[1])}
            </h3>
          );
        const h2 = line.match(/^##\s+(.*)/);
        if (h2)
          return (
            <h2
              key={i}
              className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)]"
            >
              {renderInline(h2[1])}
            </h2>
          );
        const h1 = line.match(/^#\s+(.*)/);
        if (h1)
          return (
            <h1
              key={i}
              className="text-[length:var(--text-xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)]"
            >
              {renderInline(h1[1])}
            </h1>
          );
        // 空行
        if (line.trim() === "") return <div key={i} className="h-2" />;
        // 普通段落
        return (
          <p key={i} className="text-[length:var(--text-sm)] text-[var(--fg)] leading-relaxed">
            {renderInline(line)}
          </p>
        );
      })}
    </div>
  );
}

/** 处理行内 **bold** 加粗 */
function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-[weight:var(--weight-semibold)]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export function MinutesDetail({ wid, mid, data }: MinutesDetailProps) {
  const t = useTranslations("minutes");
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function handleDelete() {
    if (!window.confirm(t("confirmDelete"))) return;
    setDeleting(true);
    setError("");
    try {
      await api(`/api/v1/workspaces/${wid}/meeting-minutes/${mid}`, {
        method: "DELETE",
      });
      router.push(`/w/${wid}/meeting-minutes`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("deleteFailed"));
      setDeleting(false);
    }
  }

  const creator = data.creator?.name || data.creator?.email;
  const attendees = Array.isArray(data.attendees) ? data.attendees : [];
  const actionItems = Array.isArray(data.actionItems) ? data.actionItems : [];

  return (
    <div className="max-w-[var(--container-max)] mx-auto px-[var(--space-4)] py-[var(--space-6)]">
      {/* 标题 + 操作栏 */}
      <div className="flex items-start justify-between gap-4 mb-[var(--space-5)]">
        <div className="flex-1 min-w-0">
          <h1 className="text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)]">
            {data.title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[length:var(--text-xs)] text-[var(--muted)]">
            {creator && (
              <span className="inline-flex items-center gap-1">
                <User size={13} />
                {t("createdBy", { name: creator })}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Calendar size={13} />
              {t("createdAt", { date: new Date(data.createdAt).toLocaleString() })}
            </span>
            <span>·</span>
            <span>{t("updatedAt", { date: new Date(data.updatedAt).toLocaleString() })}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => router.push(`/w/${wid}/meeting-minutes/${mid}?edit=1`)}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
          >
            <Pencil size={14} />
            {t("edit")}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--danger)] hover:bg-[var(--surface-2)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)]"
          >
            {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            {t("delete")}
          </button>
        </div>
      </div>

      {error && <p className="mb-4 text-[length:var(--text-sm)] text-[var(--danger)]">{error}</p>}

      {/* 内容 */}
      <section className="mb-[var(--space-6)]">
        <h2 className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--meta)] mb-2 uppercase tracking-wide">
          {t("content")}
        </h2>
        <div className="px-4 py-3 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)]">
          {data.content.trim() ? (
            <MarkdownView md={data.content} />
          ) : (
            <p className="text-[length:var(--text-sm)] text-[var(--muted)]">{t("contentEmpty")}</p>
          )}
        </div>
      </section>

      {/* 参会人员 */}
      <section className="mb-[var(--space-6)]">
        <h2 className="flex items-center gap-1.5 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--meta)] mb-2 uppercase tracking-wide">
          <Users size={14} />
          {t("attendees")}
          <span className="text-[var(--muted)] normal-case tracking-normal">
            ({attendees.length})
          </span>
        </h2>
        {attendees.length === 0 ? (
          <p className="text-[length:var(--text-sm)] text-[var(--muted)]">{t("noAttendees")}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {attendees.map((a, idx) => (
              <li
                key={idx}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)]"
              >
                <span className="font-[weight:var(--weight-medium)]">{a.name}</span>
                {a.role && (
                  <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
                    · {a.role}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 行动项 */}
      <section className="mb-[var(--space-6)]">
        <h2 className="flex items-center gap-1.5 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--meta)] mb-2 uppercase tracking-wide">
          <CheckSquare size={14} />
          {t("actionItems")}
          <span className="text-[var(--muted)] normal-case tracking-normal">
            ({actionItems.filter((a) => a.done).length}/{actionItems.length})
          </span>
        </h2>
        {actionItems.length === 0 ? (
          <p className="text-[length:var(--text-sm)] text-[var(--muted)]">{t("noActions")}</p>
        ) : (
          <ul className="divide-y divide-[var(--border-soft)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
            {actionItems.map((a, idx) => (
              <li key={idx} className="flex items-center gap-3 px-4 py-2.5">
                <span
                  className="shrink-0 w-4 h-4 flex items-center justify-center rounded-[var(--radius-sm)] border"
                  style={{
                    background: a.done ? "var(--accent)" : "transparent",
                    borderColor: a.done ? "var(--accent)" : "var(--border)",
                  }}
                  aria-label={t("actionDone")}
                >
                  {a.done && <CheckSquare size={12} className="text-[var(--accent-fg)]" />}
                </span>
                <span
                  className={`flex-1 min-w-0 text-[length:var(--text-sm)] ${
                    a.done ? "text-[var(--muted)] line-through" : "text-[var(--fg)]"
                  }`}
                >
                  {a.title}
                </span>
                {a.assigneeId && (
                  <span className="shrink-0 inline-flex items-center gap-1 text-[length:var(--text-xs)] text-[var(--meta)]">
                    <User size={12} />
                    {a.assigneeId}
                  </span>
                )}
                {a.dueDate && (
                  <span className="shrink-0 inline-flex items-center gap-1 text-[length:var(--text-xs)] text-[var(--meta)]">
                    <Calendar size={12} />
                    {new Date(a.dueDate).toLocaleDateString()}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
