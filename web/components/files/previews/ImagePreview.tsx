"use client";

/**
 * 图片预览组件
 *
 * 支持滚轮缩放（0.2x ~ 5x），使用 CSS transform scale。
 * 加载中显示占位提示，加载完成后居中展示图片。
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 * 尊重 prefers-reduced-motion（transition 用 motion-reduce 变体禁用）。
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";

export interface ImagePreviewProps {
  src: string;
  fileName: string;
}

export function ImagePreview({ src, fileName }: ImagePreviewProps) {
  const t = useTranslations("files.imagePreview");
  const [scale, setScale] = useState(1);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  // 滚轮缩放（native event, passive: false 以支持 preventDefault）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setScale((s) => Math.min(5, Math.max(0.2, Number((s + delta).toFixed(2)))));
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  const handleLoad = useCallback(() => setLoading(false), []);

  return (
    <div
      ref={containerRef}
      className="relative flex items-center justify-center w-full h-full overflow-auto bg-[var(--surface-2)]"
      data-testid="image-preview"
    >
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center text-[var(--muted)] text-[length:var(--text-sm)]">
          {t("loading")}
        </span>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element -- src 是运行时动态的私有文件端点（靠会话 Cookie 鉴权），next/image 优化器服务端取源不带 Cookie 会 401；且需 transform: scale() 缩放 + max-w/max-h 自然尺寸语义（fill 会把小图放大）、含 svg（需 dangerouslyAllowSVG）、可能为 blob:/跨域预签名 URL（需 remotePatterns）——均无法预声明，故保留原生 img */}
      <img
        src={src}
        alt={fileName}
        onLoad={handleLoad}
        style={{
          transform: `scale(${scale})`,
          transition: "transform var(--motion-base) var(--ease-standard)",
        }}
        className="max-w-full max-h-full object-contain motion-reduce:transition-none"
        draggable={false}
      />
    </div>
  );
}
