import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

const reportQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  groupBy: z.enum(["user", "task", "day"]).default("user"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

interface GroupRow {
  key: string;
  totalDuration: number;
  billableDuration: number;
  totalAmount: number;
}

/**
 * GET /v1/workspaces/{wid}/time-entries/report — 工时报告
 * Query: ?userId=&startDate=&endDate=&groupBy=user|task|day
 * 聚合：按用户/任务/日期分组，返回总时长、计费时长、金额
 * 返回 { groups: [{ key, totalDuration, billableDuration, totalAmount }], summary }
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const url = new URL(req.url);
    const parsed = reportQuerySchema.safeParse({
      userId: url.searchParams.get("userId") ?? undefined,
      startDate: url.searchParams.get("startDate") ?? undefined,
      endDate: url.searchParams.get("endDate") ?? undefined,
      groupBy: url.searchParams.get("groupBy") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationFailed"), errors: parsed.error.errors, data: null },
        { status: 400 },
      );
    }
    const { userId, startDate, endDate, groupBy, page, pageSize } = parsed.data;
    const take = pageSize;
    const skip = (page - 1) * pageSize;

    const where = {
      workspaceId: wid,
      // 仅聚合已完成的计时（有 duration）
      endTime: { not: null },
      ...(userId ? { userId } : {}),
      ...(startDate || endDate
        ? {
            startTime: {
              ...(startDate ? { gte: new Date(startDate) } : {}),
              ...(endDate ? { lte: new Date(endDate) } : {}),
            },
          }
        : {}),
    };

    const [entries, total] = await runWithWorkspace(
      wid,
      async (tx) =>
        Promise.all([
          tx.timeEntry.findMany({
            where,
            include: {
              user: { select: { id: true, name: true, email: true } },
              task: { select: { id: true, title: true } },
            },
            orderBy: [{ startTime: "asc" }],
            take,
            skip,
          }),
          tx.timeEntry.count({ where }),
        ]),
      ctx.payload.sub,
    );

    // 按分组维度聚合
    const groupMap = new Map<string, GroupRow>();
    let summaryTotal = 0;
    let summaryBillable = 0;
    let summaryAmount = 0;

    for (const e of entries) {
      const dur = e.duration ?? 0;
      const billableDur = e.billable ? dur : 0;
      const amount = e.billable && e.hourlyRate ? (billableDur / 3600) * e.hourlyRate : 0;

      let key: string;
      switch (groupBy) {
        case "user":
          key = e.user?.name || e.user?.email || e.userId;
          break;
        case "task":
          key = e.task?.title || e.taskId || "—";
          break;
        case "day":
          key = e.startTime.toISOString().slice(0, 10);
          break;
      }

      const existing = groupMap.get(key);
      if (existing) {
        existing.totalDuration += dur;
        existing.billableDuration += billableDur;
        existing.totalAmount += amount;
      } else {
        groupMap.set(key, {
          key,
          totalDuration: dur,
          billableDuration: billableDur,
          totalAmount: amount,
        });
      }

      summaryTotal += dur;
      summaryBillable += billableDur;
      summaryAmount += amount;
    }

    const groups = Array.from(groupMap.values()).sort((a, b) => b.totalDuration - a.totalDuration);

    return NextResponse.json({
      code: 200,
      data: {
        groups,
        summary: {
          totalDuration: summaryTotal,
          billableDuration: summaryBillable,
          totalAmount: Math.round(summaryAmount * 100) / 100,
        },
        total,
        hasMore: skip + take < total,
      },
    });
  } catch (error) {
    console.error("[GET time-entries/report] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}