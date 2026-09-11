import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { randomBytes } from "crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";
import { hash as hashSharePassword } from "@/lib/crypto";

/**
 * GET /v1/workspaces/{wid}/documents/{id} — 文档详情（编辑视图）
 * 返回 markdown 草稿 + publishedMarkdown（如有）；含 shareToken 状态供 UI 决定展示
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  const { wid, id } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const doc = await runWithWorkspace(wid, (tx) =>
      tx.document.findFirst({
        where: { id, workspaceId: wid },
        include: {
          author: { select: { id: true, name: true, email: true } },
        },
      }),
    );

    if (!doc) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "documentNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 200, data: doc });
  } catch (error) {
    console.error("[GET document] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

const updateDocSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  markdown: z.string().optional(),
  /** 设为 true 将当前 markdown 快照到 publishedMarkdown；false 不影响发布快照 */
  publish: z.boolean().optional(),
  /** "rotate"=服务端生成新分享 token（旧链接立即失效）；null=取消分享；不传=保持原状 */
  shareToken: z.union([z.literal("rotate"), z.null()]).optional(),
  /** F5: 分享过期时间（ISO 字符串；null=永不过期；不传=保持原状） */
  shareExpiresAt: z.union([z.string().datetime(), z.null()]).optional(),
  /** F5: 分享密码明文（null=清除密码；不传=保持原状；存 scrypt hash） */
  sharePassword: z.union([z.string().min(1).max(128), z.null()]).optional(),
});

/** PATCH /v1/workspaces/{wid}/documents/{id} — 更新标题/正文/发布状态/分享 token */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  const { wid, id } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const body = await req.json();
    const validated = updateDocSchema.parse(body);

    const updated = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.document.findFirst({
          where: { id, workspaceId: wid },
          select: { id: true, markdown: true },
        });
        if (!existing) return { kind: "notFound" as const };

        // 编辑前端往往只传 markdown（草稿）+ publish=true 一并提交；
        // 快照优先取已合并的 markdown（validated.markdown 优先），否则取库里旧值。
        // publish 与 shareToken 可在同一次 PATCH 组合（发布并分享）。
        const data: {
          title?: string;
          markdown?: string;
          publishedMarkdown?: string;
          publishedAt?: Date;
          shareToken?: string | null;
          shareExpiresAt?: Date | null;
          sharePassword?: string | null;
        } = {};
        if (validated.title !== undefined) data.title = validated.title;
        if (validated.markdown !== undefined) data.markdown = validated.markdown;
        if (validated.publish) {
          data.publishedMarkdown = validated.markdown ?? existing.markdown;
          data.publishedAt = new Date();
        }
        if (validated.shareToken === null) {
          data.shareToken = null;
        } else if (validated.shareToken === "rotate") {
          // token 一律由服务端生成（192 位熵），旧 token 即时失效；
          // 接受客户端传值会造成唯一键冲突（P2002）与可猜测 token
          data.shareToken = randomBytes(24).toString("base64url");
        }
        // F5: 分享过期时间（null = 永不过期）
        if (validated.shareExpiresAt !== undefined) {
          data.shareExpiresAt = validated.shareExpiresAt
            ? new Date(validated.shareExpiresAt)
            : null;
        }
        // F5: 分享密码（null = 清除密码；非空 = 存 scrypt hash）
        if (validated.sharePassword !== undefined) {
          data.sharePassword = validated.sharePassword
            ? await hashSharePassword(validated.sharePassword)
            : null;
        }

        const doc = await tx.document.update({ where: { id }, data });
        // 安全：剥离 sharePassword hash，防止泄露给客户端
        const { sharePassword: _stripped, ...docSafe } = doc;
        return { kind: "ok" as const, doc: docSafe };
      },
      ctx.payload.sub,
    );

    if (updated.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "documentNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 200, data: updated.doc });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"), data: null },
        { status: 400 },
      );
    }
    // P2025: 记录不存在（并发删除场景）→ 404
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "documentNotFound"), data: null },
        { status: 404 },
      );
    }
    console.error("[PATCH document] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** DELETE /v1/workspaces/{wid}/documents/{id} */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  const { wid, id } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const deleted = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.document.findFirst({
          where: { id, workspaceId: wid },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const };
        await tx.document.delete({ where: { id } });
        return { kind: "ok" as const };
      },
      ctx.payload.sub,
    );

    if (deleted.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "documentNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 200, data: { id, deleted: true } });
  } catch (error) {
    console.error("[DELETE document] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
