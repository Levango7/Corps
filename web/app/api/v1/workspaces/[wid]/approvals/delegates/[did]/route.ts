import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContextV2, runWithWorkspace } from "@/lib/auth";
import { authFailure } from "@/lib/auth-response";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

const updateDelegateSchema = z.object({
  active: z.boolean().optional(),
  endAt: z.string().datetime().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; did: string }> },
) {
  const { wid, did } = await params;
  const ctx = await getWorkspaceContextV2(req, wid);
  if (!ctx)
    // V2 契约上从不返回 null（见 lib/auth.ts 的 WorkspaceContextV2 文档：
    // "调用方遇到 null 应按 500 处理（fail-closed，不可当作 401 重试）"）。
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  if (!ctx.ok) return authFailure(ctx, req);

  try {
    const body = await req.json().catch(() => ({}));
    const validated = updateDelegateSchema.parse(body);

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const delegate = await tx.approvalDelegate.findUnique({ where: { id: did } });
        if (!delegate || delegate.workspaceId !== wid) return { kind: "notFound" as const };
        if (delegate.delegatorId !== ctx.payload.sub) return { kind: "forbidden" as const };

        const updated = await tx.approvalDelegate.update({
          where: { id: did },
          data: {
            ...(validated.active !== undefined ? { active: validated.active } : {}),
            ...(validated.endAt ? { endAt: new Date(validated.endAt) } : {}),
          },
          include: { delegateTo: { select: { id: true, name: true, email: true } } },
        });
        return { kind: "ok" as const, data: updated };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound")
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "approvalDelegateNotFound"), data: null },
        { status: 404 },
      );
    if (result.kind === "forbidden")
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "forbidden"), data: null },
        { status: 403 },
      );

    return NextResponse.json({ code: 200, data: result.data });
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json(
        {
          code: 400,
          message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"),
          data: null,
          errors: error.errors,
        },
        { status: 400 },
      );
    console.error("[PATCH approval-delegate] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; did: string }> },
) {
  const { wid, did } = await params;
  const ctx = await getWorkspaceContextV2(req, wid);
  if (!ctx)
    // V2 契约上从不返回 null（见 lib/auth.ts 的 WorkspaceContextV2 文档：
    // "调用方遇到 null 应按 500 处理（fail-closed，不可当作 401 重试）"）。
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  if (!ctx.ok) return authFailure(ctx, req);

  try {
    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const delegate = await tx.approvalDelegate.findUnique({ where: { id: did } });
        if (!delegate || delegate.workspaceId !== wid) return { kind: "notFound" as const };
        if (delegate.delegatorId !== ctx.payload.sub) return { kind: "forbidden" as const };

        await tx.approvalDelegate.delete({ where: { id: did } });
        return { kind: "ok" as const };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound")
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "approvalDelegateNotFound"), data: null },
        { status: 404 },
      );
    if (result.kind === "forbidden")
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "forbidden"), data: null },
        { status: 403 },
      );

    return NextResponse.json({ code: 200, data: null });
  } catch (error) {
    console.error("[DELETE approval-delegate] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
