// GET  /api/v1/sync?workspaceId=xxx&since=timestamp — 增量拉取各模块变更
// POST /api/v1/sync — 批量上传本地变更（离线同步队列）
//
// 认证模式：getUserId → checkRateLimit → getWorkspaceContext → runWithWorkspace（RLS 事务）
// 安全：所有 DB 操作经 runWithWorkspace 注入 RLS，确保租户隔离
// 约定：{ code, data, message }
//
// 增量同步策略：
//  - GET：按 since（ms 时间戳）查询各模块 updatedAt/createdAt > since 的记录
//  - POST：按 module 分发，update 前先查远程 updatedAt 做冲突检测（LWW）
//
// 经验来源：2026-09-15-ai-route-unified-pattern-audit-checklist
//  - checkRateLimit 认证后立即调用
//  - DB 操作用 try-catch 包裹，catch 返回 503 internalError

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getUserId,
  unauthorizedResponse,
} from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";

/** 支持增量同步的模块 */
const SYNC_MODULES = ["task", "decision", "document", "notification"] as const;
type SyncModule = (typeof SYNC_MODULES)[number];

/** GET 查询参数 schema */
const getQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  since: z.coerce.number().int().min(0).default(0),
});

/** 单个同步操作 schema（POST body 中 operations 数组的元素） */
const operationSchema = z.object({
  id: z.string(),
  workspaceId: z.string().uuid(),
  module: z.enum(SYNC_MODULES),
  op: z.enum(["create", "update", "delete"]),
  targetId: z.string().uuid(),
  payload: z.unknown(),
  createdAt: z.number().int().min(0),
});

// ─── P1-fix: 各 module payload 具体校验 schema ────────────────
// 此前 payload 为 z.unknown() 完全未校验，客户端可注入任意结构数据。
// 现按 module 定义具体 schema，在 processOperation 分发前校验。

/** task 模块 payload schema */
const taskPayloadSchema = z.object({
  title: z.string().max(255).optional(),
  description: z.string().nullable().optional(),
  status: z.enum(["todo", "in_progress", "review", "done"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().optional(),
  parentId: z.string().uuid().nullable().optional(),
  milestoneId: z.string().uuid().nullable().optional(),
});

/** decision 模块 payload schema */
const decisionPayloadSchema = z.object({
  taskId: z.string().uuid().optional(),
  markdown: z.string().optional(),
  title: z.string().optional(),
  status: z.enum(["pending", "approved", "rejected", "withdrawn"]).optional(),
});

/** document 模块 payload schema */
const documentPayloadSchema = z.object({
  title: z.string().optional(),
  markdown: z.string().optional(),
  content: z.string().optional(),
});

/** notification 模块 payload schema */
const notificationPayloadSchema = z.object({
  read: z.boolean().optional(),
});

/** 各 module payload schema 映射（notification 由服务端生成，仍校验形状） */
const payloadSchemas: Record<SyncModule, z.ZodType> = {
  task: taskPayloadSchema,
  decision: decisionPayloadSchema,
  document: documentPayloadSchema,
  notification: notificationPayloadSchema,
};

/** POST body schema */
const postBodySchema = z.object({
  workspaceId: z.string().uuid(),
  operations: z.array(operationSchema).max(500), // 单次最多 500 个操作
});

/** 各模块增量变更响应 */
interface SyncChanges {
  task: unknown[];
  decision: unknown[];
  document: unknown[];
  notification: unknown[];
}

/**
 * GET /api/v1/sync?workspaceId=xxx&since=timestamp
 *
 * 增量拉取指定工作区自 since 以来的各模块变更。
 * since 为 ms 时间戳，0 表示全量拉取。
 *
 * 返回：{ changes: { task: [...], decision: [...], ... }, serverTime }
 */
export async function GET(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：60s 内最多 60 次
  const limited = await checkRateLimit(req, "sync-down", {
    windowMs: 60_000,
    max: 60,
  });
  if (limited) return limited;

  // 2) 查询参数校验
  const url = new URL(req.url);
  const parsed = getQuerySchema.safeParse({
    workspaceId: url.searchParams.get("workspaceId") ?? undefined,
    since: url.searchParams.get("since") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      {
        code: 400,
        message:
          parsed.error.issues[0]?.message ?? apiMsg(req, "invalidParams"),
        data: null,
      },
      { status: 400 },
    );
  }
  const { workspaceId, since } = parsed.data;
  const sinceDate = new Date(since);

  // 3) 工作区成员资格认证 + 增量查询
  try {
    const ctx = await getWorkspaceContext(req, workspaceId);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    // 并行查询各模块增量变更（均经 RLS 事务）
    const [tasks, decisions, documents, notifications] = await Promise.all([
      runWithWorkspace(
        workspaceId,
        (tx) =>
          tx.task.findMany({
            where: {
              workspaceId,
              updatedAt: { gt: sinceDate },
              deletedAt: null,
            },
            select: {
              id: true,
              title: true,
              status: true,
              priority: true,
              assigneeId: true,
              dueDate: true,
              sortOrder: true,
              parentId: true,
              milestoneId: true,
              blocked: true,
              createdAt: true,
              updatedAt: true,
            },
            orderBy: { updatedAt: "desc" },
            take: 500,
          }),
        ctx.payload.sub,
      ),
      runWithWorkspace(
        workspaceId,
        (tx) =>
          tx.decision.findMany({
            where: {
              workspaceId,
              updatedAt: { gt: sinceDate },
            },
            select: {
              id: true,
              taskId: true,
              markdown: true,
              version: true,
              authorId: true,
              createdAt: true,
              updatedAt: true,
            },
            orderBy: { updatedAt: "desc" },
            take: 500,
          }),
        ctx.payload.sub,
      ),
      runWithWorkspace(
        workspaceId,
        (tx) =>
          tx.document.findMany({
            where: {
              workspaceId,
              updatedAt: { gt: sinceDate },
            },
            select: {
              id: true,
              title: true,
              markdown: true,
              publishedAt: true,
              authorId: true,
              createdAt: true,
              updatedAt: true,
            },
            orderBy: { updatedAt: "desc" },
            take: 500,
          }),
        ctx.payload.sub,
      ),
      runWithWorkspace(
        workspaceId,
        (tx) =>
          tx.notification.findMany({
            where: {
              workspaceId,
              userId: ctx.payload.sub,
              createdAt: { gt: sinceDate },
            },
            select: {
              id: true,
              type: true,
              entityId: true,
              entityTitle: true,
              read: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
            take: 200,
          }),
        ctx.payload.sub,
      ),
    ]);

    const changes: SyncChanges = {
      task: tasks,
      decision: decisions,
      document: documents,
      notification: notifications,
    };

    return NextResponse.json({
      code: 0,
      data: {
        changes,
        serverTime: Date.now(),
      },
      message: apiMsg(req, "ok"),
    });
  } catch (error) {
    console.error("[GET sync] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * POST /api/v1/sync — 批量上传本地变更
 *
 * Body: { workspaceId, operations: SyncOperation[] }
 *
 * 处理逻辑：
 *  - 对每个操作，按 module + op 分发到对应 Prisma 操作
 *  - update 前先查远程记录的 updatedAt，若远程较新则加入 conflicts（LWW）
 *  - 成功执行的加入 accepted
 *
 * 返回：{ accepted: string[], conflicts: [{ id, remote }] }
 */
export async function POST(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：60s 内最多 30 次
  const limited = await checkRateLimit(req, "sync-up", {
    windowMs: 60_000,
    max: 30,
  });
  if (limited) return limited;

  // 2) body 校验
  let body: z.infer<typeof postBodySchema>;
  try {
    body = postBodySchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        {
          code: 400,
          message: e.issues[0]?.message ?? apiMsg(req, "validationFailed"),
          data: null,
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidBody"), data: null },
      { status: 400 },
    );
  }

  // 3) 工作区成员资格认证
  const ctx = await getWorkspaceContext(req, body.workspaceId);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  // 4) 逐个处理操作（冲突检测 + 写入）
  const accepted: string[] = [];
  const conflicts: Array<{ id: string; remote: unknown }> = [];

  try {
    for (const op of body.operations) {
      // 校验操作归属工作区一致（防跨工作区注入）
      if (op.workspaceId !== body.workspaceId) {
        // 不接受跨工作区操作，跳过（不记为冲突，直接忽略）
        continue;
      }

      // P1-fix: 按 module 校验 payload 结构，防客户端注入任意数据
      const payloadSchema = payloadSchemas[op.module];
      const payloadResult = payloadSchema.safeParse(op.payload);
      if (!payloadResult.success) {
        // payload 校验失败：跳过该操作，记录警告便于排查
        console.warn(
          `[POST sync] payload validation failed for op ${op.id} (module=${op.module}):`,
          payloadResult.error.issues[0]?.message,
        );
        continue;
      }
      // 用校验后的 payload 替换原始 payload（剥离未知字段）
      op.payload = payloadResult.data;

      const result = await processOperation(op, ctx.payload.sub);
      if (result.kind === "accepted") {
        accepted.push(op.id);
      } else if (result.kind === "conflict") {
        conflicts.push({ id: op.id, remote: result.remote });
      }
      // ignored: 不记录
    }

    return NextResponse.json({
      code: 0,
      data: { accepted, conflicts },
      message: apiMsg(req, "ok"),
    });
  } catch (error) {
    console.error("[POST sync] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * 处理单个同步操作：冲突检测 + 写入。
 *
 * @param op       同步操作
 * @param userId   当前用户 ID（用于审计字段）
 * @returns accepted | conflict | ignored
 */
async function processOperation(
  op: z.infer<typeof operationSchema>,
  userId: string,
): Promise<
  | { kind: "accepted" }
  | { kind: "conflict"; remote: unknown }
  | { kind: "ignored" }
> {
  const wid = op.workspaceId;
  const clientTs = new Date(op.createdAt);

  switch (op.module) {
    case "task":
      return processTaskOp(op, userId, wid, clientTs);
    case "decision":
      return processDecisionOp(op, userId, wid, clientTs);
    case "document":
      return processDocumentOp(op, userId, wid, clientTs);
    case "notification":
      // 通知由服务端生成，不接受客户端写操作
      return { kind: "ignored" };
    default:
      return { kind: "ignored" };
  }
}

/** 处理 task 模块操作 */
async function processTaskOp(
  op: z.infer<typeof operationSchema>,
  userId: string,
  wid: string,
  clientTs: Date,
): Promise<
  | { kind: "accepted" }
  | { kind: "conflict"; remote: unknown }
  | { kind: "ignored" }
> {
  if (op.op === "delete") {
    await runWithWorkspace(
      wid,
      (tx) =>
        tx.task.updateMany({
          where: { id: op.targetId, workspaceId: wid },
          data: { deletedAt: new Date(), deletedBy: userId },
        }),
      userId,
    );
    return { kind: "accepted" };
  }

  if (op.op === "create" || op.op === "update") {
    // 冲突检测：查远程 updatedAt
    const existing = await runWithWorkspace(
      wid,
      (tx) =>
        tx.task.findUnique({
          where: { id: op.targetId },
          select: { id: true, updatedAt: true, title: true, status: true },
        }),
      userId,
    );

    if (existing && op.op === "update") {
      // LWW：远程较新则冲突
      if (existing.updatedAt > clientTs) {
        return { kind: "conflict", remote: { ...existing, updatedAt: existing.updatedAt.toISOString() } };
      }
    }

    const payload = (op.payload ?? {}) as Record<string, unknown>;
    if (op.op === "create" && !existing) {
      await runWithWorkspace(
        wid,
        (tx) =>
          tx.task.create({
            data: {
              id: op.targetId,
              workspaceId: wid,
              title: String(payload.title ?? ""),
              description: payload.description != null ? String(payload.description) : null,
              status: String(payload.status ?? "todo"),
              priority: String(payload.priority ?? "medium"),
              assigneeId: payload.assigneeId != null ? String(payload.assigneeId) : null,
              dueDate: payload.dueDate != null ? new Date(String(payload.dueDate)) : null,
              sortOrder: typeof payload.sortOrder === "number" ? payload.sortOrder : 0,
              createdBy: userId,
              parentId: payload.parentId != null ? String(payload.parentId) : null,
              milestoneId: payload.milestoneId != null ? String(payload.milestoneId) : null,
            },
          }),
        userId,
      );
    } else if (op.op === "update" && existing) {
      const data: Record<string, unknown> = {};
      if (payload.title != null) data.title = String(payload.title);
      if (payload.description !== undefined) data.description = payload.description != null ? String(payload.description) : null;
      if (payload.status != null) data.status = String(payload.status);
      if (payload.priority != null) data.priority = String(payload.priority);
      if (payload.assigneeId !== undefined) data.assigneeId = payload.assigneeId != null ? String(payload.assigneeId) : null;
      if (payload.dueDate !== undefined) data.dueDate = payload.dueDate != null ? new Date(String(payload.dueDate)) : null;
      if (typeof payload.sortOrder === "number") data.sortOrder = payload.sortOrder;
      if (payload.parentId !== undefined) data.parentId = payload.parentId != null ? String(payload.parentId) : null;
      if (payload.milestoneId !== undefined) data.milestoneId = payload.milestoneId != null ? String(payload.milestoneId) : null;

      if (Object.keys(data).length > 0) {
        await runWithWorkspace(
          wid,
          (tx) =>
            tx.task.update({
              where: { id: op.targetId },
              data,
            }),
          userId,
        );
      }
    }
    return { kind: "accepted" };
  }

  return { kind: "ignored" };
}

/** 处理 decision 模块操作 */
async function processDecisionOp(
  op: z.infer<typeof operationSchema>,
  userId: string,
  wid: string,
  clientTs: Date,
): Promise<
  | { kind: "accepted" }
  | { kind: "conflict"; remote: unknown }
  | { kind: "ignored" }
> {
  if (op.op === "delete") {
    await runWithWorkspace(
      wid,
      (tx) => tx.decision.deleteMany({ where: { id: op.targetId, workspaceId: wid } }),
      userId,
    );
    return { kind: "accepted" };
  }

  if (op.op === "create" || op.op === "update") {
    const existing = await runWithWorkspace(
      wid,
      (tx) =>
        tx.decision.findUnique({
          where: { id: op.targetId },
          select: { id: true, updatedAt: true, markdown: true, version: true },
        }),
      userId,
    );

    if (existing && op.op === "update") {
      if (existing.updatedAt > clientTs) {
        return { kind: "conflict", remote: { ...existing, updatedAt: existing.updatedAt.toISOString() } };
      }
    }

    const payload = (op.payload ?? {}) as Record<string, unknown>;
    if (op.op === "create" && !existing) {
      await runWithWorkspace(
        wid,
        (tx) =>
          tx.decision.create({
            data: {
              id: op.targetId,
              workspaceId: wid,
              taskId: String(payload.taskId ?? ""),
              markdown: String(payload.markdown ?? ""),
              authorId: userId,
            },
          }),
        userId,
      );
    } else if (op.op === "update" && existing) {
      const data: Record<string, unknown> = {};
      if (typeof payload.markdown === "string") data.markdown = payload.markdown;
      if (Object.keys(data).length > 0) {
        await runWithWorkspace(
          wid,
          (tx) =>
            tx.decision.update({
              where: { id: op.targetId },
              data,
            }),
          userId,
        );
      }
    }
    return { kind: "accepted" };
  }

  return { kind: "ignored" };
}

/** 处理 document 模块操作 */
async function processDocumentOp(
  op: z.infer<typeof operationSchema>,
  userId: string,
  wid: string,
  clientTs: Date,
): Promise<
  | { kind: "accepted" }
  | { kind: "conflict"; remote: unknown }
  | { kind: "ignored" }
> {
  if (op.op === "delete") {
    await runWithWorkspace(
      wid,
      (tx) => tx.document.deleteMany({ where: { id: op.targetId, workspaceId: wid } }),
      userId,
    );
    return { kind: "accepted" };
  }

  if (op.op === "create" || op.op === "update") {
    const existing = await runWithWorkspace(
      wid,
      (tx) =>
        tx.document.findUnique({
          where: { id: op.targetId },
          select: { id: true, updatedAt: true, title: true, markdown: true },
        }),
      userId,
    );

    if (existing && op.op === "update") {
      if (existing.updatedAt > clientTs) {
        return { kind: "conflict", remote: { ...existing, updatedAt: existing.updatedAt.toISOString() } };
      }
    }

    const payload = (op.payload ?? {}) as Record<string, unknown>;
    if (op.op === "create" && !existing) {
      await runWithWorkspace(
        wid,
        (tx) =>
          tx.document.create({
            data: {
              id: op.targetId,
              workspaceId: wid,
              title: String(payload.title ?? ""),
              markdown: String(payload.markdown ?? ""),
              authorId: userId,
            },
          }),
        userId,
      );
    } else if (op.op === "update" && existing) {
      const data: Record<string, unknown> = {};
      if (typeof payload.title === "string") data.title = payload.title;
      if (typeof payload.markdown === "string") data.markdown = payload.markdown;
      if (Object.keys(data).length > 0) {
        await runWithWorkspace(
          wid,
          (tx) =>
            tx.document.update({
              where: { id: op.targetId },
              data,
            }),
          userId,
        );
      }
    }
    return { kind: "accepted" };
  }

  return { kind: "ignored" };
}