// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * KnowledgeGraphView 契约（components/ai/KnowledgeGraphView.tsx，named export）：
 *  1. 挂载即 GET /api/v1/ai/knowledge/graph?wid=<wid>&limit=200
 *  2. SVG 渲染：节点 g/circle/text（label 超 8 字符截断加省略号）、边 line
 *     （depends_on 带 marker-end 箭头）
 *  3. 类型过滤按钮（concept/entity/fact/procedure）点击 toggle，过滤后边随端点移除
 *  4. 搜索框按 label/content 子串过滤；无匹配 → noData 空态
 *  5. 点节点 → 详情侧栏（type/label/content/source/relations + 删除按钮）
 *  6. 删除走 window.confirm；成功 DELETE /api/v1/ai/knowledge/nodes/{id}?wid=<wid>，
 *     移除节点与关联边 + toast success deleted + 侧栏关闭；confirm 取消不发请求；失败 toast error
 *  7. 加载失败 → loadFailed 文案 + toast error，刷新按钮（graph）可重试
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  toast: vi.fn(),
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

import { KnowledgeGraphView } from "@/components/ai/KnowledgeGraphView";

const WID = "ws-kgv-1";
const NS = "ai.aiKnowledge";

function kn(id: string, type: string, label: string, content: string) {
  return {
    id,
    workspaceId: WID,
    type,
    label,
    content,
    sourceType: "document",
    sourceId: "doc-1",
    metadata: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
  };
}

const NODES = [
  kn("kn-1", "concept", "核心概念很长的标签名", "概念内容"),
  kn("kn-2", "entity", "实体节点", "实体内容含 searchable"),
  kn("kn-3", "fact", "事实节点", "事实内容"),
  kn("kn-4", "procedure", "流程节点", "流程内容"),
];
const EDGES = [
  {
    id: "e-1",
    workspaceId: WID,
    sourceNodeId: "kn-1",
    targetNodeId: "kn-2",
    relation: "depends_on",
    weight: 1,
    metadata: null,
    createdAt: "2026-11-01T00:00:00.000Z",
  },
  {
    id: "e-2",
    workspaceId: WID,
    sourceNodeId: "kn-2",
    targetNodeId: "kn-3",
    relation: "relates_to",
    weight: 2,
    metadata: null,
    createdAt: "2026-11-01T00:00:00.000Z",
  },
];
const GRAPH = { nodes: NODES, edges: EDGES };

function renderView() {
  return render(<KnowledgeGraphView wid={WID} />);
}

/** 图谱 svg（工具栏 lucide 图标 svg 也含 circle/line，必须限定到图谱本体） */
function graphSvg(container: HTMLElement): SVGSVGElement | null {
  return container.querySelector("svg.h-full.w-full");
}
function circleCount(container: HTMLElement) {
  return graphSvg(container)?.querySelectorAll("circle").length ?? 0;
}
function lineCount(container: HTMLElement) {
  return graphSvg(container)?.querySelectorAll("line").length ?? 0;
}
async function loaded() {
  await waitFor(() => expect(screen.getByText("实体节点")).toBeInTheDocument());
}

beforeEach(() => {
  mocks.api.mockReset();
  mocks.toast.mockReset();
});
afterEach(() => cleanup());

describe("KnowledgeGraphView", () => {
  it("初始请求：GET /api/v1/ai/knowledge/graph?wid=<wid>&limit=200，骨架含标题/刷新/搜索/4 个过滤按钮", async () => {
    mocks.api.mockResolvedValueOnce(GRAPH);
    const { container } = renderView();

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(mocks.api).toHaveBeenCalledWith(`/api/v1/ai/knowledge/graph?wid=${WID}&limit=200`);
    expect(screen.getByText(`${NS}:title`)).toBeInTheDocument();
    expect(screen.getByLabelText(`${NS}:graph`)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(`${NS}:search`)).toBeInTheDocument();
    for (const type of ["concept", "entity", "fact", "procedure"]) {
      expect(screen.getByRole("button", { name: type })).toBeInTheDocument();
    }
    expect(circleCount(container)).toBe(4);
  });

  it("SVG 渲染：4 节点 2 边，长 label 截断 8 字符加省略号，depends_on 边带箭头 marker", async () => {
    mocks.api.mockResolvedValueOnce(GRAPH);
    const { container } = renderView();
    await loaded();

    expect(circleCount(container)).toBe(4);
    expect(lineCount(container)).toBe(2);
    expect(screen.getByText("核心概念很长的标…")).toBeInTheDocument();
    expect(screen.queryByText("核心概念很长的标签名")).toBeFalsy();
    const lines = Array.from(graphSvg(container)?.querySelectorAll("line") ?? []);
    const depends = Array.from(lines).find((l) => l.getAttribute("marker-end"));
    expect(depends).not.toBeNull();
  });

  it("类型过滤：点击 concept 隐藏该节点与关联边，再点恢复", async () => {
    mocks.api.mockResolvedValueOnce(GRAPH);
    const { container } = renderView();
    await loaded();

    fireEvent.click(screen.getByRole("button", { name: "concept" }));
    await waitFor(() => expect(circleCount(container)).toBe(3));
    expect(screen.queryByText("核心概念很长的标…")).toBeFalsy();
    expect(lineCount(container)).toBe(1); // e-1 端点被过滤

    fireEvent.click(screen.getByRole("button", { name: "concept" }));
    await waitFor(() => expect(circleCount(container)).toBe(4));
    expect(lineCount(container)).toBe(2);
  });

  it("搜索：按 content 子串过滤只剩实体节点；无匹配 → noData；清空恢复", async () => {
    mocks.api.mockResolvedValueOnce(GRAPH);
    const { container } = renderView();
    await loaded();

    const search = screen.getByPlaceholderText(`${NS}:search`);
    fireEvent.change(search, { target: { value: "searchable" } });
    await waitFor(() => expect(circleCount(container)).toBe(1));
    expect(screen.getByText("实体节点")).toBeInTheDocument();
    expect(screen.queryByText("事实节点")).toBeFalsy();

    fireEvent.change(search, { target: { value: "zzz-no-match" } });
    await waitFor(() => expect(screen.getByText(`${NS}:noData`)).toBeInTheDocument());
    expect(circleCount(container)).toBe(0);

    fireEvent.change(search, { target: { value: "" } });
    await waitFor(() => expect(circleCount(container)).toBe(4));
  });

  it("点击节点 → 详情侧栏：type/label/content/source 与 relations 列表", async () => {
    mocks.api.mockResolvedValueOnce(GRAPH);
    renderView();
    await loaded();

    fireEvent.click(screen.getByText("事实节点"));
    expect(screen.getByText(`${NS}:nodeDetail`)).toBeInTheDocument();
    const aside = screen.getByText(`${NS}:nodeDetail`).closest("aside")!;
    expect(aside.textContent).toContain("fact");
    expect(aside.textContent).toContain("事实内容");
    expect(aside.textContent).toContain("document");
    // kn-3 的唯一关联边 e-2（kn-2 → kn-3）方向为 ←
    expect(screen.getByText(/relates_to: 实体节点/)).toBeInTheDocument();
  });

  it("孤立节点详情 relations 显示占位符；侧栏 close 按钮关闭", async () => {
    mocks.api.mockResolvedValueOnce(GRAPH);
    renderView();
    await loaded();

    fireEvent.click(screen.getByText("流程节点"));
    expect(screen.getByText("—")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("close"));
    expect(screen.queryByText(`${NS}:nodeDetail`)).toBeFalsy();
  });

  it("删除成功：confirm 确认 → DELETE URL 精确、节点与关联边移除、toast deleted、侧栏关闭", async () => {
    mocks.api.mockResolvedValueOnce(GRAPH).mockResolvedValueOnce({});
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { container } = renderView();
    await loaded();

    fireEvent.click(screen.getByText("实体节点"));
    fireEvent.click(screen.getByText(`${NS}:deleteNode`).closest("button")!);
    expect(confirmSpy).toHaveBeenCalledWith(`${NS}:confirmDelete`);

    await waitFor(() =>
      expect(mocks.api).toHaveBeenLastCalledWith(`/api/v1/ai/knowledge/nodes/kn-2?wid=${WID}`, {
        method: "DELETE",
      }),
    );
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("success", `${NS}:deleted`));
    // kn-2 被删：两条边均与 kn-2 相连 → 全部移除
    await waitFor(() => expect(circleCount(container)).toBe(3));
    expect(lineCount(container)).toBe(0);
    expect(screen.queryByText(`${NS}:nodeDetail`)).toBeFalsy();
    confirmSpy.mockRestore();
  });

  it("confirm 取消 → 不发 DELETE 请求", async () => {
    mocks.api.mockResolvedValueOnce(GRAPH);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const apiCallsBefore = 1; // 仅挂载时的 GET
    renderView();
    await loaded();

    fireEvent.click(screen.getByText("实体节点"));
    fireEvent.click(screen.getByText(`${NS}:deleteNode`).closest("button")!);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(mocks.api).toHaveBeenCalledTimes(apiCallsBefore);
    expect(screen.getByText(`${NS}:nodeDetail`)).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it("删除失败 → toast error（error），节点仍在侧栏仍在", async () => {
    mocks.api.mockResolvedValueOnce(GRAPH).mockRejectedValueOnce(new Error("boom"));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { container } = renderView();
    await loaded();

    fireEvent.click(screen.getByText("实体节点"));
    fireEvent.click(screen.getByText(`${NS}:deleteNode`).closest("button")!);
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("error", `${NS}:error`));
    expect(circleCount(container)).toBe(4);
    expect(screen.getByText(`${NS}:nodeDetail`)).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it("加载失败 → loadFailed 文案 + toast error；刷新按钮重试成功后渲染 SVG", async () => {
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    const { container } = renderView();

    await waitFor(() => expect(screen.getByText(`${NS}:loadFailed`)).toBeInTheDocument());
    expect(mocks.toast).toHaveBeenCalledWith("error", `${NS}:loadFailed`);
    expect(circleCount(container)).toBe(0);

    mocks.api.mockResolvedValueOnce(GRAPH);
    fireEvent.click(screen.getByLabelText(`${NS}:graph`));
    await loaded();
    expect(circleCount(container)).toBe(4);
    expect(screen.queryByText(`${NS}:loadFailed`)).toBeFalsy();
  });

  it("空数据 {nodes:[],edges:[]} → noData 空态", async () => {
    mocks.api.mockResolvedValueOnce({ nodes: [], edges: [] });
    renderView();

    await waitFor(() => expect(screen.getByText(`${NS}:noData`)).toBeInTheDocument());
  });
});
