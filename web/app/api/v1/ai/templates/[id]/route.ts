// GET   /api/v1/ai/templates/{id} — 单个模板详情
// PATCH /api/v1/ai/templates/{id} — 更新模板（部分字段）
// DELETE /api/v1/ai/templates/{id} — 删除模板
//
// 权限：
//  - 公开模板（workspaceId=null）：所有认证用户可读；仅创建者/系统可改删（此处放宽为认证用户）
//  - 工作区模板（workspaceId=wid）：需该工作区成员资格才可读/改/删
// steps 用 as Prisma.InputJsonValue 转换。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";

const CATEGORY_VALUES = ["project", "meeting", "review", "onboarding", "custom"] as const;

const stepSchema = z.object({
  name: z.string().min(1).max(100),
  capability: z.string().min(1).max(50),
  config: z.record(z.unknown()).default({}),
});

/** PATCH 部分更新 schema（所有字段可选） */
const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().min(1).max(2000).optional(),
  category: z.enum(CATEGORY_VALUES).optional(),
  steps: z.array(stepSchema).min(1).max(50).optional(),
  isPublic: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * 加载模板并校验访问权限。
 *  - workspaceId=null：公开模板，认证用户可读
 *  - workspaceId=wid：需工作区成员资格
 * 返回 { template, wid } 或 null（无权访问/不存在）
 */
async function loadAccessibleTemplate(
  req: NextRequest,
  id: string,
): Promise<{ template: Prisma.AiWorkflowTemplateGetPayload<true>; wid: string | null } | null> {
  const template = await prisma.aiWorkflowTemplate.findUnique({ where: { id } });
  if (!template) return null;

  // 公开模板且无工作区绑定：放行
  if (template.workspaceId === null) {
    return { template, wid: null };
  }

  // 工作区模板：校验成员资格
  const ctx = await getWorkspaceContext(req, template.workspaceId);
  if (!ctx) return null;
  return { template, wid: template.workspaceId };
}

/** GET /api/v1/ai/templates/{id} */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  const limited = await checkRateLimit(req, "ai-template-get", {
    windowMs: 60_000,
    max: 60,
  });
  if (limited) return limited;

  const { id } = await params;
  try {
    const result = await loadAccessibleTemplate(req, id);
    if (!result) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "templateNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 0, data: result.template, message: "OK" });
  } catch (error) {
    console.error("[GET ai/templates/[id]] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** PATCH /api/v1/ai/templates/{id} */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  const limited = await checkRateLimit(req, "ai-template-update", {
    windowMs: 60_000,
    max: 20,
  });
  if (limited) return limited;

  const { id } = await params;

  let body: z.infer<typeof updateSchema>;
  try {
    body = updateSchema.parse(await req.json());
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

  try {
    const existing = await loadAccessibleTemplate(req, id);
    if (!existing) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "templateNotFound"), data: null },
        { status: 404 },
      );
    }

    // 构建更新 data（仅包含传入字段）
    const data: Prisma.AiWorkflowTemplateUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.description !== undefined) data.description = body.description;
    if (body.category !== undefined) data.category = body.category;
    if (body.isPublic !== undefined) data.isPublic = body.isPublic;
    if (body.steps !== undefined) data.steps = body.steps as Prisma.InputJsonValue;
    if (body.metadata !== undefined) {
      data.metadata = body.metadata as Prisma.InputJsonValue;
    }

    const updated = existing.wid
      ? await runWithWorkspace(
          existing.wid,
          (tx) => tx.aiWorkflowTemplate.update({ where: { id }, data }),
          userId,
        )
      : await prisma.aiWorkflowTemplate.update({ where: { id }, data });

    return NextResponse.json({ code: 0, data: updated, message: "OK" });
  } catch (error) {
    console.error("[PATCH ai/templates/[id]] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** DELETE /api/v1/ai/templates/{id} */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  const limited = await checkRateLimit(req, "ai-template-delete", {
    windowMs: 60_000,
    max: 20,
  });
  if (limited) return limited;

  const { id } = await params;
  try {
    const existing = await loadAccessibleTemplate(req, id);
    if (!existing) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "templateNotFound"), data: null },
        { status: 404 },
      );
    }

    if (existing.wid) {
      await runWithWorkspace(
        existing.wid,
        (tx) => tx.aiWorkflowTemplate.delete({ where: { id } }),
        userId,
      );
    } else {
      await prisma.aiWorkflowTemplate.delete({ where: { id } });
    }

    return NextResponse.json({ code: 0, data: null, message: "OK" });
  } catch (error) {
    console.error("[DELETE ai/templates/[id]] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}