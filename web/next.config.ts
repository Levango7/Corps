import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// next-intl App Router 集成（ADR-008 方案 A）
// 指定 i18n 配置入口；插件自动接管 messages 加载与 RSC 注水
const withNextIntl = createNextIntlPlugin("./lib/i18n.ts");

const nextConfig: NextConfig = {
  output: "standalone",

  // ─── 响应压缩 ──────────────────────────────────────────────
  // 显式启用 gzip/brotli 压缩（Next.js 默认 true，此处文档化以示确认）。
  // 生产环境由 standalone server 输出压缩响应，减小传输体积。
  compress: true,

  // ─── 图片优化 ──────────────────────────────────────────────
  // 显式声明 AVIF/WebP 优先级：AVIF 压缩率最高，WebP 作为兼容回退。
  // 浏览器通过 Accept 头协商，Next.js 自动转换并缓存。
  images: {
    formats: ["image/avif", "image/webp"],
  },

  // ─── 编译器优化 ────────────────────────────────────────────
  // 生产构建移除 console.* 调用，但保留 console.error 以便线上排查。
  // 开发环境 (next dev) 不受影响。
  compiler: {
    removeConsole: process.env.NODE_ENV === "production" ? { exclude: ["error"] } : false,
  },

  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
    // ─── 按需导入优化 ────────────────────────────────────────
    // 对大型桶导出库启用 modularizeImports：仅打包实际用到的图标/工具，
    // 显著缩减客户端 bundle 体积。lucide-react 单独全量导入可达数百 KB。
    // next-intl 有多个命名导出（useTranslations/useLocale/getTranslations 等），
    // 启用后按需 tree-shake，避免客户端打包未用到的服务端 API。
    optimizePackageImports: ["lucide-react", "next-intl"],
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          // CSP 已迁移至 middleware.ts（per-request nonce 动态生成），
          // 此处不再设置静态 CSP 头。
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
