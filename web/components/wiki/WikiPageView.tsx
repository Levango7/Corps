"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Loader2, FileX } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useRouter } from "next/navigation";
import { WikiSidebar, type WikiPageNode } from "./WikiSidebar";
import { WikiEditor, type WikiPageData } from "./WikiEditor";

/** API 返回的 Wiki 页面详情（含 children） */
interface WikiPageDetail extends WikiPageData {
  children: Array<{
    id: string;
    title: string;
    slug: string;
    sortOrder: number;
    updatedAt: string;
  }>;
  createdBy: string;
  createdAt: string;
}

/**
 * WikiPageView — Wiki 编辑页面客户端组件。
 * 左侧 WikiSidebar 页面树 + 右侧 WikiEditor（编辑/预览切换）。
 */
export function WikiPageView({ wid, pageId }: { wid: string; pageId: string }) {
  const t = useTranslations("wiki");
  const router = useRouter();
  const [page, setPage] = useState<WikiPageDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  // 拉取页面详情
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setNotFound(false);
      setError("");
      try {
        const data = await api<WikiPageDetail>(`/api/v1/workspaces/${wid}/wiki/${pageId}`);
        if (!cancelled) setPage(data);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) {
          setNotFound(true);
        } else {
          setError(e instanceof Error ? e.message : t("loadError"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wid, pageId, t]);

  /** 侧边栏选中页面 → 跳转 */
  const handleSelect = useCallback(
    (node: WikiPageNode) => {
      router.push(`/w/${wid}/wiki/${node.id}`);
    },
    [router, wid],
  );

  /** 保存成功 → 刷新侧边栏 */
  const handleSaved = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  /** 删除成功 → 返回 wiki 首页 */
  const handleDeleted = useCallback(() => {
    router.push(`/w/${wid}/wiki`);
  }, [router, wid]);

  return (
    <div className="flex h-full">
      {/* 左侧：页面树侧边栏 */}
      <div className="w-64 shrink-0 h-full">
        <WikiSidebar
          wid={wid}
          selectedId={pageId}
          onSelect={handleSelect}
          refreshKey={refreshKey}
        />
      </div>

      {/* 右侧：编辑器 / 加载态 / 错误态 */}
      <div className="flex-1 min-w-0 h-full">
        {loading ? (
          <div className="flex items-center justify-center h-full text-[var(--muted)] text-[length:var(--text-sm)]">
            <Loader2 size={20} className="inline animate-spin mr-2" />
            {t("loadError")}
          </div>
        ) : notFound ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--muted)]">
            <FileX size={48} className="mb-[var(--space-4)] opacity-50" />
            <p className="text-[length:var(--text-sm)]">{t("notFound")}</p>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-[var(--danger)] text-[length:var(--text-sm)]">
            {error}
          </div>
        ) : page ? (
          <WikiEditor wid={wid} page={page} onSaved={handleSaved} onDeleted={handleDeleted} />
        ) : null}
      </div>
    </div>
  );
}
