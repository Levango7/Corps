import { describe, it, expect, vi } from "vitest";
import { runTaskQuickAction, deleteTaskNow, type QuickActionDeps } from "@/lib/task-quick-actions";
import type { Task } from "@/lib/types";

/**
 * 看板快捷菜单副作用单元测试
 *
 * 覆盖 web/lib/task-quick-actions.ts，钉住四条容易回退的行为契约：
 *  - complete 委托给页面注入的乐观更新，模块自身不发状态请求
 *  - delete 只上报意图（后端是硬删除，必须先过确认弹窗）
 *  - duplicate 先取详情再创建（列表端点不返回 description，否则副本会静默丢描述）
 *  - share 复用已有 token，只在缺失时 rotate（每次 rotate 会作废已发出的旧链接）
 *
 * 依赖全部走 QuickActionDeps 注入，因此无需渲染 React、无需 mock next-intl，
 * 纯 node 环境即可跑。
 */

const baseTask: Task = {
  id: "t1",
  title: "原任务",
  status: "in_progress",
  priority: "high",
};

function makeDeps(overrides: Partial<QuickActionDeps> = {}) {
  const apiFetch = vi.fn();
  const copyText = vi.fn().mockResolvedValue(undefined);
  const onComplete = vi.fn();
  const onRequestDelete = vi.fn();
  const refresh = vi.fn().mockResolvedValue(undefined);
  const toast = vi.fn();
  const deps: QuickActionDeps = {
    wid: "w1",
    onComplete,
    onRequestDelete,
    refresh,
    toast,
    messages: {
      duplicated: "已创建副本",
      shareLinkCopied: "分享链接已复制",
      failed: "操作失败，请重试",
    },
    apiFetch,
    copyText,
    origin: "https://example.test",
    ...overrides,
  };
  return { deps, apiFetch, copyText, onComplete, onRequestDelete, refresh, toast };
}

describe("runTaskQuickAction：complete", () => {
  it("委托给页面注入的乐观更新，模块自身不发请求", async () => {
    const { deps, onComplete, apiFetch } = makeDeps();
    await runTaskQuickAction("complete", baseTask, deps);
    expect(onComplete).toHaveBeenCalledWith(baseTask);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe("runTaskQuickAction：delete", () => {
  it("只上报删除意图，不直接调 DELETE 接口", async () => {
    const { deps, onRequestDelete, apiFetch } = makeDeps();
    await runTaskQuickAction("delete", baseTask, deps);
    expect(onRequestDelete).toHaveBeenCalledWith(baseTask);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe("runTaskQuickAction：duplicate", () => {
  it("先取详情再创建，副本保留 description", async () => {
    const { deps, apiFetch, refresh, toast } = makeDeps();
    apiFetch
      .mockResolvedValueOnce({ ...baseTask, description: "详细描述" })
      .mockResolvedValueOnce({});

    await runTaskQuickAction("duplicate", baseTask, deps);

    expect(apiFetch.mock.calls[0][0]).toBe("/api/v1/workspaces/w1/tasks/t1");
    const [path, init] = apiFetch.mock.calls[1];
    expect(path).toBe("/api/v1/workspaces/w1/tasks");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      title: "原任务",
      description: "详细描述",
      status: "in_progress",
      priority: "high",
    });
    expect(refresh).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("success", "已创建副本");
  });

  it("空字段不下发，避免把 null 当成有效值覆盖", async () => {
    const { deps, apiFetch } = makeDeps();
    apiFetch
      .mockResolvedValueOnce({
        ...baseTask,
        description: null,
        assigneeId: null,
        dueDate: null,
        milestoneId: null,
      })
      .mockResolvedValueOnce({});

    await runTaskQuickAction("duplicate", baseTask, deps);

    const body = JSON.parse(apiFetch.mock.calls[1][1].body);
    expect(body).toEqual({ title: "原任务", status: "in_progress", priority: "high" });
    expect(Object.keys(body)).not.toContain("description");
  });

  it("创建失败时提示失败且不刷新列表", async () => {
    const { deps, apiFetch, refresh, toast } = makeDeps();
    apiFetch.mockResolvedValueOnce(baseTask).mockRejectedValueOnce(new Error("boom"));

    await runTaskQuickAction("duplicate", baseTask, deps);

    expect(refresh).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("error", "操作失败，请重试");
  });
});

describe("runTaskQuickAction：share", () => {
  it("已有 token 时复用，不触发 rotate", async () => {
    const { deps, apiFetch, copyText, toast } = makeDeps();
    apiFetch.mockResolvedValueOnce({ shareToken: "tok-existing" });

    await runTaskQuickAction("share", baseTask, deps);

    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch.mock.calls[0][0]).toBe("/api/v1/workspaces/w1/tasks/t1/share");
    expect(copyText).toHaveBeenCalledWith("https://example.test/tasks/share/tok-existing");
    expect(toast).toHaveBeenCalledWith("success", "分享链接已复制");
  });

  it("无 token 时才 rotate 生成新 token", async () => {
    const { deps, apiFetch, copyText } = makeDeps();
    apiFetch
      .mockResolvedValueOnce({ shareToken: null })
      .mockResolvedValueOnce({ shareToken: "tok-new" });

    await runTaskQuickAction("share", baseTask, deps);

    expect(apiFetch.mock.calls[1][0]).toBe("/api/v1/workspaces/w1/tasks/t1");
    expect(JSON.parse(apiFetch.mock.calls[1][1].body)).toEqual({ shareToken: "rotate" });
    expect(copyText).toHaveBeenCalledWith("https://example.test/tasks/share/tok-new");
  });

  it("剪贴板不可用时报失败，不谎称已复制", async () => {
    const { deps, apiFetch, toast } = makeDeps();
    apiFetch.mockResolvedValueOnce({ shareToken: "tok" });
    deps.copyText = vi.fn().mockRejectedValue(new Error("clipboard unavailable"));

    await runTaskQuickAction("share", baseTask, deps);

    expect(toast).toHaveBeenCalledWith("error", "操作失败，请重试");
    expect(toast.mock.calls.some((c) => c[0] === "success")).toBe(false);
  });

  it("查询与 rotate 都拿不到 token 时报失败", async () => {
    const { deps, apiFetch, copyText, toast } = makeDeps();
    apiFetch
      .mockResolvedValueOnce({ shareToken: null })
      .mockResolvedValueOnce({ shareToken: null });

    await runTaskQuickAction("share", baseTask, deps);

    expect(copyText).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("error", "操作失败，请重试");
  });
});

describe("deleteTaskNow（确认弹窗确认后真正执行）", () => {
  it("成功：发 DELETE + 刷新 + 返回 true", async () => {
    const { deps, apiFetch, refresh } = makeDeps();
    apiFetch.mockResolvedValueOnce({});

    await expect(deleteTaskNow(baseTask, deps)).resolves.toBe(true);

    expect(apiFetch.mock.calls[0][0]).toBe("/api/v1/workspaces/w1/tasks/t1");
    expect(apiFetch.mock.calls[0][1].method).toBe("DELETE");
    expect(refresh).toHaveBeenCalled();
  });

  it("失败：提示失败 + 返回 false（弹窗保留以便重试）", async () => {
    const { deps, apiFetch, refresh, toast } = makeDeps();
    apiFetch.mockRejectedValueOnce(new Error("boom"));

    await expect(deleteTaskNow(baseTask, deps)).resolves.toBe(false);

    expect(refresh).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("error", "操作失败，请重试");
  });
});
