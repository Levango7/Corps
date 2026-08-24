import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * 真实健康检查（而非静态 200）：
 * Docker healthcheck 与 CI 启动等待（curl /api/health）都依赖本端点判断服务
 * 是否真正可用——若只返回静态 JSON，DB 未就绪时容器也会被判定 healthy，
 * 流量会被路由到一个必然报错的实例。因此这里真实执行一条 SELECT 1 探测。
 */
export async function GET() {
  // Promise.race：DB 探测与 2 秒超时赛跑，防止 DB 挂起时 healthcheck 长时间阻塞
  const TIMEOUT_MS = 2_000;
  try {
    let timer: ReturnType<typeof setTimeout>;
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Database probe timeout")), TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timer!);
    return NextResponse.json({
      code: 200,
      data: {
        status: "ok",
        db: "up",
        // 进程运行秒数：供监控判断进程是否频繁重启（如 OOM/崩溃循环）
        uptimeSec: Math.round(process.uptime()),
      },
    });
  } catch (error) {
    console.error("[GET /api/health] database probe failed:", error);
    return NextResponse.json(
      {
        code: 503,
        data: { status: "degraded", db: "down" },
        message: "Database unreachable",
      },
      { status: 503 },
    );
  }
}
