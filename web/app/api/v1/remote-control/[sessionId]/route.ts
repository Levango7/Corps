// PATCH /api/v1/remote-control/[sessionId] — 接受/拒绝/结束远程控制请求
// DELETE /api/v1/remote-control/[sessionId] — 结束会话
//
// 会话状态机：
//   pending ──accept──→ active ──end──→ ended
//   pending ──reject──→ rejected
//   active  ──end───→ ended
//   active  ──(超时)──→ ended (由 API 层校验 expiresAt)
//
// 权限：
//  - accept/reject：仅目标方（targetId）可操作
//  - end：发起方或目标方均可
//
// 认证模式：getUserId → checkRateLimit → getWorkspaceContext → runWithWorkspace（RLS 事务）
// 约定：{ code, data, message } 信封

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import { emitSessionEvent } from "@/lib/webrtc/remote-control-events";

// ─── Schema ────────────────────────────────────────────────────

/** PATCH body：接受/拒绝/结束 */
const patchBodySchema = z.object({
  action: z.enum(["accept", "reject", "end"]),
  reason: z.string().max(200).optional(),
});

// ─── 响应类型 ──────────────────────────────────────────────────

/** 远程控制会话 DTO */
interface RemoteControlSessionDTO {
  id: string;
  workspaceId: string;
  initiatorId: string;
  targetId: string;
  status: string;
  endReason: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 将 Prisma 会话记录转换为 DTO */
function toDTO(s: {
  id: string;
  workspaceId: string;
  initiatorId: string;
  targetId: string;
  status: string;
  endReason: string | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): RemoteControlSessionDTO {
  return {
    id: s.id,
    workspaceId: s.workspaceId,
    initiatorId: s.initiatorId,
    targetId: s.targetId,
    status: s.status,
    endReason: s.endReason,
    expiresAt: s.expiresAt.toISOString(),
    acceptedAt: s.acceptedAt?.toISOString() ?? null,
    endedAt: s.endedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

// ─── PATCH：接受/拒绝/结束 ────────────────────────────────────

/**
 * PATCH /api/v1/remote-control/[sessionId]
 *
 * Body: { action: "accept" | "reject" | "end", reason?: string }
 *
 * - accept：目标方接受远程控制请求，会话状态 pending → active
 * - reject：目标方拒绝远程控制请求，会话状态 pending → rejected
 * - end：任一参与方结束会话，会话状态 active → ended
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;

  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流
  const limited = await checkRateLimit(req, "remote-control-patch", {
    windowMs: 60_000,
    max: 30,
  });
  if (limited) return limited;

  // 2) body 校验
  let body: z.infer<typeof patchBodySchema>;
  try {
    const raw = await req.json();
    const parsed = patchBodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: 400,
          message:
            parsed.error.issues[0]?.message ?? apiMsg(req, "invalidBody"),
          data: null,
        },
        { status: 400 },
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidBody"), data: null },
      { status: 400 },
    );
  }

  const { action, reason } = body;

  // 3) 查询会话并校验权限
  try {
    // 先无事务查询会话基本信息（用于权限判断）
    // 注意：此处需要 workspaceId 才能用 getWorkspaceContext，先从会话记录获取
    // 但会话查询本身需要 RLS 上下文。采用 auth_op 逃逸通道读取会话记录。
    // 简化方案：从 query param 获取 workspaceId（前端调用时传入）。
    // 这里从 URL search params 获取 workspaceId。
    const url = new URL(req.url);
    const workspaceId = url.searchParams.get("workspaceId");
    if (!workspaceId) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "invalidParams"), data: null },
        { status: 400 },
      );
    }

    const ctx = await getWorkspaceContext(req, workspaceId);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    const currentUserId = ctx.payload.sub;

    // 在 RLS 事务内查询并更新会话
    const result = await runWithWorkspace(
      workspaceId,
      async (tx) => {
        // 查询会话
        const session = await tx.remoteControlSession.findUnique({
          where: { id: sessionId },
        });

        if (!session) {
          return { error: "notFound" as const };
        }

        // 校验当前用户是会话参与方
        const isInitiator = session.initiatorId === currentUserId;
        const isTarget = session.targetId === currentUserId;
        if (!isInitiator && !isTarget) {
          return { error: "notParticipant" as const };
        }

        // 校验会话未过期
        if (session.expiresAt < new Date()) {
          // 自动标记为过期结束
          await tx.remoteControlSession.update({
            where: { id: sessionId },
            data: {
              status: "ended",
              endReason: "expired",
              endedAt: new Date(),
            },
          });
          return { error: "expired" as const };
        }

        // 按 action 分发
        if (action === "accept") {
          // 仅目标方可接受
          if (!isTarget) {
            return { error: "notTarget" as const };
          }
          // 仅 pending 状态可接受
          if (session.status !== "pending") {
            return { error: "alreadyProcessed" as const };
          }
          const updated = await tx.remoteControlSession.update({
            where: { id: sessionId },
            data: {
              status: "active",
              acceptedAt: new Date(),
            },
          });
          return { error: null, session: updated, event: "accepted" };
        }

        if (action === "reject") {
          // 仅目标方可拒绝
          if (!isTarget) {
            return { error: "notTarget" as const };
          }
          // 仅 pending 状态可拒绝
          if (session.status !== "pending") {
            return { error: "alreadyProcessed" as const };
          }
          const updated = await tx.remoteControlSession.update({
            where: { id: sessionId },
            data: {
              status: "rejected",
              endReason: reason ?? "rejected",
              endedAt: new Date(),
            },
          });
          return { error: null, session: updated, event: "rejected" };
        }

        // action === "end"
        // 仅 active 状态可结束
        if (session.status !== "active") {
          return { error: "alreadyProcessed" as const };
        }
        const updated = await tx.remoteControlSession.update({
          where: { id: sessionId },
          data: {
            status: "ended",
            endReason: reason ?? "ended",
            endedAt: new Date(),
          },
        });
        return { error: null, session: updated, event: "ended" };
      },
      currentUserId,
    );

    // 处理错误
    if (result.error) {
      const errorMap: Record<string, { code: number; status: number; key: Parameters<typeof apiMsg>[1] }> = {
        notFound: { code: 404, status: 404, key: "remoteControlSessionNotFound" },
        notParticipant: { code: 403, status: 403, key: "remoteControlNotParticipant" },
        notTarget: { code: 403, status: 403, key: "remoteControlNotTarget" },
        expired: { code: 410, status: 410, key: "remoteControlSessionExpired" },
        alreadyProcessed: { code: 409, status: 409, key: "remoteControlAlreadyProcessed" },
      };
      const err = errorMap[result.error];
      if (err) {
        return NextResponse.json(
          { code: err.code, message: apiMsg(req, err.key), data: null },
          { status: err.status },
        );
      }
    }

    // 4) 通过会话事件总线通知双方
    const session = result.session!;
    if (result.event === "accepted") {
      emitSessionEvent(session.initiatorId, session.targetId, {
        type: "session-accepted",
        session: toDTO(session),
      });
    } else if (result.event === "rejected") {
      emitSessionEvent(session.initiatorId, session.targetId, {
        type: "session-rejected",
        session: toDTO(session),
        reason: reason,
      });
    } else if (result.event === "ended") {
      emitSessionEvent(session.initiatorId, session.targetId, {
        type: "session-ended",
        session: toDTO(session),
        reason: reason,
      });
    }

    // 5) 返回更新后的会话 DTO
    return NextResponse.json({
      code: 0,
      data: toDTO(session),
      message: apiMsg(req, "ok"),
    });
  } catch (error) {
    console.error("[PATCH remote-control] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

// ─── DELETE：结束会话 ────────────────────────────────────────

/**
 * DELETE /api/v1/remote-control/[sessionId]?workspaceId=xxx
 *
 * 结束远程控制会话。任一参与方可调用。
 * 等价于 PATCH { action: "end" }。
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;

  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流
  const limited = await checkRateLimit(req, "remote-control-delete", {
    windowMs: 60_000,
    max: 30,
  });
  if (limited) return limited;

  // 2) 获取 workspaceId
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidParams"), data: null },
      { status: 400 },
    );
  }

  // 3) 结束会话
  try {
    const ctx = await getWorkspaceContext(req, workspaceId);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    const currentUserId = ctx.payload.sub;

    const result = await runWithWorkspace(
      workspaceId,
      async (tx) => {
        const session = await tx.remoteControlSession.findUnique({
          where: { id: sessionId },
        });

        if (!session) {
          return { error: "notFound" as const };
        }

        // 校验参与方
        const isInitiator = session.initiatorId === currentUserId;
        const isTarget = session.targetId === currentUserId;
        if (!isInitiator && !isTarget) {
          return { error: "notParticipant" as const };
        }

        // 已结束的会话直接返回
        if (session.status === "ended" || session.status === "rejected") {
          return { error: null, session, event: null };
        }

        // 结束会话
        const updated = await tx.remoteControlSession.update({
          where: { id: sessionId },
          data: {
            status: "ended",
            endReason: "ended",
            endedAt: new Date(),
          },
        });
        return { error: null, session: updated, event: "ended" };
      },
      currentUserId,
    );

    if (result.error) {
      const errorMap: Record<string, { code: number; status: number; key: Parameters<typeof apiMsg>[1] }> = {
        notFound: { code: 404, status: 404, key: "remoteControlSessionNotFound" },
        notParticipant: { code: 403, status: 403, key: "remoteControlNotParticipant" },
      };
      const err = errorMap[result.error];
      if (err) {
        return NextResponse.json(
          { code: err.code, message: apiMsg(req, err.key), data: null },
          { status: err.status },
        );
      }
    }

    // 通知双方
    if (result.event === "ended") {
      emitSessionEvent(result.session!.initiatorId, result.session!.targetId, {
        type: "session-ended",
        session: toDTO(result.session!),
        reason: "ended",
      });
    }

    return NextResponse.json({
      code: 0,
      data: toDTO(result.session!),
      message: apiMsg(req, "ok"),
    });
  } catch (error) {
    console.error("[DELETE remote-control] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}