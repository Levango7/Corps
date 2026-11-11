import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiMsg } from "@/lib/api-messages";
import { logger } from "@/lib/logger";
import { withRed } from "@/lib/red-metrics";

/**
 * 真实健康检查（而非静态 200）：
 * Docker healthcheck 与 CI 启动等待（curl /api/health）都依赖本端点判断服务
 * 是否真正可用——若只返回静态 JSON，DB 未就绪时容器也会被判定 healthy，
 * 流量会被路由到一个必然报错的实例。因此这里真实执行一条 SELECT 1 探测。
 */
async function getHealth(req: NextRequest) {
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
  } catch (err) {
    // 脱敏硬要求：Prisma 探测失败的 err.message 常含主机名+端口甚至连接串
    // （DATABASE_URL），绝不能把原始消息 / stack / String(err) 写进日志。
    // 日志里的 message 只取代码内常量，errorName / prismaCode 也均为安全标识。
    const isTimeout = err instanceof Error && err.message.includes("Database probe timeout");
    const rawCode =
      typeof err === "object" && err !== null && "code" in err
        ? (err as { code?: unknown }).code
        : undefined;
    const prismaCode =
      typeof rawCode === "string" && /^P\d{4}$/.test(rawCode) ? rawCode : undefined;

    logger.error("database probe failed", {
      endpoint: "health",
      errorName: err instanceof Error ? err.name : "NonError",
      message: isTimeout ? "Database probe timeout" : "database probe error",
      isTimeout,
      ...(prismaCode ? { prismaCode } : {}),
    });
    return NextResponse.json(
      {
        code: 503,
        data: { status: "degraded", db: "down" },
        message: apiMsg(req, "databaseUnreachable"),
      },
      { status: 503 },
    );
  }
}

export const GET = withRed(getHealth);
