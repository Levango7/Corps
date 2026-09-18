import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";

/**
 * POST /v1/workspaces/{wid}/meetings/{mid}/leave — 离开会议
 *
 * 更新 MeetingParticipant 记录（leftAt=now）。
 * 若离开后无在线参与者（leftAt=null 的数量为 0），自动将会议状态置为 ended。
 * 幂等：未加入或已离开均返回 200（无副作用）。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; mid: string }> },
) {
  const { wid, mid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const userId = ctx.payload.sub;

    await runWithWorkspace(
      wid,
      async (tx) => {
        // 仅当存在仍在线（leftAt=null）的参与者记录时才更新，避免无谓写入
        const participant = await tx.meetingParticipant.findUnique({
          where: { meetingId_userId: { meetingId: mid, userId } },
          select: { id: true, leftAt: true },
        });
        if (participant && participant.leftAt === null) {
          await tx.meetingParticipant.update({
            where: { id: participant.id },
            data: { leftAt: new Date() },
          });

          // 检查剩余在线参与者数；若为 0 则自动结束会议
          const remaining = await tx.meetingParticipant.count({
            where: { meetingId: mid, leftAt: null },
          });
          if (remaining === 0) {
            await tx.meeting.updateMany({
              where: { id: mid, status: { not: "ended" } },
              data: { status: "ended", endedAt: new Date() },
            });
          }
        }
      },
      userId,
    );

    return NextResponse.json({ code: 200, data: null });
  } catch (error) {
    console.error("[leave meeting] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
