// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ api: vi.fn(), apiList: vi.fn() }));

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
vi.mock("@/lib/api", () => ({ api: mocks.api, apiList: mocks.apiList }));

import { ContactList } from "@/components/contact/ContactList";

const WID = "ws-1";
const BASE = `/api/v1/workspaces/${WID}/contacts`;

function item(over: Record<string, unknown> = {}) {
  return {
    id: "c-1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    phone: "+1 555 0100",
    department: "R&D",
    position: "Engineer",
    avatar: null as string | null,
    groupId: null,
    updatedAt: "2026-11-01T00:00:00Z",
    ...over,
  };
}

type ListProps = Parameters<typeof ContactList>[0];

function renderList(props: Partial<ListProps> = {}) {
  const onSelect = vi.fn();
  const utils = render(
    <ContactList wid={WID} groupId={null} onSelect={onSelect} selectedId={null} {...props} />,
  );
  return { ...utils, onSelect };
}

/** 每个联系人的可点击行按钮（ul > li > button） */
function rowButtons(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll("ul > li > button"));
}

beforeEach(() => {
  mocks.api.mockReset();
  mocks.apiList.mockReset();
});
afterEach(() => cleanup());

describe("ContactList", () => {
  it("groupId=null 且无搜索时，请求 URL 为空查询串且只传一个参数", async () => {
    mocks.api.mockResolvedValue({ items: [], total: 0 });
    renderList();

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(mocks.api.mock.calls[0][0]).toBe(`${BASE}?`);
    expect(mocks.api.mock.calls[0][1]).toBeUndefined();
    expect(mocks.apiList).not.toHaveBeenCalled();
  });

  it("挂载时带 groupId 精确编码进查询串", async () => {
    mocks.api.mockResolvedValue({ items: [], total: 0 });
    renderList({ groupId: "g 1/x" });

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(mocks.api.mock.calls[0][0]).toBe(`${BASE}?groupId=g+1%2Fx`);
  });

  it("groupId 变化触发重新请求（两次调用的 URL 各自正确）", async () => {
    mocks.api.mockResolvedValue({ items: [], total: 0 });
    const { rerender } = renderList({ groupId: null });
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));

    rerender(<ContactList wid={WID} groupId="g-1" onSelect={vi.fn()} selectedId={null} />);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api.mock.calls[1][0]).toBe(`${BASE}?groupId=g-1`);
  });

  it("加载中显示 loading，完成后渲染列表", async () => {
    let release: (v: unknown) => void = () => {};
    mocks.api.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    renderList();

    expect(screen.getByText("contact:loading")).toBeInTheDocument();
    release({ items: [item()], total: 1 });

    await waitFor(() => expect(screen.getByText("Ada Lovelace")).toBeInTheDocument());
    expect(screen.queryByText("contact:loading")).toBeNull();
  });

  it("空列表显示空态，不渲染 ul", async () => {
    mocks.api.mockResolvedValue({ items: [], total: 0 });
    const { container } = renderList();

    await waitFor(() => expect(screen.getByText("contact:noContacts")).toBeInTheDocument());
    expect(container.querySelector("ul")).toBeNull();
  });

  it("渲染姓名/职位/部门/邮箱/电话；缺省字段不渲染文本，头像回退为首字母大写", async () => {
    mocks.api.mockResolvedValue({
      items: [
        item(),
        item({
          id: "c-2",
          name: "bob",
          email: null,
          phone: null,
          department: null,
          position: null,
          avatar: "https://cdn.test/bob.png",
        }),
      ],
      total: 2,
    });
    const { container } = renderList();

    await waitFor(() => expect(screen.getByText("Ada Lovelace")).toBeInTheDocument());
    expect(screen.getByText("Engineer")).toBeInTheDocument();
    expect(screen.getByText("R&D")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByText("+1 555 0100")).toBeInTheDocument();

    // 首字母回退只在 Ada 上出现（bob 用了头像图片）
    expect(screen.getByText("A")).toBeInTheDocument();
    const img = screen.getByRole("img", { name: "bob" });
    expect(img).toHaveAttribute("src", "https://cdn.test/bob.png");
    expect(screen.queryByText("B")).toBeNull();
    expect(screen.queryAllByText("ada@example.com")).toHaveLength(1);
    expect(container.querySelectorAll("ul > li")).toHaveLength(2);
  });

  it("total 大于已渲染数量时追加 showingCount 行（带 vars）", async () => {
    mocks.api.mockResolvedValue({ items: [item()], total: 3 });
    const { container } = renderList();

    await waitFor(() =>
      expect(
        screen.getByText(`contact:showingCount:${JSON.stringify({ shown: 1, total: 3 })}`),
      ).toBeInTheDocument(),
    );
    // 1 个联系人 + 1 个计数行
    expect(container.querySelectorAll("ul > li")).toHaveLength(2);
  });

  it("total 等于已渲染数量时不显示 showingCount", async () => {
    mocks.api.mockResolvedValue({ items: [item()], total: 1 });
    renderList();

    await waitFor(() => expect(screen.getByText("Ada Lovelace")).toBeInTheDocument());
    expect(screen.queryByText(/^contact:showingCount/)).toBeNull();
  });

  it("点击行回调 onSelect(contact)；selectedId 命中时行高亮", async () => {
    mocks.api.mockResolvedValue({ items: [item(), item({ id: "c-2", name: "Bob" })], total: 2 });
    const { container, onSelect } = renderList({ selectedId: "c-2" });

    await waitFor(() => expect(screen.getByText("Ada Lovelace")).toBeInTheDocument());
    const [first, second] = rowButtons(container);
    expect(first.className).toContain("hover:bg-[var(--surface-2)]");
    expect(second.className).toContain("bg-[var(--surface-2)]");
    expect(second.className).not.toContain("hover:");

    fireEvent.click(first);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toMatchObject({ id: "c-1", name: "Ada Lovelace" });
  });

  it("搜索：输入后发出带 search 参数的请求，清空按钮收起并回到无 search 的 URL", async () => {
    mocks.api.mockResolvedValue({ items: [item()], total: 1 });
    const { container } = renderList();
    await waitFor(() => expect(screen.getByText("Ada Lovelace")).toBeInTheDocument());

    const searchInput = screen.getByPlaceholderText("contact:search") as HTMLInputElement;
    expect(container.querySelector("button[aria-label='contact:search']")).toBeNull();

    fireEvent.change(searchInput, { target: { value: "ada" } });
    await waitFor(() =>
      expect(mocks.api.mock.calls.map((c) => c[0])).toContain(`${BASE}?search=ada`),
    );
    expect(searchInput.value).toBe("ada");

    const clear = container.querySelector(
      "button[aria-label='contact:search']",
    ) as HTMLButtonElement;
    expect(clear).not.toBeNull();
    fireEvent.click(clear);

    expect(searchInput.value).toBe("");
    await waitFor(() =>
      expect(mocks.api.mock.calls[mocks.api.mock.calls.length - 1][0]).toBe(`${BASE}?`),
    );
    expect(container.querySelector("button[aria-label='contact:search']")).toBeNull();
  });

  it("搜索与分组同时存在时参数顺序为 groupId 在前、search 在后", async () => {
    mocks.api.mockResolvedValue({ items: [], total: 0 });
    renderList({ groupId: "g-1" });
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByPlaceholderText("contact:search"), {
      target: { value: "bob smith" },
    });
    await waitFor(() =>
      expect(mocks.api.mock.calls[mocks.api.mock.calls.length - 1][0]).toBe(
        `${BASE}?groupId=g-1&search=bob+smith`,
      ),
    );
  });

  it("请求失败显示 e.message 且落到空态", async () => {
    mocks.api.mockRejectedValue(new Error("网络错误"));
    renderList();

    await waitFor(() => expect(screen.getByText("网络错误")).toBeInTheDocument());
    expect(screen.getByText("contact:noContacts")).toBeInTheDocument();
    expect(screen.queryByText("contact:loading")).toBeNull();
  });
});
