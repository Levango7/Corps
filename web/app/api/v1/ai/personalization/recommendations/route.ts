// GET /api/v1/ai/personalization/recommendations — 查询当前用户个性化推荐列表
// 查询参数：wid（必填）、type（可选，过滤推荐类型）、applied（可选，过滤已采纳/未采纳）
// 返回：{ code: 200, data: { recommendations: AiPersonalization[] } }
//
// 在 RLS 事务内查询，仅返回当前用户的推荐记录。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";

const querySchema = z.object({
  wid: z.string().uuid(),
  type: z
    .enum(["capability_recommendation", "prompt_optimization", "workflow_suggestion"])
    .optional(),
  applied: z.coerce.boolean().optional(),
});

export async function GET(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) 速率限制：每分钟 60 次
  const rateLimited = await checkRateLimit(req, "ai-personalization-recommendations", {
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

  // 4) 工作区成员资格认证
  const ctx = await getWorkspaceContext(req, parsed.wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  // 5) 查询推荐列表
  try {
    const recommendations = await runWithWorkspace(
      parsed.wid,
      (tx) =>
        tx.aiPersonalization.findMany({
          where: {
            userId: ctx.payload.sub,
            ...(parsed.type ? { type: parsed.type } : {}),
            ...(parsed.applied !== undefined ? { applied: parsed.applied } : {}),
          },
          orderBy: [{ applied: "asc" }, { score: "desc" }, { createdAt: "desc" }],
          take: 50,
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({
      code: 200,
      data: { recommendations },
    });
  } catch (error) {
    console.error("[ai/personalization/recommendations] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}
