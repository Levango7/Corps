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

import { ContactGroupSidebar } from "@/components/contact/ContactGroupSidebar";

const WID = "ws-1";
const GROUPS_PATH = `/api/v1/workspaces/${WID}/contact-groups`;

function group(id: string, name: string, contacts: number) {
  return { id, name, _count: { contacts } };
}

function payload(items: ReturnType<typeof group>[]) {
  return { items, total: items.length, hasMore: false };
}

type SidebarProps = Parameters<typeof ContactGroupSidebar>[0];

/** 每个分组行内的删除按钮（aria-label 与新建表单里的取消按钮同为 contact:delete） */
function rowDeleteButtons(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll("nav div > button[aria-label='contact:delete']"));
}

function renderSidebar(props: Partial<SidebarProps> = {}) {
  const onSelectGroup = vi.fn();
  const utils = render(
    <ContactGroupSidebar
      wid={WID}
      selectedGroupId={null}
      onSelectGroup={onSelectGroup}
      totalCount={7}
      {...props}
    />,
  );
  return { ...utils, onSelectGroup };
}

beforeEach(() => {
  mocks.api.mockReset();
  mocks.apiList.mockReset();
});
afterEach(() => cleanup());

describe("ContactGroupSidebar", () => {
  it("挂载时按 wid 精确请求分组列表（单参数调用，不用 apiList）", async () => {
    mocks.api.mockResolvedValue(payload([]));
    renderSidebar();

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(mocks.api.mock.calls[0][0]).toBe(GROUPS_PATH);
    expect(mocks.api.mock.calls[0][1]).toBeUndefined();
    expect(mocks.apiList).not.toHaveBeenCalled();
  });

  it("「全部联系人」行显示 totalCount 并在加载中显示 loading", async () => {
    let release: (v: unknown) => void = () => {};
    mocks.api.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    renderSidebar({ totalCount: 42 });

    expect(screen.getByText("contact:allContacts")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("contact:loading")).toBeInTheDocument();

    release(payload([group("g-1", "Core", 3)]));
    await waitFor(() => expect(screen.queryByText("contact:loading")).toBeNull());
  });

  it("分组按接口顺序渲染计数与色点，totalCount=0 时回退值 0 可见", async () => {
    mocks.api.mockResolvedValue(payload([group("g-1", "Core", 3), group("g-2", "Design", 0)]));
    const { container } = renderSidebar({ totalCount: 0 });

    await waitFor(() => expect(screen.getByText("Core")).toBeInTheDocument());
    expect(screen.getByText("Design")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    // 「全部」计数 0 + Design 计数 0 => 两个 0
    expect(screen.getAllByText("0")).toHaveLength(2);
    expect(container.querySelectorAll("nav span[aria-hidden='true']")).toHaveLength(2);
  });

  it("空列表只渲染「全部联系人」行，没有分组行与删除按钮", async () => {
    mocks.api.mockResolvedValue(payload([]));
    const { container } = renderSidebar({ totalCount: 1 });

    await waitFor(() => expect(screen.queryByText("contact:loading")).toBeNull());
    expect(screen.getByText("contact:allContacts")).toBeInTheDocument();
    expect(rowDeleteButtons(container)).toHaveLength(0);
    expect(screen.queryByText("Create")).toBeNull();
  });

  it("加载失败被静默吞掉：无错误文案、无分组，仅剩「全部联系人」", async () => {
    mocks.api.mockRejectedValue(new Error("boom"));
    const { container } = renderSidebar({ totalCount: 5 });

    await waitFor(() => expect(screen.queryByText("contact:loading")).toBeNull());
    expect(screen.queryByText("boom")).toBeNull();
    expect(screen.queryByText("contact:delete")).toBeNull();
    expect(rowDeleteButtons(container)).toHaveLength(0);
    expect(screen.getByText("contact:allContacts")).toBeInTheDocument();
  });

  it("点「全部联系人」与点分组分别回调 null 与该分组 id", async () => {
    mocks.api.mockResolvedValue(payload([group("g-1", "Core", 3)]));
    const { onSelectGroup } = renderSidebar({ selectedGroupId: "g-1" });

    await waitFor(() => expect(screen.getByText("Core")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Core"));
    expect(onSelectGroup).toHaveBeenNthCalledWith(1, "g-1");

    fireEvent.click(screen.getByText("contact:allContacts"));
    expect(onSelectGroup).toHaveBeenNthCalledWith(2, null);
  });

  it("新建按钮切换输入框；空白名提交按钮禁用，取消按钮关闭并保留分组列表", async () => {
    mocks.api.mockResolvedValue(payload([group("g-1", "Core", 3)]));
    const { container } = renderSidebar();

    await waitFor(() => expect(screen.getByText("Core")).toBeInTheDocument());
    expect(container.querySelector("form")).toBeNull();

    fireEvent.click(screen.getByLabelText("contact:addGroup"));
    const input = screen.getByPlaceholderText("contact:groupName") as HTMLInputElement;
    const submit = screen.getByLabelText("contact:create");
    expect(submit).toBeDisabled();

    fireEvent.change(input, { target: { value: "   " } });
    expect(submit).toBeDisabled();

    fireEvent.change(input, { target: { value: "Ops" } });
    expect(submit).toBeEnabled();

    // 新建表单里的 X 取消按钮与行内删除共用 contact:delete 标签：这里取表单内的那个
    const form = container.querySelector("form") as HTMLFormElement;
    fireEvent.click(form.querySelector("button[aria-label='contact:delete']") as HTMLElement);
    expect(container.querySelector("form")).toBeNull();
    expect(screen.getByText("Core")).toBeInTheDocument();
  });

  it("创建分组：POST 的 URL 与 body 精确，返回后插入并按名称排序、_count 归零", async () => {
    mocks.api
      .mockResolvedValueOnce(payload([group("g-1", "Core", 3)]))
      .mockResolvedValueOnce({ id: "g-2", name: "Analytics" });
    const { container } = renderSidebar();

    await waitFor(() => expect(screen.getByText("Core")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("contact:addGroup"));
    fireEvent.change(screen.getByPlaceholderText("contact:groupName"), {
      target: { value: "  Analytics  " },
    });
    fireEvent.click(screen.getByLabelText("contact:create"));

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api.mock.calls[1][0]).toBe(GROUPS_PATH);
    expect(mocks.api.mock.calls[1][1]).toEqual({
      method: "POST",
      body: JSON.stringify({ name: "Analytics" }),
    });

    await waitFor(() => expect(screen.getByText("Analytics")).toBeInTheDocument());
    const names = Array.from(container.querySelectorAll("nav div > button > span:last-child")).map(
      (el) => el.textContent,
    );
    expect(names).toEqual(["Analytics", "Core"]);
    // 新分组计数 0；「全部」计数仍是 7，Core 计数 3
    expect(screen.getAllByText("0")).toHaveLength(1);
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    // 成功后表单收起
    expect(container.querySelector("form")).toBeNull();
  });

  it("创建失败显示 e.message，输入框保留且分组数不变", async () => {
    mocks.api
      .mockResolvedValueOnce(payload([group("g-1", "Core", 3)]))
      .mockRejectedValueOnce(new Error("重名分组"));
    const { container } = renderSidebar();

    await waitFor(() => expect(screen.getByText("Core")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("contact:addGroup"));
    const input = screen.getByPlaceholderText("contact:groupName") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Core" } });
    fireEvent.click(screen.getByLabelText("contact:create"));

    await waitFor(() => expect(screen.getByText("重名分组")).toBeInTheDocument());
    expect((screen.getByPlaceholderText("contact:groupName") as HTMLInputElement).value).toBe(
      "Core",
    );
    expect(rowDeleteButtons(container)).toHaveLength(1);
  });

  it("删除非当前分组：DELETE 带 ?gid=，成功后移除该行且不回调 onSelectGroup", async () => {
    mocks.api
      .mockResolvedValueOnce(payload([group("g-1", "Core", 3), group("g-2", "Design", 0)]))
      .mockResolvedValueOnce(undefined);
    const { container, onSelectGroup } = renderSidebar({ selectedGroupId: "g-3" });

    await waitFor(() => expect(screen.getByText("Core")).toBeInTheDocument());
    fireEvent.click(rowDeleteButtons(container)[0]);

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api.mock.calls[1][0]).toBe(`${GROUPS_PATH}?gid=g-1`);
    expect(mocks.api.mock.calls[1][1]).toEqual({ method: "DELETE" });

    await waitFor(() => expect(screen.queryByText("Core")).toBeNull());
    expect(screen.getByText("Design")).toBeInTheDocument();
    expect(onSelectGroup).not.toHaveBeenCalled();
  });

  it("删除当前选中分组：成功后回退「全部」，回调 onSelectGroup(null)", async () => {
    mocks.api
      .mockResolvedValueOnce(payload([group("g-1", "Core", 3)]))
      .mockResolvedValueOnce(undefined);
    const { container, onSelectGroup } = renderSidebar({ selectedGroupId: "g-1" });

    await waitFor(() => expect(screen.getByText("Core")).toBeInTheDocument());
    fireEvent.click(rowDeleteButtons(container)[0]);

    await waitFor(() => expect(onSelectGroup).toHaveBeenCalledWith(null));
    expect(onSelectGroup).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Core")).toBeNull();
    expect(mocks.api.mock.calls[1][0]).toBe(`${GROUPS_PATH}?gid=g-1`);
  });

  it("删除失败显示 e.message 且该行保留", async () => {
    mocks.api
      .mockResolvedValueOnce(payload([group("g-1", "Core", 3)]))
      .mockRejectedValueOnce(new Error("分组非空"));
    const { container } = renderSidebar();

    await waitFor(() => expect(screen.getByText("Core")).toBeInTheDocument());
    const btn = rowDeleteButtons(container)[0];
    fireEvent.click(btn);

    await waitFor(() => expect(screen.getByText("分组非空")).toBeInTheDocument());
    expect(screen.getByText("Core")).toBeInTheDocument();
    expect(rowDeleteButtons(container)).toHaveLength(1);
    expect(btn).toBeEnabled();
  });
});
