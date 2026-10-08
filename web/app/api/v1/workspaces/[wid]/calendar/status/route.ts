import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContextV2, withGuc } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";
import { authFailure } from "@/lib/auth-response";

/** 连接状态响应 */
interface ConnectionStatus {
  provider: string;
  email: string;
  connected: boolean;
  lastSyncAt: string | null;
  syncStatus: string;
  syncError: string | null;
}

/**
 * GET /api/v1/workspaces/{wid}/calendar/status
 * 获取当前用户的日历连接状态 + 同步状态（用于设置页面渲染）。
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContextV2(req, wid);
  if (!ctx)
    // V2 契约上从不返回 null（见 lib/auth.ts 的 WorkspaceContextV2 文档：
    // "调用方遇到 null 应按 500 处理（fail-closed，不可当作 401 重试）"）。
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  if (!ctx.ok) return authFailure(ctx, req);

  try {
    // calendar_connections 受 FORCE RLS（user_id 谓词）：本人连接的可见性
    // 依赖 app.user_id GUC，经 withGuc 注入（而非裸 prisma 直查）
    const connections = await withGuc({ user_id: ctx.payload.sub }, (tx) =>
      tx.calendarConnection.findMany({
        where: { userId: ctx.payload.sub },
        select: {
          provider: true,
          email: true,
          lastSyncAt: true,
          syncStatus: true,
          syncError: true,
        },
      }),
    );

    // 构造 google + outlook 的完整状态（未连接的 provider 也返回 disconnected）
    const providers = ["google", "outlook"];
    const status: ConnectionStatus[] = providers.map((p) => {
      const conn = connections.find((c) => c.provider === p);
      return {
        provider: p,
        email: conn?.email ?? "",
        connected: !!conn,
        lastSyncAt: conn?.lastSyncAt?.toISOString() ?? null,
        syncStatus: conn?.syncStatus ?? "idle",
        syncError: conn?.syncError ?? null,
      };
    });

    return NextResponse.json({ code: 200, data: { connections: status } });
  } catch (error) {
    console.error("[calendar status] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}
