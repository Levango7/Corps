// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";

/**
 * WorkflowBuildDialog 契约（components/ai/WorkflowBuildDialog.tsx）：
 *  1. props {wid, onClose, onCreated?}；描述必填（空/空白时生成 disabled）
 *  2. 生成 → POST /api/v1/ai/workflow-build {wid, description(trim)}；loading 中
 *     Escape 与遮罩点击不关闭，textarea/生成按钮 disabled
 *  3. 返回 WorkflowDefinition 后渲染预览：name/description/trigger.event/
 *     conditions JSON/actions 列表（type + config JSON，空 config 不渲染）；无 conditions 行
 *     无 actions → t("noActions")；FeedbackButtons(capability=workflow-build)
 *  4. 确认创建 → POST /api/v1/workspaces/{wid}/workflows {name, description||undefined,
 *     trigger, actions} → success toast + onCreated + onClose；失败 → error toast 不关闭
 *  5. 生成失败 → t("error") 错误条（button:close dismiss 可清除）
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

import WorkflowBuildDialog from "@/components/ai/WorkflowBuildDialog";

const WID = "ws-wbd-1";
const NS = "ai.workflowBuild";
const DESC = "  任务创建后自动通知负责人并写周报  ";

const WORKFLOW = {
  name: "自动分配新任务",
  description: "新任务创建时通知负责人",
  trigger: { event: "task.created", conditions: { priority: "high" } },
  actions: [
    { type: "notify", config: { channel: "im" }, order: 1 },
    { type: "assign", config: {}, order: 2 },
  ],
};

function renderDialog() {
  return render(
    <WorkflowBuildDialog wid={WID} onClose={mocks.onClose} onCreated={mocks.onCreated} />,
  );
}

function descArea() {
  return screen.getByLabelText(`${NS}:descriptionLabel`) as HTMLTextAreaElement;
}
function generateButton() {
  return screen.getByText(`${NS}:generate`).closest("button") as HTMLButtonElement;
}
/** 完成一次生成（点击生成按钮并等待预览出现），随后回到非 loading 稳定态 */
async function generated() {
  fireEvent.click(generateButton());
  await waitFor(() => expect(screen.getByText(`${NS}:preview`)).toBeInTheDocument());
  await settleIdle();
}

/**
 * 显式等待非 loading 态并 flush pending passive effects。
 *
 * 竞态根因：Escape 走 window keydown 原生监听，由 useEffect 按 [loading, submitting]
 * 闭包重挂。预览 DOM 出现（loading=false 提交）与该 passive effect 执行之间没有先后
 * 保证——过早 keyDown 会命中仍挂着的 loading=true 旧闭包（Escape 被源码门控忽略），
 * 反向亦然（submitting 中旧 loading=false 闭包会误关）。空跑一次 act 强制 effect 队列
 * 清空后再做 Escape/遮罩操作。
 */
async function settleIdle() {
  // loading 期间按钮文案是 generating，getByText("…:generate") 抛错由 waitFor 重试吃掉
  await waitFor(() => expect(generateButton()).toBeEnabled());
  await act(async () => {});
}

beforeEach(() => {
  mocks.api.mockReset();
  mocks.toast.mockReset();
  mocks.onClose.mockReset();
  mocks.onCreated.mockReset();
});
afterEach(() => cleanup());

describe("WorkflowBuildDialog", () => {
  it("对话框骨架：dialog 角色、标题、描述输入；空描述与纯空白描述时生成 disabled", () => {
    renderDialog();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(`${NS}:title`)).toBeInTheDocument();
    expect(descArea()).toBeInTheDocument();
    expect(generateButton()).toBeDisabled();
    fireEvent.change(descArea(), { target: { value: "   " } });
    expect(generateButton()).toBeDisabled();
  });

  it("生成请求：POST /api/v1/ai/workflow-build body {wid, description(trim)}；loading 态禁用输入", async () => {
    let resolveApi!: (v: unknown) => void;
    mocks.api.mockReturnValueOnce(
      new Promise((res) => {
        resolveApi = res;
      }),
    );
    renderDialog();
    fireEvent.change(descArea(), { target: { value: DESC } });
    fireEvent.click(generateButton());

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(mocks.api).toHaveBeenCalledWith("/api/v1/ai/workflow-build", {
      method: "POST",
      body: JSON.stringify({ wid: WID, description: DESC.trim() }),
      signal: expect.any(AbortSignal),
    });
    // flush effects：确保 loading=true 闭包的 keydown 监听已挂上（否则旧 loading=false
    // 监听会误判为可关闭，反向抖动）
    await act(async () => {});
    expect(screen.getByText(`${NS}:generating`)).toBeInTheDocument();
    expect(screen.getByText(`${NS}:generating`).closest("button")).toBeDisabled();
    expect(descArea()).toBeDisabled();
    // loading 中 Escape 与遮罩点击不关闭
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("dialog"));
    fireEvent.click(screen.getByLabelText("button:close"));
    expect(mocks.onClose).not.toHaveBeenCalled();

    resolveApi(WORKFLOW);
    await waitFor(() => expect(screen.getByText(WORKFLOW.name)).toBeInTheDocument());
  });

  it("成功预览：name/description/trigger.event/conditions JSON/actions（含 config JSON）+ FeedbackButtons", async () => {
    mocks.api.mockResolvedValueOnce(WORKFLOW);
    renderDialog();
    fireEvent.change(descArea(), { target: { value: DESC } });
    await generated();

    expect(screen.getByText(`${NS}:preview`)).toBeInTheDocument();
    expect(screen.getByText(`${NS}:name`)).toBeInTheDocument();
    expect(screen.getByText(WORKFLOW.description)).toBeInTheDocument();
    expect(screen.getByText(`${NS}:trigger`)).toBeInTheDocument();
    expect(screen.getByText(WORKFLOW.trigger.event)).toBeInTheDocument();
    expect(screen.getByText(JSON.stringify(WORKFLOW.trigger.conditions))).toBeInTheDocument();
    expect(screen.getByText("notify")).toBeInTheDocument();
    expect(screen.getByText(JSON.stringify({ channel: "im" }))).toBeInTheDocument();
    expect(screen.getByText("assign")).toBeInTheDocument();
    // 空 config 不渲染第二段 code
    expect(screen.queryByText(JSON.stringify({}))).toBeFalsy();
    const fb = screen.getByTestId("fb");
    expect(fb.getAttribute("data-capability")).toBe("workflow-build");
    expect(fb.getAttribute("data-wid")).toBe(WID);
  });

  it("conditions 为空对象不渲染 conditions 行；actions 为空数组 → noActions", async () => {
    mocks.api.mockResolvedValueOnce({
      name: "空工作流",
      description: "",
      trigger: { event: "manual", conditions: {} },
      actions: [],
    });
    renderDialog();
    fireEvent.change(descArea(), { target: { value: DESC } });
    await generated();

    expect(screen.queryByText(`${NS}:conditions`)).toBeFalsy();
    expect(screen.getByText(`${NS}:noActions`)).toBeInTheDocument();
  });

  it("确认创建成功：POST /api/v1/workspaces/{wid}/workflows body 精确 + success toast + onCreated + onClose", async () => {
    mocks.api.mockResolvedValueOnce(WORKFLOW).mockResolvedValueOnce({});
    renderDialog();
    fireEvent.change(descArea(), { target: { value: DESC } });
    await generated();

    fireEvent.click(screen.getByText(`${NS}:confirmCreate`).closest("button")!);
    await waitFor(() => expect(mocks.onClose).toHaveBeenCalledTimes(1));
    expect(mocks.api).toHaveBeenNthCalledWith(2, `/api/v1/workspaces/${WID}/workflows`, {
      method: "POST",
      body: JSON.stringify({
        name: WORKFLOW.name,
        description: WORKFLOW.description,
        trigger: WORKFLOW.trigger,
        actions: WORKFLOW.actions,
      }),
      signal: expect.any(AbortSignal),
    });
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("success", `${NS}:createSuccess`));
    expect(mocks.onCreated).toHaveBeenCalledTimes(1);
  });

  it("确认创建失败 → error createFailed toast，不关闭且按钮恢复可重试", async () => {
    mocks.api.mockResolvedValueOnce(WORKFLOW).mockRejectedValueOnce(new Error("boom"));
    renderDialog();
    fireEvent.change(descArea(), { target: { value: DESC } });
    await generated();

    fireEvent.click(screen.getByText(`${NS}:confirmCreate`).closest("button")!);
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("error", `${NS}:createFailed`));
    expect(mocks.onClose).not.toHaveBeenCalled();
    expect(mocks.onCreated).not.toHaveBeenCalled();
    expect(screen.getByText(`${NS}:confirmCreate`).closest("button")).toBeEnabled();
  });

  it("生成失败 → t('error') 错误条，dismiss（button:close 第二枚）后清除", async () => {
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    renderDialog();
    fireEvent.change(descArea(), { target: { value: DESC } });
    fireEvent.click(generateButton());

    await waitFor(() => expect(screen.getByText(`${NS}:error`)).toBeInTheDocument());
    expect(screen.queryByTestId("fb")).toBeFalsy();
    fireEvent.click(screen.getAllByLabelText("button:close")[1]);
    expect(screen.queryByText(`${NS}:error`)).toBeFalsy();
  });

  it("非 loading 下 Escape 与遮罩点击关闭；cancel 按钮关闭", async () => {
    mocks.api.mockResolvedValueOnce(WORKFLOW);
    renderDialog();
    fireEvent.change(descArea(), { target: { value: DESC } });
    await generated();
    // 显式等待非 loading 态 + flush passive effects：
    // 预览出现不代表 Escape 的 window keydown 监听已按 loading=false 闭包重挂，
    // 过早 keyDown 会命中旧 loading=true 监听（被源码门控忽略）→ onClose 0 次的偶发红
    await settleIdle();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(mocks.onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("dialog"));
    expect(mocks.onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByText("button:cancel").closest("button")!);
    expect(mocks.onClose).toHaveBeenCalledTimes(3);
  });

  it("提交中：confirm/cancel disabled、Escape 不关；完成后 onClose", async () => {
    let resolveCreate!: (v: unknown) => void;
    mocks.api.mockResolvedValueOnce(WORKFLOW).mockReturnValueOnce(
      new Promise((res) => {
        resolveCreate = res;
      }),
    );
    renderDialog();
    fireEvent.change(descArea(), { target: { value: DESC } });
    await generated();

    fireEvent.click(screen.getByText(`${NS}:confirmCreate`).closest("button")!);
    await waitFor(() =>
      expect(screen.getByText(`${NS}:confirmCreate`).closest("button")).toBeDisabled(),
    );
    // flush effects：确保 submitting=true 闭包的 keydown 监听已挂上
    await act(async () => {});
    expect(screen.getByText("button:cancel").closest("button")).toBeDisabled();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("dialog"));
    expect(mocks.onClose).not.toHaveBeenCalled();

    resolveCreate({});
    await waitFor(() => expect(mocks.onClose).toHaveBeenCalledTimes(1));
  });
});
