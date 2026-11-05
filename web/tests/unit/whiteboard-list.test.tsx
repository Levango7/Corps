// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * WhiteboardList 契约（components/whiteboard/WhiteboardList.tsx，named 导出）：
 *  1. 挂载 GET /api/v1/workspaces/{wid}/whiteboards → 卡片列表；loading 态
 *  2. 每张卡片：标题（空标题回退 untitled）、更新时间、href、删除按钮
 *  3. 新建：POST body {title: t("untitled")} → router.push(/w/{wid}/whiteboards/{id})
 *  4. 删除：confirm 门控 → DELETE → 卡片移除；取消不发
 *  5. 失败：加载失败显示 e.message；创建/删除失败显示 e.message（非 Error 回退文案）
 *  6. 空列表 → 空态文案
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  push: vi.fn(),
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
vi.mock("@/lib/i18n-navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { WhiteboardList } from "@/components/whiteboard/WhiteboardList";

const WID = "ws-wbl-1";
const LIST_URL = `/api/v1/workspaces/${WID}/whiteboards`;

function wb(overrides: Record<string, unknown> = {}) {
  return {
    id: "wb-1",
    title: "白板甲",
    updatedAt: "2026-11-01T10:00:00Z",
    createdAt: "2026-11-01T00:00:00Z",
    ...overrides,
  };
}

const OK = (items: unknown[] = [wb()]) =>
  mocks.api.mockResolvedValueOnce({ items, total: items.length, hasMore: false });

beforeEach(() => {
  mocks.api.mockReset();
  mocks.push.mockReset();
});
afterEach(() => cleanup());

describe("WhiteboardList", () => {
  it("挂载 GET 列表（URL 精确）；loading 态显示 loading 文案", () => {
    mocks.api.mockImplementationOnce(() => new Promise(() => {}));
    render(<WhiteboardList wid={WID} />);

    expect(mocks.api).toHaveBeenCalledWith(LIST_URL);
    expect(screen.getByText("whiteboard:loading")).toBeInTheDocument();
  });

  it("列表渲染：标题、更新时间文案、指向 /w/{wid}/whiteboards/{id} 的链接", async () => {
    OK();
    render(<WhiteboardList wid={WID} />);

    await waitFor(() => expect(screen.getByText("白板甲")).toBeInTheDocument());
    expect(screen.getByText(/whiteboard:lastUpdated/)).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", `/w/${WID}/whiteboards/wb-1`);
  });

  it("空标题回退 untitled", async () => {
    OK([wb({ title: "" })]);
    render(<WhiteboardList wid={WID} />);
    await waitFor(() => expect(screen.getByText("whiteboard:untitled")).toBeInTheDocument());
  });

  it("空列表 → 空态文案", async () => {
    OK([]);
    render(<WhiteboardList wid={WID} />);
    await waitFor(() => expect(screen.getByText("whiteboard:noWhiteboards")).toBeInTheDocument());
  });

  it("加载失败（Error）→ 显示 e.message", async () => {
    mocks.api.mockRejectedValueOnce(new Error("列表炸了"));
    render(<WhiteboardList wid={WID} />);
    await waitFor(() => expect(screen.getByText("列表炸了")).toBeInTheDocument());
    expect(screen.getByText("whiteboard:noWhiteboards")).toBeInTheDocument(); // 空列表兜底
  });

  it("加载失败（非 Error）→ 回退 noWhiteboards 文案（与空态同文案，故可能两处）", async () => {
    mocks.api.mockRejectedValueOnce("oops");
    render(<WhiteboardList wid={WID} />);
    await waitFor(() =>
      expect(screen.getAllByText("whiteboard:noWhiteboards").length).toBeGreaterThanOrEqual(1),
    );
  });

  it("新建：POST body {title} → router.push 到新白板", async () => {
    OK([]);
    mocks.api.mockResolvedValueOnce({ id: "wb-new", title: "untitled" });
    render(<WhiteboardList wid={WID} />);
    await waitFor(() => expect(screen.getByText("whiteboard:noWhiteboards")).toBeInTheDocument());

    fireEvent.click(screen.getByText("whiteboard:create").closest("button")!);

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(`/w/${WID}/whiteboards/wb-new`));
    expect(mocks.api).toHaveBeenLastCalledWith(LIST_URL, {
      method: "POST",
      body: JSON.stringify({ title: "whiteboard:untitled" }),
    });
  });

  it("新建失败 → 显示 e.message，不跳转", async () => {
    OK([]);
    mocks.api.mockRejectedValueOnce(new Error("创建炸了"));
    render(<WhiteboardList wid={WID} />);
    await waitFor(() => expect(screen.getByText("whiteboard:noWhiteboards")).toBeInTheDocument());

    fireEvent.click(screen.getByText("whiteboard:create").closest("button")!);
    await waitFor(() => expect(screen.getByText("创建炸了")).toBeInTheDocument());
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("删除：confirm true → DELETE 并移除卡片", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      OK();
      mocks.api.mockResolvedValueOnce(undefined);
      render(<WhiteboardList wid={WID} />);
      await waitFor(() => expect(screen.getByText("白板甲")).toBeInTheDocument());

      fireEvent.click(screen.getByLabelText("whiteboard:delete"));
      await waitFor(() =>
        expect(mocks.api).toHaveBeenLastCalledWith(`${LIST_URL}/wb-1`, { method: "DELETE" }),
      );
      await waitFor(() => expect(screen.queryByText("白板甲")).toBeFalsy());
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("删除：confirm false → 不发 DELETE，卡片保留", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      OK();
      render(<WhiteboardList wid={WID} />);
      await waitFor(() => expect(screen.getByText("白板甲")).toBeInTheDocument());

      fireEvent.click(screen.getByLabelText("whiteboard:delete"));
      expect(mocks.api).toHaveBeenCalledTimes(1); // 仅初始 GET
      expect(screen.getByText("白板甲")).toBeInTheDocument();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("删除失败 → 显示 e.message，卡片保留", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      OK();
      mocks.api.mockRejectedValueOnce(new Error("删除炸了"));
      render(<WhiteboardList wid={WID} />);
      await waitFor(() => expect(screen.getByText("白板甲")).toBeInTheDocument());

      fireEvent.click(screen.getByLabelText("whiteboard:delete"));
      await waitFor(() => expect(screen.getByText("删除炸了")).toBeInTheDocument());
      expect(screen.getByText("白板甲")).toBeInTheDocument();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("多张卡片按响应顺序渲染，链接各自独立", async () => {
    OK([wb({ id: "wb-1", title: "甲" }), wb({ id: "wb-2", title: "乙" })]);
    render(<WhiteboardList wid={WID} />);
    await waitFor(() => expect(screen.getByText("乙")).toBeInTheDocument());

    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      `/w/${WID}/whiteboards/wb-1`,
      `/w/${WID}/whiteboards/wb-2`,
    ]);
    expect(screen.getAllByLabelText("whiteboard:delete")).toHaveLength(2);
  });
});
