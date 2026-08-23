import { NextRequest, NextResponse } from "next/server";

/**
 * CORS 预检白名单：仅放行应用自身 origin（NEXT_PUBLIC_APP_URL 与本地开发端口）。
 * 同源请求根本不会触发预检；此处理器只为显式配置过的跨端调用方服务。
 */
const allowedOrigins = new Set(
  [process.env.NEXT_PUBLIC_APP_URL, "http://localhost:3000", "http://127.0.0.1:3000"].filter(
    Boolean,
  ) as string[],
);

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get("origin");
  const headers = new Headers();
  headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (origin && allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
    return new NextResponse(null, { status: 204, headers });
  }

  // 未在白名单内：不回 ACAO 头，浏览器将拦截响应读取
  return new NextResponse(null, { status: 204, headers });
}
