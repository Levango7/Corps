import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions";
import { getWorkspaceContextV2, runWithWorkspace } from "@/lib/auth";
import { authFailure } from "@/lib/auth-response";
import { trackServerEvent } from "@/lib/analytics-server";
import { syncActionItems } from "@/lib/decision-action-parser";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

/** 免费版每工作区决策记录上限（v2 定价 r07：超出转只读保留，Pro 不受限） */
const FREE_DECISION_LIMIT = 10;

/** GET /v1/workspaces/{wid}/tasks/{id}/decisions — 决策记录（版本倒序，最新在前） */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  const { wid, id } = await params;
  const ctx = await getWorkspaceContextV2(req, wid);
  if (!ctx)
    // V2 契约上从不返回 null（见 lib/auth.ts 的 WorkspaceContextV2 文档：
    // "调用方遇到 null 应按 500 处理（fail-closed，不可当作 401 重试）"）。
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  if (!ctx.ok) return authFailure(ctx, req);

  // API-015：补 try-catch，避免 runWithWorkspace 抛错变成未处理异常
  try {
    const decisions = await runWithWorkspace(wid, (tx) =>
      tx.decision.findMany({
        where: { taskId: id, task: { workspaceId: wid } },
        include: { author: { select: { id: true, name: true, email: true } } },
        orderBy: { version: "desc" },
        // 上限保护：决策记录只追加不覆盖，取最近 100 个版本
        take: 100,
      }),
    );

    // R8C-06：统一分页响应格式（无分页参数，仅 items + total）
    return NextResponse.json({ code: 200, data: { items: decisions, total: decisions.length } });
  } catch (error) {
    console.error("[GET task decisions] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

const createDecisionSchema = z.object({
  markdown: z.string().min(1).max(50000),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  const { wid, id } = await params;
  const ctx = await getWorkspaceContextV2(req, wid);
  if (!ctx)
    // V2 契约上从不返回 null（见 lib/auth.ts 的 WorkspaceContextV2 文档：
    // "调用方遇到 null 应按 500 处理（fail-closed，不可当作 401 重试）"）。
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  if (!ctx.ok) return authFailure(ctx, req);

  // 角色门禁：lib/permissions.ts 声明 decisions 对 viewer 仅 "r"，此前只认证不判角色。
  const deniedRole = await requirePermission(ctx, "decisions", "create", req);
  if (deniedRole) return deniedRole;

  try {
    const validated = createDecisionSchema.parse(await req.json());

    const result = await runWithWorkspace(wid, async (tx) => {
      const task = await tx.task.findFirst({
        where: { id, workspaceId: wid },
        select: { id: true, assigneeId: true, title: true },
      });
      if (!task) return null;

      // v2 定价 r07：免费版每工作区保留最近 10 条决策记录（FAQ：超出转只读）。
      // 审计 P1-2：此限制此前只存在于定价文案，服务端零执行点。
      // 上限按工作区计（跨任务），与 /decisions 聚合列表同一口径。
      // 并发保护：事务级 advisory lock 按 workspace 串行化"计数+插入"
      //（与 conversation/上传清理同款模式，随事务结束自动释放）——不用
      // workspaces FOR UPDATE（那需要 seat 特权上下文，见 runWithSeatCheck），
      // 跨任务并发创建也串行过闸，不会超限。
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${wid}))`;
      const workspace = await tx.workspace.findUnique({
        where: { id: wid },
        select: { plan: true },
      });
      if (workspace?.plan !== "pro") {
        const decisionCount = await tx.decision.count({ where: { workspaceId: wid } });
        if (decisionCount >= FREE_DECISION_LIMIT) return { limited: true as const };
      }

      // 决策记录只追加不覆盖：版本号在事务内自增（AC-10 可追溯）
      // 并发保护：再对 Task 行加 FOR UPDATE 行锁，防止两个并发请求同时读到
      // 相同的 _max.version 导致版本号重复（来源：经验库 prisma-interactive-transaction）
      await tx.$queryRaw`SELECT id FROM "tasks" WHERE id = ${id}::uuid FOR UPDATE`;
      const agg = await tx.decision.aggregate({ where: { taskId: id }, _max: { version: true } });
      const version = (agg._max.version ?? 0) + 1;

      const created = await tx.decision.create({
        data: {
          task: { connect: { id } },
          workspace: { connect: { id: wid } },
          markdown: validated.markdown,
          version,
          author: { connect: { id: ctx.payload.sub } },
          versions: {
            create: {
              workspaceId: wid,
              markdown: validated.markdown,
              version,
              authorId: ctx.payload.sub,
            },
          },
        },
        include: { author: { select: { id: true, name: true, email: true } } },
      });

      // A-3: 通知 —— decision_updated（任务指派人，如果不是决策作者）
      if (task.assigneeId && task.assigneeId !== ctx.payload.sub) {
        await tx.notification.create({
          data: {
            userId: task.assigneeId,
            workspaceId: wid,
            type: "decision_updated",
            entityId: id,
            entityTitle: task.title,
          },
        });
      }

      // F1: 决策驱动执行 —— 在同一事务内自动解析并同步行动项（创建 Task + DecisionActionItem）
      const actionSync = await syncActionItems(
        tx,
        created.id,
        validated.markdown,
        wid,
        ctx.payload.sub,
      );

      return { decision: created, actionSync };
    });

    if (!result)
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "taskNotFound"), data: null },
        { status: 404 },
      );

    if ("limited" in result)
      // 402 + 定价文案：与席位门控同一出口语义（限额 → 提示升级）
      return NextResponse.json(
        { code: 402, message: apiMsg(req, "decisionLimitFree"), data: null },
        { status: 402 },
      );

    const { decision, actionSync } = result;

    // P2 数据埋点：create_decision 事件（不阻塞主流程）
    await trackServerEvent({
      userId: ctx.payload.sub,
      workspaceId: wid,
      name: "create_decision",
      props: { taskId: id, version: decision.version },
    });

    return NextResponse.json(
      { code: 201, data: { ...decision, actionItems: actionSync } },
      { status: 201 },
    );
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
    console.error("Create decision error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
