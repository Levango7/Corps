import { randomUUID } from "crypto";
import { runWithAuthOp } from "./auth";

/**
 * 服务端数据埋点（审计 T1.2 配套）：
 * analytics_events 表已纳入 RLS，直写必须携带 provision 逃生口上下文，
 * 否则加固模式下会被 WITH CHECK 静默拒绝（.catch 吞掉导致埋点丢失）。
 *
 * 统一走此助手：runWithAuthOp("provision") + 失败记录日志（不阻塞主流程）。
 *
 * M13 修复：原实现 .catch(() => {}) 静默吞掉所有错误，导致埋点丢失时无法排障。
 * 现改为 .catch 记录 console.error（仍不抛出，不影响主流程），便于运维监控。
 *
 * 终态签名（P2-2 / 裁决二，埋点线独占）：
 *   trackServerEvent(data: {
 *     userId?: string | null;       // 放宽：webhook 取不到 owner 时传 null
 *     workspaceId: string | null;
 *     sessionId?: string;           // 新增：获客段漏斗按 sessionId 串联
 *     name: string;
 *     props?: Record<string, unknown>;
 *   })
 *
 * 内部适配：
 *  - runWithAuthOp 第三参签名 `userId?: string`，传 `data.userId ?? undefined`
 *    （auth.ts L119–125 签名不变）。
 *  - 入库 analytics_events.userId 列为 uuid nullable，写 `data.userId ?? null`。
 *  - sessionId 缺省时入库为 null（与既有行为一致）。
 *
 * 支付线 webhook 四埋点只消费此签名，不得并行修改本文件。
 */
export function trackServerEvent(data: {
  userId?: string | null;
  workspaceId: string | null;
  sessionId?: string;
  name: string;
  props?: Record<string, unknown>;
}): Promise<unknown> {
  return runWithAuthOp(
    "provision",
    (tx) =>
      tx.analyticsEvent.create({
        data: {
          id: randomUUID(),
          userId: data.userId ?? null,
          workspaceId: data.workspaceId,
          name: data.name,
          props: (data.props ?? {}) as object,
          sessionId: data.sessionId ?? null,
        },
      }),
    data.userId ?? undefined,
  ).catch((err) => {
    // M13 修复：记录埋点失败日志（不阻塞主流程，但便于排障）
    console.error(
      `[analytics-server] trackServerEvent 失败 name=${data.name} wid=${data.workspaceId}:`,
      err instanceof Error ? err.message : err,
    );
  });
}
