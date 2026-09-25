// POST /api/v1/ai/templates/{id}/instantiate — 从模板实例化工作流
//
// Body: { wid, name? }
//  - wid：目标工作区（必填，需成员资格）
//  - name：新工作流名称（可选，默认用模板名）
//
// 逻辑：
//  1. 加载模板（校验访问权限）
//  2. 校验目标工作区成员资格
//  3. 模板 steps → Workflow.actions：{ type: capability, config: { ...config, name }, order }
//  4. 创建 Workflow（trigger 标注来源模板）
//  5. 模板 usageCount + 1（ai_workflow_templates 无 RLS，直接 prisma 更新）
//  6. 返回创建的 Workflow
//
// steps / actions 用 as Prisma.InputJsonValue 转换。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";

const instantiateSchema = z.object({
  wid: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
});

/** 模板步骤形状（与 seed-templates.ts 的 TemplateStep 对齐） */
interface TemplateStep {
  name: string;
  capability: string;
  config: Record<string, unknown>;
}

/**
 * 把模板 steps 转换为 Workflow.actions。
 *
 * 映射规则：
 *  - type ← step.capability（对齐 orchestrator 能力标识）
 *  - config ← { ...step.config, name: step.name }（保留步骤名作为描述）
 *  - order ← index + 1
 */
function stepsToActions(steps: TemplateStep[]): Array<{
  type: string;
  config: Record<string, unknown>;
  order: number;
}> {
  return steps.map((step, idx) => ({
    type: step.capability,
    config: { ...step.config, name: step.name },
    order: idx + 1,
  }));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  const limited = await checkRateLimit(req, "ai-template-instantiate", {
    windowMs: 60_000,
    max: 20,
  });
  if (limited) return limited;

  const { id } = await params;

  let body: z.infer<typeof instantiateSchema>;
  try {
    body = instantiateSchema.parse(await req.json());
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

  // 校验目标工作区成员资格
  const ctx = await getWorkspaceContext(req, body.wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 403, message: apiMsg(req, "noPermission"), data: null },
      { status: 403 },
    );
  }

  try {
    // 1) 加载模板（校验访问权限）
    const template = await prisma.aiWorkflowTemplate.findUnique({ where: { id } });
    if (!template) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "templateNotFound"), data: null },
        { status: 404 },
      );
    }
    // 工作区私有模板：需校验该工作区成员资格
    if (template.workspaceId !== null && template.workspaceId !== body.wid) {
      const tplCtx = await getWorkspaceContext(req, template.workspaceId);
      if (!tplCtx) {
        return NextResponse.json(
          { code: 403, message: apiMsg(req, "noPermission"), data: null },
          { status: 403 },
        );
      }
    }

    // 2) 校验 steps 形状
    let steps: TemplateStep[];
    try {
      const raw = template.steps;
      if (!Array.isArray(raw) || raw.length === 0) {
        return NextResponse.json(
          { code: 400, message: apiMsg(req, "invalidBody"), data: null },
          { status: 400 },
        );
      }
      steps = raw.map((s) => {
        if (s == null || typeof s !== "object") throw new Error("invalid step");
        const obj = s as Record<string, unknown>;
        if (typeof obj.name !== "string" || typeof obj.capability !== "string") {
          throw new Error("invalid step");
        }
        return {
          name: obj.name,
          capability: obj.capability,
          config:
            obj.config != null && typeof obj.config === "object"
              ? (obj.config as Record<string, unknown>)
              : {},
        };
      });
    } catch {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "invalidBody"), data: null },
        { status: 400 },
      );
    }

    // 3) 映射为 Workflow.actions
    const actions = stepsToActions(steps);
    const wfName = body.name ?? template.name;
    const trigger = {
      event: "schedule.recurring",
      conditions: {
        fromTemplate: true,
        templateId: template.id,
        templateName: template.name,
      },
    };

    // 4) 在目标工作区创建 Workflow + 模板 usageCount 自增
    //    ai_workflow_templates 无 RLS，usageCount 更新用 prisma 直连。
    const [workflow] = await Promise.all([
      runWithWorkspace(
        body.wid,
        (tx) =>
          tx.workflow.create({
            data: {
              workspaceId: body.wid,
              name: wfName,
              description: template.description,
              trigger: trigger as Prisma.InputJsonValue,
              actions: actions as Prisma.InputJsonValue,
              active: true,
              createdBy: ctx.payload.sub,
            },
          }),
        ctx.payload.sub,
      ),
      prisma.aiWorkflowTemplate.update({
        where: { id },
        data: { usageCount: { increment: 1 } },
        select: { id: true, usageCount: true },
      }),
    ]);

    return NextResponse.json({ code: 0, data: workflow, message: "OK" }, { status: 201 });
  } catch (error) {
    console.error("[POST ai/templates/[id]/instantiate] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
