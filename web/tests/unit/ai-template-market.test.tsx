// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";

/**
 * TemplateMarket 契约（components/ai/TemplateMarket.tsx，default 导出，ns=ai.aiTemplate）：
 *  1. 挂载即 GET /api/v1/ai/templates?wid=..（category/q 有值才带，带 AbortSignal）；
 *     loading 态显示 Loader2 + t("loadFailed") 文案（组件怪癖：loading 标签复用 loadFailed 文案）
 *  2. 卡片：分类标签 t(category)、名称/描述、isPublic → t("public") 否则 t("private")、
 *     步骤预览最多 3 条 + "+N …"、usageCount 行、实例化按钮 t("instantiate")
 *  3. 搜索框（aria-label=t("search")）输入 → 重新 GET 且 q 为 trim 后的值；
 *     分类按钮点击 → GET 带 category，选中按钮高亮 bg-[var(--accent)]，"全部"切回无 category
 *  4. 实例化：POST /api/v1/ai/templates/{id}/instantiate {wid,name}；
 *     成功 toast("success", t("instantiated")) + onInstantiated + 重拉列表；
 *     进行中按钮 disabled（instantiatingId 守卫防重复）；失败 toast("error", t("error")) 不回调
 *  5. 加载失败 → 错误条 t("loadFailed") + 关闭按钮（aria-label=t("close")）点击清除；
 *     空列表（无错误）→ t("noTemplates")
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  toast: vi.fn(),
  onInstantiated: vi.fn(),
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

import TemplateMarket from "@/components/ai/TemplateMarket";

const WID = "ws-tpl-1";

interface StepShape {
  name: string;
  capability: string;
  config: Record<string, unknown>;
}

interface TplShape {
  id: string;
  name: string;
  description: string;
  category: string;
  steps: StepShape[];
  isPublic: boolean;
  workspaceId: string | null;
  usageCount: number;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
}

function makeTpl(overrides: Partial<TplShape> = {}): TplShape {
  return {
    id: "tpl-1",
    name: "项目周报",
    description: "自动汇总本周项目进展",
    category: "project",
    steps: [
      { name: "拉取任务进展", capability: "progress_anomaly", config: {} },
      { name: "汇总风险", capability: "risk_alert", config: {} },
      { name: "生成纪要", capability: "daily_briefing", config: {} },
      { name: "推送成员", capability: "daily_briefing", config: {} },
    ],
    isPublic: true,
    workspaceId: null,
    usageCount: 5,
    metadata: {},
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function tplPage(items: TplShape[]) {
  return { items, total: items.length };
}

function instantiateBtn() {
  return screen.getByRole("button", { name: "ai.aiTemplate:instantiate" }) as HTMLButtonElement;
}

beforeEach(() => {
  mocks.api.mockReset();
  mocks.toast.mockReset();
  mocks.onInstantiated.mockReset();
});
afterEach(() => cleanup());

describe("TemplateMarket", () => {
  it("挂载即 GET /api/v1/ai/templates?wid=..；loading 态显示 spinner 与 t(loadFailed) 文案", async () => {
    let resolveApi!: (v: unknown) => void;
    mocks.api.mockReturnValueOnce(
      new Promise((res) => {
        resolveApi = res;
      }),
    );
    const { container } = render(
      <TemplateMarket wid={WID} onInstantiated={mocks.onInstantiated} />,
    );

    expect(mocks.api).toHaveBeenCalledWith("/api/v1/ai/templates?wid=ws-tpl-1", {
      signal: expect.any(AbortSignal),
    });
    expect(container.querySelector("svg.lucide-loader-2")).toBeTruthy();
    expect(screen.getByText("ai.aiTemplate:loadFailed")).toBeInTheDocument();
    resolveApi(tplPage([]));
    await screen.findByText("ai.aiTemplate:noTemplates");
  });

  it("卡片渲染：分类标签/名称/描述/public/步骤预览(3 条 + +1 …)/usageCount/实例化按钮", async () => {
    mocks.api.mockResolvedValue(tplPage([makeTpl()]));
    render(<TemplateMarket wid={WID} onInstantiated={mocks.onInstantiated} />);
    const card = (await screen.findByText("项目周报")).closest("article")!;

    expect(within(card).getByText("自动汇总本周项目进展")).toBeInTheDocument();
    expect(within(card).getByText("ai.aiTemplate:project")).toBeInTheDocument();
    expect(within(card).getByText("ai.aiTemplate:public")).toBeInTheDocument();
    expect(within(card).getByText("拉取任务进展")).toBeInTheDocument();
    expect(within(card).getByText("汇总风险")).toBeInTheDocument();
    expect(within(card).getByText("生成纪要")).toBeInTheDocument();
    expect(within(card).queryByText("推送成员")).toBeFalsy(); // 仅预览前 3 条
    expect(within(card).getByText("+1 …")).toBeInTheDocument();
    expect(within(card).getByText("ai.aiTemplate:usageCount: 5")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "ai.aiTemplate:instantiate" })).toBeTruthy();
  });

  it("私有模板显示 t(private)，公开模板显示 t(public)", async () => {
    mocks.api.mockResolvedValue(
      tplPage([makeTpl(), makeTpl({ id: "tpl-2", name: "内部回顾", isPublic: false })]),
    );
    render(<TemplateMarket wid={WID} onInstantiated={mocks.onInstantiated} />);
    await screen.findByText("项目周报");

    expect(screen.getByText("ai.aiTemplate:public")).toBeInTheDocument();
    expect(screen.getByText("ai.aiTemplate:private")).toBeInTheDocument();
  });

  it("custom 分类模板显示 t(custom) 标签", async () => {
    mocks.api.mockResolvedValue(tplPage([makeTpl({ category: "custom", name: "自定义流" })]));
    render(<TemplateMarket wid={WID} onInstantiated={mocks.onInstantiated} />);
    const card = (await screen.findByText("自定义流")).closest("article")!;
    expect(within(card).getByText("ai.aiTemplate:custom")).toBeInTheDocument();
  });

  it("空列表（无错误）→ Sparkles + t(noTemplates)，无实例化按钮", async () => {
    mocks.api.mockResolvedValue(tplPage([]));
    render(<TemplateMarket wid={WID} onInstantiated={mocks.onInstantiated} />);
    expect(await screen.findByText("ai.aiTemplate:noTemplates")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ai.aiTemplate:instantiate" })).toBeFalsy();
  });

  it("加载失败 → 错误条 t(loadFailed)，点关闭按钮（aria-label=t(close)）清除", async () => {
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    const { container } = render(
      <TemplateMarket wid={WID} onInstantiated={mocks.onInstantiated} />,
    );
    // loading 标签与错误条共用 loadFailed 文案，先等 loading 结束再断言错误条
    await waitFor(() => expect(container.querySelector("svg.lucide-loader-2")).toBeFalsy());
    expect(screen.getByText("ai.aiTemplate:loadFailed")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("ai.aiTemplate:close"));
    expect(screen.queryByText("ai.aiTemplate:loadFailed")).toBeFalsy();
  });

  it("搜索输入 → 重新 GET 且 q 为 trim 后的值", async () => {
    mocks.api.mockResolvedValue(tplPage([]));
    render(<TemplateMarket wid={WID} onInstantiated={mocks.onInstantiated} />);
    await screen.findByText("ai.aiTemplate:noTemplates");

    fireEvent.change(screen.getByLabelText("ai.aiTemplate:search"), {
      target: { value: "  周报  " },
    });
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api).toHaveBeenNthCalledWith(
      2,
      `/api/v1/ai/templates?wid=${WID}&q=${encodeURIComponent("周报")}`,
      { signal: expect.any(AbortSignal) },
    );
  });

  it("分类筛选 → GET 带 category=project，选中按钮高亮", async () => {
    mocks.api.mockResolvedValue(tplPage([]));
    render(<TemplateMarket wid={WID} onInstantiated={mocks.onInstantiated} />);
    await screen.findByText("ai.aiTemplate:noTemplates");

    const projectBtn = screen.getByRole("button", { name: "ai.aiTemplate:project" });
    fireEvent.click(projectBtn);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api).toHaveBeenNthCalledWith(
      2,
      `/api/v1/ai/templates?wid=${WID}&category=project`,
      {
        signal: expect.any(AbortSignal),
      },
    );
    expect(projectBtn.className).toContain("bg-[var(--accent)]");
  });

  it("切回全部分类 → GET 不带 category 参数", async () => {
    mocks.api.mockResolvedValue(tplPage([]));
    render(<TemplateMarket wid={WID} onInstantiated={mocks.onInstantiated} />);
    await screen.findByText("ai.aiTemplate:noTemplates");

    fireEvent.click(screen.getByRole("button", { name: "ai.aiTemplate:project" }));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "ai.aiTemplate:all" }));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(3));
    expect(mocks.api).toHaveBeenNthCalledWith(3, `/api/v1/ai/templates?wid=${WID}`, {
      signal: expect.any(AbortSignal),
    });
  });

  it("实例化成功：POST {wid,name} + toast success + onInstantiated + 重拉列表", async () => {
    mocks.api
      .mockResolvedValueOnce(tplPage([makeTpl()]))
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(tplPage([makeTpl()]));
    render(<TemplateMarket wid={WID} onInstantiated={mocks.onInstantiated} />);
    await screen.findByText("项目周报");

    fireEvent.click(instantiateBtn());
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(3)); // GET + POST + 刷新 GET
    expect(mocks.api).toHaveBeenNthCalledWith(2, "/api/v1/ai/templates/tpl-1/instantiate", {
      method: "POST",
      body: JSON.stringify({ wid: WID, name: "项目周报" }),
    });
    expect(mocks.toast).toHaveBeenCalledWith("success", "ai.aiTemplate:instantiated");
    expect(mocks.onInstantiated).toHaveBeenCalledTimes(1);
  });

  it("实例化进行中：按钮 disabled 且重复点击只发一次 POST", async () => {
    let resolvePost!: (v: unknown) => void;
    mocks.api.mockResolvedValueOnce(tplPage([makeTpl()]));
    mocks.api.mockReturnValueOnce(
      new Promise((res) => {
        resolvePost = res;
      }),
    );
    render(<TemplateMarket wid={WID} onInstantiated={mocks.onInstantiated} />);
    const btn = (await screen.findByRole("button", {
      name: "ai.aiTemplate:instantiate",
    })) as HTMLButtonElement;

    fireEvent.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());
    fireEvent.click(btn); // instantiatingId 守卫
    resolvePost({});
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith("success", "ai.aiTemplate:instantiated"),
    );
    expect(mocks.api).toHaveBeenCalledTimes(3); // GET + 1 次 POST + 刷新 GET
  });

  it("实例化失败：toast error t(error)，onInstantiated 不调用", async () => {
    mocks.api.mockResolvedValueOnce(tplPage([makeTpl()])).mockRejectedValueOnce(new Error("boom"));
    render(<TemplateMarket wid={WID} onInstantiated={mocks.onInstantiated} />);
    await screen.findByText("项目周报");

    fireEvent.click(instantiateBtn());
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("error", "ai.aiTemplate:error"));
    expect(mocks.onInstantiated).not.toHaveBeenCalled();
  });
});
