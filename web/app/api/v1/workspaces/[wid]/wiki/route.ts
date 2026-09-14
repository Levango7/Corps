import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";

/**
 * Wiki 页面列表项（树形结构）
 */
interface WikiPageNode {
  id: string;
  title: string;
  slug: string;
  content: string;
  parentId: string | null;
  createdBy: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  children: WikiPageNode[];
}

/**
 * 从扁平页面列表构建树形结构。
 * 先按 sortOrder 升序排序，再以 parentId 归组，最后从根节点（parentId=null）递归挂载子节点。
 */
function buildTree(
  pages: Array<{
    id: string;
    title: string;
    slug: string;
    content: string;
    parentId: string | null;
    createdBy: string;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
  }>,
): WikiPageNode[] {
  const sorted = [...pages].sort((a, b) => a.sortOrder - b.sortOrder);
  const byParent = new Map<string | null, typeof sorted>();
  for (const p of sorted) {
    const arr = byParent.get(p.parentId) ?? [];
    arr.push(p);
    byParent.set(p.parentId, arr);
  }

  const toNode = (p: (typeof sorted)[number]): WikiPageNode => ({
    id: p.id,
    title: p.title,
    slug: p.slug,
    content: p.content,
    parentId: p.parentId,
    createdBy: p.createdBy,
    sortOrder: p.sortOrder,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    children: (byParent.get(p.id) ?? []).map(toNode),
  });

  return (byParent.get(null) ?? []).map(toNode);
}

/**
 * 从 title 生成 slug：
 *  - 英文：kebab-case（小写化、非字母数字替换为 -、合并连续 -、去首尾 -、截断 60）
 *  - 中文/纯符号：回退 page-<timestamp-base36>，保证非空
 */
function slugifyTitle(title: string): string {
  const kebab = title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return kebab || `page-${Date.now().toString(36)}`;
}

/**
 * GET /v1/workspaces/{wid}/wiki — Wiki 页面列表（树形结构）
 * Query: ?q= 全文搜索（title/content ilike）
 *        ?parentId= 树形过滤（仅返回某父节点下的子页面，扁平结构）
 * 返回：默认返回完整页面树；带 parentId 时返回该父节点的直接子页面（扁平）
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    const parentId = url.searchParams.get("parentId") ?? undefined;

    const where: Prisma.WikiPageWhereInput = { workspaceId: wid };
    if (q) {
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { content: { contains: q, mode: "insensitive" } },
      ];
    }
    if (parentId !== undefined) {
      where.parentId = parentId === "root" ? null : parentId;
    }

    const pages = await runWithWorkspace(wid, (tx) =>
      tx.wikiPage.findMany({
        where,
        select: {
          id: true,
          title: true,
          slug: true,
          content: true,
          parentId: true,
          createdBy: true,
          sortOrder: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
      }),
    );

    // 带 parentId 过滤时返回扁平列表；否则构建完整树
    const data = parentId !== undefined ? pages : buildTree(pages);

    return NextResponse.json({ code: 200, data });
  } catch (error) {
    console.error("[GET wiki] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** POST /v1/workspaces/{wid}/wiki — 创建 Wiki 页面 */
const createSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().default(""),
  parentId: z.string().uuid().nullable().optional(),
  slug: z.string().min(1).max(200).optional(),
  sortOrder: z.number().int().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const body = await req.json();
    const validated = createSchema.parse(body);

    // slug 未提供则从 title 自动生成
    const slug = validated.slug ?? slugifyTitle(validated.title);

    // 校验 slug 在工作区内唯一
    const existing = await runWithWorkspace(wid, (tx) =>
      tx.wikiPage.findFirst({
        where: { workspaceId: wid, slug },
        select: { id: true },
      }),
    );
    if (existing) {
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "wikiSlugConflict"), data: null },
        { status: 409 },
      );
    }

    // 校验父页面存在（若提供）
    if (validated.parentId) {
      const parent = await runWithWorkspace(wid, (tx) =>
        tx.wikiPage.findFirst({
          where: { id: validated.parentId!, workspaceId: wid },
          select: { id: true },
        }),
      );
      if (!parent) {
        return NextResponse.json(
          { code: 404, message: apiMsg(req, "wikiPageNotFound"), data: null },
          { status: 404 },
        );
      }
    }

    const page = await runWithWorkspace(
      wid,
      (tx) =>
        tx.wikiPage.create({
          data: {
            workspaceId: wid,
            title: validated.title,
            slug,
            content: validated.content,
            parentId: validated.parentId ?? null,
            createdBy: ctx.payload.sub,
            sortOrder: validated.sortOrder ?? 0,
          },
          select: {
            id: true,
            title: true,
            slug: true,
            content: true,
            parentId: true,
            createdBy: true,
            sortOrder: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 201, data: page }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"), data: null, errors: error.errors },
        { status: 400 },
      );
    }
    // P2002: unique 约束冲突（slug 并发碰撞）
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "wikiSlugConflict"), data: null },
        { status: 409 },
      );
    }
    console.error("[POST wiki] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}