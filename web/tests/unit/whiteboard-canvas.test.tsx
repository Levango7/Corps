// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

/**
 * WhiteboardCanvas 契约（components/whiteboard/WhiteboardCanvas.tsx，named 导出）：
 *  1. 初始：标题预填、元素计数、空态文案；initialData 支持数组 / JSON 字符串 / 坏 JSON
 *  2. 工具→画布空白点击创建元素（sticky/text 立即进入编辑并切回 select）
 *  3. select：点元素选中（边框 + resize 手柄 + footer 选中信息）；delete 工具点击删除
 *  4. 双击 sticky/text 进入编辑并可改内容；rectangle/ellipse/arrow 不进入编辑
 *  5. 键盘 Delete/Backspace 删除选中；Escape 清选中；编辑中不拦截删除键
 *  6. 拖拽移动 / 手柄 resize（最小 20）
 *  7. 自动保存：元素变化 debounce 2s PATCH data（首次渲染不保存）；卸载时 flush 脏数据
 *  8. 标题 blur：变更才 PATCH {title}；未变更不发
 *
 * 说明：WhiteboardToolbar 被 stub 成可控按钮组（其自身有独立测试）。
 */

const mocks = vi.hoisted(() => ({ api: vi.fn() }));

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
vi.mock("@/components/whiteboard/WhiteboardToolbar", () => ({
  WhiteboardToolbar: ({
    tool,
    onToolChange,
  }: {
    tool: string;
    onToolChange: (t: string) => void;
  }) => (
    <div data-testid="toolbar" data-tool={tool}>
      {["select", "sticky", "text", "rectangle", "ellipse", "arrow", "delete"].map((tp) => (
        <button key={tp} type="button" aria-label={`tool-${tp}`} onClick={() => onToolChange(tp)}>
          {tp}
        </button>
      ))}
    </div>
  ),
}));

import { WhiteboardCanvas } from "@/components/whiteboard/WhiteboardCanvas";

const WID = "ws-wb-1";
const WBID = "wb-1";
const PATCH_URL = `/api/v1/workspaces/${WID}/whiteboards/${WBID}`;

function element(overrides: Record<string, unknown> = {}) {
  return {
    id: "el-1",
    type: "sticky",
    x: 10,
    y: 20,
    width: 160,
    height: 120,
    content: "便签内容",
    style: { background: "var(--warning-soft)", color: "var(--fg)" },
    ...overrides,
  };
}

function renderCanvas(props: { title?: string; data?: unknown } = {}) {
  return render(
    <WhiteboardCanvas
      wid={WID}
      wbid={WBID}
      initialTitle={props.title ?? "我的白板"}
      initialData={props.data ?? [element()]}
    />,
  );
}

const canvas = () => document.querySelector(".relative.flex-1") as HTMLDivElement;
const elementDivs = () => Array.from(document.querySelectorAll(".absolute.select-none"));
const setTool = (tp: string) => fireEvent.click(screen.getByLabelText(`tool-${tp}`));

beforeEach(() => {
  mocks.api.mockReset();
  mocks.api.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("WhiteboardCanvas", () => {
  it("初始：标题预填、元素数量、无空态", () => {
    renderCanvas();
    expect(screen.getByLabelText("whiteboard:title")).toHaveValue("我的白板");
    expect(screen.getByText(/whiteboard:elements/)).toHaveTextContent(/1/);
    expect(screen.queryByText("whiteboard:noWhiteboards")).toBeFalsy();
    expect(elementDivs()).toHaveLength(1);
  });

  it("initialData 为 JSON 字符串 → 解析；坏 JSON/非数组 → 空", () => {
    const first = renderCanvas({ data: JSON.stringify([element(), element({ id: "el-2" })]) });
    expect(elementDivs()).toHaveLength(2);
    first.unmount();

    cleanup();
    renderCanvas({ data: "{broken" });
    expect(elementDivs()).toHaveLength(0);
    expect(screen.getByText("whiteboard:noWhiteboards")).toBeInTheDocument();

    cleanup();
    renderCanvas({ data: { not: "array" } });
    expect(elementDivs()).toHaveLength(0);
  });

  it("sticky 工具点画布空白 → 创建元素并立即进入编辑，工具回 select", () => {
    renderCanvas({ data: [] });
    setTool("sticky");
    fireEvent.mouseDown(canvas(), { clientX: 100, clientY: 50 });

    expect(elementDivs()).toHaveLength(1);
    // 编辑态出现 textarea
    expect(document.querySelector("textarea")).toBeTruthy();
    expect(screen.getByTestId("toolbar")).toHaveAttribute("data-tool", "select");
  });

  it("text 工具创建后进入编辑；rectangle 创建不进入编辑", () => {
    renderCanvas({ data: [] });
    setTool("text");
    fireEvent.mouseDown(canvas(), { clientX: 10, clientY: 10 });
    expect(document.querySelector("textarea")).toBeTruthy();
    // 编辑中 blur 退出
    fireEvent.blur(document.querySelector("textarea")!);
    expect(document.querySelector("textarea")).toBeNull();

    setTool("rectangle");
    fireEvent.mouseDown(canvas(), { clientX: 200, clientY: 200 });
    expect(elementDivs()).toHaveLength(2);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("点击元素内部不创建新元素（仅空白 target===currentTarget）", () => {
    renderCanvas({ data: [] });
    setTool("sticky");
    fireEvent.mouseDown(screen.getByText("whiteboard:noWhiteboards"), { clientX: 10, clientY: 10 });
    expect(elementDivs()).toHaveLength(0);
  });

  it("select 工具点元素 → 选中（边框+resize 手柄+footer 信息）", () => {
    renderCanvas();
    fireEvent.mouseDown(elementDivs()[0], { clientX: 15, clientY: 25 });

    expect(screen.getByLabelText("resize")).toBeInTheDocument();
    expect(screen.getByText(/whiteboard:toolSelect/)).toBeInTheDocument();
  });

  it("delete 工具点元素 → 删除", () => {
    renderCanvas();
    setTool("delete");
    fireEvent.mouseDown(elementDivs()[0], { clientX: 15, clientY: 25 });
    expect(elementDivs()).toHaveLength(0);
    expect(screen.getByText("whiteboard:noWhiteboards")).toBeInTheDocument();
  });

  it("双击 sticky → 编辑；修改内容后 blur 生效", () => {
    renderCanvas();
    fireEvent.doubleClick(elementDivs()[0]);
    const ta = document.querySelector("textarea") as HTMLTextAreaElement;
    expect(ta).toBeTruthy();
    expect(ta).toHaveValue("便签内容");

    fireEvent.change(ta, { target: { value: "改后的内容" } });
    fireEvent.blur(ta);
    expect(document.querySelector("textarea")).toBeNull();
    expect(screen.getByText("改后的内容")).toBeInTheDocument();
  });

  it("双击 rectangle 不进入编辑", () => {
    renderCanvas({ data: [element({ type: "rectangle", content: "" })] });
    fireEvent.doubleClick(elementDivs()[0]);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("键盘 Delete 删除选中；Backspace 同；Escape 清选中", () => {
    renderCanvas();
    fireEvent.mouseDown(elementDivs()[0], { clientX: 15, clientY: 25 });
    expect(screen.getByLabelText("resize")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByLabelText("resize")).toBeFalsy();

    fireEvent.mouseDown(elementDivs()[0], { clientX: 15, clientY: 25 });
    fireEvent.keyDown(window, { key: "Delete" });
    expect(elementDivs()).toHaveLength(0);
  });

  it("拖拽移动：mousemove 更新 left/top，mouseup 结束", () => {
    renderCanvas();
    const div = elementDivs()[0] as HTMLElement;
    fireEvent.mouseDown(div, { clientX: 15, clientY: 25 });
    fireEvent.mouseMove(window, { clientX: 45, clientY: 65 });
    expect(div.style.left).toBe("40px");
    expect(div.style.top).toBe("60px");

    fireEvent.mouseUp(window);
    fireEvent.mouseMove(window, { clientX: 100, clientY: 100 });
    expect(div.style.left).toBe("40px"); // 已结束，不再变化
  });

  it("手柄 resize：mousemove 调整宽高，最小 20", () => {
    renderCanvas();
    fireEvent.mouseDown(elementDivs()[0], { clientX: 15, clientY: 25 });
    const handle = screen.getByLabelText("resize");
    fireEvent.mouseDown(handle, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 130, clientY: 140 });
    const div = elementDivs()[0] as HTMLElement;
    expect(div.style.width).toBe("190px");
    expect(div.style.height).toBe("160px");

    fireEvent.mouseDown(screen.getByLabelText("resize"), { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: -500, clientY: -500 });
    expect(div.style.width).toBe("20px");
    expect(div.style.height).toBe("20px");
  });

  it("自动保存：元素变化 debounce 2s → PATCH data；首次渲染不保存", async () => {
    vi.useFakeTimers();
    renderCanvas({ data: [] });
    expect(mocks.api).not.toHaveBeenCalled(); // 首次渲染不保存

    setTool("sticky");
    fireEvent.mouseDown(canvas(), { clientX: 100, clientY: 50 });
    expect(mocks.api).not.toHaveBeenCalled(); // 未到 2s

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(mocks.api).toHaveBeenCalledTimes(1);
    const [url, init] = mocks.api.mock.calls[0];
    expect(url).toBe(PATCH_URL);
    expect(init).toMatchObject({ method: "PATCH", signal: expect.any(AbortSignal) });
    const parsed = JSON.parse(JSON.parse(init.body).data);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].type).toBe("sticky");
  });

  it("卸载 flush：有未保存改动时立即 PATCH 最新 elements", async () => {
    vi.useFakeTimers();
    const { unmount } = renderCanvas({ data: [] });
    setTool("sticky");
    fireEvent.mouseDown(canvas(), { clientX: 100, clientY: 50 });

    unmount();
    // 卸载 flush 直接发请求（不等 debounce）
    expect(mocks.api).toHaveBeenCalledTimes(1);
    const [, init] = mocks.api.mock.calls[0];
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(JSON.parse(init.body).data)).toHaveLength(1);
  });

  it("标题 blur：改过才 PATCH {title}；未改不发", async () => {
    renderCanvas();
    const input = screen.getByLabelText("whiteboard:title") as HTMLInputElement;

    fireEvent.blur(input);
    expect(mocks.api).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "新标题" } });
    fireEvent.blur(input);
    expect(mocks.api).toHaveBeenCalledWith(PATCH_URL, {
      method: "PATCH",
      body: JSON.stringify({ title: "新标题" }),
    });
  });

  it("保存状态：saving 时显示 autoSaved…，成功后显示 autoSaved", async () => {
    vi.useFakeTimers();
    renderCanvas({ data: [] });
    setTool("sticky");
    fireEvent.mouseDown(canvas(), { clientX: 100, clientY: 50 });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    // 保存成功落定后显示 autoSaved
    expect(screen.getByText(/whiteboard:autoSaved/)).toBeInTheDocument();
  });
});
