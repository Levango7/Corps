import { NextRequest, NextResponse } from "next/server";
import { authenticate, runWithAuthOp } from "@/lib/auth";
import { generateSlug } from "@/lib/slug";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { readSidebarSettings } from "@/lib/workspace-settings";
import { withRed } from "@/lib/red-metrics";

async function getWorkspaces(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  try {
    // workspaces 的 RLS 策略按成员资格子查询 app.user_id 判定可见性，需注入 uid
    const workspaces = await runWithAuthOp(
      "login",
      (tx) =>
        tx.workspace.findMany({
          where: {
            members: {
              some: { userId: auth.sub },
            },
          },
          include: {
            members: {
              where: { userId: auth.sub },
              select: { role: true },
            },
          },
          orderBy: { createdAt: "desc" },
        }),
      auth.sub,
    );

    return NextResponse.json({
      code: 200,
      data: workspaces.map((w) => ({
        id: w.id,
        name: w.name,
        slug: w.slug,
        plan: w.plan,
        seatLimit: w.seatLimit,
        role: w.members[0]?.role || "member",
        // P1-B2：只暴露"已启用的可选模块 id"，不把整个 settings 桶漏给前端
        enabledOptionalModules: readSidebarSettings(w.settings).enabledModules,
      })),
    });
  } catch (error) {
    console.error("[GET workspaces] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

const createWorkspaceSchema = z.object({
  name: z.string().min(2).max(100),
});

async function postWorkspace(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  try {
    const body = await req.json();
    const validated = createWorkspaceSchema.parse(body);

    const slug = await generateSlug(validated.name);

    // 建工作区 + owner 成员单事务，走 provision 逃生口（RLS 启用后仍可写）
    const workspace = await runWithAuthOp(
      "provision",
      async (tx) => {
        const created = await tx.workspace.create({
          data: {
            name: validated.name,
            slug,
            ownerId: auth.sub,
          },
        });
        await tx.member.create({
          data: {
            userId: auth.sub,
            workspaceId: created.id,
            role: "owner",
          },
        });
        return created;
      },
      auth.sub,
    );

    return NextResponse.json(
      {
        code: 201,
        data: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          plan: workspace.plan,
          seatLimit: workspace.seatLimit,
          role: "owner",
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationError"), errors: error.issues, data: null },
        { status: 400 },
      );
    }
    console.error("Create workspace error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}

export const GET = withRed(getWorkspaces);

export const POST = withRed(postWorkspace);
