// PATCH /api/v1/ai/personalization/recommendations/[id] — 标记推荐已采纳/拒绝
// 输入：{ wid, applied: boolean }
// 输出：{ code: 200, data: AiPersonalization }
//
// adopted=true：标记为已采纳，并记录 accept_suggestion 行为
// adopted=false：标记为未采纳（拒绝），并记录 reject_suggestion 行为
// 仅推荐所属用户可操作（userId 匹配）。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { recordBehavior } from "@/lib/ai/behavior-tracker";
import { apiMsg } from "@/lib/api-messages";

const patchSchema = z.object({
  wid: z.string().uuid(),
  applied: z.boolean(),
});

/** PATCH /api/v1/ai/personalization/recommendations/{id} — 标记推荐已采纳/拒绝 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  const rateLimited = await checkRateLimit(
    req,
    "ai-personalization-recommendation-mark",
    { windowMs: 60_000, max: 60 },
  );
  if (rateLimited) return rateLimited;

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
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

  const ctx = await getWorkspaceContext(req, body.wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  try {
    // 校验推荐归属当前用户
    const existing = await runWithWorkspace(
      body.wid,
      (tx) =>
        tx.aiPersonalization.findFirst({
          where: { id, workspaceId: body.wid, userId: ctx.payload.sub },
          select: { id: true, type: true, content: true },
        }),
      ctx.payload.sub,
    );
    if (!existing) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "workspaceNotFound"), data: null },
        { status: 404 },
      );
    }

    // 更新 applied 状态 + 记录对应行为
    const updated = await runWithWorkspace(
      body.wid,
      async (tx) => {
        const rec = await tx.aiPersonalization.update({
          where: { id },
          data: { applied: body.applied },
        });

        // 记录采纳/拒绝行为（用于后续个性化分析）
        await recordBehavior(
          tx,
          body.wid,
          ctx.payload.sub,
          body.applied ? "accept_suggestion" : "reject_suggestion",
          "personalization",
          {
            recommendationId: id,
            type: existing.type,
          } as Prisma.InputJsonValue,
        );

        return rec;
      },
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 200, data: updated });
  } catch (error) {
    console.error("[PATCH ai/personalization/recommendations/[id]] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}