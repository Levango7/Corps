// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

/**
 * DeliveryPanel 契约（components/ai/DeliveryPanel.tsx，default 导出）：
 *  1. 提交表单渲染（query textarea + 流水线 select + 提交按钮，query 空时禁用）
 *  2. 提交：POST /api/v1/ai/deliverables 成功后清空输入并刷新列表；失败显示错误文案
 *  3. 任务列表：空态「还没有交付任务」/ sidecar 不可达「交付服务未就绪」
 *  4. 列表项展开：拉取详情并渲染交付内容
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: mocks.api }));

vi.mock("next-intl", () => {
  const cache = new Map<string, (key: string, vars?: Record<string, unknown>) => string>();
  const useTranslations = (ns: string) => {
    let fn = cache.get(ns);
    if (!fn) {
      fn = (key: string) => `${ns}.${key}`;
      cache.set(ns, fn);
    }
    return fn;
  };
  return { useTranslations };
});

vi.mock("lucide-react", () => ({
  FileText: () => null,
  Loader2: () => null,
  PackageCheck: () => null,
  RefreshCw: () => null,
  AlertCircle: () => null,
}));

import DeliveryPanel from "@/components/ai/DeliveryPanel";

const WID = "63acadde-1111-4222-8333-444455556666";

describe("DeliveryPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.api.mockReset();
  });
  afterEach(() => cleanup());

  it("渲染提交表单：query 空时提交按钮禁用", () => {
    mocks.api.mockResolvedValue({ items: [], total: 0 });
    render(<DeliveryPanel wid={WID} />);
    expect(screen.getByLabelText("ai.delivery.queryLabel")).toBeInTheDocument();
    expect(screen.getByLabelText("ai.delivery.pipelineLabel")).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "ai.delivery.submit" });
    expect(submit).toBeDisabled();
  });

  it("提交成功：POST 载荷含 wid/query/pipeline，输入清空且列表刷新", async () => {
    // 首次列表调用（空态），第二次为提交后的刷新
    mocks.api.mockResolvedValue({ items: [], total: 0 });
    render(<DeliveryPanel wid={WID} />);
    const box = screen.getByLabelText("ai.delivery.queryLabel");
    fireEvent.change(box, { target: { value: "写一份敏捷落地指引" } });
    const submit = screen.getByRole("button", { name: "ai.delivery.submit" });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    await waitFor(() => {
      const post = mocks.api.mock.calls.find((c) => c[1]?.method === "POST");
      expect(post).toBeTruthy();
    });
    const post = mocks.api.mock.calls.find((c) => c[1]?.method === "POST");
    const payload = JSON.parse(String(post![1].body));
    expect(payload.wid).toBe(WID);
    expect(payload.query).toBe("写一份敏捷落地指引");
    expect(payload.pipeline).toBe("docgen");
    // 输入清空
    expect((box as HTMLTextAreaElement).value).toBe("");
  });

  it("提交失败：错误文案渲染且不清空输入", async () => {
    mocks.api.mockImplementation((path: string, opts?: RequestInit) => {
      if (opts?.method === "POST") return Promise.reject(new Error("delivery down"));
      return Promise.resolve({ items: [], total: 0 });
    });
    render(<DeliveryPanel wid={WID} />);
    fireEvent.change(screen.getByLabelText("ai.delivery.queryLabel"), {
      target: { value: "测试" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ai.delivery.submit" }));
    await waitFor(() => expect(screen.getByText("delivery down")).toBeInTheDocument());
    expect((screen.getByLabelText("ai.delivery.queryLabel") as HTMLTextAreaElement).value).toBe(
      "测试",
    );
  });

  it("列表空态渲染「还没有交付任务」", async () => {
    mocks.api.mockResolvedValue({ items: [], total: 0 });
    render(<DeliveryPanel wid={WID} />);
    await waitFor(() => expect(screen.getByText("ai.delivery.empty")).toBeInTheDocument());
  });

  it("列表请求失败渲染「交付服务未就绪」提示", async () => {
    mocks.api.mockRejectedValue(new Error("502"));
    render(<DeliveryPanel wid={WID} />);
    await waitFor(() => expect(screen.getByText("ai.delivery.sidecarDown")).toBeInTheDocument());
  });

  it("列表项展开：拉取详情并渲染交付内容", async () => {
    const task = {
      id: "task-1",
      status: "done",
      pipeline: "docgen",
      created_at: "2026-11-22T00:00:00Z",
      finished_at: "2026-11-22T00:05:00Z",
      error: null,
    };
    mocks.api.mockImplementation((path: string) => {
      if (path.includes("/api/v1/ai/deliverables/task-1")) {
        return Promise.resolve({ ...task, outputContent: "# 交付正文", outputPath: "/tmp/out.md" });
      }
      return Promise.resolve({ items: [task], total: 1 });
    });
    render(<DeliveryPanel wid={WID} />);
    await waitFor(() => expect(screen.getByText("ai.delivery.statusDone")).toBeInTheDocument());
    fireEvent.click(screen.getByText("ai.delivery.statusDone"));
    await waitFor(() => expect(screen.getByText("# 交付正文")).toBeInTheDocument());
  });

  it("待审详情：查看审批链接指向真实 /approvals/<aid> 详情路由", async () => {
    const instanceId = "63acadde-aaaa-4bbb-8ccc-ddddeeeeffff";
    const task = {
      id: "task-pending",
      title: "待审交付",
      taskId: "loom-pending",
      status: "awaiting_approval",
      pipeline: "docgen-review",
      createdAt: null,
      finishedAt: null,
      outputPath: null,
      approvalInstanceId: instanceId,
      approvalStatus: null,
    };
    mocks.api.mockImplementation((path: string) => {
      if (path.includes("/api/v1/ai/deliverables/task-pending")) {
        return Promise.resolve({
          ...task,
          outputContent: null,
          error: null,
          awaitingApproval: { nodes: ["approval_gate"] },
        });
      }
      return Promise.resolve({ items: [task], total: 1 });
    });
    render(<DeliveryPanel wid={WID} />);
    await waitFor(() =>
      expect(screen.getByText("ai.delivery.statusAwaitingApproval")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("ai.delivery.statusAwaitingApproval"));
    const link = await screen.findByRole("link", { name: "ai.delivery.approvalInstanceLink" });
    expect(link).toHaveAttribute("href", `/w/${WID}/approvals/${instanceId}`);
    expect(link).not.toHaveAttribute("href", expect.stringContaining("/approvals/instances/"));
  });

  it("驳回终态：cancelled 显示已取消，不再误报生成中", async () => {
    const task = {
      id: "task-cancelled",
      title: "被驳回交付",
      taskId: "loom-cancelled",
      status: "cancelled",
      pipeline: "docgen-review",
      createdAt: null,
      finishedAt: null,
      outputPath: null,
      approvalInstanceId: "63acadde-aaaa-4bbb-8ccc-ddddeeeeffff",
      approvalStatus: "rejected",
    };
    mocks.api.mockImplementation((path: string) => {
      if (path.includes("/api/v1/ai/deliverables/task-cancelled")) {
        return Promise.resolve({
          ...task,
          outputContent: null,
          error: null,
          approvalNote: "真实浏览器驳回验收",
        });
      }
      return Promise.resolve({ items: [task], total: 1 });
    });
    render(<DeliveryPanel wid={WID} />);
    await waitFor(() =>
      expect(screen.getByText("ai.delivery.statusCancelled")).toBeInTheDocument(),
    );
    expect(screen.queryByText("ai.delivery.statusRunning")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("ai.delivery.statusCancelled"));
    await waitFor(() =>
      expect(screen.getByText("ai.delivery.approvalNote: 真实浏览器驳回验收")).toBeInTheDocument(),
    );
  });
});
