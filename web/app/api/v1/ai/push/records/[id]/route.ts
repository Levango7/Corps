// PATCH /api/v1/ai/push/records/[id] — 标记推送记录已读
//
// 通过 body.wid 绑定工作区做 RLS 守卫；仅记录所属用户可操作（userId 匹配）。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";

const patchSchema = z.object({
  wid: z.string().uuid(),
  read: z.boolean().optional().default(true),
});

/** PATCH /api/v1/ai/push/records/{id} — 标记已读（或未读） */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  const limited = await checkRateLimit(req, "ai-push-records-mark", {
    windowMs: 60_000,
    max: 60,
  });
  if (limited) return limited;

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
    // 校验记录归属当前用户
    const existing = await runWithWorkspace(
      body.wid,
      (tx) =>
        tx.aiPushRecord.findFirst({
          where: { id, workspaceId: body.wid, userId: ctx.payload.sub },
          select: { id: true },
        }),
      ctx.payload.sub,
    );
    if (!existing) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "workspaceNotFound"), data: null },
        { status: 404 },
      );
    }

    const updated = await runWithWorkspace(
      body.wid,
      (tx) => tx.aiPushRecord.update({ where: { id }, data: { read: body.read } }),
      ctx.payload.sub,
    );
    return NextResponse.json({ code: 200, data: updated });
  } catch (error) {
    console.error("[PATCH ai/push/records/[id]] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}
