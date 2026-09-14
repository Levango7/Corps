import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";

/**
 * GET /v1/workspaces/{wid}/forms — 表单列表
 * Query: ?active=true（仅启用的）
 *        ?take=&skip= 分页
 * 返回按 updatedAt 倒序，含 _count submissions
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const url = new URL(req.url);
    const parsed = listQuerySchema.safeParse({
      active: url.searchParams.get("active") ?? undefined,
      take: url.searchParams.get("take") ?? undefined,
      skip: url.searchParams.get("skip") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationFailed"), errors: parsed.error.errors, data: null },
        { status: 400 },
      );
    }
    const { active, take, skip } = parsed.data;

    const where = {
      workspaceId: wid,
      ...(active ? { active: true } : {}),
    };

    const [items, total] = await runWithWorkspace(wid, (tx) =>
      Promise.all([
        tx.form.findMany({
          where,
          select: {
            id: true,
            title: true,
            description: true,
            fields: true,
            active: true,
            createdAt: true,
            updatedAt: true,
            _count: { select: { submissions: true } },
          },
          orderBy: [{ updatedAt: "desc" }],
          skip,
          take,
        }),
        tx.form.count({ where }),
      ]),
    );

    return NextResponse.json({ code: 0, data: { items, total, skip, take } });
  } catch (error) {
    console.error("[GET forms] error:", error);
    return NextResponse.json({ code: 500, data: null, message: apiMsg(req, "internalError") }, { status: 500 });
  }
}

const listQuerySchema = z.object({
  active: z.literal("true").optional(),
  take: z.coerce.number().int().min(1).max(100).default(50),
  skip: z.coerce.number().int().min(0).default(0),
});

/**
 * 表单字段定义校验：
 * 每个字段有 id/type/label/required，可选 options（select/radio/checkbox 选项）/validation
 */
const fieldSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["text", "textarea", "number", "select", "radio", "checkbox", "date"]),
  label: z.string().min(1).max(200),
  required: z.boolean().default(false),
  options: z.array(z.string().min(1).max(200)).optional(),
  validation: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
      pattern: z.string().optional(),
    })
    .optional(),
});

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  fields: z.array(fieldSchema).min(1),
  active: z.boolean().optional(),
});

/** POST /v1/workspaces/{wid}/forms — 创建表单 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const body = await req.json();
    const validated = createSchema.parse(body);

    const form = await runWithWorkspace(
      wid,
      (tx) =>
        tx.form.create({
          data: {
            workspaceId: wid,
            title: validated.title,
            description: validated.description,
            fields: validated.fields as Prisma.InputJsonValue,
            active: validated.active ?? true,
            createdBy: ctx.payload.sub,
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 0, data: form }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"), data: null, errors: error.errors },
        { status: 400 },
      );
    }
    console.error("[POST form] error:", error);
    return NextResponse.json({ code: 500, data: null, message: apiMsg(req, "internalError") }, { status: 500 });
  }
}