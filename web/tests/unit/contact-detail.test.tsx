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

import { ContactDetail } from "@/components/contact/ContactDetail";

const WID = "ws-1";
const CID = "c-1";
const DETAIL_PATH = `/api/v1/workspaces/${WID}/contacts/${CID}`;
const GROUPS_PATH = `/api/v1/workspaces/${WID}/contact-groups`;

const group = { id: "g-1", name: "Core", _count: { contacts: 2 } };

function makeDetail(over: Record<string, unknown> = {}) {
  return {
    id: CID,
    name: "Ada Lovelace",
    email: "ada@example.com",
    phone: "+1 555 0100",
    department: "R&D",
    position: "Engineer",
    avatar: null as string | null,
    groupId: "g-1",
    notes: "Mathematician",
    updatedAt: "2026-11-01T00:00:00Z",
    createdAt: "2026-10-01T00:00:00Z",
    group: { id: "g-1", name: "Core" },
    creator: null,
    ...over,
  };
}

type DetailProps = Parameters<typeof ContactDetail>[0];

function renderDetail(props: Partial<DetailProps> = {}) {
  const onClose = vi.fn();
  const onDeleted = vi.fn();
  const onUpdated = vi.fn();
  const utils = render(
    <ContactDetail
      wid={WID}
      contactId={CID}
      onClose={onClose}
      onDeleted={onDeleted}
      onUpdated={onUpdated}
      {...props}
    />,
  );
  return { ...utils, onClose, onDeleted, onUpdated };
}

beforeEach(() => {
  mocks.api.mockReset();
  mocks.apiList.mockReset();
});
afterEach(() => cleanup());

describe("ContactDetail", () => {
  it("挂载时按 wid/contactId 精确请求详情与分组列表（单参数调用）", async () => {
    mocks.api.mockResolvedValue(makeDetail());
    mocks.apiList.mockResolvedValue([group]);
    renderDetail();

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(mocks.api.mock.calls[0][0]).toBe(DETAIL_PATH);
    expect(mocks.api.mock.calls[0][1]).toBeUndefined();

    expect(mocks.apiList).toHaveBeenCalledTimes(1);
    expect(mocks.apiList.mock.calls[0][0]).toBe(GROUPS_PATH);
    expect(mocks.apiList.mock.calls[0][1]).toBeUndefined();
  });

  it("加载中显示 loading，标题回退到 title；完成后两处标题都是姓名", async () => {
    let release: (v: unknown) => void = () => {};
    mocks.api.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    mocks.apiList.mockResolvedValue([]);

    renderDetail();
    expect(screen.getByText("contact:loading")).toBeInTheDocument();
    expect(screen.getByText("contact:title")).toBeInTheDocument();

    release(makeDetail());
    await waitFor(() =>
      expect(screen.getAllByRole("heading", { name: "Ada Lovelace" })).toHaveLength(2),
    );
    expect(screen.queryByText("contact:loading")).toBeNull();
    expect(screen.queryByText("contact:title")).toBeNull();
  });

  it("只读详情渲染全部字段、分组徽标与头像图片", async () => {
    mocks.api.mockResolvedValue(makeDetail({ avatar: "https://cdn.test/ada.png" }));
    mocks.apiList.mockResolvedValue([group]);
    renderDetail();

    await waitFor(() => expect(screen.getByText("ada@example.com")).toBeInTheDocument());
    expect(screen.getByText("+1 555 0100")).toBeInTheDocument();
    expect(screen.getByText("R&D")).toBeInTheDocument();
    expect(screen.getByText("Engineer")).toBeInTheDocument();
    expect(screen.getByText("Mathematician")).toBeInTheDocument();
    expect(screen.getByText("Core")).toBeInTheDocument();

    const img = screen.getByRole("img", { name: "Ada Lovelace" });
    expect(img).toHaveAttribute("src", "https://cdn.test/ada.png");
  });

  it("无头像时回退到姓名首字母大写，且不渲染 img", async () => {
    mocks.api.mockResolvedValue(makeDetail());
    mocks.apiList.mockResolvedValue([]);
    renderDetail();

    await waitFor(() => expect(screen.getByText("A")).toBeInTheDocument());
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("字段全为 null 时 5 行详情都显示破折号占位，且不渲染分组徽标", async () => {
    mocks.api.mockResolvedValue(
      makeDetail({
        email: null,
        phone: null,
        department: null,
        position: null,
        notes: null,
        group: null,
      }),
    );
    mocks.apiList.mockResolvedValue([]);
    renderDetail();

    await waitFor(() => expect(screen.getAllByText("—")).toHaveLength(5));
    expect(screen.queryByText("Core")).toBeNull();
  });

  it("详情请求失败时显示 e.message，并落到空态", async () => {
    mocks.api.mockRejectedValue(new Error("联系人不存在"));
    mocks.apiList.mockResolvedValue([]);
    renderDetail();

    await waitFor(() => expect(screen.getByText("联系人不存在")).toBeInTheDocument());
    expect(screen.getByText("contact:noContacts")).toBeInTheDocument();
    expect(screen.queryByText("contact:loading")).toBeNull();
  });

  it("详情返回 null 时不崩：标题回退、显示空态（错误来自解构空对象）", async () => {
    mocks.api.mockResolvedValue(null);
    mocks.apiList.mockResolvedValue([]);
    renderDetail();

    await waitFor(() => expect(screen.getByText("contact:noContacts")).toBeInTheDocument());
    expect(screen.getByText("contact:title")).toBeInTheDocument();
    expect(screen.queryByText("contact:loading")).toBeNull();
  });

  it("分组列表失败被吞掉：不显示错误，编辑表单只有「全部联系人」选项", async () => {
    mocks.api.mockResolvedValue(makeDetail());
    mocks.apiList.mockRejectedValue(new Error("groups down"));
    renderDetail();

    await waitFor(() => expect(screen.getByText("ada@example.com")).toBeInTheDocument());
    expect(screen.queryByText("groups down")).toBeNull();

    fireEvent.click(screen.getByText("contact:edit"));
    const select = document.querySelector("#cd-group") as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.options).toHaveLength(1);
    expect(select.options[0].textContent).toBe("contact:allContacts");
  });

  it("编辑回填后提交：PATCH 的 URL 与 body 精确（trim + 空串转 null）", async () => {
    const updated = makeDetail({ name: "Ada L.", email: null });
    mocks.api.mockResolvedValueOnce(makeDetail()).mockResolvedValueOnce(updated);
    mocks.apiList.mockResolvedValue([group]);
    const { onUpdated } = renderDetail();

    await waitFor(() => expect(screen.getByText("ada@example.com")).toBeInTheDocument());
    fireEvent.click(screen.getByText("contact:edit"));

    const nameInput = document.querySelector("#cd-name") as HTMLInputElement;
    const emailInput = document.querySelector("#cd-email") as HTMLInputElement;
    expect(nameInput.value).toBe("Ada Lovelace");
    expect(emailInput.value).toBe("ada@example.com");
    expect((document.querySelector("#cd-group") as HTMLSelectElement).value).toBe("g-1");

    fireEvent.change(nameInput, { target: { value: "  Ada L.  " } });
    fireEvent.change(emailInput, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "button:save" }));

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api.mock.calls[1][0]).toBe(DETAIL_PATH);
    expect(mocks.api.mock.calls[1][1]).toEqual({
      method: "PATCH",
      body: JSON.stringify({
        name: "Ada L.",
        email: null,
        phone: "+1 555 0100",
        department: "R&D",
        position: "Engineer",
        notes: "Mathematician",
        groupId: "g-1",
      }),
    });

    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated));
    expect(document.querySelector("#cd-name")).toBeNull();
    expect(screen.getAllByText("Ada L.")).toHaveLength(2);
  });

  it("保存失败显示 e.message，停留在编辑态且不回调 onUpdated", async () => {
    mocks.api.mockResolvedValueOnce(makeDetail()).mockRejectedValueOnce(new Error("保存超时"));
    mocks.apiList.mockResolvedValue([group]);
    const { onUpdated } = renderDetail();

    await waitFor(() => expect(screen.getByText("ada@example.com")).toBeInTheDocument());
    fireEvent.click(screen.getByText("contact:edit"));
    fireEvent.change(document.querySelector("#cd-name") as HTMLInputElement, {
      target: { value: "Nobody" },
    });
    fireEvent.click(screen.getByRole("button", { name: "button:save" }));

    await waitFor(() => expect(screen.getByText("保存超时")).toBeInTheDocument());
    expect(document.querySelector("#cd-name")).not.toBeNull();
    expect(onUpdated).not.toHaveBeenCalled();
  });

  it("姓名只有空白时保存按钮禁用", async () => {
    mocks.api.mockResolvedValue(makeDetail());
    mocks.apiList.mockResolvedValue([]);
    renderDetail();

    await waitFor(() => expect(screen.getByText("ada@example.com")).toBeInTheDocument());
    fireEvent.click(screen.getByText("contact:edit"));
    expect(screen.getByRole("button", { name: "button:save" })).toBeEnabled();

    fireEvent.change(document.querySelector("#cd-name") as HTMLInputElement, {
      target: { value: "   " },
    });
    expect(screen.getByRole("button", { name: "button:save" })).toBeDisabled();
  });

  it("删除二次确认后发 DELETE，并回调 onDeleted(contactId) + onClose", async () => {
    mocks.api.mockResolvedValueOnce(makeDetail()).mockResolvedValueOnce(undefined);
    mocks.apiList.mockResolvedValue([]);
    const { onDeleted, onClose } = renderDetail();

    await waitFor(() => expect(screen.getByText("ada@example.com")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("contact:delete"));
    expect(screen.getByText("contact:confirmDelete")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "contact:delete" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(CID));
    expect(onClose).toHaveBeenCalledTimes(1);

    expect(mocks.api.mock.calls[1][0]).toBe(DETAIL_PATH);
    expect(mocks.api.mock.calls[1][1]).toEqual({ method: "DELETE" });
  });

  it("删除失败显示 e.message，确认视图关闭回到只读态且不回调 onDeleted", async () => {
    mocks.api.mockResolvedValueOnce(makeDetail()).mockRejectedValueOnce(new Error("无权删除"));
    mocks.apiList.mockResolvedValue([]);
    const { onDeleted, onClose } = renderDetail();

    await waitFor(() => expect(screen.getByText("ada@example.com")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("contact:delete"));
    fireEvent.click(screen.getByRole("button", { name: "contact:delete" }));

    await waitFor(() => expect(screen.getByText("无权删除")).toBeInTheDocument());
    expect(screen.queryByText("contact:confirmDelete")).toBeNull();
    expect(screen.getByText("contact:edit")).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
