import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

/**
 * 单个联系人 API · /api/v1/workspaces/{wid}/contacts/{cid}
 *
 * - GET：获取联系人详情
 * - PATCH：更新联系人
 * - DELETE：删除联系人
 */

/** GET /v1/workspaces/{wid}/contacts/{cid} — 联系人详情 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; cid: string }> },
) {
  const { wid, cid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const contact = await runWithWorkspace(
      wid,
      (tx) =>
        tx.contact.findFirst({
          where: { id: cid, workspaceId: wid },
          include: {
            group: { select: { id: true, name: true } },
            creator: { select: { id: true, name: true, email: true } },
          },
        }),
      ctx.payload.sub,
    );

    if (!contact)
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "contactNotFound"), data: null },
        { status: 404 },
      );

    return NextResponse.json({ code: 200, data: contact });
  } catch (error) {
    console.error("[GET contact] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

const updateContactSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().max(255).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  department: z.string().max(100).nullable().optional(),
  position: z.string().max(100).nullable().optional(),
  avatar: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  groupId: z.string().uuid().nullable().optional(),
});

/** PATCH /v1/workspaces/{wid}/contacts/{cid} — 更新联系人 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; cid: string }> },
) {
  const { wid, cid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const validated = updateContactSchema.parse(await req.json());

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.contact.findFirst({
          where: { id: cid, workspaceId: wid },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const, data: null };

        const updated = await tx.contact.update({
          where: { id: cid },
          data: {
            ...(validated.name !== undefined ? { name: validated.name } : {}),
            ...(validated.email !== undefined ? { email: validated.email } : {}),
            ...(validated.phone !== undefined ? { phone: validated.phone } : {}),
            ...(validated.department !== undefined ? { department: validated.department } : {}),
            ...(validated.position !== undefined ? { position: validated.position } : {}),
            ...(validated.avatar !== undefined ? { avatar: validated.avatar } : {}),
            ...(validated.notes !== undefined ? { notes: validated.notes } : {}),
            ...(validated.groupId !== undefined ? { groupId: validated.groupId } : {}),
          },
        });
        return { kind: "ok" as const, data: updated };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "contactNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 200, data: result.data });
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
    console.error("[PATCH contact] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** DELETE /v1/workspaces/{wid}/contacts/{cid} — 删除联系人 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; cid: string }> },
) {
  const { wid, cid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.contact.findFirst({
          where: { id: cid, workspaceId: wid },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const };
        await tx.contact.delete({ where: { id: cid } });
        return { kind: "ok" as const };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "contactNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 200, data: { id: cid, deleted: true } });
  } catch (error) {
    console.error("[DELETE contact] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
