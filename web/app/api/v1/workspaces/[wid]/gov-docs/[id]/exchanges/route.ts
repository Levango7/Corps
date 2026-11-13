import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContextV2, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { requirePermission } from "@/lib/permissions";
import { authFailure } from "@/lib/auth-response";
import { withRed } from "@/lib/red-metrics";
import { trackServerEvent } from "@/lib/analytics-server";

/**
 * GET /v1/workspaces/{wid}/gov-docs/{id}/exchanges — 交换记录列表（收发留痕）
 * 按 exchangedAt DESC（最近交换在前）。
 */
async function getExchanges(
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
      tx.govDocExchange.findMany({
        where: { govDocId: id, workspaceId: wid },
        select: {
          id: true,
          direction: true,
          channel: true,
          operatorId: true,
          exchangedAt: true,
          note: true,
          createdAt: true,
          operator: { select: { id: true, name: true, email: true } },
        },
        orderBy: { exchangedAt: "desc" },
      }),
    );
    return NextResponse.json({ code: 200, data: { items } });
  } catch (error) {
    console.error("[GET gov-docs/{id}/exchanges] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** POST /v1/workspaces/{wid}/gov-docs/{id}/exchanges — 登记一次交换（收发留痕） */
const createExchangeSchema = z.object({
  direction: z.enum(["incoming", "outgoing"]).optional(),
  channel: z.string().min(1).max(50),
  exchangedAt: z.string().datetime().optional(),
  note: z.string().optional(),
});

async function postExchange(
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
    const validated = createExchangeSchema.parse(body);

    const govDoc = await runWithWorkspace(wid, (tx) =>
      tx.govDoc.findFirst({ where: { id, workspaceId: wid }, select: { id: true } }),
    );
    if (!govDoc) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "govDocNotFound"), data: null },
        { status: 404 },
      );
    }

    const exchange = await runWithWorkspace(
      wid,
      (tx) =>
        tx.govDocExchange.create({
          data: {
            workspaceId: wid,
            govDocId: id,
            direction: validated.direction ?? "incoming",
            channel: validated.channel,
            operatorId: ctx.payload.sub,
            exchangedAt: validated.exchangedAt ? new Date(validated.exchangedAt) : new Date(),
            note: validated.note ?? null,
          },
          select: {
            id: true,
            direction: true,
            channel: true,
            operatorId: true,
            exchangedAt: true,
            note: true,
            createdAt: true,
            operator: { select: { id: true, name: true, email: true } },
          },
        }),
      ctx.payload.sub,
    );

    // 事件面（设计文档 §7）：交换留痕落库 = gov_doc_exchanged。
    await trackServerEvent({
      userId: ctx.payload.sub,
      workspaceId: wid,
      name: "gov_doc_exchanged",
      props: { direction: exchange.direction, channel: exchange.channel },
    });

    return NextResponse.json({ code: 201, data: exchange }, { status: 201 });
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
    console.error("[POST gov-docs/{id}/exchanges] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

// ── RED 指标接线（Rate/Duration）：包装器见 lib/red-metrics.ts。
export const GET = withRed(getExchanges);
export const POST = withRed(postExchange);
