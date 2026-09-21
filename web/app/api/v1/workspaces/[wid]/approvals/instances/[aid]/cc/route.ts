import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

const ccSchema = z.object({
  ccUserIds: z.array(z.string().uuid()).min(1).max(50),
  nodeIndex: z.number().int().min(0).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; aid: string }> },
) {
  const { wid, aid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const validated = ccSchema.parse(body);

    const result = await runWithWorkspace(wid, async (tx) => {
      const instance = await tx.approvalInstance.findUnique({ where: { id: aid } });
      if (!instance || instance.workspaceId !== wid) return { kind: "notFound" as const };

      const nodeIndex = validated.nodeIndex ?? instance.currentNode;

      const members = await tx.member.findMany({ where: { userId: { in: validated.ccUserIds }, workspaceId: wid }, select: { userId: true } });
      const memberIds = new Set(members.map((m) => m.userId));
      const invalidIds = validated.ccUserIds.filter((id) => !memberIds.has(id));
      if (invalidIds.length > 0) return { kind: "targetNotFound" as const };

      const ccRecords = [];
      for (const ccUserId of validated.ccUserIds) {
        const existing = await tx.approvalCcRecord.findUnique({
          where: { instanceId_userId_nodeIndex: { instanceId: aid, userId: ccUserId, nodeIndex } },
        });
        if (!existing) {
          const record = await tx.approvalCcRecord.create({
            data: { instanceId: aid, workspaceId: wid, userId: ccUserId, nodeIndex },
          });
          ccRecords.push(record);
          await tx.notification.create({ data: { userId: ccUserId, workspaceId: wid, type: "approval_cc", entityId: aid, entityTitle: instance.title } });
        }
      }

      return { kind: "ok" as const, data: { ccRecords } };
    }, ctx.payload.sub);

    if (result.kind === "notFound") return NextResponse.json({ code: 404, message: apiMsg(req, "approvalNotFound"), data: null }, { status: 404 });
    if (result.kind === "targetNotFound") return NextResponse.json({ code: 403, message: apiMsg(req, "approvalCcTargetNotFound"), data: null }, { status: 403 });

    return NextResponse.json({ code: 200, data: result.data });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ code: 400, message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"), data: null, errors: error.errors }, { status: 400 });
    console.error("[POST approval-cc] error:", error);
    return NextResponse.json({ code: 500, data: null, message: apiMsg(req, "internalError") }, { status: 500 });
  }
}