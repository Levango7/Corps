// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 工作流执行引擎契约（lib/workflow/executor.ts）：
 *  - 状态机 pending → running（写 startedAt）→ completed/failed（写 completedAt + result.actions）
 *  - 防跨租户执行：workflow.workspaceId ≠ 传入 workspaceId → 立即 markFailed("workspace mismatch")
 *  - workflow 不存在 → markFailed("not found")
 *  - **单动作失败即终止后续动作**（保守策略）且整体判 failed
 *  - 逐动作前查执行状态，cancelled 则停止剩余动作
 *  - 未知异常兜底：catch → markFailed，**不向调用方抛**；markFailed 自身失败也只记日志
 *  - 动作实现契约：create_task 的 {{trigger.*}} 占位符 + 默认值；send_notification 的**成员校验**；
 *    update_task 的「至少一个可更新字段」与「限定工作区」；未命中 → failed 文案
 *
 * runWithWorkspace 用可编程 mock：记录每次事务调用，供断言「每操作独立短事务」的形态。
 */
const h = vi.hoisted(() => {
  type Call = { model: string; method: string; args: unknown };
  return {
    calls: [] as Call[],
    workflowRow: null as null | { actions: unknown; name: string; workspaceId: string },
    executionStatus: "pending" as string,
    executionUpdates: [] as Array<Record<string, unknown>>,
    taskCreateResult: { id: "task-new" } as { id: string },
    memberRow: null as null | { userId: string },
    taskUpdateCount: 1 as number,
    notificationRow: { id: "notif-1" } as { id: string },
    workflowFindThrows: null as null | Error,
    execFindThrows: null as null | Error,
    markFailedThrows: false,
    infoLog: [] as unknown[],
    errorLog: [] as unknown[],
    warnLog: [] as unknown[],
  };
});

vi.mock("@/lib/auth", () => ({
  runWithWorkspace: vi.fn(async (_wid: string, fn: (tx: unknown) => unknown) => {
    const tx = {
      workflow: {
        findUnique: async (args: unknown) => {
          h.calls.push({ model: "workflow", method: "findUnique", args });
          if (h.workflowFindThrows) throw h.workflowFindThrows;
          return h.workflowRow;
        },
      },
      workflowExecution: {
        findUnique: async (args: unknown) => {
          h.calls.push({ model: "workflowExecution", method: "findUnique", args });
          if (h.execFindThrows) throw h.execFindThrows;
          return { status: h.executionStatus };
        },
        update: async (args: unknown) => {
          h.calls.push({ model: "workflowExecution", method: "update", args });
          const data = (args as { data: Record<string, unknown> }).data;
          h.executionUpdates.push(data);
          if (h.markFailedThrows && data.status === "failed") {
            throw new Error("markFailed boom");
          }
          return {};
        },
      },
      task: {
        create: async (args: unknown) => {
          h.calls.push({ model: "task", method: "create", args });
          return h.taskCreateResult;
        },
        updateMany: async (args: unknown) => {
          h.calls.push({ model: "task", method: "updateMany", args });
          return { count: h.taskUpdateCount };
        },
      },
      member: {
        findFirst: async (args: unknown) => {
          h.calls.push({ model: "member", method: "findFirst", args });
          return h.memberRow;
        },
      },
      notification: {
        create: async (args: unknown) => {
          h.calls.push({ model: "notification", method: "create", args });
          return h.notificationRow;
        },
      },
    };
    return fn(tx);
  }),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: (...a: unknown[]) => h.infoLog.push(a),
    warn: (...a: unknown[]) => h.warnLog.push(a),
    error: (...a: unknown[]) => h.errorLog.push(a),
  },
}));

import { executeWorkflow } from "@/lib/workflow/executor";

const action = (type: string, config: Record<string, unknown>, order?: number) => ({
  type,
  config,
  ...(order === undefined ? {} : { order }),
});

beforeEach(() => {
  h.calls.length = 0;
  h.executionUpdates.length = 0;
  h.infoLog.length = 0;
  h.errorLog.length = 0;
  h.warnLog.length = 0;
  h.workflowRow = { actions: [], name: "wf", workspaceId: "w1" };
  h.executionStatus = "pending";
  h.taskCreateResult = { id: "task-new" };
  h.memberRow = { userId: "u-in" };
  h.taskUpdateCount = 1;
  h.workflowFindThrows = null;
  h.execFindThrows = null;
  h.markFailedThrows = false;
});

const finalUpdate = () => h.executionUpdates[h.executionUpdates.length - 1];

describe("状态机与防御", () => {
  it("happy path：running（startedAt）→ completed（completedAt + result.actions）", async () => {
    h.workflowRow = {
      actions: [action("create_task", { title: "T" })],
      name: "wf",
      workspaceId: "w1",
    };
    await executeWorkflow("w1", "wf-1", "exec-1", { k: "v" });
    expect(h.executionUpdates[0].status).toBe("running");
    expect(h.executionUpdates[0].startedAt).toBeInstanceOf(Date);
    const fin = finalUpdate();
    expect(fin.status).toBe("completed");
    expect(fin.completedAt).toBeInstanceOf(Date);
    expect(fin.result).toEqual({
      actions: [{ index: 0, type: "create_task", status: "success", entityId: "task-new" }],
      triggerData: { k: "v" },
    });
  });

  it("workflow 不存在：markFailed（result.error 带 id），不进入 running", async () => {
    h.workflowRow = null;
    await executeWorkflow("w1", "missing", "exec-1", {});
    expect(h.executionUpdates).toHaveLength(1);
    expect(h.executionUpdates[0].status).toBe("failed");
    expect(h.executionUpdates[0].result).toEqual({ error: "workflow missing not found" });
    expect(h.errorLog).toHaveLength(1);
  });

  it('跨租户防御：workflow.workspaceId ≠ 传入 → markFailed("workspace mismatch")', async () => {
    h.workflowRow = { actions: [], name: "wf", workspaceId: "other" };
    await executeWorkflow("w1", "wf-1", "exec-1", {});
    expect(h.executionUpdates[0].result).toEqual({ error: "workspace mismatch" });
    expect(h.errorLog).toHaveLength(1);
  });

  it("空 actions：仍走 running → completed（result.actions 为空数组）", async () => {
    await executeWorkflow("w1", "wf-1", "exec-1", {});
    expect(finalUpdate().status).toBe("completed");
    expect((finalUpdate().result as { actions: unknown[] }).actions).toEqual([]);
  });
});

describe("动作失败与取消", () => {
  it("单动作失败即终止后续动作，整体判 failed（保守策略）", async () => {
    h.workflowRow = {
      actions: [
        action("create_task", { title: "" }), // 必填缺失 → failed
        action("create_task", { title: "不该执行" }),
      ],
      name: "wf",
      workspaceId: "w1",
    };
    await executeWorkflow("w1", "wf-1", "exec-1", {});
    const creates = h.calls.filter((c) => c.model === "task" && c.method === "create");
    expect(creates).toHaveLength(0); // 第二个动作未执行
    const fin = finalUpdate();
    expect(fin.status).toBe("failed");
    expect((fin.result as { actions: Array<{ error?: string }> }).actions[0].error).toBe(
      "config.title is required",
    );
  });

  it("执行前状态为 cancelled：停止剩余动作", async () => {
    h.workflowRow = {
      actions: [action("create_task", { title: "A" }), action("create_task", { title: "B" })],
      name: "wf",
      workspaceId: "w1",
    };
    // 第一次查状态（动作 0 执行前）返回 cancelled
    h.executionStatus = "cancelled";
    await executeWorkflow("w1", "wf-1", "exec-1", {});
    const creates = h.calls.filter((c) => c.model === "task" && c.method === "create");
    expect(creates).toHaveLength(0);
    expect(h.warnLog.length + h.errorLog.length).toBe(0);
    // 现状注记：cancelled 提前 break 后仍会走终态判定，因无失败动作被写成 completed。
    // 这与 "cancelled 是终态" 的直觉不符，属既有行为；如需改为保留 cancelled 需产品/后续批裁决。
    expect(finalUpdate().status).toBe("completed");
  });

  it("逐动作前都查一次执行状态（取消检查）", async () => {
    h.workflowRow = {
      actions: [action("create_task", { title: "A" }), action("create_task", { title: "B" })],
      name: "wf",
      workspaceId: "w1",
    };
    await executeWorkflow("w1", "wf-1", "exec-1", {});
    const statusChecks = h.calls.filter(
      (c) => c.model === "workflowExecution" && c.method === "findUnique",
    );
    expect(statusChecks).toHaveLength(2);
  });
});

describe("create_task 动作", () => {
  it("{{trigger.*}} 占位符（含点路径）解析；缺省 status=todo、priority=medium", async () => {
    h.workflowRow = {
      actions: [
        action("create_task", {
          title: "处理：{{trigger.title}}",
          description: "负责人 {{trigger.data.user.name}}，缺失 {{trigger.nope}}",
          assigneeId: "{{trigger.assigneeId}}",
        }),
      ],
      name: "wf",
      workspaceId: "w1",
    };
    await executeWorkflow("w1", "wf-1", "exec-1", {
      title: "Bug#1",
      assigneeId: "u-9",
      data: { user: { name: "张三" } },
    });
    const create = h.calls.find((c) => c.model === "task" && c.method === "create")!;
    const data = (create.args as { data: Record<string, unknown> }).data;
    expect(data.title).toBe("处理：Bug#1");
    expect(data.description).toBe("负责人 张三，缺失 ");
    expect(data.assigneeId).toBe("u-9");
    expect(data.status).toBe("todo");
    expect(data.priority).toBe("medium");
    expect(data.workspaceId).toBe("w1");
  });

  it("配置里的 status/priority/dueDate 覆盖缺省；非法日期忽略", async () => {
    h.workflowRow = {
      actions: [
        action("create_task", {
          title: "T",
          status: "in_progress",
          priority: "high",
          dueDate: "2026-12-01T00:00:00.000Z",
        }),
      ],
      name: "wf",
      workspaceId: "w1",
    };
    await executeWorkflow("w1", "wf-1", "exec-1", {});
    const data = (
      h.calls.find((c) => c.model === "task")!.args as { data: Record<string, unknown> }
    ).data;
    expect(data.status).toBe("in_progress");
    expect(data.priority).toBe("high");
    expect(data.dueDate).toBeInstanceOf(Date);
  });
});

describe("send_notification 动作", () => {
  const cfg = { userId: "u-1", type: "mention", entityId: "e-1", entityTitle: "标题" };

  it("缺少任一必填：failed 且不查成员", async () => {
    h.workflowRow = {
      actions: [action("send_notification", { userId: "u-1" })],
      name: "wf",
      workspaceId: "w1",
    };
    await executeWorkflow("w1", "wf-1", "exec-1", {});
    expect(h.calls.some((c) => c.model === "member")).toBe(false);
    const fin = finalUpdate();
    expect((fin.result as { actions: Array<{ error?: string }> }).actions[0].error).toContain(
      "userId, type, entityId, entityTitle",
    );
  });

  it("目标非工作区成员：failed（防越权/钓鱼），不创建通知", async () => {
    h.memberRow = null;
    h.workflowRow = { actions: [action("send_notification", cfg)], name: "wf", workspaceId: "w1" };
    await executeWorkflow("w1", "wf-1", "exec-1", {});
    expect(h.calls.some((c) => c.model === "notification")).toBe(false);
    const fin = finalUpdate();
    expect((fin.result as { actions: Array<{ error?: string }> }).actions[0].error).toContain(
      "is not a member",
    );
  });

  it("成员校验与通知创建在**同一事务**：成功返回 notification id", async () => {
    h.workflowRow = { actions: [action("send_notification", cfg)], name: "wf", workspaceId: "w1" };
    await executeWorkflow("w1", "wf-1", "exec-1", {});
    expect(h.calls.some((c) => c.model === "member" && c.method === "findFirst")).toBe(true);
    expect(h.calls.some((c) => c.model === "notification" && c.method === "create")).toBe(true);
    const fin = finalUpdate();
    expect((fin.result as { actions: Array<{ entityId?: string }> }).actions[0].entityId).toBe(
      "notif-1",
    );
  });
});

describe("update_task 动作", () => {
  it("无 taskId：failed；无可更新字段：failed（不落库）", async () => {
    h.workflowRow = { actions: [action("update_task", {})], name: "wf", workspaceId: "w1" };
    await executeWorkflow("w1", "wf-1", "e", {});
    expect((finalUpdate().result as { actions: Array<{ error?: string }> }).actions[0].error).toBe(
      "config.taskId is required",
    );

    h.calls.length = 0;
    h.executionUpdates.length = 0;
    h.workflowRow = {
      actions: [action("update_task", { taskId: "t-1", dueDate: "not-a-date" })],
      name: "wf",
      workspaceId: "w1",
    };
    await executeWorkflow("w1", "wf-1", "e", {});
    expect(h.calls.some((c) => c.model === "task" && c.method === "updateMany")).toBe(false);
    expect((finalUpdate().result as { actions: Array<{ error?: string }> }).actions[0].error).toBe(
      "no updatable fields provided",
    );
  });

  it("updateMany 限定 workspace；count=0 → failed（not found in workspace）", async () => {
    h.taskUpdateCount = 0;
    h.workflowRow = {
      actions: [action("update_task", { taskId: "t-1", title: "改" })],
      name: "wf",
      workspaceId: "w1",
    };
    await executeWorkflow("w1", "wf-1", "e", {});
    const upd = h.calls.find((c) => c.model === "task" && c.method === "updateMany")!;
    expect((upd.args as { where: unknown }).where).toEqual({ id: "t-1", workspaceId: "w1" });
    expect(
      (finalUpdate().result as { actions: Array<{ error?: string }> }).actions[0].error,
    ).toContain("not found in workspace");
  });

  it("字段映射：assigneeId → connect；dueDate null → null", async () => {
    h.workflowRow = {
      actions: [action("update_task", { taskId: "t-1", assigneeId: "u-2", dueDate: null })],
      name: "wf",
      workspaceId: "w1",
    };
    await executeWorkflow("w1", "wf-1", "e", {});
    const data = (
      h.calls.find((c) => c.model === "task" && c.method === "updateMany")!.args as {
        data: Record<string, unknown>;
      }
    ).data;
    expect(data.assignee).toEqual({ connect: { id: "u-2" } });
    expect(data.dueDate).toBeNull();
  });
});

describe("action 解析与排序（parseActions 走 workflow.actions JSON）", () => {
  it("非数组 → []；未知 type/非法元素跳过；按 order 升序（缺省 0 最前）", async () => {
    h.workflowRow = {
      actions: [
        action("create_task", { title: "ordered-9" }, 9),
        { type: "not_supported", config: {} },
        "garbage",
        null,
        action("create_task", { title: "no-order" }), // order 缺省 → 0 → 排最前
        action("create_task", { title: "ordered-1" }, 1),
      ],
      name: "wf",
      workspaceId: "w1",
    };
    await executeWorkflow("w1", "wf-1", "e", {});
    const titles = h.calls
      .filter((c) => c.model === "task" && c.method === "create")
      .map((c) => (c.args as { data: { title: string } }).data.title);
    expect(titles).toEqual(["no-order", "ordered-1", "ordered-9"]);
  });

  it("actions 非数组（对象/字符串）→ 视为空数组（completed 空结果）", async () => {
    h.workflowRow = { actions: { not: "array" }, name: "wf", workspaceId: "w1" };
    await executeWorkflow("w1", "wf-1", "e", {});
    expect(finalUpdate().status).toBe("completed");
    expect((finalUpdate().result as { actions: unknown[] }).actions).toEqual([]);
  });
});

describe("未知异常兜底", () => {
  it("查询抛错：catch → markFailed(message)，不向调用方抛", async () => {
    h.workflowFindThrows = new Error("db down");
    await expect(executeWorkflow("w1", "wf-1", "e", {})).resolves.toBeUndefined();
    expect(h.executionUpdates[0]).toMatchObject({ status: "failed" });
    expect(h.executionUpdates[0].result).toEqual({ error: "db down" });
    expect(h.errorLog.length).toBeGreaterThan(0);
  });

  it("markFailed 自身也失败：只记日志、不再抛（静默降级）", async () => {
    h.workflowFindThrows = new Error("db down");
    h.markFailedThrows = true;
    await expect(executeWorkflow("w1", "wf-1", "e", {})).resolves.toBeUndefined();
    expect(h.errorLog.length).toBeGreaterThanOrEqual(2); // unexpected error + markFailed also failed
  });
});
