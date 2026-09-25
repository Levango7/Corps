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
  // M1: 审批模式
  mode: z.enum(["sequential", "parallel", "countersign"]).optional(),
  /** countersign 模式下需要通过的最少审批人数 */
  requiredCount: z.number().int().min(1).optional(),
});

/** GET 列表 query 校验 */
const listInstancesQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "withdrawn"]).optional(),
  mine: z.literal("1").optional(),
  /** pendingMine=1：筛选当前用户是当前节点审批人且状态为 pending 的实例 */
  pendingMine: z.literal("1").optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** 审批节点类型（nodes JSON 快照中的单节点） */
interface ApprovalNode {
  approverRole?: string;
  approverUserId?: string;
  name: string;
  order: number;
  mode?: "sequential" | "parallel" | "countersign";
  requiredCount?: number;
}

/** 判断用户是否是当前节点的审批人 */
function isCurrentApprover(
  nodes: ApprovalNode[],
  currentNode: number,
  userId: string,
  userRole: string,
): boolean {
  const node = nodes[currentNode];
  if (!node) return false;
  return (
    node.approverUserId === userId ||
    (node.approverRole !== undefined && node.approverRole === userRole)
  );
}

/** POST 发起审批 body 校验 */
const createInstanceSchema = z.object({
  templateId: z.string().uuid().optional(),
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  content: z.record(z.any()),
  nodes: z.array(approvalNodeSchema).min(1).optional(),
  // M5: 工作流 approval 节点 — 从工作流节点配置自动生成审批流
  workflowNodeId: z.string().uuid().optional(),
});

/**
 * GET /v1/workspaces/{wid}/approvals/instances — 审批实例列表
 * Query: ?status=pending|approved|rejected|withdrawn&mine=1&pendingMine=1&page=1&limit=20
 * mine=1 时只返回当前用户发起的，按 submittedAt 倒序
 * pendingMine=1 时只返回当前用户是当前节点审批人且状态为 pending 的实例
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const url = new URL(req.url);
    const parsed = listInstancesQuerySchema.safeParse({
      status: url.searchParams.get("status") ?? undefined,
      mine: url.searchParams.get("mine") ?? undefined,
      pendingMine: url.searchParams.get("pendingMine") ?? undefined,
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
    const { status, mine, pendingMine, page, limit } = parsed.data;

    // pendingMine=1：当前用户是当前节点审批人且状态为 pending
    // 由于 nodes 是 JSON 字段，无法用 Prisma where 直接筛选，需在应用层过滤
    if (pendingMine === "1" && ctx.payload.sub) {
      const userId = ctx.payload.sub;
      const userRole = ctx.member.role;
      // 查询所有 pending 实例（含 nodes），在应用层过滤当前节点审批人
      const allPending = await runWithWorkspace(wid, (tx) =>
        tx.approvalInstance.findMany({
          where: { workspaceId: wid, status: "pending" },
          include: {
            applicant: { select: { id: true, name: true, email: true } },
          },
          orderBy: [{ submittedAt: "desc" }],
        }),
      );
      const filtered = allPending.filter((inst) => {
        const nodes = inst.nodes as unknown as ApprovalNode[];
        return isCurrentApprover(nodes, inst.currentNode, userId, userRole);
      });
      const total = filtered.length;
      const skip = (page - 1) * limit;
      const items = filtered.slice(skip, skip + limit);
      return NextResponse.json({
        code: 200,
        data: {
          items,
          page,
          limit,
          total,
          hasMore: page * limit < total,
          totalPages: Math.ceil(total / limit),
        },
      });
    }

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
      data: {
        items,
        page,
        limit,
        total,
        hasMore: page * limit < total,
        totalPages: Math.ceil(total / limit),
      },
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
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const body = await req.json();
    const validated = createInstanceSchema.parse(body);

    // 确定审批节点：有 templateId 从模板复制快照，否则用 body.nodes
    let nodes: z.infer<typeof approvalNodeSchema>[];
    let templateId: string | null = null;

    if (validated.workflowNodeId) {
      // M5: 从工作流节点配置自动生成审批流
      // workflowNodeId 是 Workflow 的 id，从 Workflow.actions 中找到 type="approval" 的 action
      const workflow = await runWithWorkspace(wid, (tx) =>
        tx.workflow.findUnique({ where: { id: validated.workflowNodeId! } }),
      );
      if (!workflow || workflow.workspaceId !== wid || !workflow.active) {
        return NextResponse.json(
          { code: 404, message: apiMsg(req, "workflowNotFound"), data: null },
          { status: 404 },
        );
      }
      // 从 actions JSON 中提取 type="approval" 的节点，转换为审批节点
      const actions = workflow.actions as unknown as Array<{
        type?: string;
        config?: Record<string, unknown>;
        order?: number;
      }>;
      const approvalActions = actions.filter((a) => a.type === "approval");
      if (approvalActions.length === 0) {
        return NextResponse.json(
          { code: 400, message: apiMsg(req, "validationFailed"), data: null },
          { status: 400 },
        );
      }
      nodes = approvalActions.map((a, idx) => ({
        approverRole: (a.config?.approverRole as string) || undefined,
        approverUserId: (a.config?.approverUserId as string) || undefined,
        name: (a.config?.name as string) || `Node ${idx + 1}`,
        order: a.order ?? idx,
        mode: (a.config?.mode as "sequential" | "parallel" | "countersign") || undefined,
        requiredCount: (a.config?.requiredCount as number) || undefined,
      }));
    } else if (validated.templateId) {
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
        {
          code: 400,
          message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"),
          data: null,
          errors: error.errors,
        },
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
