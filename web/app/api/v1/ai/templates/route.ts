// GET  /api/v1/ai/templates — 模板列表（公开 + 当前工作区私有）
//      Query: ?category=project & public=true & wid=<uuid> & q=搜索词 & take=50 & skip=0
// POST /api/v1/ai/templates — 创建模板
//      Body: { wid?, name, description, category, steps, isPublic, metadata? }
//
// 约定：{ code, data, message }；成功 code=0；steps 用 as Prisma.InputJsonValue 转换。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";

/** 合法分类枚举 */
const CATEGORY_VALUES = ["project", "meeting", "review", "onboarding", "custom"] as const;

/** GET 查询参数 schema */
const listQuerySchema = z.object({
  category: z.enum(CATEGORY_VALUES).optional(),
  public: z.literal("true").optional(),
  wid: z.string().uuid().optional(),
  q: z.string().max(200).optional(),
  take: z.coerce.number().int().min(1).max(100).default(50),
  skip: z.coerce.number().int().min(0).default(0),
});

/** 步骤 schema：[{ name, capability, config }] */
const stepSchema = z.object({
  name: z.string().min(1).max(100),
  capability: z.string().min(1).max(50),
  config: z.record(z.unknown()).default({}),
});

/** POST 创建 schema */
const createSchema = z.object({
  wid: z.string().uuid().optional(),
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(2000),
  category: z.enum(CATEGORY_VALUES),
  steps: z.array(stepSchema).min(1).max(50),
  isPublic: z.boolean().default(false),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * GET /api/v1/ai/templates
 *
 * 可见范围：
 *  - 公开模板（isPublic=true）：所有认证用户可见
 *  - 工作区私有模板（workspaceId=wid 且 isPublic=false）：仅该工作区成员可见
 * 传 wid 时两者合并返回；不传 wid 仅返回公开模板。
 */
export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  const limited = await checkRateLimit(req, "ai-templates-list", {
    windowMs: 60_000,
    max: 60,
  });
  if (limited) return limited;

  const url = new URL(req.url);
  const parsed = listQuerySchema.safeParse({
    category: url.searchParams.get("category") ?? undefined,
    public: url.searchParams.get("public") ?? undefined,
    wid: url.searchParams.get("wid") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    take: url.searchParams.get("take") ?? undefined,
    skip: url.searchParams.get("skip") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      {
        code: 400,
        message: parsed.error.issues[0]?.message ?? apiMsg(req, "validationFailed"),
        data: null,
      },
      { status: 400 },
    );
  }
  const { category, public: publicOnly, wid, q, take, skip } = parsed.data;

  // wid 传入时校验工作区成员资格（防越权读取他人工作区私有模板）
  let wsOk = true;
  if (wid) {
    const ctx = await getWorkspaceContext(req, wid);
    if (!ctx) wsOk = false;
  }
  if (wid && !wsOk) {
    return NextResponse.json(
      { code: 403, message: apiMsg(req, "noPermission"), data: null },
      { status: 403 },
    );
  }

  try {
    // 构建查询条件：
    //  - workspaceId=null 的公开模板始终可见
    //  - workspaceId=wid 的模板（公开或私有）仅成员可见
    //  - publicOnly=true 时仅返回 isPublic=true
    const where: Prisma.AiWorkflowTemplateWhereInput = {};
    if (category) where.category = category;
    if (publicOnly) where.isPublic = true;
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ];
    }
    if (wid) {
      // 工作区上下文：公开模板（workspaceId=null 或任意）+ 本工作区模板
      where.OR = [
        { isPublic: true, workspaceId: null },
        { isPublic: true, workspaceId: { not: null } },
        { workspaceId: wid },
      ];
    } else {
      // 无工作区上下文：仅公开模板
      where.isPublic = true;
      where.workspaceId = null;
    }

    const [items, total] = await Promise.all([
      prisma.aiWorkflowTemplate.findMany({
        where,
        select: {
          id: true,
          name: true,
          description: true,
          category: true,
          steps: true,
          isPublic: true,
          workspaceId: true,
          usageCount: true,
          metadata: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ usageCount: "desc" }, { updatedAt: "desc" }],
        skip,
        take,
      }),
      prisma.aiWorkflowTemplate.count({ where }),
    ]);

    return NextResponse.json({ code: 0, data: { items, total, skip, take }, message: "OK" });
  } catch (error) {
    console.error("[GET ai/templates] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * POST /api/v1/ai/templates — 创建模板
 *
 *  - wid 传入：创建为该工作区模板（需成员资格），isPublic 决定是否公开
 *  - wid 不传：创建为全局公开模板（isPublic 强制 true）
 */
export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  const limited = await checkRateLimit(req, "ai-templates-create", {
    windowMs: 60_000,
    max: 20,
  });
  if (limited) return limited;

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json());
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

  // wid 传入时校验工作区成员资格
  if (body.wid) {
    const ctx = await getWorkspaceContext(req, body.wid);
    if (!ctx) {
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "noPermission"), data: null },
        { status: 403 },
      );
    }
  }

  try {
    const template = body.wid
      ? await runWithWorkspace(
          body.wid,
          (tx) =>
            tx.aiWorkflowTemplate.create({
              data: {
                name: body.name,
                description: body.description,
                category: body.category,
                steps: body.steps as Prisma.InputJsonValue,
                isPublic: body.isPublic,
                workspaceId: body.wid,
                metadata: body.metadata as Prisma.InputJsonValue | undefined,
              },
            }),
          userId,
        )
      : await prisma.aiWorkflowTemplate.create({
          data: {
            name: body.name,
            description: body.description,
            category: body.category,
            steps: body.steps as Prisma.InputJsonValue,
            isPublic: true,
            workspaceId: null,
            metadata: body.metadata as Prisma.InputJsonValue | undefined,
          },
        });

    return NextResponse.json({ code: 0, data: template, message: "OK" }, { status: 201 });
  } catch (error) {
    console.error("[POST ai/templates] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
