import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { apiMsg } from "@/lib/api-messages";
import { handlePrismaError } from "@/lib/prisma-error";
import { z } from "zod";
import { diffMarkdown } from "@/lib/document-diff";

/**
 * 文档版本对比 API · /api/v1/workspaces/{wid}/documents/{id}/versions/compare
 * 设计文档 §2.3.3 — 版本对比
 *
 * - POST：比对同一文档的两个历史版本，返回行级 diff
 *
 * 入参二选一（都接受，body 优先于 query）：
 *  - { fromId, toId }  —— 版本行 id（UUID）
 *  - { from, to }      —— 版本号（整数），与前端 DocumentVersionHistory 的
 *                        `?from=N&to=M` 调用形态一致
 *
 * 鉴权：成员 + 文档读权限。比对两个版本都属于同一文档，
 * 因此拿到文档读权限即可读其任意版本内容（与 GET /versions/{vid} 同口径）。
 */

const compareSchema = z
  .object({
    fromId: z.string().uuid().optional(),
    toId: z.string().uuid().optional(),
    from: z.coerce.number().int().min(1).optional(),
    to: z.coerce.number().int().min(1).optional(),
  })
  .refine((v) => (v.fromId && v.toId) || (v.from !== undefined && v.to !== undefined), {
    message: "compare requires fromId+toId or from+to",
  });

/** POST /v1/workspaces/{wid}/documents/{id}/versions/compare — 比对两个版本 */
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

  // 角色门禁：Spec §5 要求「成员 + 文档读权限」。虽然语义是读，但本端点用 POST 传输
  // （diff 载荷放在 body 里），因此必须显式声明 documents:read 门禁，
  // 否则 scripts/check_permission_gates.py 会按写 handler 口径判为 T1 缺口，
  // 且 viewer 越权读他人文档版本内容也无从拦截。
  const deniedRole = await requirePermission(ctx, "documents", "read", req);
  if (deniedRole) return deniedRole;

  try {
    const url = new URL(req.url);
    const raw = await req.json().catch(() => ({}));
    // body 为空时回退到 query（前端当前用 GET 风格 query；这里 POST 兼容两种）
    const merged = {
      fromId: raw?.fromId ?? url.searchParams.get("fromId") ?? undefined,
      toId: raw?.toId ?? url.searchParams.get("toId") ?? undefined,
      from: raw?.from ?? url.searchParams.get("from") ?? undefined,
      to: raw?.to ?? url.searchParams.get("to") ?? undefined,
    };

    const parsed = compareSchema.safeParse(merged);
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: 400,
          message: apiMsg(req, "validationFailed"),
          errors: parsed.error.errors,
          data: null,
        },
        { status: 400 },
      );
    }
    const { fromId, toId, from, to } = parsed.data;

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 校验文档存在且属于本工作区（防跨租户读取）
        const doc = await tx.document.findFirst({
          where: { id, workspaceId: wid },
          select: { id: true },
        });
        if (!doc) return { kind: "docNotFound" as const, data: null };

        // 按 id 或版本号定位两个版本；缺失任一即 404
        const [fromVersion, toVersion] = await Promise.all([
          tx.documentVersion.findFirst({
            where: fromId
              ? { id: fromId, documentId: id, workspaceId: wid }
              : { documentId: id, workspaceId: wid, version: from },
            select: {
              id: true,
              version: true,
              markdown: true,
              createdAt: true,
              author: { select: { name: true } },
            },
          }),
          tx.documentVersion.findFirst({
            where: toId
              ? { id: toId, documentId: id, workspaceId: wid }
              : { documentId: id, workspaceId: wid, version: to },
            select: {
              id: true,
              version: true,
              markdown: true,
              createdAt: true,
              author: { select: { name: true } },
            },
          }),
        ]);
        if (!fromVersion || !toVersion) return { kind: "versionNotFound" as const, data: null };

        return { kind: "ok" as const, data: { fromVersion, toVersion } };
      },
      ctx.payload.sub,
    );

    if (result.kind === "docNotFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "documentNotFound"), data: null },
        { status: 404 },
      );
    }
    if (result.kind === "versionNotFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "prismaRecordNotFound"), data: null },
        { status: 404 },
      );
    }

    const { fromVersion, toVersion } = result.data;
    const diff = diffMarkdown(fromVersion.markdown, toVersion.markdown);

    return NextResponse.json({
      code: 200,
      data: {
        from: {
          id: fromVersion.id,
          version: fromVersion.version,
          createdAt: fromVersion.createdAt,
          author: fromVersion.author,
        },
        to: {
          id: toVersion.id,
          version: toVersion.version,
          createdAt: toVersion.createdAt,
          author: toVersion.author,
        },
        diff,
        stats: diff.stats,
      },
    });
  } catch (error) {
    console.error("[POST document version compare] error:", error);
    return handlePrismaError(error, req);
  }
}

/**
 * GET 兼容入口：前端 DocumentVersionHistory 目前用
 * `GET .../versions/compare?from=N&to=M` 调用（组件属并行会话改动区，本批不改前端）。
 * 语义完全委托给上面的 POST，避免两份实现漂移。
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  const url = new URL(req.url);
  const body = {
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    fromId: url.searchParams.get("fromId") ?? undefined,
    toId: url.searchParams.get("toId") ?? undefined,
  };
  // 构造一个只带 body 的等价请求交给 POST 处理
  const forwarded = new NextRequest(req.url, {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify(body),
  });
  return POST(forwarded, { params });
}
