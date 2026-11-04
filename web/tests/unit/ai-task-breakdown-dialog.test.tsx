// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * TaskBreakdownDialog 契约（components/ai/TaskBreakdownDialog.tsx）：
 *  1. 打开即 POST /api/v1/ai/task-breakdown { taskTitle }；loading 态
 *  2. 返回后可编辑子任务列表（标题/描述/工时/优先级/删除）+ addSubtask
 *  3. 确认创建 → 逐条 POST /api/v1/workspaces/{wid}/tasks { parentId: taskId }
 *     成功 toast success(count) + onCreated + onClose
 *  4. 部分失败 → toast warning partialCreateSuccess{created, failed:1} 仍关闭
 *  5. 全失败（0 条已创建）→ toast error createFailed，不关闭
 *  6. 无有效标题 → 确认按钮 disabled
 *  7. 拉取失败 → t("fetchFailed") 错误态、无底部操作栏
 *  8. FeedbackButtons(capability=task-breakdown)；Escape 关闭
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  toast: vi.fn(),
  onClose: vi.fn(),
  onCreated: vi.fn(),
}));

vi.mock("next-intl", () => {
  const cache = new Map<string, (key: string, vars?: Record<string, unknown>) => string>();
  const useTranslations = (ns: string) => {
    let fn = cache.get(ns);
    if (!fn) {
      const created = (key: string, vars?: Record<string, unknown>) =>
        vars ? `${ns}:${key}:${JSON.stringify(vars)}` : `${ns}:${key}`;
      cache.set(ns, created);
      fn = created;
    }
    return fn;
  };
  return { useTranslations };
});
vi.mock("@/lib/api", () => ({ api: mocks.api }));
vi.mock("@/components/Toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock("@/components/ai/FeedbackButtons", () => ({
  FeedbackButtons: (props: { capability?: string; workspaceId?: string }) => (
    <div
      data-testid="fb"
      data-capability={props.capability ?? ""}
      data-wid={props.workspaceId ?? ""}
    />
  ),
}));

import TaskBreakdownDialog from "@/components/ai/TaskBreakdownDialog";

const WID = "ws-tbd-1";
const TASK_ID = "task-1";
const TASK_TITLE = "搭建登录页";

function breakdownResult() {
  return {
    subtasks: [
      {
        title: "写登录表单",
        description: "含邮箱与密码校验",
        estimatedHours: 4,
        priority: "high",
        suggestedAssignee: "Alice",
      },
      {
        title: "接登录 API",
        description: "",
        estimatedHours: 2,
        priority: "medium",
        suggestedAssignee: null,
      },
    ],
    reasoning: "按前端与接口两条线拆解",
  };
}

function renderDialog(props: { onCreated?: () => void } = {}) {
  return render(
    <TaskBreakdownDialog
      wid={WID}
      taskId={TASK_ID}
      taskTitle={TASK_TITLE}
      onClose={mocks.onClose}
      onCreated={props.onCreated ?? mocks.onCreated}
    />,
  );
}

/** 等首次拆解完成（loading 消失、第一条标题 input 出现） */
async function loaded() {
  await waitFor(() => expect(screen.queryByText("ai.taskBreakdown:loading")).toBeFalsy());
  const firstTitle = (await screen.findAllByLabelText("ai.taskBreakdown:titleLabel"))[0];
  return firstTitle as HTMLInputElement;
}

// 删空列表后零匹配是合法状态，故用 queryAllBy（getAllBy 零匹配会抛）
const titleLabels = () => screen.queryAllByLabelText("ai.taskBreakdown:titleLabel");

beforeEach(() => {
  mocks.api.mockReset();
  mocks.toast.mockReset();
  mocks.onClose.mockReset();
  mocks.onCreated.mockReset();
});
afterEach(() => cleanup());

describe("TaskBreakdownDialog", () => {
  it("对话框骨架：dialog 角色、标题、源任务名", async () => {
    mocks.api.mockResolvedValueOnce(breakdownResult());
    renderDialog();

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("ai.taskBreakdown:dialogTitle")).toBeInTheDocument();
    expect(screen.getByText(TASK_TITLE)).toBeInTheDocument();
    await loaded();
  });

  it("打开即 POST /api/v1/ai/task-breakdown { taskTitle }，且先显示 loading", async () => {
    let resolveApi!: (v: unknown) => void;
    mocks.api.mockReturnValueOnce(
      new Promise((res) => {
        resolveApi = res;
      }),
    );
    renderDialog();

    expect(screen.getByText("ai.taskBreakdown:loading")).toBeInTheDocument();
    expect(mocks.api).toHaveBeenCalledWith("/api/v1/ai/task-breakdown", {
      method: "POST",
      body: JSON.stringify({ taskTitle: TASK_TITLE }),
      signal: expect.any(AbortSignal),
    });
    expect(screen.queryByText("ai.taskBreakdown:confirmCreate")).toBeFalsy();
    resolveApi(breakdownResult());
    await loaded();
  });

  it("返回后渲染子任务列表（标题值/工时/优先级 select/推理说明）", async () => {
    mocks.api.mockResolvedValueOnce(breakdownResult());
    renderDialog();
    await loaded();

    const titles = titleLabels();
    expect(titles).toHaveLength(2);
    expect((titles[0] as HTMLInputElement).value).toBe("写登录表单");
    // 每条子任务各一枚同名 label 的工时/优先级控件，断言取第一条
    const hours = screen.getAllByLabelText(
      "ai.taskBreakdown:estimatedHours",
    )[0] as HTMLInputElement;
    expect(hours.value).toBe("4");
    const prio = screen.getAllByLabelText("ai.taskBreakdown:priority")[0] as HTMLSelectElement;
    expect(prio.value).toBe("high");
    expect(screen.getByText("ai.taskBreakdown:reasoning")).toBeInTheDocument();
    const fb = screen.getByTestId("fb");
    expect(fb.getAttribute("data-capability")).toBe("task-breakdown");
    expect(fb.getAttribute("data-wid")).toBe(WID);
  });

  it("编辑标题与优先级回写表单状态", async () => {
    mocks.api.mockResolvedValueOnce(breakdownResult());
    renderDialog();
    await loaded();

    fireEvent.change(titleLabels()[0], { target: { value: "改后的标题" } });
    expect((titleLabels()[0] as HTMLInputElement).value).toBe("改后的标题");
    const prio = screen.getAllByLabelText("ai.taskBreakdown:priority")[0] as HTMLSelectElement;
    fireEvent.change(prio, { target: { value: "urgent" } });
    expect(
      (screen.getAllByLabelText("ai.taskBreakdown:priority")[0] as HTMLSelectElement).value,
    ).toBe("urgent");
  });

  it("删除子任务仅剩一条；全部删空后 addSubtask 追加空白项且确认按钮 disabled", async () => {
    mocks.api.mockResolvedValueOnce(breakdownResult());
    renderDialog();
    await loaded();

    // 两条都有标题，逐条删到空
    fireEvent.click(screen.getAllByLabelText("ai.taskBreakdown:removeSubtask")[0]);
    expect(titleLabels()).toHaveLength(1);
    fireEvent.click(screen.getAllByLabelText("ai.taskBreakdown:removeSubtask")[0]);
    expect(titleLabels()).toHaveLength(0);

    // 空列表 + 追加空白子任务（标题为空）→ 确认按钮 disabled
    fireEvent.click(screen.getByText("ai.taskBreakdown:addSubtask"));
    expect(titleLabels()).toHaveLength(1);
    const confirm = screen.getByText("ai.taskBreakdown:confirmCreate").closest("button")!;
    expect(confirm).toBeDisabled();
  });

  it("全部标题为空时确认 disabled，点击 addSubtask 后补标题即可创建", async () => {
    mocks.api.mockResolvedValueOnce({ subtasks: [], reasoning: "" });
    renderDialog();
    await waitFor(() =>
      expect(screen.getByText("ai.taskBreakdown:emptySubtasks")).toBeInTheDocument(),
    );
    // 空结果无反馈按钮
    expect(screen.queryByTestId("fb")).toBeFalsy();

    fireEvent.click(screen.getByText("ai.taskBreakdown:addSubtask"));
    fireEvent.change(titleLabels()[0], { target: { value: "新任务" } });
    fireEvent.click(screen.getByText("ai.taskBreakdown:confirmCreate").closest("button")!);

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api).toHaveBeenLastCalledWith(`/api/v1/workspaces/${WID}/tasks`, {
      method: "POST",
      body: JSON.stringify({
        title: "新任务",
        description: undefined,
        priority: "medium",
        parentId: TASK_ID,
      }),
    });
    expect(mocks.toast).toHaveBeenCalledWith(
      "success",
      'ai.taskBreakdown:createSuccess:{"count":1}',
    );
    expect(mocks.onCreated).toHaveBeenCalledTimes(1);
    expect(mocks.onClose).toHaveBeenCalledTimes(1);
  });

  it("确认创建：有效子任务逐条 POST（parentId=taskId）→ success toast + onCreated + onClose", async () => {
    mocks.api.mockResolvedValueOnce(breakdownResult());
    const onCreated = vi.fn();
    renderDialog({ onCreated });
    await loaded();

    fireEvent.click(screen.getByText("ai.taskBreakdown:confirmCreate").closest("button")!);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(3)); // 1 拆解 + 2 创建
    expect(mocks.api).toHaveBeenNthCalledWith(2, `/api/v1/workspaces/${WID}/tasks`, {
      method: "POST",
      body: JSON.stringify({
        title: "写登录表单",
        description: "含邮箱与密码校验",
        priority: "high",
        parentId: TASK_ID,
      }),
    });
    expect(mocks.toast).toHaveBeenCalledWith(
      "success",
      'ai.taskBreakdown:createSuccess:{"count":2}',
    );
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(mocks.onClose).toHaveBeenCalledTimes(1);
  });

  it("部分失败：第 1 条成功第 2 条失败 → warning partialCreateSuccess 并关闭", async () => {
    mocks.api
      .mockResolvedValueOnce(breakdownResult())
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("boom"));
    renderDialog();
    await loaded();

    fireEvent.click(screen.getByText("ai.taskBreakdown:confirmCreate").closest("button")!);
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        "warning",
        'ai.taskBreakdown:partialCreateSuccess:{"created":1,"failed":1}',
      ),
    );
    expect(mocks.onCreated).toHaveBeenCalledTimes(1);
    expect(mocks.onClose).toHaveBeenCalledTimes(1);
  });

  it("全部失败（0 条已创建）→ error createFailed，不关闭", async () => {
    mocks.api.mockResolvedValueOnce(breakdownResult()).mockRejectedValueOnce(new Error("boom"));
    renderDialog();
    await loaded();

    fireEvent.click(screen.getByText("ai.taskBreakdown:confirmCreate").closest("button")!);
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith("error", "ai.taskBreakdown:createFailed"),
    );
    expect(mocks.onClose).not.toHaveBeenCalled();
  });

  it("拆解接口失败 → fetchFailed 错误态，无底部操作栏与反馈按钮", async () => {
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    renderDialog();

    await waitFor(() =>
      expect(screen.getByText("ai.taskBreakdown:fetchFailed")).toBeInTheDocument(),
    );
    expect(screen.queryByText("ai.taskBreakdown:confirmCreate")).toBeFalsy();
    expect(screen.queryByTestId("fb")).toBeFalsy();
  });

  it("Escape 关闭；加载失败后错误条内的关闭按钮也走 onClose", async () => {
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    renderDialog();
    await waitFor(() =>
      expect(screen.getByText("ai.taskBreakdown:fetchFailed")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getAllByLabelText("button:close")[0]);
    expect(mocks.onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape 键按下调用 onClose", async () => {
    mocks.api.mockResolvedValueOnce(breakdownResult());
    renderDialog();
    await loaded();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(mocks.onClose).toHaveBeenCalledTimes(1);
  });
});
