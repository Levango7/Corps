import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";

/**
 * CSRF 基线防护（Spec §152）：
 * 对 /api/v1 下的写请求校验 Origin 与 Host 同源。浏览器会强制附带 Origin 头，
 * 恶意第三方页面的跨站写请求将因 origin 不匹配被拒；非浏览器客户端
 * （curl、集成测试、服务间调用）不携带 Origin，直接放行——它们不受 CSRF 影响。
 * 配合 access_token cookie 的 SameSite=Lax 形成双层防线。
 */
const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

function isAllowed(req: NextRequest): boolean {
  if (!MUTATING_METHODS.has(req.method)) return true;

  const origin = req.headers.get("origin");
  // 无 Origin（同源 GET 导航、curl/测试、旧浏览器表单）：放行
  if (!origin) return true;

  const host = req.headers.get("host");
  try {
    const originHost = new URL(origin).host;
    if (host && originHost === host) return true;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (appUrl && originHost === new URL(appUrl).host) return true;
    // 本地开发端口
    if (originHost === "localhost:3000" || originHost === "127.0.0.1:3000") return true;
  } catch {
    /* 非法 Origin 一律拒绝 */
  }
  return false;
}

/**
 * T3.6：生成 per-request nonce 并注入 CSP 头。
 * nonce 通过 Base64 编码，32 字节随机，满足 CSP Level 3 规范。
 * style-src 保留 unsafe-inline（Tailwind 运行时注入 inline style），
 * script-src 保留 unsafe-inline（Next.js hydration 脚本无法逐一加 nonce）。
 */
function generateNonce(): string {
  return randomBytes(16).toString("base64");
}

export function middleware(req: NextRequest) {
  if (!isAllowed(req)) {
    return NextResponse.json(
      { code: 403, message: "Cross-origin request blocked (CSRF protection)" },
      { status: 403 },
    );
  }

  const nonce = generateNonce();
  const res = NextResponse.next();
  res.headers.set("x-nonce", nonce);

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'nonce-${nonce}'`,
    `style-src 'self' 'unsafe-inline' 'nonce-${nonce}'`,
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
  res.headers.set("Content-Security-Policy", csp);

  // HSTS：仅生产环境启用（localhost/127.0.0.1 不加，避免开发困扰）
  const host = req.headers.get("host") ?? "";
  if (!host.startsWith("localhost") && !host.startsWith("127.0.0.1")) {
    res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }

  return res;
}

export const config = {
  /**
   * CSRF 校验范围（扩大至全站以覆盖 CSP）：
   *  - /api/v1/:path* — 业务 API
   *  - /api/auth/:path* — Better Auth 会话端点
   *  - /(.* ) — 所有页面路由（CSP nonce 注入）
   */
  matcher: ["/api/v1/:path*", "/api/auth/:path*", "/(.*)"],
};
