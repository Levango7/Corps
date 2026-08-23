import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";

const querySchema = z.object({
  q: z.string().min(1).max(200),
  limit: z.string().nullish(),
});

/** GET /v1/workspaces/{wid}/search?q= — 全局搜索任务标题 + 决策记录 markdown */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

  try {
    const url = new URL(req.url);
    const parsed = querySchema.safeParse({
      q: url.searchParams.get("q"),
      limit: url.searchParams.get("limit"),
    });
    if (!parsed.success) {
      return NextResponse.json({ code: 400, message: "参数 q 必填" }, { status: 400 });
    }

    const q = parsed.data.q.trim();
    // A-9: trim 后若为空字符串（纯空格输入），返回 400 避免匹配全部记录
    if (!q) {
      return NextResponse.json(
        { code: 400, message: "参数 q 不能为空或纯空格" },
        { status: 400 },
      );
    }

    // A-8: parseInt 后可能为 NaN（非数字输入），需兜底为默认值；
    // 同时 clamp 到合理范围 [1, 100]，防止过大 take 拖垮查询。
    const DEFAULT_LIMIT = 20;
    const MAX_LIMIT = 100;
    const parsedLimit = parseInt(parsed.data.limit ?? String(DEFAULT_LIMIT), 10);
    const limit = Number.isNaN(parsedLimit)
      ? DEFAULT_LIMIT
      : Math.min(Math.max(parsedLimit, 1), MAX_LIMIT);

    const [tasks, decisions] = await runWithWorkspace(wid, async (tx) => {
      const tasks = await tx.task.findMany({
        where: {
          workspaceId: wid,
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        },
        select: { id: true, title: true, status: true, priority: true },
        take: limit,
      });

      const decisions = await tx.decision.findMany({
        where: {
          workspaceId: wid,
          markdown: { contains: q, mode: "insensitive" },
        },
        select: {
          id: true,
          markdown: true,
          version: true,
          taskId: true,
          createdAt: true,
          author: { select: { id: true, name: true, email: true } },
        },
        take: limit,
        orderBy: { createdAt: "desc" },
      });

      return [tasks, decisions];
    });

    return NextResponse.json({
      code: 200,
      data: {
        tasks: tasks.map((t) => ({ ...t, kind: "task" as const })),
        decisions: decisions.map((d) => ({
          id: d.id,
          kind: "decision" as const,
          title: `决策 v${d.version} · ${d.author.name || d.author.email}`,
          snippet: d.markdown.slice(0, 120),
          taskId: d.taskId,
          href: `/w/${wid}/task/${d.taskId}`,
        })),
      },
    });
  } catch (error) {
    console.error("[GET search] error:", error);
    return NextResponse.json({ code: 500, data: null, message: "服务器内部错误" }, { status: 500 });
  }
}
