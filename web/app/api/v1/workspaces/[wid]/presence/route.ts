import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace, runWithAuthOp } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";

import { logger } from "@/lib/logger";

/**
 * M4 实时协作基础：工作区成员在线状态 API
 *
 * POST /v1/workspaces/{wid}/presence — 心跳：更新当前用户 onlineAt 时间戳
 * GET  /v1/workspaces/{wid}/presence — 查询工作区成员在线状态
 *
 * 在线判定：最近 5 分钟内有 heartbeat 的用户视为在线。
 * User.onlineAt 字段由本 API POST 定期更新（前端每 2 分钟发一次心跳）。
 *
 * 认证：getWorkspaceContext 校验工作区成员身份 + RLS 上下文。
 * RLS：通过 runWithWorkspace 注入工作区上下文，跨工作区请求被拦截。
 *
 * 注意：User 表受 FORCE RLS，onlineAt 更新需经 runWithWorkspace 注入租户上下文。
 * 但 User 表的 RLS 策略按成员资格判定（非 owner 关联），故用 runWithAuthOp("login")
 * 逃逸通道更稳妥——用户更新自己的 onlineAt 是身份级操作，不依赖工作区成员资格。
 * 此处采用 runWithWorkspace：成员资格已由 getWorkspaceContext 校验，且 RLS 策略
 * 允许成员读取同工作区其他成员的 onlineAt（用于 GET 查询）。
 */

/** 在线判定窗口：最近 5 分钟内有心跳记录视为在线 */
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

/**
 * POST /v1/workspaces/{wid}/presence — 心跳：更新当前用户 onlineAt
 *
 * 前端登录后每 2 分钟调用一次，刷新在线状态。
 * 响应：{ code: 0, data: { onlineAt: ISO }, message: "OK" }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string }> },
) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  try {
    const userId = ctx.payload.sub;
    const now = new Date();

    // 更新当前用户 onlineAt 时间戳。
    // User 表受 FORCE RLS，但用户更新自己的 onlineAt 是身份级操作，
    // 用 runWithAuthOp("login") 逃逸通道（与 login 流程同源，不依赖工作区成员资格）。
    await runWithAuthOp(
      "login",
      async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: { onlineAt: now },
        });
      },
      userId,
    );

    return NextResponse.json({
      code: 0,
      data: { onlineAt: now.toISOString() },
      message: apiMsg(req, "ok"),
    });
  } catch (error) {
    logger.error("[POST presence] error", { wid, error: String(error) });
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * GET /v1/workspaces/{wid}/presence — 查询工作区成员在线状态
 *
 * 查询工作区所有成员 + 其 onlineAt 时间戳，最近 5 分钟内有心跳的标记为在线。
 * 响应：{ code: 0, data: { items: [{ userId, name, image, role, online, onlineAt }], total, onlineCount }, message }
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string }> },
) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  try {
    const userId = ctx.payload.sub;
    const onlineThreshold = new Date(Date.now() - ONLINE_WINDOW_MS);

    // 查询工作区成员 + 用户基本信息 + onlineAt。
    // 经 runWithWorkspace 注入 RLS 上下文，成员表按 workspaceId 隔离。
    const members = await runWithWorkspace(
      wid,
      async (tx) => {
        return tx.member.findMany({
          where: { workspaceId: wid },
          select: {
            userId: true,
            role: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                image: true,
                onlineAt: true,
              },
            },
          },
          orderBy: { joinedAt: "asc" },
        });
      },
      userId,
    );

    const items = members.map((m) => ({
      userId: m.userId,
      name: m.user.name ?? m.user.email,
      image: m.user.image,
      role: m.role,
      online: !!m.user.onlineAt && m.user.onlineAt > onlineThreshold,
      onlineAt: m.user.onlineAt?.toISOString() ?? null,
    }));

    const onlineCount = items.filter((i) => i.online).length;

    return NextResponse.json({
      code: 0,
      data: { items, total: items.length, onlineCount },
      message: apiMsg(req, "ok"),
    });
  } catch (error) {
    logger.error("[GET presence] error", { wid, error: String(error) });
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}