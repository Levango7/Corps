// F5：文档分享密码验证路由
// POST /api/v1/workspaces/{wid}/documents/{id}/share/verify
//
// 流程：
//  1. 校验文档存在且有分享设置（shareToken 非空）
//  2. 检查分享是否过期 → 403 shareExpired
//  3. 若设置了密码：验证密码（scrypt），错误 → 401
//     密码错误 3 次 → 5 分钟 IP 级别锁定
//  4. 验证通过 → 记录 ShareAccessLog（IP + UserAgent）+ 返回文档内容
//
// 注意：此路由需要登录（工作区上下文），用于成员预览分享效果。
// 公开访问（无登录）走 /api/documents/share/[token] 路径，此处不覆盖。
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
  const lockKey = rateLimitKey("document", id, ip);

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
        const doc = await tx.document.findFirst({
          where: { id, workspaceId: wid },
          select: {
            id: true,
            title: true,
            publishedMarkdown: true,
            shareToken: true,
            shareExpiresAt: true,
            sharePassword: true,
          },
        });
        if (!doc) return { kind: "notFound" as const };
        if (!doc.shareToken) return { kind: "notShared" as const };

        // 过期检查
        if (doc.shareExpiresAt && doc.shareExpiresAt < new Date()) {
          return { kind: "expired" as const };
        }

        // 密码校验
        if (doc.sharePassword) {
          const ok = await verifySharePassword(
            validated.password,
            doc.sharePassword,
          );
          if (!ok) return { kind: "wrongPassword" as const };
        }

        // 记录访问日志
        await tx.shareAccessLog.create({
          data: {
            entityType: "document",
            entityId: id,
            ip,
            userAgent,
          },
        });

        return { kind: "ok" as const, doc };
      },
      ctx.payload.sub,
    );

    switch (result.kind) {
      case "notFound":
        return NextResponse.json(
          { code: 404, message: apiMsg(req, "documentNotFound"), data: null },
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
            id: result.doc.id,
            title: result.doc.title,
            markdown: result.doc.publishedMarkdown,
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
    console.error("[POST document share/verify] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}