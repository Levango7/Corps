// GET /api/v1/ai/personalization/behaviors — 查询当前用户行为历史
// 查询参数：wid（必填）、capability（可选）、limit（默认 100，最大 500）
// 返回：{ code: 200, data: { behaviors: AiUserBehavior[], total: number } }
//
// 在 RLS 事务内查询，仅返回当前用户的行为记录。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getUserBehaviors } from "@/lib/ai/behavior-tracker";
import { apiMsg } from "@/lib/api-messages";

const querySchema = z.object({
  wid: z.string().uuid(),
  capability: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export async function GET(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) 速率限制：每分钟 60 次
  const rateLimited = await checkRateLimit(req, "ai-personalization-behaviors", {
    windowMs: 60_000,
    max: 60,
  });
  if (rateLimited) return rateLimited;

  // 3) 解析查询参数
  const url = new URL(req.url);
  const params = Object.fromEntries(url.searchParams.entries());
  let parsed: z.infer<typeof querySchema>;
  try {
    parsed = querySchema.parse(params);
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
      { code: 400, message: apiMsg(req, "invalidParams"), data: null },
      { status: 400 },
    );
  }

  // 4) 工作区成员资格认证（wid 守卫 + RLS）
  const ctx = await getWorkspaceContext(req, parsed.wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  // 5) 查询用户行为历史
  try {
    const behaviors = await runWithWorkspace(
      parsed.wid,
      (tx) =>
        getUserBehaviors(tx, ctx.payload.sub, {
          capability: parsed.capability,
          limit: parsed.limit,
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({
      code: 200,
      data: { behaviors, total: behaviors.length },
    });
  } catch (error) {
    console.error("[ai/personalization/behaviors] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}
