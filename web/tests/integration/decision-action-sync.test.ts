import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader, createTask, type RegisterResult } from "../helpers";

/**
 * 决策闭环的**接线**集成测试：决策里的行动项 → 真的产出任务 → 勾选真的转 done。
 *
 * ─── 为什么单独一份 ───────────────────────────────────────────
 * 产品的楔子是「把会后的讨论落成决策与任务」（docs/design/POSITIONING.md）。这条链
 * 的实现是 `lib/decision-action-parser.ts:syncActionItems`，由
 * `POST /v1/workspaces/{wid}/tasks/{id}/decisions` 在同一事务内调用。
 *
 * 但既有覆盖只证明**函数自己是对的**：
 *  - `tests/unit/decision-action-parser.test.ts` 测的是纯函数 `parseActionItems`
 *    与模板常量，**`syncActionItems` 一个字都没测**；
 *  - `e2e/task-management.spec.ts` 点了「记一条」并断言 markdown 渲染出来，
 *    **没有断言行动项变成任务**——所以「解析出 2 条、建出 0 个任务」这种断线，
 *    现有用例全绿。
 * 这正是本仓反复踩过的形态：函数正确不等于被调用，被调用不等于产出可见。
 *
 * ─── 顺带钉住的第二件事 ──────────────────────────────────────
 * 免费版每工作区 10 条决策的上限（`FREE_DECISION_LIMIT`，v2 定价 r07）此前
 * **只存在于定价文案、服务端零执行点**（审计 P1-2）。执行点补上后需要一条用例
 * 证明它真的会挡，而不是又变成一句承诺。
 */

interface TaskRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  assigneeId: string | null;
  dueDate: string | null;
}

interface ActionSync {
  created: number;
  updated: number;
  removed: number;
  tasks: TaskRow[];
}

async function postDecision(
  owner: RegisterResult,
  wid: string,
  taskId: string,
  markdown: string,
): Promise<{
  status: number;
  actionItems?: ActionSync;
  decisionId?: string;
  message?: string;
  code?: number;
}> {
  const res = await fetch(`${BASE}/workspaces/${wid}/tasks/${taskId}/decisions`, {
    method: "POST",
    headers: { ...authHeader(owner.accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({ markdown }),
  });
  const body = (await res.json().catch(() => null)) as {
    code?: number;
    message?: string;
    data?: { id?: string; actionItems?: ActionSync };
  } | null;
  return {
    status: res.status,
    code: body?.code,
    message: body?.message,
    actionItems: body?.data?.actionItems,
    decisionId: body?.data?.id,
  };
}

async function listTasks(owner: RegisterResult, wid: string): Promise<TaskRow[]> {
  const res = await fetch(`${BASE}/workspaces/${wid}/tasks?limit=100`, {
    headers: authHeader(owner.accessToken),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data?: { items?: TaskRow[] } };
  return body?.data?.items ?? [];
}

/** 固定行号布局：行动项必须落在第 4、5 行，v2 才能按 lineIndex 对上同一条。 */
function decisionMarkdown(
  email: string,
  due1: string,
  due2: string,
  checkedFirst: boolean,
): string {
  return [
    "## 决定",
    "采用方案 A。",
    "",
    "## 执行计划",
    `- [${checkedFirst ? "x" : " "}] @${email} ${due1} 采购预算复核 #high`,
    `- [ ] ${due2} 只带日期的行动项`,
  ].join("\n");
}

describe("决策闭环：行动项→任务→完成（接线）", () => {
  let owner: RegisterResult;
  let wid: string;
  let taskId: string;
  const due1 = "2026-12-01";
  const due2 = "2026-12-05";

  beforeAll(async () => {
    owner = await registerUser({ workspaceName: "闭环接线工作区", prefix: "loop" });
    wid = owner.workspace.id;
    const created = await createTask(owner.accessToken, wid, {
      title: `闭环母任务-${Date.now()}`,
    });
    expect(created.status).toBe(201);
    taskId = created.body.data!.id!;
  });

  it("决策里的行动项真的建出任务，且指派人/日期/优先级落库", async () => {
    const res = await postDecision(
      owner,
      wid,
      taskId,
      decisionMarkdown(owner.user.email, due1, due2, false),
    );
    expect(res.status).toBe(201);
    expect(res.actionItems?.created).toBe(2);
    expect(res.actionItems?.tasks).toHaveLength(2);

    // 断言要回到**读取面**：响应里带 tasks 不等于任务真的可查、字段真的写对。
    const tasks = await listTasks(owner, wid);
    const review = tasks.find((t) => t.title === "采购预算复核");
    const dateOnly = tasks.find((t) => t.title === "只带日期的行动项");
    expect(review, "带 @邮箱 的行动项应建成任务").toBeTruthy();
    expect(dateOnly, "只带日期的行动项也应建成任务").toBeTruthy();
    expect(review!.status).toBe("todo");
    expect(review!.priority).toBe("high");
    expect(review!.assigneeId).toBe(owner.user.id);
    expect(review!.dueDate?.startsWith(due1)).toBe(true);
    // 无 @ 无优先级标签 → 指派生为空、优先级取默认 medium
    expect(dateOnly!.assigneeId).toBeNull();
    expect(dateOnly!.priority).toBe("medium");
    expect(dateOnly!.dueDate?.startsWith(due2)).toBe(true);
  });

  it("勾选同一条行动项 → 原任务转 done，且不重复建任务", async () => {
    const res = await postDecision(
      owner,
      wid,
      taskId,
      decisionMarkdown(owner.user.email, due1, due2, true),
    );
    expect(res.status).toBe(201);
    // 这一条是"闭环"的下半段：勾选是**同步**而不是再建一个任务。
    // created 若 >0，说明 diff 没按 lineIndex 对上，用户会看到重复任务。
    expect(res.actionItems?.created).toBe(0);
    expect(res.actionItems?.updated).toBe(1);

    const tasks = await listTasks(owner, wid);
    const same = tasks.filter((t) => t.title === "采购预算复核");
    expect(same).toHaveLength(1);
    expect(same[0].status).toBe("done");
  });

  it("没有行动项的决策不虚报闭环", async () => {
    const created = await createTask(owner.accessToken, wid, {
      title: `无行动项母任务-${Date.now()}`,
    });
    const plain = await postDecision(
      owner,
      wid,
      created.body.data!.id!,
      [
        "## 决定",
        "仅记录结论，不派生任务。",
        "",
        "## 理由",
        "- 用来钉住 decision_landed 的触发条件",
      ].join("\n"),
    );
    expect(plain.status).toBe(201);
    expect(plain.actionItems?.created).toBe(0);
    expect(plain.actionItems?.tasks ?? []).toHaveLength(0);
  });

  it("行动项列表端点：顺序/字段回读齐全，勾选镜像到关联任务状态", async () => {
    const suffix = Date.now();
    const created = await createTask(owner.accessToken, wid, {
      title: `面板母任务-${suffix}`,
    });
    expect(created.status).toBe(201);
    const panelTaskId = created.body.data!.id!;

    const markdown = [
      "## 决定",
      "面板接线。",
      "",
      "## 执行计划",
      `- [ ] @${owner.user.email} ${due1} 面板行动项A-${suffix} #high`,
      `- [ ] ${due2} 面板行动项B-${suffix}`,
    ].join("\n");
    const saved = await postDecision(owner, wid, panelTaskId, markdown);
    expect(saved.status).toBe(201);
    const decisionId = saved.decisionId;
    expect(decisionId, "决策响应必须带 id：列表端点按它取行动项").toBeTruthy();

    const itemsUrl = `${BASE}/workspaces/${wid}/tasks/${panelTaskId}/decisions/${decisionId}/action-items`;
    const listRes = await fetch(itemsUrl, { headers: authHeader(owner.accessToken) });
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      code?: number;
      data?: {
        items?: Array<{
          id: string;
          title: string;
          completed: boolean;
          priority: string;
          assignee: { id: string; name: string; email: string } | null;
          dueDate: string | null;
          taskId: string | null;
        }>;
      };
    };
    expect(listBody.code).toBe(200);
    const items = listBody.data?.items ?? [];
    // 顺序按 lineIndex：面板渲染依赖它保持与 markdown 同序
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe(`面板行动项A-${suffix}`);
    expect(items[0].completed).toBe(false);
    expect(items[0].priority).toBe("high");
    expect(items[0].assignee?.id).toBe(owner.user.id);
    expect(items[0].dueDate?.startsWith(due1)).toBe(true);
    expect(items[0].taskId, "面板点勾选时要能回链关联任务").toBeTruthy();
    expect(items[1].title).toBe(`面板行动项B-${suffix}`);
    expect(items[1].assignee).toBeNull();
    expect(items[1].priority).toBe("medium");

    const toggle = (itemId: string, completed: boolean) =>
      fetch(`${itemsUrl}/${itemId}`, {
        method: "PATCH",
        headers: {
          ...authHeader(owner.accessToken),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ completed }),
      });

    const doneRes = await toggle(items[0].id, true);
    expect(doneRes.status).toBe(200);
    const doneBody = (await doneRes.json()) as { data?: { completed?: boolean } };
    expect(doneBody.data?.completed).toBe(true);
    const afterDone = await listTasks(owner, wid);
    expect(
      afterDone.find((t) => t.id === items[0].taskId)?.status,
      "勾选行动项必须镜像到关联任务（与 parser 同口径）",
    ).toBe("done");

    const backRes = await toggle(items[0].id, false);
    expect(backRes.status).toBe(200);
    const afterBack = await listTasks(owner, wid);
    expect(afterBack.find((t) => t.id === items[0].taskId)?.status).toBe("todo");

    const listAgain = await fetch(itemsUrl, {
      headers: authHeader(owner.accessToken),
    });
    const againBody = (await listAgain.json()) as typeof listBody;
    expect(againBody.data?.items?.[0].completed).toBe(false);
  });

  it("行动项端点：决策不在该任务下 → 404，未知行动项 → 404", async () => {
    const created = await createTask(owner.accessToken, wid, {
      title: `错位母任务-${Date.now()}`,
    });
    expect(created.status).toBe(201);
    const otherTaskId = created.body.data!.id!;
    const saved = await postDecision(
      owner,
      wid,
      otherTaskId,
      "## 决定\n错位取证用。\n\n## 执行计划\n- [ ] 2026-12-20 错位行动项",
    );
    expect(saved.status).toBe(201);
    const decisionId = saved.decisionId!;

    // 决策属于 otherTask，用母任务 id 去取 → 404（不跨任务泄漏）
    const crossTask = await fetch(
      `${BASE}/workspaces/${wid}/tasks/${taskId}/decisions/${decisionId}/action-items`,
      { headers: authHeader(owner.accessToken) },
    );
    expect(crossTask.status).toBe(404);
    const crossBody = (await crossTask.json()) as { code?: number; message?: string };
    expect(crossBody.code).toBe(404);
    // message 走 apiMsg 本地化：测试请求不带 NEXT_LOCALE/Accept-Language → zh
    expect(crossBody.message).toBe("决策不存在");

    const unknownItem = await fetch(
      `${BASE}/workspaces/${wid}/tasks/${otherTaskId}/decisions/${decisionId}/action-items/${crypto.randomUUID()}`,
      {
        method: "PATCH",
        headers: {
          ...authHeader(owner.accessToken),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ completed: true }),
      },
    );
    expect(unknownItem.status).toBe(404);
    const unknownBody = (await unknownItem.json()) as {
      code?: number;
      message?: string;
    };
    expect(unknownBody.code).toBe(404);
    expect(unknownBody.message).toBe("行动项不存在");

    // 参数形状错误 → 400（zod），不能静默当 false
    const badBody = await fetch(
      `${BASE}/workspaces/${wid}/tasks/${otherTaskId}/decisions/${decisionId}/action-items/whatever`,
      {
        method: "PATCH",
        headers: {
          ...authHeader(owner.accessToken),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ completed: "yes" }),
      },
    );
    expect(badBody.status).toBe(400);
  });

  it("免费版第 11 条决策被服务端挡下（402），不是只在定价文案里", async () => {
    // 独立工作区：前面的用例已在本区建了决策，计数按工作区累计会串味。
    const owner2 = await registerUser({ workspaceName: "免费额度工作区", prefix: "limit" });
    const wid2 = owner2.workspace.id;
    const t2 = await createTask(owner2.accessToken, wid2, { title: "额度母任务" });
    const taskId2 = t2.body.data!.id!;

    for (let i = 1; i <= 10; i++) {
      const r = await postDecision(owner2, wid2, taskId2, `## 决定\n第 ${i} 条记录。`);
      expect(r.status, `第 ${i} 条应在额度内`).toBe(201);
    }
    const overflow = await postDecision(owner2, wid2, taskId2, "## 决定\n第 11 条应被挡下。");
    expect(overflow.status).toBe(402);
    expect(overflow.code).toBe(402);
    expect(overflow.message && overflow.message.length > 0).toBe(true);
  });
});
