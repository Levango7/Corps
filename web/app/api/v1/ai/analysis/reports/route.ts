// GET /api/v1/ai/analysis/reports — 获取 AI 分析报告列表
// 查询参数：?wid=uuid&type=burndown&page=1&pageSize=20
// 输出：{ code: 200, data: { items: Report[], total: number, page: number, pageSize: number } }
//
// 返回当前工作区的 AI 分析报告列表，支持按类型过滤与分页。

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getUserId,
  unauthorizedResponse,
} from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";

const querySchema = z.object({
  wid: z.string().uuid(),
  type: z
    .enum(["burndown", "team_performance", "bottleneck", "weekly_report"])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** 报告列表项（列表视图所需字段） */
interface ReportListItem {
  id: string;
  type: string;
  title: string;
  summary: string;
  createdAt: string;
}

export async function GET(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 2) 查询参数校验
  const url = new URL(req.url);
  const params = Object.fromEntries(url.searchParams.entries());
  let query: z.infer<typeof querySchema>;
  try {
    query = querySchema.parse(params);
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
      { code: 400, message: apiMsg(req, "invalidParams"), data: null },
      { status: 400 },
    );
  }

  // 3) 工作区成员资格认证
  const ctx = await getWorkspaceContext(req, query.wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  // 4) 查询报告列表 + 总数（RLS 事务内）
  try {
    const where = {
      workspaceId: query.wid,
      ...(query.type ? { type: query.type } : {}),
    };
    const [rows, total] = await runWithWorkspace(
      query.wid,
      (tx) =>
        Promise.all([
          tx.aiAnalysisReport.findMany({
            where,
            select: {
              id: true,
              type: true,
              title: true,
              summary: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
          }),
          tx.aiAnalysisReport.count({ where }),
        ]),
      ctx.payload.sub,
    );

    const items: ReportListItem[] = rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      summary: r.summary,
      createdAt: r.createdAt.toISOString(),
    }));

    return NextResponse.json({
      code: 200,
      data: {
        items,
        total,
        page: query.page,
        pageSize: query.pageSize,
      },
    });
  } catch (error) {
    console.error("[ai/analysis/reports] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}