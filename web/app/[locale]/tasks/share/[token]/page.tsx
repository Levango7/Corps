"use client";

/**
 * 任务公开只读分享页：/tasks/share/[token]——任何人可访问。
 * 展示：标题/描述/状态/优先级/截止日/负责人（名字）/子任务进度。不含评论、聊天、附件。
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Markdown from "@/components/Markdown";
import { AlertTriangle } from "lucide-react";

interface SharedTask {
  id: string;
  title: string;
  description: string | null;
  status: "todo" | "in_progress" | "review" | "done";
  priority: "low" | "medium" | "high" | "urgent";
  dueDate: string | null;
  updatedAt: string;
  workspace: { name: string } | null;
  assignee: { name: string } | null;
  children: { id: string; title: string; status: string; blocked: boolean }[];
}

export default function SharedTaskPage({ params }: { params: Promise<{ token: string }> }) {
  return <SharedTaskClient params={params} />;
}

function SharedTaskClient({ params }: { params: Promise<{ token: string }> }) {
  const t = useTranslations("taskShare");
  const [data, setData] = useState<SharedTask | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { token } = await params;
      try {
        const res = await fetch(`/api/tasks/share/${token}`);
        if (!res.ok) {
          if (!cancelled) setError(t("invalid"));
          return;
        }
        const json = await res.json();
        if (!cancelled) setData(json.data);
      } catch {
        if (!cancelled) setError(t("invalid"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params, t]);

  if (error) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center text-[var(--muted)]">
        {error}
      </div>
    );
  }
  if (!data) return <div className="min-h-[50vh]" />;

  const done = data.children.filter((c) => c.status === "done").length;
  const total = data.children.length;

  return (
    <article className="max-w-3xl mx-auto px-[var(--space-4)] py-[var(--space-10)]">
      <header className="mb-[var(--space-6)] pb-[var(--space-4)] border-b border-[var(--border-soft)]">
        <h1 className="text-[length:var(--text-3xl)] font-[var(--weight-semibold)] text-[var(--fg)] tracking-[-0.01em]">
          {data.title}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[length:var(--text-sm)] text-[var(--muted)]">
          {data.workspace && (
            <span>
              {t("workspaceLabel")}:{" "}
              <strong className="text-[var(--fg-2)]">{data.workspace.name}</strong>
            </span>
          )}
          <span>·</span>
          <span>
            {t("statusLabel")}:{" "}
            <strong className="text-[var(--fg-2)]">{t(`status.${data.status}`)}</strong>
          </span>
          <span>·</span>
          <span>
            {t("priorityLabel")}:{" "}
            <strong className="text-[var(--fg-2)]">{t(`priority.${data.priority}`)}</strong>
          </span>
          {data.dueDate && (
            <>
              <span>·</span>
              <span>
                {t("dueLabel")}:{" "}
                <strong className="text-[var(--fg-2)]">
                  {new Date(data.dueDate).toLocaleDateString()}
                </strong>
              </span>
            </>
          )}
          {data.assignee && (
            <>
              <span>·</span>
              <span>
                {t("assigneeLabel")}:{" "}
                <strong className="text-[var(--fg-2)]">{data.assignee.name}</strong>
              </span>
            </>
          )}
        </div>
      </header>

      {data.description && (
        <div className="prose prose-sm max-w-none mb-8">
          <Markdown source={data.description} />
        </div>
      )}

      {total > 0 && (
        <section className="mb-8">
          <h2 className="text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--fg)] mb-3">
            {t("subtasksLabel")}（{done}/{total}）
          </h2>
          <ul className="divide-y divide-[var(--border-soft)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
            {data.children.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                <span
                  className={`w-4 h-4 rounded-full border shrink-0 ${
                    c.status === "done"
                      ? "bg-[var(--success)] border-[var(--success)]"
                      : "border-[var(--muted)]"
                  }`}
                  aria-hidden="true"
                />
                <span
                  className={`flex-1 min-w-0 text-[length:var(--text-sm)] truncate ${
                    c.status === "done" ? "text-[var(--meta)] line-through" : "text-[var(--fg)]"
                  }`}
                >
                  {c.title}
                </span>
                {c.blocked && <AlertTriangle size={13} className="text-[var(--danger)] shrink-0" />}
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-[var(--space-10)] pt-[var(--space-4)] border-t border-[var(--border-soft)] text-[length:var(--text-xs)] text-[var(--meta)]">
        {t("footerHint", { product: "corps" })} ·{" "}
        {t("updatedAt", { date: new Date(data.updatedAt).toLocaleString() })}
      </footer>
    </article>
  );
}
