import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

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
    removeConsole:
      process.env.NODE_ENV === "production"
        ? { exclude: ["error"] }
        : false,
  },

  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
    // ─── 按需导入优化 ────────────────────────────────────────
    // 对大型桶导出库启用 modularizeImports：仅打包实际用到的图标/工具，
    // 显著缩减客户端 bundle 体积。lucide-react 单独全量导入可达数百 KB。
    optimizePackageImports: [
      "lucide-react",
    ],
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
          // Next.js 运行时需要内联脚本/样式（hydration 与主题引导），
          // 故允许 self + unsafe-inline；外部资源默认全部拒绝。
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              "connect-src 'self'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
