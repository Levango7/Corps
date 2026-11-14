import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContextV2, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { requirePermission } from "@/lib/permissions";
import { authFailure } from "@/lib/auth-response";
import { withRed } from "@/lib/red-metrics";

/**
 * GET /v1/workspaces/{wid}/gov-docs/{id}/attachments — OFD 附件登记列表
 * 按 version ASC（版本升序）。
 *
 * 注意（设计文档 §8-1）：OFD 解析/预览选型**待核**，本端点只做附件**登记**
 * （版本/哈希/预览产物引用），不承诺渲染能力，能力清单不写「支持 OFD」。
 */
async function getAttachments(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  const { wid, id } = await params;
  const ctx = await getWorkspaceContextV2(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  if (!ctx.ok) return authFailure(ctx, req);

  const denied = await requirePermission(ctx, "govDocs", "read", req);
  if (denied) return denied;

  try {
    const items = await runWithWorkspace(wid, (tx) =>
      tx.govDocAttachment.findMany({
        where: { govDocId: id, workspaceId: wid },
        select: {
          id: true,
          version: true,
          fileHash: true,
          previewRef: true,
          createdAt: true,
        },
        orderBy: { version: "asc" },
      }),
    );
    return NextResponse.json({ code: 200, data: { items } });
  } catch (error) {
    console.error("[GET gov-docs/{id}/attachments] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * POST /v1/workspaces/{wid}/gov-docs/{id}/attachments — 登记 OFD 附件
 * version 缺省时取当前最大版本 +1；fileHash 按 sha256 hex 落库（算法口径随
 * OFD 选型定，设计文档 §8-1，先按 64 位 hex 校验）。
 */
const createAttachmentSchema = z.object({
  version: z.number().int().min(1).optional(),
  fileHash: z.string().min(1).max(128),
  previewRef: z.string().min(1).max(500).optional(),
});

async function postAttachment(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  const { wid, id } = await params;
  const ctx = await getWorkspaceContextV2(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  if (!ctx.ok) return authFailure(ctx, req);

  const denied = await requirePermission(ctx, "govDocs", "create", req);
  if (denied) return denied;

  try {
    const body = await req.json();
    const validated = createAttachmentSchema.parse(body);

    const govDoc = await runWithWorkspace(wid, (tx) =>
      tx.govDoc.findFirst({ where: { id, workspaceId: wid }, select: { id: true } }),
    );
    if (!govDoc) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "govDocNotFound"), data: null },
        { status: 404 },
      );
    }

    const attachment = await runWithWorkspace(
      wid,
      (tx) =>
        tx.govDocAttachment.create({
          data: {
            workspaceId: wid,
            govDocId: id,
            version: validated.version ?? 1,
            fileHash: validated.fileHash,
            previewRef: validated.previewRef ?? null,
          },
          select: {
            id: true,
            version: true,
            fileHash: true,
            previewRef: true,
            createdAt: true,
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 201, data: attachment }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          code: 400,
          message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"),
          data: null,
          errors: error.issues,
        },
        { status: 400 },
      );
    }
    console.error("[POST gov-docs/{id}/attachments] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

// ── RED 指标接线（Rate/Duration）：包装器见 lib/red-metrics.ts。
export const GET = withRed(getAttachments);
export const POST = withRed(postAttachment);
