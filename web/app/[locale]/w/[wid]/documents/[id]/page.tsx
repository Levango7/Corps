"use client";

import { History } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import dynamic from "next/dynamic";

// P0-2: code splitting — DocumentEditor 改为 dynamic import 懒加载
const DocumentVersionHistory = dynamic(
  () => import("@/components/DocumentVersionHistory").then((m) => m.DocumentVersionHistory),
  { ssr: false },
);

const DocumentEditor = dynamic(
  () => import("@/components/DocumentEditor").then((m) => m.DocumentEditor),
  {
    ssr: false,
    loading: () => <div className="animate-pulse h-32 rounded-lg bg-[var(--surface-2)]" />,
  },
);
import { PermissionManager } from "@/components/doc/PermissionManager";
import { SafeComponent } from "@/components/SafeComponent";
import type { DocumentEditorProps } from "@/components/DocumentEditor";

/** 工作区成员（用于判断当前用户角色） */
interface Member {
  userId: string;
  role: string;
}

/**
 * L2: 提取 canManageDoc 为独立函数，避免重复逻辑
 * 判断当前用户是否有 manage 权限：
 * 1. 文档作者
 * 2. 工作区 owner/admin
 * 3. 显式 manage 权限（通过权限 API 判断）
 */
async function checkCanManageDoc(
  wid: string,
  docId: string,
  currentUserId: string,
  authorId: string | undefined,
  myRole: string,
): Promise<boolean> {
  // 1. 文档作者
  const isAuthor = !!currentUserId && !!authorId && currentUserId === authorId;
  // 2. 工作区 owner/admin
  const isOwnerOrAdmin = myRole === "owner" || myRole === "admin";

  if (isAuthor || isOwnerOrAdmin) return true;

  // 3. 非作者/owner/admin：检查是否有显式 manage 权限
  if (!currentUserId) return false;
  try {
    const permData = await api<{
      items: { granteeType: string; granteeId: string; permission: string }[];
    }>(`/api/v1/workspaces/${wid}/documents/${docId}/permissions`);
    return permData.items.some(
      (p) =>
        p.permission === "manage" &&
        ((p.granteeType === "user" && p.granteeId === currentUserId) ||
          (p.granteeType === "role" && p.granteeId === myRole)),
    );
  } catch {
    // 无权访问权限列表 → 无 manage 权限
    return false;
  }
}

export default function DocumentEditPage({
  params,
}: {
  params: Promise<{ wid: string; id: string }>;
}) {
  return <DocumentEditPageClient params={params} />;
}

function DocumentEditPageClient({ params }: { params: Promise<{ wid: string; id: string }> }) {
  const t = useTranslations("document");
  const [wid, setWid] = useState<string | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [data, setData] = useState<DocumentEditorProps["initial"] | null>(null);
  const [error, setError] = useState("");
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  // 权限管理：仅对有 manage 权限的用户显示 PermissionManager
  const [canManage, setCanManage] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { wid: w, id: i } = await params;
      setWid(w);
      setId(i);
      try {
        const [doc, me, members] = await Promise.all([
          api<{
            id: string;
            title: string;
            markdown: string;
            publishedMarkdown: string | null;
            publishedAt: string | null;
            shareToken: string | null;
            authorId?: string;
            author?: { id: string; name: string | null; email: string };
          }>(`/api/v1/workspaces/${w}/documents/${i}`),
          // 获取当前用户 ID
          api<{ id: string }>("/api/v1/users/me").catch(() => ({ id: "" })),
          // 获取工作区成员列表以判断当前用户角色
          api<{ items: Member[] } | Member[]>(`/api/v1/workspaces/${w}/members`).catch(() => ({
            items: [] as Member[],
          })),
        ]);
        if (cancelled) return;
        setData({
          title: doc.title,
          markdown: doc.markdown,
          publishedMarkdown: doc.publishedMarkdown,
          publishedAt: doc.publishedAt,
          shareToken: doc.shareToken,
        });

        // L2: 使用提取的 checkCanManageDoc 函数
        const currentUserId = me.id;
        const authorId = doc.authorId ?? doc.author?.id;
        const memberList = Array.isArray(members) ? members : members.items;
        const myMember = memberList.find((m) => m.userId === currentUserId);
        const myRole = myMember?.role ?? "";

        const canManageDoc = await checkCanManageDoc(w, i, currentUserId, authorId, myRole);
        setCanManage(canManageDoc);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t("loadFailed"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params, t]);

  function handleVersionRestored(document: DocumentEditorProps["initial"]) {
    setData({
      title: document.title,
      markdown: document.markdown,
      publishedMarkdown: document.publishedMarkdown,
      publishedAt: document.publishedAt,
      shareToken: document.shareToken,
    });
    setEditorKey((key) => key + 1);
  }

  if (error) {
    return <p className="p-[var(--space-8)] text-center text-[var(--danger)]">{error}</p>;
  }
  if (!wid || !id || !data) {
    return <p className="p-[var(--space-8)] text-center text-[var(--muted)]">{t("loading")}</p>;
  }
  return (
    <div className="flex flex-col gap-[var(--space-4)]">
      <div className="mx-auto flex w-full max-w-3xl justify-end px-[var(--space-4)] pt-[var(--space-4)]">
        <button
          type="button"
          onClick={() => setVersionHistoryOpen((open) => !open)}
          aria-expanded={versionHistoryOpen}
          aria-controls="document-version-history"
          className="inline-flex min-h-[var(--space-12)] items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] active:bg-[var(--surface-3)]"
        >
          <History size={16} aria-hidden="true" />
          {t("versionHistory")}
        </button>
      </div>
      <SafeComponent name="文档编辑器">
        <DocumentEditor key={editorKey} wid={wid} id={id} initial={data} />
      </SafeComponent>
      {canManage && <PermissionManager docId={id} workspaceId={wid} />}
      {versionHistoryOpen && (
        <DocumentVersionHistory
          wid={wid}
          docId={id}
          onClose={() => setVersionHistoryOpen(false)}
          onRestored={handleVersionRestored}
        />
      )}
    </div>
  );
}
