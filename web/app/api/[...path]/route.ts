import { NextRequest, NextResponse } from "next/server";
import { apiMsg } from "@/lib/api-messages";

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

/**
 * L6：catch-all 路由此前仅处理 OPTIONS 预检，对 GET/POST/PATCH/PUT/DELETE
 * 请求未定义 handler，Next.js 会回退到 404 HTML 页面——与全站 JSON ErrorEnvelope
 * 契约不一致（客户端期望 { code, message, data } 结构）。
 *
 * 这里统一为所有 non-OPTIONS 方法返回 JSON 404，使用 apiMsg("fileNotFound")
 * 作为通用"资源不存在"文案，并补 data:null 保持 ErrorEnvelope 形状一致。
 * 真实业务路由在更具体的路径段（如 app/api/v1/...）中定义，会优先匹配，
 * 不会落到此 catch-all。
 */
async function notFound(req: NextRequest) {
  return NextResponse.json(
    { code: 404, message: apiMsg(req, "fileNotFound"), data: null },
    { status: 404 },
  );
}

export async function GET(req: NextRequest) {
  return notFound(req);
}

export async function POST(req: NextRequest) {
  return notFound(req);
}

export async function PATCH(req: NextRequest) {
  return notFound(req);
}

export async function PUT(req: NextRequest) {
  return notFound(req);
}

export async function DELETE(req: NextRequest) {
  return notFound(req);
}
