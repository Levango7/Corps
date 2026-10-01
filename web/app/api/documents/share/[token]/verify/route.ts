// POST /api/documents/share/{token} — 公开分享链接的密码校验端点（无需登录）
//
// 为什么单独有这个路由：分享页 app/[locale]/documents/share/[token]/page.tsx 一直在
// POST 这个路径，而它此前并不存在（命中 [...path] → 404），同时 GET 端点又从不返回
// sharePassword / shareExpiresAt，于是"设了密码"和"设了有效期"两条控制在公开路径上
// 完全失效——任何拿到 URL 的人都能匿名读到全文。本路由把这两条控制落到服务端。
//
// 安全约束：
//  - 未通过门禁（密码缺失/错误、已过期）时，响应体里绝不出现正文；
//  - 密码用 scrypt 比对（lib/crypto），比对失败计入 IP 锁定；
//  - 绝不把 sharePassword 哈希下发给客户端。
import { NextRequest, NextResponse } from "next/server";
import { runWithShareToken, setTxGuc } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { verify as verifySharePassword } from "@/lib/crypto";
import { isLocked, recordFailure, clearFailures, rateLimitKey } from "@/lib/share-rate-limit";

const verifySchema = z.object({
  password: z.string().min(1).max(128),
});

/**
 * 取客户端 IP 用于失败锁定。
 * 优先 x-real-ip（由我们的反代写入、客户端无法伪造）；仅当它缺失时才回退到
 * x-forwarded-for 的最左值——那一节是客户端可控的，可被伪造来绕过锁定，
 * 所以只作兜底。兜底链本身是纵深防御里较弱的一环，精确限流应在网关层做。
 */
function getClientIp(req: NextRequest): string {
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return "unknown";
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ip = getClientIp(req);
  const userAgent = req.headers.get("user-agent") ?? null;

  try {
    const body = await req.json().catch(() => ({}));
    const validated = verifySchema.parse(body);

    // 锁定按"文档实体 + IP"计，避免一个 IP 失败波及整个站点
    const result = await runWithShareToken(token, async (tx) => {
      const doc = await tx.document.findFirst({
        where: { OR: [{ shareSlug: token }, { shareToken: token }] },
        select: {
          id: true,
          title: true,
          publishedMarkdown: true,
          sharePassword: true,
          shareExpiresAt: true,
          workspaceId: true,
        },
      });
      if (!doc?.publishedMarkdown) return { kind: "notFound" as const };

      const lockKey = rateLimitKey("document", doc.id, ip);
      if (isLocked(lockKey)) return { kind: "locked" as const, lockKey };

      if (doc.shareExpiresAt && doc.shareExpiresAt < new Date()) {
        return { kind: "expired" as const };
      }

      // 未设密码时不强制校验：GET 已经会把正文直发，走到这里只是客户端多调了一次
      if (doc.sharePassword) {
        const ok = await verifySharePassword(validated.password, doc.sharePassword);
        if (!ok) return { kind: "wrongPassword" as const, lockKey };
      }

      clearFailures(lockKey);
      // ADR-010 G4：share_access_logs 已有 RLS 策略（按 app.workspace_id 隔离）。
      // 本入口是匿名公开路径，只有 public_token GUC，读到这里已凭 token 取到文档行；
      // setTxGuc 按行上的 workspace_id 临时放行本事务内的日志写入。写失败不该阻断取文，
      // 但这里保持与 workspace 版 verify 路由同一口径（同一事务内写）。
      await setTxGuc(tx, "workspace_id", doc.workspaceId);
      await tx.shareAccessLog.create({
        data: {
          workspaceId: doc.workspaceId,
          entityType: "document",
          entityId: doc.id,
          ip,
          userAgent,
        },
      });

      return { kind: "ok" as const, doc };
    });

    switch (result.kind) {
      case "notFound":
        return NextResponse.json(
          { code: 404, message: apiMsg(req, "shareLinkInvalidUnpublished"), data: null },
          { status: 404 },
        );
      case "locked":
        return NextResponse.json(
          { code: 429, message: apiMsg(req, "shareLocked"), data: null },
          { status: 429 },
        );
      case "expired":
        return NextResponse.json(
          { code: 403, message: apiMsg(req, "shareExpired"), data: null },
          { status: 403 },
        );
      case "wrongPassword":
        recordFailure(result.lockKey);
        return NextResponse.json(
          { code: 401, message: apiMsg(req, "sharePasswordIncorrect"), data: null },
          { status: 401 },
        );
      case "ok":
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
    console.error("[POST public document share/verify] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
