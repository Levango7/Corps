import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth";
import { disconnectCalendar } from "@/lib/calendar/sync";
import type { CalendarProvider } from "@/lib/calendar/config";
import { apiMsg } from "@/lib/api-messages";

/**
 * DELETE /api/v1/auth/calendar/disconnect/[provider]
 * 断开日历连接：撤销 OAuth token + 删除 CalendarConnection 记录（级联删除事件映射）。
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;

  // 鉴权
  const payload = await authenticate(req);
  if (!payload) {
    return NextResponse.json({ code: 401, data: null, message: apiMsg(req, "unauthorized") }, { status: 401 });
  }

  // 校验 provider
  if (provider !== "google" && provider !== "outlook") {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "unsupportedCalendarProvider"), data: null },
      { status: 400 },
    );
  }
  const p = provider as CalendarProvider;

  try {
    await disconnectCalendar(payload.sub, p);
    return NextResponse.json({ code: 200, data: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : apiMsg(req, "calendarDisconnectFailed");
    console.error("[calendar disconnect] error:", error);
    return NextResponse.json({ code: 500, data: null, message }, { status: 500 });
  }
}
