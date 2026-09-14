import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

/** 审批节点配置 schema */
const approvalNodeSchema = z.object({
  approverRole: z.string().optional(),
  approverUserId: z.string().optional(),
  name: z.string().min(1).max(200),
  order: z.number().int().min(0),
});

/** GET 列表 query 校验 */
const listInstancesQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "withdrawn"]).optional(),
  mine: z.literal("1").optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** POST 发起审批 body 校验 */
const createInstanceSchema = z.object({
  templateId: z.string().uuid().optional(),
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  content: z.record(z.any()),
  nodes: z.array(approvalNodeSchema).min(1).optional(),
});

/**
 * GET /v1/workspaces/{wid}/approvals/instances — 审批实例列表
 * Query: ?status=pending|approved|rejected|withdrawn&mine=1&page=1&limit=20
 * mine=1 时只返回当前用户发起的，按 submittedAt 倒序
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const url = new URL(req.url);
    const parsed = listInstancesQuerySchema.safeParse({
      status: url.searchParams.get("status") ?? undefined,
      mine: url.searchParams.get("mine") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationFailed"), errors: parsed.error.errors, data: null },
        { status: 400 },
      );
    }
    const { status, mine, page, limit } = parsed.data;
    const skip = (page - 1) * limit;

    const where = {
      workspaceId: wid,
      ...(status ? { status } : {}),
      ...(mine === "1" && ctx.payload.sub ? { applicantId: ctx.payload.sub } : {}),
    };

    const [items, total] = await runWithWorkspace(wid, (tx) =>
      Promise.all([
        tx.approvalInstance.findMany({
          where,
          include: {
            applicant: { select: { id: true, name: true, email: true } },
          },
          orderBy: [{ submittedAt: "desc" }],
          skip,
          take: limit,
        }),
        tx.approvalInstance.count({ where }),
      ]),
    );

    return NextResponse.json({
      code: 200,
      data: { items, page, limit, total, hasMore: page * limit < total },
    });
  } catch (error) {
    console.error("[GET approval-instances] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * POST /v1/workspaces/{wid}/approvals/instances — 发起审批
 * Body: { templateId?, title, description?, content, nodes? }
 * 有 templateId 则从模板复制 nodes 快照；否则用 body 中的 nodes
 * applicantId 设为当前用户，status="pending", currentNode=0
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const body = await req.json();
    const validated = createInstanceSchema.parse(body);

    // 确定审批节点：有 templateId 从模板复制快照，否则用 body.nodes
    let nodes: z.infer<typeof approvalNodeSchema>[];
    let templateId: string | null = null;

    if (validated.templateId) {
      const template = await runWithWorkspace(wid, (tx) =>
        tx.approvalTemplate.findUnique({ where: { id: validated.templateId! } }),
      );
      if (!template || template.workspaceId !== wid || !template.active) {
        return NextResponse.json(
          { code: 404, message: apiMsg(req, "approvalTemplateNotFound"), data: null },
          { status: 404 },
        );
      }
      nodes = template.nodes as unknown as z.infer<typeof approvalNodeSchema>[];
      templateId = template.id;
    } else {
      if (!validated.nodes) {
        return NextResponse.json(
          { code: 400, message: apiMsg(req, "validationFailed"), data: null },
          { status: 400 },
        );
      }
      nodes = validated.nodes;
    }

    const instance = await runWithWorkspace(
      wid,
      (tx) =>
        tx.approvalInstance.create({
          data: {
            workspaceId: wid,
            templateId,
            title: validated.title,
            description: validated.description,
            applicantId: ctx.payload.sub,
            content: validated.content,
            status: "pending",
            currentNode: 0,
            nodes,
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 201, data: instance }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"), data: null, errors: error.errors },
        { status: 400 },
      );
    }
    console.error("[POST approval-instance] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}