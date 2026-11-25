// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock("@/lib/api", () => ({ api: mocks.api }));
vi.mock("next-intl", () => {
  const translators = new Map<string, (key: string) => string>();
  return {
    useTranslations: (ns: string) => {
      let translator = translators.get(ns);
      if (!translator) {
        translator = (key: string) => `${ns}.${key}`;
        translators.set(ns, translator);
      }
      return translator;
    },
  };
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
const TASK_ID = "7d0dc2af-2222-4333-8444-555566667777";

function task(approvalStatus: string | null) {
  return {
    id: TASK_ID,
    taskId: "loom-task-1",
    title: "交付报告",
    pipeline: "docgen",
    status: "done",
    createdAt: "2026-11-24T00:00:00Z",
    finishedAt: "2026-11-24T00:05:00Z",
    outputPath: "/tmp/report.md",
    approvalStatus,
  };
}

function mockApi(getApprovalStatus: () => string | null) {
  mocks.api.mockImplementation((path: string) => {
    if (path.includes(`/api/v1/ai/deliverables/${TASK_ID}`)) {
      return Promise.resolve({
        ...task(getApprovalStatus()),
        outputContent: "# 交付正文",
        error: null,
      });
    }
    return Promise.resolve({ items: [task(getApprovalStatus())], total: 1 });
  });
}

async function openTask() {
  await waitFor(() => expect(screen.getByText("ai.delivery.statusDone")).toBeInTheDocument());
  fireEvent.click(screen.getByText("ai.delivery.statusDone"));
  await waitFor(() => expect(screen.getByText("# 交付正文")).toBeInTheDocument());
}

describe("DeliveryPanel 审批状态刷新回显", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.api.mockReset();
  });
  afterEach(() => cleanup());

  it("刷新并重新打开详情后显示已审批徽标，不再显示审批按钮", async () => {
    let approvalStatus: string | null = null;
    mockApi(() => approvalStatus);
    render(<DeliveryPanel wid={WID} />);
    await openTask();
    expect(screen.getByRole("button", { name: "ai.delivery.approve" })).toBeInTheDocument();

    approvalStatus = "approved";
    fireEvent.click(screen.getByRole("button", { name: "ai.delivery.refresh" }));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(3));
    fireEvent.click(screen.getByText("ai.delivery.statusDone"));
    await openTask();

    expect(screen.getByText("ai.delivery.approved")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ai.delivery.approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ai.delivery.reject" })).not.toBeInTheDocument();
  });

  it("点击通过后刷新列表，重新打开详情显示已审批徽标", async () => {
    let approvalStatus: string | null = null;
    mocks.api.mockImplementation((path: string, options?: RequestInit) => {
      if (path.includes(`/api/v1/ai/deliverables/${TASK_ID}/approve`)) {
        expect(options?.method).toBe("POST");
        expect(JSON.parse(String(options?.body))).toEqual({ action: "approve" });
        approvalStatus = "approved";
        return Promise.resolve({});
      }
      if (path.includes(`/api/v1/ai/deliverables/${TASK_ID}`)) {
        return Promise.resolve({
          ...task(approvalStatus),
          outputContent: "# 交付正文",
          error: null,
        });
      }
      return Promise.resolve({ items: [task(approvalStatus)], total: 1 });
    });

    render(<DeliveryPanel wid={WID} />);
    await openTask();
    fireEvent.click(screen.getByRole("button", { name: "ai.delivery.approve" }));

    await waitFor(() => {
      const listCalls = mocks.api.mock.calls.filter(([path]) =>
        path.startsWith("/api/v1/ai/deliverables?"),
      );
      expect(listCalls).toHaveLength(2);
    });
    fireEvent.click(screen.getByText("ai.delivery.statusDone"));
    await openTask();

    expect(screen.getByText("ai.delivery.approved")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ai.delivery.approve" })).not.toBeInTheDocument();
  });

  it("刷新后显示已驳回徽标", async () => {
    mockApi(() => "rejected");
    render(<DeliveryPanel wid={WID} />);
    await openTask();

    expect(screen.getByText("ai.delivery.rejected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ai.delivery.approve" })).not.toBeInTheDocument();
  });

  it("未审批时显示通过和驳回按钮", async () => {
    mockApi(() => null);
    render(<DeliveryPanel wid={WID} />);
    await openTask();

    expect(screen.getByRole("button", { name: "ai.delivery.approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ai.delivery.reject" })).toBeInTheDocument();
    expect(screen.queryByText("ai.delivery.approved")).not.toBeInTheDocument();
    expect(screen.queryByText("ai.delivery.rejected")).not.toBeInTheDocument();
  });
});
