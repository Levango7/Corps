import { NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { buildCsp } from "./lib/csp";
import { routing } from "./lib/i18n-routing";

/**
 * next-intl 中间件：locale 检测与重定向（ADR-008 方案 A）。
 *
 * 策略（lib/i18n-routing.ts）：
 *  - localePrefix: as-needed → 默认 zh 不带前缀，en 带 /en
 *  - localeDetection: true → 从 cookie / Accept-Language 协商
 *
 * 与既有 CSRF / CSP / CORS 逻辑组合：
 *  - 先让 next-intl 处理 locale 协商（可能返回重定向）
 *  - 若未重定向，继续执行既有安全头注入
 */
const intlMiddleware = createMiddleware(routing);

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
    // 本地开发端口：仅非生产放行（生产放开会给本机 3000 端口上的其他应用留 CSRF 通道）
    if (
      process.env.NODE_ENV !== "production" &&
      (originHost === "localhost:3000" || originHost === "127.0.0.1:3000")
    ) {
      return true;
    }
  } catch {
    /* 非法 Origin 一律拒绝 */
  }
  return false;
}

/**
 * CORS 白名单（可选启用）：
 * - 未配置 CORS_ORIGINS 时不回任何 ACAO 头——浏览器默认拦截跨源读取（fail-closed），
 *   同源前端与 curl/服务间调用不受影响。
 * - 配置后（逗号分隔的精确 Origin 列表），命中项获得 ACAO 回显 + Vary: Origin；
 *   OPTIONS 预检短路返回 204（预检响应无需 CSP/nonce）。
 * 环境变量在函数内动态读取，保证测试中 stubEnv 可生效。
 */
function getAllowedOrigin(req: NextRequest): string | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  const allowlist = (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowlist.length === 0) return null;
  return allowlist.includes(origin) ? origin : null;
}

/**
 * T3.6：生成 per-request nonce 并注入 CSP 头。
 * 使用 Web Crypto API（Edge Runtime 兼容），不依赖 Node.js crypto 模块。
 * nonce 为 Base64 编码的 16 字节随机值，满足 CSP Level 3 规范。
 */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * 判断请求路径是否属于 API（不参与 locale 协商）。
 * next-intl matcher 已排除 /api，但此处双重保险。
 */
function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api");
}

export function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // CORS 预检短路：204 即满足浏览器要求；白名单命中时附带 CORS 头
  const corsOrigin = getAllowedOrigin(req);
  if (req.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: corsOrigin
        ? {
            "Access-Control-Allow-Origin": corsOrigin,
            "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Max-Age": "86400",
            Vary: "Origin",
          }
        : { Vary: "Origin" },
    });
  }

  if (!isAllowed(req)) {
    return NextResponse.json(
      { code: 403, message: "Cross-origin request blocked (CSRF protection)" },
      { status: 403 },
    );
  }

  // ─── next-intl locale 协商（仅对页面路由，API 跳过）───
  // intlMiddleware 命中时可能返回重定向（如 / → /en）；
  // 非重定向时以其响应为基底追加安全头——next-intl 可能附加的头/cookie（如
  // NEXT_LOCALE）不会因为另起 NextResponse.next() 而丢失（next-intl 官方模式
  // 要求返回其产生的响应）
  let res: NextResponse;
  if (!isApiPath(pathname)) {
    const intlRes = intlMiddleware(req);
    if (intlRes instanceof NextResponse && intlRes.headers.has("Location")) {
      return intlRes;
    }
    res = intlRes instanceof NextResponse ? intlRes : NextResponse.next();
  } else {
    res = NextResponse.next();
  }

  const nonce = generateNonce();
  res.headers.set("x-nonce", nonce);

  // CORS 响应头：仅对白名单命中的跨源请求回显（同源请求无 Origin，行为不变）
  if (corsOrigin) {
    res.headers.set("Access-Control-Allow-Origin", corsOrigin);
    res.headers.set("Access-Control-Allow-Credentials", "true");
    res.headers.append("Vary", "Origin");
  }

  // CSP 分环境构建（TC-CFG-02 修复）：生产移除 unsafe-inline 收紧为纯 nonce，
  // 开发保留 unsafe-inline 兼容 HMR。具体策略与取舍见 lib/csp.ts 头注释。
  const csp = buildCsp(nonce, process.env.NODE_ENV === "production");
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
   * CSRF 校验范围 + locale 协商范围：
   *  - /api/v1/:path* — 业务 API
   *  - /api/auth/:path* — Better Auth 会话端点
   *  - /(.* ) — 所有页面路由（CSP nonce 注入 + locale 协商）
   *
   * next-intl 会自动忽略 /api 路径，无需在此排除。
   */
  matcher: ["/api/v1/:path*", "/api/auth/:path*", "/((?!api|_next|_vercel|.*\\..*).*)"],
};
