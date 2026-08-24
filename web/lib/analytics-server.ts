import { randomUUID } from "crypto";
import { runWithAuthOp } from "./auth";
import { prisma } from "./prisma";

/**
 * 服务端数据埋点（审计 T1.2 配套）：
 * analytics_events 表已纳入 RLS，直写必须携带 provision 逃生口上下文，
 * 否则加固模式下会被 WITH CHECK 静默拒绝（.catch 吞掉导致埋点丢失）。
 *
 * 统一走此助手：runWithAuthOp("provision") + 失败静默（不阻塞主流程）。
 */
export function trackServerEvent(data: {
  userId: string;
  workspaceId: string | null;
  name: string;
  props?: Record<string, unknown>;
}): Promise<unknown> {
  return runWithAuthOp(
    "provision",
    (tx) =>
      tx.analyticsEvent.create({
        data: {
          id: randomUUID(),
          userId: data.userId,
          workspaceId: data.workspaceId,
          name: data.name,
          props: (data.props ?? {}) as object,
        },
      }),
    data.userId,
  ).catch(() => {
    /* 埋点失败不影响主流程 */
  });
}
