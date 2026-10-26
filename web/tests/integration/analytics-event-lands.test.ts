import { describe, it, expect } from "vitest";
import { BASE, registerUser, authHeader, createTask } from "../helpers";

/**
 * 埋点必须**真的落进表并被分析口径读到**。
 *
 * 为什么需要这一条：此前全仓对 analytics_events 的覆盖只有"名字对不对"
 * （`tests/unit/analytics-event-contract.test.ts` 扫源码），没有任何测试证明
 * 一条事件从写入通道走到了消费端。而 `lib/analytics-server.ts` 头部就写着已知失败形态
 * ——「analytics_events 受 RLS 约束，加固模式下裸写会被 WITH CHECK 静默拒绝，
 * `.catch` 吞掉导致埋点丢失」。也就是说**接口 201、事件没落库**这个状态是可以长期存在的，
 * 而且不报错：源码扫描看不见（调用点确实在）、看板也看不见（只会读出"转化 0"）。
 * 本用例就是那一层的回归门，且在 `Test (hardened RLS mode)` job 里以 corps_app 身份跑真 RLS。
 *
 * 判据走 `GET …/analytics/overview`（漏斗与 WAW 的真实消费方），不直接数库里的行：
 * 断的是"这个信号在指标里到底有没有"，正是产品要的结果。
 *
 * 等待条件用**顺序保证**而不是轮询或固定 sleep：评论接口在返回 201 之前
 * `await trackServerEvent(...)`，其内部是 runWithAuthOp 的事务，await 返回即已提交。
 */

interface OverviewData {
  daily: Array<Record<string, number | string>>;
  topEvents: Array<{ name: string; count: number }>;
  totalEvents: number;
  coreActiveUsers: number;
}

async function overview(token: string, wid: string): Promise<OverviewData> {
  const res = await fetch(`${BASE}/workspaces/${wid}/analytics/overview`, {
    headers: authHeader(token),
  });
  expect(res.status, "owner 应能读分析概览").toBe(200);
  const json = await res.json();
  return json.data as OverviewData;
}

/** 概览的 daily 按事件名逐日计数，且不受 Top8 截断影响，所以用它判"有没有"。 */
function countOf(data: OverviewData, name: string): number {
  return data.daily.reduce((sum, day) => {
    const v = day[name];
    return sum + (typeof v === "number" ? v : 0);
  }, 0);
}

describe("埋点端到端：事件从 API 落库并被分析概览读到", () => {
  it("创建评论后 create_comment 计数 +1（此前它只有白名单名字、没有 emit 站点）", async () => {
    const owner = await registerUser({
      prefix: "analytics-lands",
      workspaceName: "埋点落库工作区",
    });
    const token = owner.accessToken;
    const wid = owner.workspace.id;

    const before = await overview(token, wid);

    const task = await createTask(token, wid, { title: "埋点落库测试任务" });
    const taskId = task.body.data!.id;

    const comment = await fetch(`${BASE}/workspaces/${wid}/tasks/${taskId}/comments`, {
      method: "POST",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ body: "这条评论应当产生一条 create_comment 事件" }),
    });
    expect(comment.status).toBe(201);

    const after = await overview(token, wid);

    expect(
      countOf(after, "create_comment"),
      "评论创建后 create_comment 没有增加 ⇒ 事件没落库（写入通道被静默拒绝，接口却照样 201）",
    ).toBe(countOf(before, "create_comment") + 1);

    // 阳性对照：register_success 是本次改动之前就存在的服务端事件。
    // 没有这条，上面的"看见 create_comment"可能只是概览把所有名字都算了一遍。
    expect(countOf(after, "register_success"), "对照组失效：概览读不到 register_success").toBe(1);
    expect(after.topEvents.length, "对照组失效：topEvents 为空集不许判绿").toBeGreaterThan(0);

    // 粗判：读路径确实把 CORE_EVENTS 纳入了严格活跃口径。
    // 口径如实说明——本用例里同一个用户还建过任务（create_task 也是 CORE_EVENTS），
    // 所以这条**证明不了**"只写评论的团队成员也算活跃"；那需要一个只评论的第二成员，
    // 属 WAW 口径落地（任务 #49）的范围，不在本条里冒充。
    expect(
      after.coreActiveUsers,
      "CORE_EVENTS 成员事件未计入严格活跃口径 ⇒ 读路径没消费事件表",
    ).toBeGreaterThanOrEqual(1);
  });
});
