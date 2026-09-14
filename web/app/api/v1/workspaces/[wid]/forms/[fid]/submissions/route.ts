import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";

/**
 * GET /v1/workspaces/{wid}/forms/{fid}/submissions — 表单提交列表
 * Query: ?take=&skip= 分页
 * 返回按 submittedAt 降序
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string; fid: string }> }) {
  const { wid, fid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const url = new URL(req.url);
    const parsed = listQuerySchema.safeParse({
      take: url.searchParams.get("take") ?? undefined,
      skip: url.searchParams.get("skip") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationFailed"), errors: parsed.error.errors, data: null },
        { status: 400 },
      );
    }
    const { take, skip } = parsed.data;

    // 先确认表单存在且属于该工作区
    const form = await runWithWorkspace(
      wid,
      (tx) => tx.form.findUnique({ where: { id: fid }, select: { workspaceId: true } }),
      ctx.payload.sub,
    );
    if (!form || form.workspaceId !== wid) {
      return NextResponse.json({ code: 404, data: null, message: apiMsg(req, "formNotFound") }, { status: 404 });
    }

    const where = { formId: fid, workspaceId: wid };

    const [items, total] = await runWithWorkspace(wid, (tx) =>
      Promise.all([
        tx.formSubmission.findMany({
          where,
          select: {
            id: true,
            data: true,
            submittedAt: true,
            submitter: { select: { id: true, name: true, email: true } },
          },
          orderBy: [{ submittedAt: "desc" }],
          skip,
          take,
        }),
        tx.formSubmission.count({ where }),
      ]),
    );

    return NextResponse.json({ code: 0, data: { items, total, skip, take } });
  } catch (error) {
    console.error("[GET form submissions] error:", error);
    return NextResponse.json({ code: 500, data: null, message: apiMsg(req, "internalError") }, { status: 500 });
  }
}

const listQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(100).default(50),
  skip: z.coerce.number().int().min(0).default(0),
});

const createSubmissionSchema = z.object({
  data: z.record(z.string(), z.unknown()),
});

/** POST /v1/workspaces/{wid}/forms/{fid}/submissions — 提交表单 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string; fid: string }> }) {
  const { wid, fid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const body = await req.json();
    const validated = createSubmissionSchema.parse(body);

    // 先确认表单存在、属于该工作区且处于启用状态
    const form = await runWithWorkspace(
      wid,
      (tx) => tx.form.findUnique({ where: { id: fid }, select: { workspaceId: true, active: true } }),
      ctx.payload.sub,
    );
    if (!form || form.workspaceId !== wid) {
      return NextResponse.json({ code: 404, data: null, message: apiMsg(req, "formNotFound") }, { status: 404 });
    }
    if (!form.active) {
      return NextResponse.json({ code: 400, data: null, message: apiMsg(req, "validationFailed") }, { status: 400 });
    }

    const submission = await runWithWorkspace(
      wid,
      (tx) =>
        tx.formSubmission.create({
          data: {
            formId: fid,
            workspaceId: wid,
            data: validated.data as Prisma.InputJsonValue,
            submittedBy: ctx.payload.sub,
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 0, data: submission }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"), data: null, errors: error.errors },
        { status: 400 },
      );
    }
    console.error("[POST form submission] error:", error);
    return NextResponse.json({ code: 500, data: null, message: apiMsg(req, "internalError") }, { status: 500 });
  }
}