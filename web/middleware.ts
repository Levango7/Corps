import { NextRequest, NextResponse } from "next/server";

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

export function middleware(req: NextRequest) {
  if (!isAllowed(req)) {
    return NextResponse.json(
      { code: 403, message: "Cross-origin request blocked (CSRF protection)" },
      { status: 403 }
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/v1/:path*",
};
