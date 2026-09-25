// DELETE /api/v1/ai/knowledge/nodes/[id]?wid=xxx — 删除知识图谱节点（级联删除相关边）
//
// 安全：通过 getWorkspaceContext 校验工作区成员资格，runWithWorkspace 注入 RLS。
// 边的 onDelete: Cascade 已在 schema 中配置，删除节点时相关边自动级联删除。

import { NextRequest, NextResponse } from "next/server";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";

/** 从 URL 路径提取节点 ID，并校验是否为合法 UUID */
function extractId(req: NextRequest): string | null {
  const segments = new URL(req.url).pathname.split("/");
  const id = segments[segments.length - 1];
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return null;
  }
  return id;
}

export async function DELETE(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：60s 内最多 10 次
  const limited = await checkRateLimit(req, "ai-knowledge-node-delete", {
    windowMs: 60_000,
    max: 10,
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

    // 原子化删除：deleteMany 带 workspaceId 条件，避免并发竞态。
    // 边的级联删除由 Prisma onDelete: Cascade 自动处理。
    const result = await runWithWorkspace(
      wid,
      (tx) =>
        tx.knowledgeNode.deleteMany({
          where: { id, workspaceId: wid },
        }),
      ctx.payload.sub,
    );

    if (result.count === 0) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "itemNotFound"), data: null },
        { status: 404 },
      );
    }

    return NextResponse.json({ code: 200, data: null });
  } catch (error) {
    console.error("[ai/knowledge/nodes] DELETE 失败:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}
