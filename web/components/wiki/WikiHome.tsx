"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { BookOpen } from "lucide-react";
import { WikiSidebar, type WikiPageNode } from "./WikiSidebar";
import { useRouter } from "next/navigation";

/**
 * WikiHome — Wiki 主页面客户端组件。
 * 左侧 WikiSidebar 页面树 + 右侧欢迎/选择提示。
 * 选中页面后跳转到 /w/{wid}/wiki/{pageId} 编辑页。
 */
export function WikiHome({ wid }: { wid: string }) {
  const t = useTranslations("wiki");
  const router = useRouter();
  const [refreshKey, setRefreshKey] = useState(0);

  const handleSelect = useCallback(
    (page: WikiPageNode) => {
      router.push(`/w/${wid}/wiki/${page.id}`);
    },
    [router, wid],
  );

  return (
    <div className="flex h-full">
      {/* 左侧：页面树侧边栏 */}
      <div className="w-64 shrink-0 h-full">
        <WikiSidebar
          wid={wid}
          onSelect={handleSelect}
          refreshKey={refreshKey}
        />
      </div>

      {/* 右侧：欢迎/选择提示 */}
      <div className="flex-1 flex items-center justify-center min-w-0">
        <div className="text-center">
          <BookOpen size={48} className="mx-auto mb-[var(--space-4)] text-[var(--muted)] opacity-50" />
          <h1 className="text-[length:var(--text-xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mb-2">
            {t("title")}
          </h1>
          <p className="text-[length:var(--text-sm)] text-[var(--muted)]">{t("selectPage")}</p>
        </div>
      </div>
    </div>
  );
}