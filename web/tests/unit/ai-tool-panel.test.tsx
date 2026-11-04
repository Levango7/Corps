// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * ToolPanel 契约（components/ai/ToolPanel.tsx，named 导出，ns=ai.aiTool）：
 *  1. 挂载即 GET /api/v1/ai/tools（无查询参数）；loading 态文案 t("loading")
 *  2. 加载失败：ApiError → 直接显示 e.message；其他错误 → t("error")
 *  3. 空列表 → t("noTools")；头部计数仅在 tools.length>0 时显示
 *  4. 工具卡片：点击头部展开/折叠（aria-expanded 切换），展开后按 JSON Schema properties
 *     渲染参数表单（string→text、number/integer→number、boolean→checkbox、enum→select，
 *     required 参数名后带 *）；无参数工具展开显示 "{t("inputParameters")}: ∅"
 *  5. 执行：POST /api/v1/ai/tools/execute {toolName,args,workspaceId}；args 按 schema 类型
 *     转换（number→Number、空值剔除）；执行中文案变 t("executing") 且按钮 disabled
 *  6. 结果：success → t("outputResult")+t("success")+JSON.stringify(data)；
 *     success=false → t("failed") + result.error；API 异常：ApiError → e.message，其他 → t("error")
 *  7. clear：清空结果、执行错误与参数输入
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
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
vi.mock("@/lib/api", () => {
  class ApiError extends Error {
    constructor(
      message: string,
      public status = 500,
      public code = 0,
    ) {
      super(message);
      this.name = "ApiError";
    }
  }
  return { api: mocks.api, ApiError };
});

import { ToolPanel } from "@/components/ai/ToolPanel";
import { ApiError } from "@/lib/api";

const WID = "ws-tool-1";

interface ParamSchemaShape {
  type?: string;
  description?: string;
  enum?: string[];
}

interface ToolShape {
  name: string;
  description: string;
  parameters: {
    type?: string;
    properties?: Record<string, ParamSchemaShape>;
    required?: string[];
  };
}

const TOOL_SEARCH: ToolShape = {
  name: "web_search",
  description: "搜索网页内容",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "搜索关键词" },
      limit: { type: "number", description: "结果条数" },
      dryRun: { type: "boolean" },
      mode: { type: "string", enum: ["fast", "deep"] },
    },
    required: ["query"],
  },
};

const TOOL_PING: ToolShape = {
  name: "ping",
  description: "连通性检查",
  parameters: { type: "object" },
};

function expandBtn(toolName: string) {
  return screen.getByText(toolName).closest("button") as HTMLButtonElement;
}

beforeEach(() => {
  mocks.api.mockReset();
});
afterEach(() => cleanup());

describe("ToolPanel", () => {
  it("挂载即 GET /api/v1/ai/tools，loading 期间显示 t(loading)", async () => {
    let resolveApi!: (v: unknown) => void;
    mocks.api.mockReturnValueOnce(
      new Promise((res) => {
        resolveApi = res;
      }),
    );
    render(<ToolPanel workspaceId={WID} />);

    expect(mocks.api).toHaveBeenCalledWith("/api/v1/ai/tools");
    expect(screen.getByText("ai.aiTool:loading")).toBeInTheDocument();
    resolveApi({ tools: [] });
    await screen.findByText("ai.aiTool:noTools");
  });

  it("加载失败（普通 Error）→ t(error)，不显示原始 message", async () => {
    mocks.api.mockRejectedValueOnce(new Error("inner boom"));
    render(<ToolPanel workspaceId={WID} />);
    expect(await screen.findByText("ai.aiTool:error")).toBeInTheDocument();
    expect(screen.queryByText("inner boom")).toBeFalsy();
  });

  it("加载失败（ApiError）→ 直接显示 e.message", async () => {
    mocks.api.mockRejectedValueOnce(new ApiError("配额已用尽", 429, 1001));
    render(<ToolPanel workspaceId={WID} />);
    expect(await screen.findByText("配额已用尽")).toBeInTheDocument();
    expect(screen.queryByText("ai.aiTool:error")).toBeFalsy();
  });

  it("空工具列表 → t(noTools)，头部计数不显示数字", async () => {
    mocks.api.mockResolvedValueOnce({ tools: [] });
    const { container } = render(<ToolPanel workspaceId={WID} />);
    await screen.findByText("ai.aiTool:noTools");

    const headerText = container.querySelector("header")?.textContent ?? "";
    expect(headerText).toContain("ai.aiTool:title");
    expect(/\d/.test(headerText)).toBe(false);
  });

  it("工具列表：名称/描述可见，折叠态 aria-expanded=false，头部显示数量", async () => {
    mocks.api.mockResolvedValueOnce({ tools: [TOOL_SEARCH, TOOL_PING] });
    const { container } = render(<ToolPanel workspaceId={WID} />);
    await screen.findByText("web_search");

    expect(screen.getByText("搜索网页内容")).toBeInTheDocument();
    expect(screen.getByText("ping")).toBeInTheDocument();
    expect(container.querySelector("header")?.textContent).toContain("2");
    expect(expandBtn("web_search").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText(/query/)).toBeFalsy();
  });

  it("展开工具：aria-expanded=true，渲染 text/number/checkbox/enum 控件与 required 标记", async () => {
    mocks.api.mockResolvedValueOnce({ tools: [TOOL_SEARCH] });
    render(<ToolPanel workspaceId={WID} />);
    fireEvent.click((await screen.findByText("web_search")).closest("button")!);

    expect(expandBtn("web_search").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("ai.aiTool:inputParameters")).toBeInTheDocument();
    const queryInput = screen.getByLabelText(/query/) as HTMLInputElement;
    expect(queryInput.getAttribute("type")).toBe("text");
    expect(queryInput.getAttribute("placeholder")).toBe("搜索关键词");
    const limitInput = screen.getByLabelText(/limit/) as HTMLInputElement;
    expect(limitInput.getAttribute("type")).toBe("number");
    const dryRun = screen.getByLabelText(/dryRun/) as HTMLInputElement;
    expect(dryRun.getAttribute("type")).toBe("checkbox");
    expect(dryRun).not.toBeChecked();
    const modeSelect = screen.getByRole("combobox") as HTMLSelectElement;
    expect(modeSelect.options).toHaveLength(3); // 空占位 + fast + deep
    expect(screen.getByText("*")).toBeInTheDocument(); // required 标记
  });

  it("无参数工具展开 → 显示 inputParameters: ∅", async () => {
    mocks.api.mockResolvedValueOnce({ tools: [TOOL_PING] });
    render(<ToolPanel workspaceId={WID} />);
    fireEvent.click((await screen.findByText("ping")).closest("button")!);

    expect(screen.getByText("ai.aiTool:inputParameters: ∅")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ai.aiTool:execute" })).toBeTruthy();
  });

  it("执行成功：POST {toolName,args,workspaceId}（number 转换/空值剔除），渲染 success 与 JSON data", async () => {
    mocks.api
      .mockResolvedValueOnce({ tools: [TOOL_SEARCH] })
      .mockResolvedValueOnce({ result: { success: true, data: { hits: 2 } } });
    const { container } = render(<ToolPanel workspaceId={WID} />);
    fireEvent.click((await screen.findByText("web_search")).closest("button")!);

    fireEvent.change(screen.getByLabelText(/query/), { target: { value: "Next.js 15" } });
    fireEvent.change(screen.getByLabelText(/limit/), { target: { value: "3" } });
    fireEvent.click(screen.getByLabelText(/dryRun/));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "deep" } });
    fireEvent.click(screen.getByRole("button", { name: "ai.aiTool:execute" }));

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api).toHaveBeenNthCalledWith(2, "/api/v1/ai/tools/execute", {
      method: "POST",
      body: JSON.stringify({
        toolName: "web_search",
        args: { query: "Next.js 15", limit: 3, dryRun: true, mode: "deep" },
        workspaceId: WID,
      }),
    });
    expect(await screen.findByText("ai.aiTool:outputResult")).toBeInTheDocument();
    expect(screen.getByText("ai.aiTool:success")).toBeInTheDocument();
    expect(container.querySelector("pre code")?.textContent).toContain('"hits": 2');
  });

  it("执行返回 success=false → t(failed) 并展示 result.error", async () => {
    mocks.api
      .mockResolvedValueOnce({ tools: [TOOL_PING] })
      .mockResolvedValueOnce({ result: { success: false, error: "目标服务超时" } });
    render(<ToolPanel workspaceId={WID} />);
    fireEvent.click((await screen.findByText("ping")).closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: "ai.aiTool:execute" }));

    expect(await screen.findByText("ai.aiTool:failed")).toBeInTheDocument();
    expect(screen.getByText("目标服务超时")).toBeInTheDocument();
    expect(screen.queryByText("ai.aiTool:success")).toBeFalsy();
  });

  it("执行 API 异常（普通 Error）→ t(error)", async () => {
    mocks.api
      .mockResolvedValueOnce({ tools: [TOOL_PING] })
      .mockRejectedValueOnce(new Error("exec boom"));
    render(<ToolPanel workspaceId={WID} />);
    fireEvent.click((await screen.findByText("ping")).closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: "ai.aiTool:execute" }));

    expect(await screen.findByText("ai.aiTool:error")).toBeInTheDocument();
    expect(screen.queryByText("exec boom")).toBeFalsy();
  });

  it("执行中：按钮文案变 t(executing) 且 disabled；ApiError 时显示 e.message", async () => {
    let rejectExec!: (e: unknown) => void;
    mocks.api.mockResolvedValueOnce({ tools: [TOOL_PING] });
    mocks.api.mockReturnValueOnce(
      new Promise((_res, rej) => {
        rejectExec = rej;
      }),
    );
    render(<ToolPanel workspaceId={WID} />);
    fireEvent.click((await screen.findByText("ping")).closest("button")!);

    fireEvent.click(screen.getByRole("button", { name: "ai.aiTool:execute" }));
    const execBtn = screen.getByRole("button", {
      name: "ai.aiTool:executing",
    }) as HTMLButtonElement;
    expect(execBtn).toBeDisabled();

    rejectExec(new ApiError("配额不足", 429, 1001));
    expect(await screen.findByText("配额不足")).toBeInTheDocument();
  });

  it("clear：清空结果与参数输入", async () => {
    mocks.api
      .mockResolvedValueOnce({ tools: [TOOL_SEARCH] })
      .mockResolvedValueOnce({ result: { success: true, data: { ok: 1 } } });
    render(<ToolPanel workspaceId={WID} />);
    fireEvent.click((await screen.findByText("web_search")).closest("button")!);
    fireEvent.change(screen.getByLabelText(/query/), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "ai.aiTool:execute" }));
    await screen.findByText("ai.aiTool:outputResult");

    fireEvent.click(screen.getByRole("button", { name: "ai.aiTool:clear" }));
    expect(screen.queryByText("ai.aiTool:outputResult")).toBeFalsy();
    expect((screen.getByLabelText(/query/) as HTMLInputElement).value).toBe("");
  });

  it("再次点击卡片头 → 折叠（aria-expanded=false，参数表单消失）", async () => {
    mocks.api.mockResolvedValueOnce({ tools: [TOOL_SEARCH] });
    render(<ToolPanel workspaceId={WID} />);
    fireEvent.click((await screen.findByText("web_search")).closest("button")!);
    expect(screen.getByText("ai.aiTool:inputParameters")).toBeInTheDocument();

    fireEvent.click(expandBtn("web_search"));
    expect(expandBtn("web_search").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText(/query/)).toBeFalsy();
  });
});
