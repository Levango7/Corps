// POST /api/v1/remote-control — 创建远程控制请求
// GET  /api/v1/remote-control?workspaceId=xxx — 获取活跃的远程控制会话列表
//
// 远程控制允许用户请求控制另一用户的屏幕（WebRTC 屏幕共享 + 输入事件传输）。
// 会话生命周期：pending（等待接受）→ active（进行中）→ ended/rejected/failed
//
// 安全：
//  - 认证 + 工作区隔离（getWorkspaceContext + runWithWorkspace）
//  - 不能向自己发起远程控制
//  - 会话超时 30 分钟自动过期
//  - 目标用户必须明确接受才能建立连接
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

// ─── 常量 ──────────────────────────────────────────────────────

/** 会话超时时间：30 分钟 */
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

// ─── Schema ────────────────────────────────────────────────────

/** 创建远程控制请求 body */
const createBodySchema = z.object({
  targetUserId: z.string().uuid(),
  workspaceId: z.string().uuid(),
});

/** 列表查询参数 */
const listQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  /** 筛选角色：initiator（我发起的）| target（发给我的）| all（两者都包含，默认） */
  role: z.enum(["initiator", "target", "all"]).default("all"),
  /** 筛选状态：active（进行中）| pending（等待接受）| all（所有未结束，默认） */
  status: z.enum(["active", "pending", "all"]).default("all"),
});

// ─── 响应类型 ──────────────────────────────────────────────────

/** 远程控制会话 DTO（返回给前端） */
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

// ─── POST：创建远程控制请求 ────────────────────────────────────

/**
 * POST /api/v1/remote-control
 *
 * 创建远程控制请求。目标用户会收到实时通知（通过会话事件总线），
 * 需明确接受后才能建立 WebRTC 连接。
 */
export async function POST(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：60s 内最多 10 次（远程控制是低频操作）
  const limited = await checkRateLimit(req, "remote-control-create", {
    windowMs: 60_000,
    max: 10,
  });
  if (limited) return limited;

  // 2) body 校验
  let body: z.infer<typeof createBodySchema>;
  try {
    const raw = await req.json();
    const parsed = createBodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: 400,
          message: parsed.error.issues[0]?.message ?? apiMsg(req, "invalidBody"),
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

  const { targetUserId, workspaceId } = body;

  // 3) 不能向自己发起远程控制
  if (targetUserId === userId) {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "remoteControlCannotSelf"), data: null },
      { status: 400 },
    );
  }

  // 4) 工作区成员资格认证 + 创建会话
  try {
    const ctx = await getWorkspaceContext(req, workspaceId);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    const currentUserId = ctx.payload.sub;
    const expiresAt = new Date(Date.now() + SESSION_TIMEOUT_MS);

    // 在 RLS 事务内创建会话记录
    const session = await runWithWorkspace(
      workspaceId,
      async (tx) => {
        // 校验目标用户是工作区成员（通过 member 查询，受 RLS 约束）
        const targetMember = await tx.member.findFirst({
          where: { userId: targetUserId, workspaceId },
          select: { userId: true },
        });
        if (!targetMember) {
          return { error: "notMember" as const };
        }

        // 创建会话记录
        const created = await tx.remoteControlSession.create({
          data: {
            workspaceId,
            initiatorId: currentUserId,
            targetId: targetUserId,
            status: "pending",
            expiresAt,
          },
        });

        return { error: null, session: created };
      },
      currentUserId,
    );

    if (session.error === "notMember") {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "notMemberOfWorkspace"), data: null },
        { status: 400 },
      );
    }

    // 5) 通过会话事件总线通知目标用户（实时弹出请求对话框）
    emitSessionEvent(currentUserId, targetUserId, {
      type: "session-created",
      session: {
        id: session.session!.id,
        workspaceId,
        initiatorId: currentUserId,
        targetId: targetUserId,
        status: "pending",
        expiresAt: expiresAt.toISOString(),
      },
    });

    // 6) 返回会话 DTO
    const dto: RemoteControlSessionDTO = {
      id: session.session!.id,
      workspaceId: session.session!.workspaceId,
      initiatorId: session.session!.initiatorId,
      targetId: session.session!.targetId,
      status: session.session!.status,
      endReason: session.session!.endReason,
      expiresAt: session.session!.expiresAt.toISOString(),
      acceptedAt: session.session!.acceptedAt?.toISOString() ?? null,
      endedAt: session.session!.endedAt?.toISOString() ?? null,
      createdAt: session.session!.createdAt.toISOString(),
      updatedAt: session.session!.updatedAt.toISOString(),
    };

    return NextResponse.json({ code: 0, data: dto, message: apiMsg(req, "ok") }, { status: 201 });
  } catch (error) {
    console.error("[POST remote-control] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

// ─── GET：获取活跃的远程控制会话列表 ──────────────────────────

/**
 * GET /api/v1/remote-control?workspaceId=xxx[&role=all][&status=all]
 *
 * 返回当前用户在指定工作区的远程控制会话列表。
 */
export async function GET(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：60s 内最多 60 次
  const limited = await checkRateLimit(req, "remote-control-list", {
    windowMs: 60_000,
    max: 60,
  });
  if (limited) return limited;

  // 2) 查询参数校验
  const url = new URL(req.url);
  const parsed = listQuerySchema.safeParse({
    workspaceId: url.searchParams.get("workspaceId") ?? undefined,
    role: url.searchParams.get("role") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      {
        code: 400,
        message: parsed.error.issues[0]?.message ?? apiMsg(req, "invalidParams"),
        data: null,
      },
      { status: 400 },
    );
  }
  const { workspaceId, role, status } = parsed.data;

  // 3) 工作区成员资格认证 + 查询会话列表
  try {
    const ctx = await getWorkspaceContext(req, workspaceId);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    const currentUserId = ctx.payload.sub;

    // 构建查询条件
    const where: {
      workspaceId: string;
      OR?: Array<{ initiatorId?: string; targetId?: string }>;
      status?: string | { in: string[] };
    } = { workspaceId };

    // 角色筛选
    if (role === "initiator") {
      where.OR = [{ initiatorId: currentUserId }];
    } else if (role === "target") {
      where.OR = [{ targetId: currentUserId }];
    } else {
      where.OR = [{ initiatorId: currentUserId }, { targetId: currentUserId }];
    }

    // 状态筛选
    if (status === "active") {
      where.status = "active";
    } else if (status === "pending") {
      where.status = "pending";
    } else {
      // all：返回所有未结束的会话（pending + active）
      where.status = { in: ["pending", "active"] };
    }

    const sessions = await runWithWorkspace(
      workspaceId,
      (tx) =>
        tx.remoteControlSession.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: 50,
        }),
      currentUserId,
    );

    // 转换为 DTO
    const dtos: RemoteControlSessionDTO[] = sessions.map((s) => ({
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
    }));

    return NextResponse.json({ code: 0, data: dtos, message: apiMsg(req, "ok") });
  } catch (error) {
    console.error("[GET remote-control] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
