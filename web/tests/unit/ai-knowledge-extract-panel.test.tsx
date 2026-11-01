// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * KnowledgeExtractPanel 契约（components/ai/KnowledgeExtractPanel.tsx）：
 *  1. 标题栏 Sparkles(size16) + t("extract")，根容器 aria-label 同名
 *  2. 四个来源类型按钮（document/meeting/chat/task），默认 document 选中
 *     （选中态类 bg-[var(--accent-soft)]，未选中 text-[var(--muted)]）
 *  3. 来源 ID 输入框 placeholder="UUID"；空值时提取按钮 disabled
 *  4. 提取 → POST /api/v1/ai/knowledge/extract，请求体
 *     { wid, sourceType, sourceId: trim 后 }
 *  5. 成功 → CheckCircle2 + t("extracted",{nodes,edges}) 结果条 + toast("success",…)
 *  6. data 为 null 或缺数组时 nodes/edges 计 0
 *  7. 失败 → toast("error", t("error"))，无结果条
 *  8. 提取中 → 按钮换 Loader2 + t("extracting") 且 disabled；底部进度条
 *     Loader2(size16) 同步可见
 *  9. 再次提取先把旧结果条清空（setResult(null)）
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  toast: vi.fn(),
}));

// 组件把 t 放进 useCallback 依赖，mock 必须按 ns 缓存返回函数，否则 effect/回调无限重跑
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
vi.mock("@/components/Toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));

import { KnowledgeExtractPanel } from "@/components/ai/KnowledgeExtractPanel";

const WID = "ws-ke-1";
const EXTRACTED_2_1 = 'ai.aiKnowledge:extracted:{"nodes":2,"edges":1}';

/** 来源类型按钮：按文案定位后取其 button 容器 */
function typeButton(value: string) {
  return screen.getByText(`ai.aiKnowledge:${value}`).closest("button") as HTMLButtonElement;
}

/** 提取按钮与标题 h1 同文案，按标签名区分 */
function extractButton() {
  return screen
    .getAllByText("ai.aiKnowledge:extract")
    .find((el) => el.tagName === "BUTTON") as HTMLButtonElement;
}

/** 2 节点 1 边的提取结果夹具 */
function extractFixture() {
  return {
    nodes: [
      { id: "n1", type: "concept", label: "L1", content: "C1" },
      { id: "n2", type: "concept", label: "L2", content: "C2" },
    ],
    edges: [{ id: "e1", sourceNodeId: "n1", targetNodeId: "n2", relation: "related", weight: 1 }],
  };
}

describe("KnowledgeExtractPanel", () => {
  beforeEach(() => {
    mocks.api.mockReset();
    mocks.toast.mockReset();
    mocks.api.mockResolvedValue(extractFixture());
  });
  afterEach(() => cleanup());

  it("标题栏渲染 Sparkles 与 t('extract')，根容器 aria-label 同名", () => {
    const { container } = render(<KnowledgeExtractPanel wid={WID} />);
    expect(container.querySelector("svg.lucide-sparkles")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "ai.aiKnowledge:extract" })).toBeTruthy();
    expect(container.firstElementChild?.getAttribute("aria-label")).toBe("ai.aiKnowledge:extract");
  });

  it("四个来源类型按钮渲染默认文案，默认选中 document", () => {
    render(<KnowledgeExtractPanel wid={WID} />);
    for (const v of ["document", "meeting", "chat", "task"]) {
      expect(typeButton(v)).toBeTruthy();
    }
    expect(typeButton("document").className).toContain("bg-[var(--accent-soft)]");
    expect(typeButton("meeting").className).toContain("text-[var(--muted)]");
  });

  it("点击切换来源类型：选中类迁移", () => {
    render(<KnowledgeExtractPanel wid={WID} />);
    fireEvent.click(typeButton("chat"));
    expect(typeButton("chat").className).toContain("bg-[var(--accent-soft)]");
    expect(typeButton("document").className).toContain("text-[var(--muted)]");
    fireEvent.click(typeButton("document"));
    expect(typeButton("document").className).toContain("bg-[var(--accent-soft)]");
  });

  it("来源 ID 输入框 placeholder=UUID；空值时提取按钮 disabled，填值后可用", () => {
    render(<KnowledgeExtractPanel wid={WID} />);
    expect(screen.getByPlaceholderText("UUID")).toBeTruthy();
    expect(extractButton()).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("UUID"), { target: { value: "src-1" } });
    expect(extractButton()).toBeEnabled();
  });

  it("提取：POST 请求体含 wid / 当前 sourceType / trim 后 sourceId", async () => {
    render(<KnowledgeExtractPanel wid={WID} />);
    fireEvent.click(typeButton("meeting"));
    fireEvent.change(screen.getByPlaceholderText("UUID"), { target: { value: "  src-9 " } });
    fireEvent.click(extractButton());
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(mocks.api).toHaveBeenCalledWith("/api/v1/ai/knowledge/extract", {
      method: "POST",
      body: JSON.stringify({ wid: WID, sourceType: "meeting", sourceId: "src-9" }),
    });
  });

  it("成功：结果条显示 CheckCircle2 与节点/边计数，toast success 同文案", async () => {
    const { container } = render(<KnowledgeExtractPanel wid={WID} />);
    fireEvent.change(screen.getByPlaceholderText("UUID"), { target: { value: "s1" } });
    fireEvent.click(extractButton());
    await waitFor(() => expect(screen.getByText(EXTRACTED_2_1)).toBeTruthy());
    expect(container.querySelector("svg.lucide-check-circle-2")).toBeTruthy();
    expect(mocks.toast).toHaveBeenCalledWith("success", EXTRACTED_2_1);
  });

  it("成功但 data 为 null：nodes/edges 计 0", async () => {
    mocks.api.mockResolvedValueOnce(null);
    render(<KnowledgeExtractPanel wid={WID} />);
    fireEvent.change(screen.getByPlaceholderText("UUID"), { target: { value: "s2" } });
    fireEvent.click(extractButton());
    await waitFor(() =>
      expect(screen.getByText('ai.aiKnowledge:extracted:{"nodes":0,"edges":0}')).toBeTruthy(),
    );
  });

  it("失败：toast('error', t('error')) 且无结果条", async () => {
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    const { container } = render(<KnowledgeExtractPanel wid={WID} />);
    fireEvent.change(screen.getByPlaceholderText("UUID"), { target: { value: "s3" } });
    fireEvent.click(extractButton());
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("error", "ai.aiKnowledge:error"));
    expect(container.querySelector("svg.lucide-check-circle-2")).toBeFalsy();
  });

  it("提取中：按钮换 Loader2 + t('extracting') 且 disabled，底部进度条亦可见", async () => {
    mocks.api.mockImplementationOnce(() => new Promise(() => {}));
    const { container } = render(<KnowledgeExtractPanel wid={WID} />);
    fireEvent.change(screen.getByPlaceholderText("UUID"), { target: { value: "s4" } });
    const btn = extractButton();
    fireEvent.click(btn);
    // 按钮文案与底部进度条文案同文，共 2 处
    await waitFor(() => expect(screen.getAllByText("ai.aiKnowledge:extracting").length).toBe(2));
    expect(container.querySelectorAll("svg.lucide-loader-2").length).toBe(2);
    expect(btn).toBeDisabled();
  });

  it("再次提取先把旧结果条清空", async () => {
    mocks.api.mockResolvedValueOnce(extractFixture());
    mocks.api.mockImplementationOnce(() => new Promise(() => {}));
    render(<KnowledgeExtractPanel wid={WID} />);
    fireEvent.change(screen.getByPlaceholderText("UUID"), { target: { value: "s5" } });
    fireEvent.click(extractButton());
    await waitFor(() => expect(screen.getByText(EXTRACTED_2_1)).toBeTruthy());
    fireEvent.click(extractButton());
    await waitFor(() => expect(screen.getAllByText("ai.aiKnowledge:extracting").length).toBe(2));
    expect(screen.queryByText(EXTRACTED_2_1)).toBeFalsy();
  });
});
