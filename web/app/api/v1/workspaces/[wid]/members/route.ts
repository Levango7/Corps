import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkspaceContext } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string }> }
) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

  const members = await prisma.member.findMany({
    where: { workspaceId: wid },
    include: { user: { select: { id: true, email: true, name: true, image: true } } },
    orderBy: { joinedAt: "asc" },
  });

  return NextResponse.json({
    code: 200,
    data: members.map((m) => ({
      id: m.user.id,
      email: m.user.email,
      name: m.user.name,
      image: m.user.image,
      role: m.role,
      isSelf: m.user.id === ctx.payload.sub,
      joinedAt: m.joinedAt,
    })),
  });
}
