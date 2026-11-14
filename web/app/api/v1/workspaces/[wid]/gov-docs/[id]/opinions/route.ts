import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContextV2, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { requirePermission } from "@/lib/permissions";
import { authFailure } from "@/lib/auth-response";
import { withRed } from "@/lib/red-metrics";

/**
 * GET /v1/workspaces/{wid}/gov-docs/{id}/opinions — 流程意见列表（审核留痕）
 * 按 createdAt ASC（意见按时间正序读，还原审核过程）。
 */
async function getOpinions(
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
      tx.govDocOpinion.findMany({
        where: { govDocId: id, workspaceId: wid },
        select: {
          id: true,
          conclusion: true,
          content: true,
          createdAt: true,
          authorId: true,
          author: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
    );
    return NextResponse.json({ code: 200, data: { items } });
  } catch (error) {
    console.error("[GET gov-docs/{id}/opinions] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** POST /v1/workspaces/{wid}/gov-docs/{id}/opinions — 提交流程意见（审核留痕） */
const createOpinionSchema = z.object({
  conclusion: z.enum(["agree", "reject", "amend"]),
  content: z.string().min(1),
});

async function postOpinion(
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
    const validated = createOpinionSchema.parse(body);

    const govDoc = await runWithWorkspace(wid, (tx) =>
      tx.govDoc.findFirst({ where: { id, workspaceId: wid }, select: { id: true } }),
    );
    if (!govDoc) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "govDocNotFound"), data: null },
        { status: 404 },
      );
    }

    const opinion = await runWithWorkspace(
      wid,
      (tx) =>
        tx.govDocOpinion.create({
          data: {
            workspaceId: wid,
            govDocId: id,
            authorId: ctx.payload.sub,
            conclusion: validated.conclusion,
            content: validated.content,
          },
          select: {
            id: true,
            conclusion: true,
            content: true,
            createdAt: true,
            authorId: true,
            author: { select: { id: true, name: true, email: true } },
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 201, data: opinion }, { status: 201 });
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
    console.error("[POST gov-docs/{id}/opinions] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

// ── RED 指标接线（Rate/Duration）：包装器见 lib/red-metrics.ts。
export const GET = withRed(getOpinions);
export const POST = withRed(postOpinion);
