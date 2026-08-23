import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/auth";
import { z } from "zod";

export async function GET(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) {
    return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });
  }

  const workspaces = await prisma.workspace.findMany({
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
  });

  return NextResponse.json({
    code: 200,
    data: workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      slug: w.slug,
      plan: w.plan,
      role: w.members[0]?.role || "member",
    })),
  });
}

const createWorkspaceSchema = z.object({
  name: z.string().min(2).max(100),
});

export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth) {
    return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const validated = createWorkspaceSchema.parse(body);

    const slug = validated.name.toLowerCase().replace(/\s+/g, "-").slice(0, 50);

    const workspace = await prisma.workspace.create({
      data: {
        name: validated.name,
        slug,
        ownerId: auth.sub,
      },
    });

    await prisma.member.create({
      data: {
        userId: auth.sub,
        workspaceId: workspace.id,
        role: "owner",
      },
    });

    return NextResponse.json(
      {
        code: 201,
        data: { id: workspace.id, name: workspace.name, slug: workspace.slug },
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: "Validation error", errors: error.errors },
        { status: 400 }
      );
    }
    console.error("Create workspace error:", error);
    return NextResponse.json(
      { code: 500, message: "Internal server error" },
      { status: 500 }
    );
  }
}
