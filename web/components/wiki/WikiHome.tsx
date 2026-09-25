"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { BookOpen, Menu, X } from "lucide-react";
import { WikiSidebar, type WikiPageNode } from "./WikiSidebar";
import { useRouter } from "next/navigation";

/**
 * WikiHome — Wiki 主页面客户端组件。
 * 左侧 WikiSidebar 页面树 + 右侧欢迎/选择提示。
 * 选中页面后跳转到 /w/{wid}/wiki/{pageId} 编辑页。
 *
 * 响应式：手机端侧边栏默认隐藏，通过汉堡菜单按钮打开抽屉；
 * md 以上侧边栏始终显示（w-64）。
 */
export function WikiHome({ wid }: { wid: string }) {
  const t = useTranslations("wiki");
  const router = useRouter();
  const [refreshKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleSelect = useCallback(
    (page: WikiPageNode) => {
      router.push(`/w/${wid}/wiki/${page.id}`);
      setSidebarOpen(false);
    },
    [router, wid],
  );

  return (
    <div className="flex h-full relative">
      {/* 移动端汉堡菜单按钮 */}
      <button
        type="button"
        onClick={() => setSidebarOpen(true)}
        className="md:hidden absolute top-[var(--space-3)] left-[var(--space-3)] z-10 inline-flex items-center justify-center h-9 w-9 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
        aria-label={t("title")}
      >
        <Menu size={16} />
      </button>

      {/* 移动端遮罩层 */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 z-[var(--z-sticky)] bg-[var(--mix-black)]/40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* 左侧：页面树侧边栏 */}
      <div
        className={`${
          sidebarOpen
            ? "fixed inset-y-0 left-0 z-[var(--z-modal)] w-[var(--sidebar-w-mobile)] shadow-[var(--elev-lg)]"
            : "hidden"
        } md:static md:block md:w-64 md:z-auto h-full shrink-0 bg-[var(--surface)]`}
      >
        {/* 移动端关闭按钮 */}
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          className="md:hidden absolute top-[var(--space-3)] right-[var(--space-3)] inline-flex items-center justify-center h-8 w-8 rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
          aria-label="Close sidebar"
        >
          <X size={16} />
        </button>
        <WikiSidebar wid={wid} onSelect={handleSelect} refreshKey={refreshKey} />
      </div>

      {/* 右侧：欢迎/选择提示 */}
      <div className="flex-1 flex items-center justify-center min-w-0">
        <div className="text-center">
          <BookOpen
            size={48}
            className="mx-auto mb-[var(--space-4)] text-[var(--muted)] opacity-50"
          />
          <h1 className="text-[length:var(--text-xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mb-2">
            {t("title")}
          </h1>
          <p className="text-[length:var(--text-sm)] text-[var(--muted)]">{t("selectPage")}</p>
        </div>
      </div>
    </div>
  );
}
