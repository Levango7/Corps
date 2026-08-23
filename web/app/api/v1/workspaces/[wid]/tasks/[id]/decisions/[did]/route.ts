import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";

const updateDecisionSchema = z.object({
  markdown: z.string().min(1).max(50000),
  baseVersion: z.number().int().min(1),
});

/**
 * PATCH /v1/workspaces/{wid}/tasks/{id}/decisions/{did} — 编辑决策（版本 +1）
 * 乐观并发：baseVersion 不等于当前版本时返回 409，拒绝静默覆盖他人修改。
 * 每次编辑同时追加一条 decision_versions 历史行（AC-10 版本留痕）。
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string; did: string }> }
) {
  const { wid, id, did } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

  try {
    const validated = updateDecisionSchema.parse(await req.json());

    const result = await runWithWorkspace(wid, async (tx) => {
      const decision = await tx.decision.findFirst({
        where: { id: did, taskId: id, workspaceId: wid },
        select: { id: true, version: true },
      });
      if (!decision) return { notFound: true as const };
      if (decision.version !== validated.baseVersion) {
        return { conflict: true as const, currentVersion: decision.version };
      }

      return tx.decision.update({
        where: { id: did },
        data: {
          markdown: validated.markdown,
          version: validated.baseVersion + 1,
          versions: {
            create: {
              workspaceId: wid,
              markdown: validated.markdown,
              version: validated.baseVersion + 1,
              authorId: ctx.payload.sub,
            },
          },
        },
        include: { author: { select: { id: true, name: true, email: true } } },
      });
    });

    if ("notFound" in result) {
      return NextResponse.json({ code: 404, message: "决策不存在" }, { status: 404 });
    }
    if ("conflict" in result) {
      return NextResponse.json(
        { code: 409, message: `决策已被他人更新（当前版本 ${result.currentVersion}），请刷新后重试` },
        { status: 409 }
      );
    }

    return NextResponse.json({ code: 200, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: error.issues[0]?.message ?? "参数校验失败" },
        { status: 400 }
      );
    }
    console.error("Update decision error:", error);
    return NextResponse.json({ code: 500, message: "Internal server error" }, { status: 500 });
  }
}
