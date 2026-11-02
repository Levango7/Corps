// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: mocks.api }));

const csvMocks = vi.hoisted(() => ({
  exportTasksCsv: vi.fn(),
  exportDecisionsCsv: vi.fn(),
}));
vi.mock("@/lib/csv-export", () => ({
  exportTasksCsv: csvMocks.exportTasksCsv,
  exportDecisionsCsv: csvMocks.exportDecisionsCsv,
}));

import { SettingsDataExport } from "@/components/settings/SettingsDataExport";

const onError = vi.fn();

function renderExport(wid = "ws-1", wsSlug = "alpha") {
  return render(<SettingsDataExport wid={wid} wsSlug={wsSlug} onError={onError} />);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SettingsDataExport", () => {
  it("渲染标题、提示与两个导出按钮", () => {
    renderExport();
    expect(screen.getByText("export:title")).toBeInTheDocument();
    expect(screen.getByText("export:hint")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "export:tasks" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "export:decisions" })).toBeInTheDocument();
  });

  it("导出任务：GET 任务列表并交给 exportTasksCsv（含 wsSlug）", async () => {
    const items = [
      {
        id: "t-1",
        title: "买菜",
        status: "doing",
        assigneeName: "张三",
        dueDate: "2026-10-01T00:00:00Z",
        createdAt: "2026-09-01T00:00:00Z",
      },
    ];
    mocks.api.mockResolvedValueOnce({ items, total: 1, hasMore: false });
    renderExport("ws-1", "alpha");
    fireEvent.click(screen.getByRole("button", { name: "export:tasks" }));
    await waitFor(() => expect(csvMocks.exportTasksCsv).toHaveBeenCalledWith(items, "alpha"));
    expect(mocks.api).toHaveBeenCalledWith("/api/v1/workspaces/ws-1/tasks");
  });

  it("导出任务失败（Error）→ onError 收到错误消息，不触发下载", async () => {
    mocks.api.mockRejectedValueOnce(new Error("网关超时"));
    renderExport();
    fireEvent.click(screen.getByRole("button", { name: "export:tasks" }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("网关超时"));
    expect(csvMocks.exportTasksCsv).not.toHaveBeenCalled();
  });

  it("导出任务失败（非 Error）→ onError 收到兜底文案", async () => {
    mocks.api.mockRejectedValueOnce("boom");
    renderExport();
    fireEvent.click(screen.getByRole("button", { name: "export:tasks" }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("export:tasksFailed"));
  });

  it("导出决策：GET 决策列表并交给 exportDecisionsCsv", async () => {
    const items = [
      {
        id: "d-1",
        taskTitle: "上线评审",
        markdown: "- 通过",
        authorName: "李四",
        createdAt: "2026-09-02T00:00:00Z",
      },
    ];
    mocks.api.mockResolvedValueOnce({ items, total: 1, hasMore: false });
    renderExport();
    fireEvent.click(screen.getByRole("button", { name: "export:decisions" }));
    await waitFor(() => expect(csvMocks.exportDecisionsCsv).toHaveBeenCalledWith(items, "alpha"));
    expect(mocks.api).toHaveBeenCalledWith("/api/v1/workspaces/ws-1/decisions");
  });

  it("导出决策失败（非 Error）→ onError 收到兜底文案", async () => {
    mocks.api.mockRejectedValueOnce("down");
    renderExport();
    fireEvent.click(screen.getByRole("button", { name: "export:decisions" }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("export:decisionsFailed"));
  });

  it("开始导出时先清空既有错误（onError('')）", async () => {
    mocks.api.mockResolvedValueOnce({ items: [], total: 0, hasMore: false });
    renderExport();
    fireEvent.click(screen.getByRole("button", { name: "export:tasks" }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(""));
  });

  it("导出进行中按钮禁用、完成后复位", async () => {
    let resolveGet!: (value: unknown) => void;
    mocks.api.mockImplementationOnce(
      () =>
        new Promise<unknown>((r) => {
          resolveGet = r;
        }),
    );
    renderExport();
    const btn = screen.getByRole("button", { name: "export:tasks" });
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());
    resolveGet({ items: [], total: 0, hasMore: false });
    await waitFor(() => expect(btn).toBeEnabled());
  });

  it("导出中再次点击不会重复请求", () => {
    mocks.api.mockImplementation(() => new Promise<unknown>(() => {}));
    renderExport();
    fireEvent.click(screen.getByRole("button", { name: "export:tasks" }));
    fireEvent.click(screen.getByRole("button", { name: "export:tasks" }));
    expect(mocks.api).toHaveBeenCalledTimes(1);
  });

  it("wid 透传到请求 URL", async () => {
    mocks.api.mockResolvedValueOnce({ items: [], total: 0, hasMore: false });
    renderExport("ws-9", "beta");
    fireEvent.click(screen.getByRole("button", { name: "export:tasks" }));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith("/api/v1/workspaces/ws-9/tasks"));
  });
});
