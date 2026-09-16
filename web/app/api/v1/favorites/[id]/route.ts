// PATCH  /api/v1/favorites/[id]?wid=xxx — 更新收藏备注
//        Body: { note? }
// DELETE /api/v1/favorites/[id]?wid=xxx — 取消收藏
//
// 认证模式：getUserId → checkRateLimit → getWorkspaceContext → runWithWorkspace（RLS 事务）
// 安全：通过 workspaceId + userId + id 三重过滤确保用户只能操作自己的收藏
// 约定：{ code, data, message }
//
// 经验来源：2026-09-15-ai-route-unified-pattern-audit-checklist
//  - 越权风险：通过 where: { id, workspaceId, userId } 防止用户操作他人收藏

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getUserId,
  unauthorizedResponse,
} from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";

/** PATCH 更新收藏 schema（note 可选，传 null 清空） */
const updateSchema = z.object({
  note: z.string().max(200).nullable().optional(),
});

/** UUID 正则校验 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 从 URL 路径提取收藏 ID，并校验是否为合法 UUID */
function extractId(req: NextRequest): string | null {
  const segments = new URL(req.url).pathname.split("/");
  // 路径形如 /api/v1/favorites/{id}，取最后一段
  const id = segments[segments.length - 1];
  if (!id || !UUID_RE.test(id)) return null;
  return id;
}

/**
 * PATCH /api/v1/favorites/[id]?wid=xxx
 *
 * 更新指定收藏的备注字段。
 * 通过 workspaceId + userId + id 三重过滤确保只能操作自己的收藏。
 */
export async function PATCH(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：60s 内最多 30 次
  const limited = await checkRateLimit(req, "favorites-update", {
    windowMs: 60_000,
    max: 30,
  });
  if (limited) return limited;

  // 2) 参数提取
  const id = extractId(req);
  const wid = new URL(req.url).searchParams.get("wid");
  if (!id || !wid) {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidParams"), data: null },
      { status: 400 },
    );
  }

  // 3) body 校验
  let body: z.infer<typeof updateSchema>;
  try {
    body = updateSchema.parse(await req.json());
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

  // 4) 工作区成员资格认证 + 更新
  try {
    const ctx = await getWorkspaceContext(req, wid);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    // 构建更新数据（仅包含传入字段）
    const data: { note?: string | null } = {};
    if (body.note !== undefined) {
      data.note = body.note;
    }

    // 原子化更新：带 workspaceId + userId 条件，确保只能操作自己的收藏
    const result = await runWithWorkspace(
      wid,
      (tx) =>
        tx.favorite.updateMany({
          where: { id, workspaceId: wid, userId: ctx.payload.sub },
          data,
        }),
      ctx.payload.sub,
    );

    if (result.count === 0) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "favoriteNotFound"), data: null },
        { status: 404 },
      );
    }

    // 查询更新后的收藏返回给前端
    const updated = await runWithWorkspace(
      wid,
      (tx) =>
        tx.favorite.findUnique({
          where: { id },
          select: {
            id: true,
            targetType: true,
            targetId: true,
            note: true,
            createdAt: true,
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 0, data: updated, message: apiMsg(req, "ok") });
  } catch (error) {
    console.error("[PATCH favorites/[id]] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/v1/favorites/[id]?wid=xxx
 *
 * 取消收藏（删除指定收藏记录）。
 * 通过 workspaceId + userId + id 三重过滤确保只能删除自己的收藏。
 */
export async function DELETE(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：60s 内最多 30 次
  const limited = await checkRateLimit(req, "favorites-delete", {
    windowMs: 60_000,
    max: 30,
  });
  if (limited) return limited;

  // 2) 参数提取
  const id = extractId(req);
  const wid = new URL(req.url).searchParams.get("wid");
  if (!id || !wid) {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidParams"), data: null },
      { status: 400 },
    );
  }

  // 3) 工作区成员资格认证 + 删除
  try {
    const ctx = await getWorkspaceContext(req, wid);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    // 原子化删除：带 workspaceId + userId 条件，确保只能删除自己的收藏
    const result = await runWithWorkspace(
      wid,
      (tx) =>
        tx.favorite.deleteMany({
          where: { id, workspaceId: wid, userId: ctx.payload.sub },
        }),
      ctx.payload.sub,
    );

    if (result.count === 0) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "favoriteNotFound"), data: null },
        { status: 404 },
      );
    }

    return NextResponse.json({ code: 0, data: null, message: apiMsg(req, "ok") });
  } catch (error) {
    console.error("[DELETE favorites/[id]] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}