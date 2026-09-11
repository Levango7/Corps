// F5：任务分享密码验证路由
// POST /api/v1/workspaces/{wid}/tasks/{id}/share/verify
//
// 与 documents share/verify 类似，但针对 Task 模型。
// 流程：校验任务存在且有分享设置 → 过期检查 → 密码校验（3次错误IP锁定5分钟）
//       → 记录 ShareAccessLog + 返回任务内容
import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { verify as verifySharePassword } from "@/lib/crypto";
import {
  isLocked,
  recordFailure,
  clearFailures,
  rateLimitKey,
} from "@/lib/share-rate-limit";

const verifySchema = z.object({
  password: z.string().min(1).max(128),
});

/** 提取客户端 IP（X-Forwarded-For 优先，回退 x-real-ip / unknown） */
function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  const { wid, id } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  const ip = getClientIp(req);
  const userAgent = req.headers.get("user-agent") ?? null;
  const lockKey = rateLimitKey("task", id, ip);

  // IP 锁定检查
  if (isLocked(lockKey)) {
    return NextResponse.json(
      { code: 429, message: apiMsg(req, "shareLocked"), data: null },
      { status: 429 },
    );
  }

  try {
    const body = await req.json();
    const validated = verifySchema.parse(body);

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const task = await tx.task.findFirst({
          where: { id, workspaceId: wid },
          select: {
            id: true,
            title: true,
            description: true,
            status: true,
            priority: true,
            shareToken: true,
            shareExpiresAt: true,
            sharePassword: true,
          },
        });
        if (!task) return { kind: "notFound" as const };
        if (!task.shareToken) return { kind: "notShared" as const };

        // 过期检查
        if (task.shareExpiresAt && task.shareExpiresAt < new Date()) {
          return { kind: "expired" as const };
        }

        // 密码校验
        if (task.sharePassword) {
          const ok = await verifySharePassword(
            validated.password,
            task.sharePassword,
          );
          if (!ok) return { kind: "wrongPassword" as const };
        }

        // 记录访问日志
        await tx.shareAccessLog.create({
          data: {
            entityType: "task",
            entityId: id,
            ip,
            userAgent,
          },
        });

        return { kind: "ok" as const, task };
      },
      ctx.payload.sub,
    );

    switch (result.kind) {
      case "notFound":
        return NextResponse.json(
          { code: 404, message: apiMsg(req, "taskNotFound"), data: null },
          { status: 404 },
        );
      case "notShared":
        return NextResponse.json(
          {
            code: 404,
            message: apiMsg(req, "shareLinkInvalidRevoked"),
            data: null,
          },
          { status: 404 },
        );
      case "expired":
        return NextResponse.json(
          { code: 403, message: apiMsg(req, "shareExpired"), data: null },
          { status: 403 },
        );
      case "wrongPassword":
        recordFailure(lockKey);
        return NextResponse.json(
          {
            code: 401,
            message: apiMsg(req, "sharePasswordIncorrect"),
            data: null,
          },
          { status: 401 },
        );
      case "ok":
        clearFailures(lockKey);
        return NextResponse.json({
          code: 200,
          data: {
            id: result.task.id,
            title: result.task.title,
            description: result.task.description,
            status: result.task.status,
            priority: result.task.priority,
          },
        });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          code: 400,
          message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"),
          data: null,
        },
        { status: 400 },
      );
    }
    console.error("[POST task share/verify] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}