import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions";
import { getWorkspaceContextV2, runWithWorkspace } from "@/lib/auth";
import { authFailure } from "@/lib/auth-response";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { trackServerEvent } from "@/lib/analytics-server";

/**
 * POST /v1/workspaces/{wid}/tasks/{id}/decisions/{did}/review
 *
 * 人工标记「已复盘」。body: `{ reviewed?: boolean }`，缺省 true（撤销传 false）。
 *
 * ## 为什么复盘要单独一个端点，而不是塞进已有的 PATCH .../decisions/{did}
 *
 * 那个 PATCH 语义是"编辑内容 → version + 1"，带乐观锁 `baseVersion` 与免费版
 * "最近 10 条可编辑"的 402 窗口。复盘既不改内容也不该进版本链：
 *  - 塞进去会让"只点一下复盘"也要传 baseVersion，UI 得先拉最新版本；
 *  - 还会把老决策的复盘卡在免费版窗口外（402），而"回看旧决策"恰恰是复盘的主要场景。
 * 所以拆成独立动作，权限仍走 decisions:update（viewer 只读）。
 *
 * ## 事件语义（#48，owner 口径：复盘 = 显式动作）
 *
 * 只在 **未复盘 → 已复盘** 的跃迁上发 `decision_reviewed`，重复点不重复计数；
 * 撤销复盘（reviewed:false）不发事件——它是纠错，不是一次新的复盘。
 * 分子因此等于"被明确宣告复盘过的决策数"，而不是"点过按钮的次数"。
 *
 * ## 与编辑的关系
 *
 * 编辑决策会把 `reviewed_at` 清空（见 PATCH .../decisions/{did}）：内容变了，
 * 上一次复盘不再覆盖新版本，也就自然回到"未复盘"。
 */

const reviewSchema = z.object({
  reviewed: z.boolean().optional().default(true),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string; did: string }> },
) {
  const { wid, id, did } = await params;
  const ctx = await getWorkspaceContextV2(req, wid);
  if (!ctx)
    // V2 契约上从不返回 null（见 lib/auth.ts 的 WorkspaceContextV2 文档：
    // "调用方遇到 null 应按 500 处理（fail-closed，不可当作 401 重试）"）。
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  if (!ctx.ok) return authFailure(ctx, req);

  // 角色门禁：与 PATCH 同口径，viewer 只有 decisions 的读权限。
  const deniedRole = await requirePermission(ctx, "decisions", "update", req);
  if (deniedRole) return deniedRole;

  try {
    // body 可省略（纯动作端点）：空 body 必须当成默认值，不能让 JSON 解析失败变成 400。
    const raw = await req.json().catch(() => ({}));
    const validated = reviewSchema.parse(raw ?? {});

    const result = await runWithWorkspace(wid, async (tx) => {
      const decision = await tx.decision.findFirst({
        where: { id: did, taskId: id, workspaceId: wid },
        select: { id: true, version: true, reviewedAt: true },
      });
      if (!decision) return { notFound: true as const };

      // 幂等：已复盘再点一次不刷新时间戳（否则"首次复盘时间"会被点击次数污染）。
      if (validated.reviewed) {
        if (decision.reviewedAt)
          return {
            changed: false as const,
            reviewedAt: decision.reviewedAt,
            version: decision.version,
          };
        const updated = await tx.decision.update({
          where: { id: did },
          data: { reviewedAt: new Date() },
          select: { reviewedAt: true },
        });
        return {
          changed: true as const,
          reviewedAt: updated.reviewedAt,
          version: decision.version,
        };
      }

      if (!decision.reviewedAt)
        return { changed: false as const, reviewedAt: null, version: decision.version };
      await tx.decision.update({ where: { id: did }, data: { reviewedAt: null } });
      return { changed: true as const, reviewedAt: null, version: decision.version };
    });

    if ("notFound" in result) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "decisionNotFound"), data: null },
        { status: 404 },
      );
    }

    // 只有"未复盘 → 已复盘"且真的发生了写入才发事件（不阻塞主流程，内部自带 catch）。
    if (result.changed && validated.reviewed) {
      await trackServerEvent({
        userId: ctx.payload.sub,
        workspaceId: wid,
        name: "decision_reviewed",
        props: { taskId: id, decisionId: did, version: result.version },
      });
    }

    return NextResponse.json({
      code: 200,
      data: {
        reviewedAt: result.reviewedAt ? result.reviewedAt.toISOString() : null,
        changed: result.changed,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          code: 400,
          message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"),
          data: null,
        },
        { status: 400 },
      );
    }
    console.error("Review decision error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}
