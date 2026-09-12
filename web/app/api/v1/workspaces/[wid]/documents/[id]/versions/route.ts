import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { handlePrismaError } from "@/lib/prisma-error";

/**
 * 文档版本历史 API · /api/v1/workspaces/{wid}/documents/{id}/versions
 * 设计文档 §2.3 — 版本快照策略
 *
 * - GET：列出版本历史（分页，按版本号倒序）
 * - POST：创建版本快照（手动）
 *
 * 存储策略（设计文档 §2.3.1）：
 *  - 首个版本存全量（snapshotType=full），后续版本也存全量（Phase 1 简化）
 *  - diff 增量存储留待后续优化（需引入 diff-match-patch 依赖）
 *  - 每 10 个版本强制全量（当前全为全量，该规则自动满足）
 */

/** GET /v1/workspaces/{wid}/documents/{id}/versions — 版本历史列表（分页） */
export async function GET(
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

  try {
    const url = new URL(req.url);
    const parsed = listVersionsQuerySchema.safeParse({
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
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
    const { page, limit } = parsed.data;
    const skip = (page - 1) * limit;

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 校验文档存在且属于本工作区（防跨租户读取）
        const doc = await tx.document.findFirst({
          where: { id, workspaceId: wid },
          select: { id: true, currentVersion: true },
        });
        if (!doc) return null;

        const [versions, total] = await Promise.all([
          tx.documentVersion.findMany({
            where: { documentId: id, workspaceId: wid },
            include: { author: { select: { id: true, name: true, email: true } } },
            orderBy: { version: "desc" },
            skip,
            take: limit,
          }),
          tx.documentVersion.count({ where: { documentId: id, workspaceId: wid } }),
        ]);
        return { versions, total };
      },
      ctx.payload.sub,
    );

    if (result === null) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "documentNotFound"), data: null },
        { status: 404 },
      );
    }

    return NextResponse.json({
      code: 200,
      data: {
        items: result.versions,
        page,
        limit,
        total: result.total,
        hasMore: page * limit < result.total,
      },
    });
  } catch (error) {
    console.error("[GET document versions] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

const listVersionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const createVersionSchema = z.object({
  /** 版本说明（可选） */
  message: z.string().max(255).optional(),
  /** 版本来源（默认 manual） */
  source: z.enum(["publish", "manual", "auto", "collaborative"]).optional(),
});

/** POST /v1/workspaces/{wid}/documents/{id}/versions — 创建版本快照（手动）
 *  权限：工作区成员均可创建版本（documents 模块 create 权限）
 *  语义：对文档当前 markdown 创建版本快照，版本号自增
 */
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

  try {
    const body = await req.json().catch(() => ({}));
    const validated = createVersionSchema.parse(body);

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 校验文档存在且属于本工作区
        const docExists = await tx.document.findFirst({
          where: { id, workspaceId: wid },
          select: { id: true },
        });
        if (!docExists) return { kind: "notFound" as const, data: null };

        // 并发保护：对 Document 行加 FOR UPDATE 行锁，防止并发版本号重复
        await tx.$queryRaw`SELECT id FROM "documents" WHERE id = ${id} FOR UPDATE`;

        // 锁后重新读取 currentVersion，避免 READ COMMITTED 隔离级别下
        // 并发事务读到相同版本号导致版本号重复
        const docLocked = await tx.document.findFirst({
          where: { id, workspaceId: wid },
          select: { markdown: true, currentVersion: true },
        });
        if (!docLocked) return { kind: "notFound" as const, data: null };

        const version = docLocked.currentVersion + 1;
        // Phase 1 简化：所有版本存全量快照（snapshotType=full）
        // diff 增量存储留待后续优化（需引入 diff-match-patch 依赖）
        // contentFull 不传（Json? 字段默认 SQL NULL）；Phase 1 不存 JSON doc（富文本编辑器未集成）
        const created = await tx.documentVersion.create({
          data: {
            documentId: id,
            workspaceId: wid,
            version,
            snapshotType: "full",
            contentDiff: null,
            markdown: docLocked.markdown,
            message: validated.message ?? null,
            source: validated.source ?? "manual",
            authorId: ctx.payload.sub,
          },
          include: { author: { select: { id: true, name: true, email: true } } },
        });

        // 更新文档当前版本号
        await tx.document.update({
          where: { id },
          data: { currentVersion: version },
        });

        return { kind: "ok" as const, data: created };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "documentNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 201, data: result.data }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          code: 400,
          message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"),
          data: null,
          errors: error.errors,
        },
        { status: 400 },
      );
    }
    console.error("[POST document version] error:", error);
    return handlePrismaError(error, req);
  }
}