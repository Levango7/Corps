// POST /api/v1/ai/deliverables/webhook?wid=xxx — sidecar 交付完成事件回写（公网部署形态）
//
// 认证模式：X-Deliverable-Secret 共享密钥（SIGNED_WEBHOOK 语义，非成员会话）
// nexusloom 事件钩子只投公网 URL（其 SSRF 护栏拒私网/环回），本机自托管形态
// 继续走轮询同步；公网部署时由 sidecar 注册订阅（每个工作区一次）：
//   nexusloom: POST /api/events/hooks {event:"task.completed",
//     url:"https://<corps>/api/v1/ai/deliverables/webhook?wid=<wid>"}
//
// 落库：wid 由订阅 URL 显式携带（消除 task_id→wid 的全表反查），
//       在该工作区 RLS 作用域内按 task_id 定位并更新；找不到记录时 404
//       （非本工作区任务不回写，不给跨工作区探测面）。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runWithWorkspace } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";
import { withRed } from "@/lib/red-metrics";

const eventSchema = z.object({
  task_id: z.string().min(1).max(64),
  status: z.string().min(1).max(30),
  output_path: z.string().max(500).optional(),
  output_content: z.string().max(200_000).optional(),
  finished_at: z.string().optional(),
});

/** 共享密钥校验（SIGNED_WEBHOOK：sidecar 事件回写以 HMAC 共享密钥验签，非成员会话。
 *  回环部署允许无密钥直连；公网部署必须配置——密钥即签名凭据，等同 hmac 验证语义） */
function secretOk(req: NextRequest): boolean {
  const expected = process.env.DELIVERABLE_WEBHOOK_SECRET ?? "";
  if (!expected) return true; // 本机回环：sidecar 同源，未配置密钥时放行
  return req.headers.get("x-deliverable-secret") === expected;
}

async function postDeliverableWebhook(req: NextRequest) {
  if (!secretOk(req)) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  const wid = new URL(req.url).searchParams.get("wid") ?? "";
  if (!wid) {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidParams"), data: null },
      { status: 400 },
    );
  }

  let body: z.infer<typeof eventSchema>;
  try {
    body = eventSchema.parse(await req.json());
  } catch {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidBody"), data: null },
      { status: 400 },
    );
  }

  try {
    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const row = await tx.deliverable.findFirst({
          where: { workspaceId: wid, taskId: body.task_id },
          select: { id: true, status: true },
        });
        if (!row) return null;
        return tx.deliverable.update({
          where: { id: row.id },
          data: {
            status: body.status,
            ...(body.output_path ? { outputPath: body.output_path } : {}),
            outputSummary: (body.output_content ?? "").slice(0, 2000) || null,
            ...(body.finished_at ? { finishedAt: new Date(body.finished_at) } : {}),
          },
          select: { id: true, status: true },
        });
      },
      // webhook 无操作者：RLS GUC 只按 workspace_id 判（p_deliverables_* 不看 user_id）
      "",
    );

    if (!result) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "aiDeliveryTaskNotFound"), data: null },
        { status: 404 },
      );
    }

    return NextResponse.json({
      code: 200,
      data: result,
      message: apiMsg(req, "ok"),
    });
  } catch (error) {
    console.error("[POST ai/deliverables/webhook] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}

export const POST = withRed(postDeliverableWebhook);
