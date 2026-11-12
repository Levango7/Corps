import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContextV2, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";
import { requirePermission } from "@/lib/permissions";
import { authFailure } from "@/lib/auth-response";
import { withRed } from "@/lib/red-metrics";
import { trackServerEvent } from "@/lib/analytics-server";

/** 状态机（设计文档 §4：拟稿→审核→签发→交换/归档）。A1 只许前进与归档，不回退。 */
const STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ["review", "archived"],
  review: ["signed", "archived"],
  signed: ["exchanged", "archived"],
  exchanged: ["archived"],
  archived: [],
};

const GOV_DOC_SELECT = {
  id: true,
  docNo: true,
  title: true,
  direction: true,
  secretLevel: true,
  urgency: true,
  source: true,
  destination: true,
  status: true,
  createdBy: true,
  remarks: true,
  createdAt: true,
  updatedAt: true,
  creator: { select: { id: true, name: true, email: true } },
  opinions: {
    select: {
      id: true,
      conclusion: true,
      content: true,
      createdAt: true,
      author: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "asc" as const },
  },
  exchanges: {
    select: {
      id: true,
      direction: true,
      channel: true,
      exchangedAt: true,
      note: true,
      createdAt: true,
    },
    orderBy: { exchangedAt: "desc" as const },
  },
  attachments: {
    select: { id: true, version: true, fileHash: true, previewRef: true, createdAt: true },
    orderBy: { version: "asc" as const },
  },
} satisfies Prisma.GovDocSelect;

/** GET /v1/workspaces/{wid}/gov-docs/{id} — 公文详情（含意见/交换/附件） */
async function getGovDoc(
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

  try {
    const govDoc = await runWithWorkspace(wid, (tx) =>
      tx.govDoc.findFirst({ where: { id, workspaceId: wid }, select: GOV_DOC_SELECT }),
    );
    if (!govDoc) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "govDocNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 200, data: govDoc });
  } catch (error) {
    console.error("[GET gov-docs/{id}] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** PATCH /v1/workspaces/{wid}/gov-docs/{id} — 更新字段 / 状态跃迁 */
const updateSchema = z.object({
  docNo: z.string().min(1).max(64).optional(),
  title: z.string().min(1).max(200).optional(),
  direction: z.enum(["incoming", "outgoing"]).optional(),
  secretLevel: z.enum(["internal", "secret", "confidential", "topsecret"]).optional(),
  urgency: z.enum(["normal", "urgent", "extraurgent"]).optional(),
  source: z.string().min(1).max(200).optional(),
  destination: z.string().min(1).max(200).optional(),
  status: z.enum(["draft", "review", "signed", "exchanged", "archived"]).optional(),
  remarks: z.string().optional(),
});

async function patchGovDoc(
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

  const denied = await requirePermission(ctx, "govDocs", "update", req);
  if (denied) return denied;

  try {
    const body = await req.json();
    const validated = updateSchema.parse(body);

    const existing = await runWithWorkspace(wid, (tx) =>
      tx.govDoc.findFirst({ where: { id, workspaceId: wid }, select: { id: true, status: true } }),
    );
    if (!existing) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "govDocNotFound"), data: null },
        { status: 404 },
      );
    }

    // 状态机校验：目标状态必须在当前状态的允许跃迁集合内
    if (validated.status && validated.status !== existing.status) {
      const allowed = STATUS_TRANSITIONS[existing.status] ?? [];
      if (!allowed.includes(validated.status)) {
        return NextResponse.json(
          {
            code: 400,
            message: apiMsg(req, "validationFailed"),
            errors: [
              {
                code: "invalid_state_transition",
                message: `status ${existing.status} -> ${validated.status} is not allowed`,
                path: ["status"],
              },
            ],
            data: null,
          },
          { status: 400 },
        );
      }
    }

    const govDoc = await runWithWorkspace(
      wid,
      (tx) =>
        tx.govDoc.update({
          where: { id, workspaceId: wid },
          data: {
            docNo: validated.docNo,
            title: validated.title,
            direction: validated.direction,
            secretLevel: validated.secretLevel,
            urgency: validated.urgency,
            source: validated.source,
            destination: validated.destination,
            status: validated.status,
            remarks: validated.remarks,
          },
          select: GOV_DOC_SELECT,
        }),
      ctx.payload.sub,
    );

    // 签发跃迁（→ signed）才发 gov_doc_signed；撤销/重复签发不发 ——
    // 与 decision_reviewed 同口径：分子要"被签发出的公文数"，不是点击次数。
    if (validated.status === "signed" && existing.status !== "signed") {
      await trackServerEvent({
        userId: ctx.payload.sub,
        workspaceId: wid,
        name: "gov_doc_signed",
        props: { direction: govDoc.direction, secretLevel: govDoc.secretLevel },
      });
    }

    return NextResponse.json({ code: 200, data: govDoc });
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
    console.error("[PATCH gov-docs/{id}] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** DELETE /v1/workspaces/{wid}/gov-docs/{id} — 删除公文（子资源随级联删除） */
async function deleteGovDoc(
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

  const denied = await requirePermission(ctx, "govDocs", "delete", req);
  if (denied) return denied;

  try {
    const deleted = await runWithWorkspace(
      wid,
      (tx) => tx.govDoc.deleteMany({ where: { id, workspaceId: wid } }),
      ctx.payload.sub,
    );
    if (deleted.count === 0) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "govDocNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 200, data: null });
  } catch (error) {
    console.error("[DELETE gov-docs/{id}] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

// ── RED 指标接线（Rate/Duration）：包装器见 lib/red-metrics.ts。
export const GET = withRed(getGovDoc);
export const PATCH = withRed(patchGovDoc);
export const DELETE = withRed(deleteGovDoc);
