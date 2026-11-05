// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * AnnouncementEditor 契约（components/announcement/AnnouncementEditor.tsx）：
 *  1. open=false 不渲染；新建模式 POST /api/v1/workspaces/{wid}/announcements，
 *     编辑模式 PATCH .../announcements/{id}
 *  2. payload {title trim, content trim, type, targetAudience, pinned, expiresAt}
 *     - targetAudience=all 时无 value 键；role/department 时 value 为逗号切分去空数组
 *     - expiresAt 走 localDateToISOString，空则 null
 *  3. 标题/内容为空或提交中 → submit disabled；成功 onSaved+onClose；失败显示 e.message
 *  4. Escape / 遮罩点击关闭；内层 dialog 点击不关闭
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  onClose: vi.fn(),
  onSaved: vi.fn(),
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
// 日期工具固定化，避免时区造成 body.expiresAt 断言抖动
vi.mock("@/lib/date", () => ({
  toLocalDateString: (d: Date) => d.toISOString().slice(0, 10),
  localDateToISOString: (s: string) => `${s}T00:00:00.000Z`,
}));

import AnnouncementEditor, {
  type AnnouncementItem,
} from "@/components/announcement/AnnouncementEditor";

const WID = "ws-ann-2";

function editFixture(overrides: Partial<AnnouncementItem> = {}): AnnouncementItem {
  return {
    id: "a-9",
    title: "旧标题",
    content: "旧内容",
    type: "warning",
    targetAudience: { type: "role", value: ["owner", "admin"] },
    pinned: true,
    publishedBy: null,
    publishedAt: "2026-11-01T00:00:00Z",
    expiresAt: "2026-12-31T00:00:00Z",
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    publisher: null,
    ...overrides,
  };
}

function renderEditor(props: { open?: boolean; announcement?: AnnouncementItem | null } = {}) {
  return render(
    <AnnouncementEditor
      wid={WID}
      open={props.open ?? true}
      onClose={mocks.onClose}
      onSaved={mocks.onSaved}
      announcement={props.announcement ?? null}
    />,
  );
}

const titleInput = () => screen.getByLabelText("announcement:title") as HTMLInputElement;
const contentInput = () => screen.getByLabelText("announcement:content") as HTMLTextAreaElement;
// 标题 h2 与提交按钮同文案（create 模式都渲染 announcement:create），按 type=submit 定位
const submitButton = () => document.querySelector('button[type="submit"]') as HTMLButtonElement;
// 置顶按钮被 <label> 包裹且无 aria-label，按可见文案反查
const pinButton = () =>
  screen.getByText(/^announcement:(unpin|pinned)$/).closest("button") as HTMLButtonElement;
// 类型 / 受众两个 select 都无 id/aria-label，按出现顺序取（0=type，1=audienceType）
const selectAt = (container: HTMLElement, i: number) =>
  container.querySelectorAll("select")[i] as HTMLSelectElement;

beforeEach(() => {
  mocks.api.mockReset();
  mocks.onClose.mockReset();
  mocks.onSaved.mockReset();
});
afterEach(() => cleanup());

describe("AnnouncementEditor", () => {
  it("open=false → 不渲染", () => {
    renderEditor({ open: false });
    expect(screen.queryByRole("dialog")).toBeFalsy();
  });

  it("新建模式：标题 create、默认值（info/all/未置顶）、submit disabled", () => {
    renderEditor();
    // h2 与提交按钮同文案
    expect(screen.getAllByText("announcement:create").length).toBeGreaterThanOrEqual(2);
    expect(titleInput().value).toBe("");
    expect(pinButton()).toHaveAttribute("aria-pressed", "false");
    // audience=all 时不显示受众值输入
    expect(screen.queryByLabelText("announcement:audienceRole")).toBeFalsy();
    expect(submitButton()).toBeDisabled();
  });

  it("新建提交：POST body 精确（all 无 value、expiresAt null、pinned false）", async () => {
    mocks.api.mockResolvedValueOnce({});
    renderEditor();
    fireEvent.change(titleInput(), { target: { value: "  新公告  " } });
    fireEvent.change(contentInput(), { target: { value: "  正文  " } });
    fireEvent.click(submitButton());

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(mocks.api).toHaveBeenCalledWith(`/api/v1/workspaces/${WID}/announcements`, {
      method: "POST",
      body: JSON.stringify({
        title: "新公告",
        content: "正文",
        type: "info",
        targetAudience: { type: "all" },
        pinned: false,
        expiresAt: null,
      }),
    });
    expect(mocks.onSaved).toHaveBeenCalledTimes(1);
    expect(mocks.onClose).toHaveBeenCalledTimes(1);
  });

  it("受众 role：出现受众值输入，逗号切分去空进 body", async () => {
    mocks.api.mockResolvedValueOnce({});
    const { container } = renderEditor();
    fireEvent.change(titleInput(), { target: { value: "T" } });
    fireEvent.change(contentInput(), { target: { value: "C" } });
    fireEvent.change(selectAt(container, 1), { target: { value: "role" } });

    const audienceInput = screen.getByLabelText("announcement:audienceRole");
    fireEvent.change(audienceInput, { target: { value: " owner, admin ,, " } });
    fireEvent.click(submitButton());

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    const body = JSON.parse((mocks.api.mock.calls[0][1] as { body: string }).body);
    expect(body.targetAudience).toEqual({ type: "role", value: ["owner", "admin"] });
  });

  it("置顶切换：aria-pressed 翻转、按钮文案变 pinned、body.pinned true", async () => {
    mocks.api.mockResolvedValueOnce({});
    renderEditor();
    fireEvent.change(titleInput(), { target: { value: "T" } });
    fireEvent.change(contentInput(), { target: { value: "C" } });
    fireEvent.click(pinButton());
    expect(pinButton()).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("announcement:pinned")).toBeInTheDocument();
    fireEvent.click(submitButton());

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    const body = JSON.parse((mocks.api.mock.calls[0][1] as { body: string }).body);
    expect(body.pinned).toBe(true);
  });

  it("过期日期 → body.expiresAt 走 localDateToISOString", async () => {
    mocks.api.mockResolvedValueOnce({});
    renderEditor();
    fireEvent.change(titleInput(), { target: { value: "T" } });
    fireEvent.change(contentInput(), { target: { value: "C" } });
    fireEvent.change(screen.getByLabelText("announcement:expiresAt"), {
      target: { value: "2026-12-31" },
    });
    fireEvent.click(submitButton());

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    const body = JSON.parse((mocks.api.mock.calls[0][1] as { body: string }).body);
    expect(body.expiresAt).toBe("2026-12-31T00:00:00.000Z");
  });

  it("编辑模式：预填全部字段、标题 edit、PATCH 到子路径、提交文案 publish", async () => {
    mocks.api.mockResolvedValueOnce({});
    renderEditor({ announcement: editFixture() });

    expect(screen.getByText("announcement:edit")).toBeInTheDocument();
    expect(titleInput().value).toBe("旧标题");
    expect(contentInput().value).toBe("旧内容");
    expect(screen.getByLabelText("announcement:expiresAt")).toHaveValue("2026-12-31");
    expect(screen.getByLabelText("announcement:audienceRole")).toHaveValue("owner, admin");

    fireEvent.change(titleInput(), { target: { value: "改后标题" } });
    fireEvent.click(screen.getByText("announcement:publish").closest("button")!);

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(mocks.api).toHaveBeenCalledWith(`/api/v1/workspaces/${WID}/announcements/a-9`, {
      method: "PATCH",
      body: JSON.stringify({
        title: "改后标题",
        content: "旧内容",
        type: "warning",
        targetAudience: { type: "role", value: ["owner", "admin"] },
        pinned: true,
        expiresAt: "2026-12-31T00:00:00.000Z",
      }),
    });
    expect(mocks.onSaved).toHaveBeenCalledTimes(1);
  });

  it("编辑模式切换 announcement 时表单重新预填", () => {
    const { rerender } = renderEditor({ announcement: editFixture() });
    rerender(
      <AnnouncementEditor
        wid={WID}
        open
        onClose={mocks.onClose}
        onSaved={mocks.onSaved}
        announcement={editFixture({ id: "a-10", title: "另一条" })}
      />,
    );
    expect(titleInput().value).toBe("另一条");
  });

  it("提交失败 → 错误条显示 e.message，不关闭", async () => {
    mocks.api.mockRejectedValueOnce(new Error("标题重复"));
    renderEditor();
    fireEvent.change(titleInput(), { target: { value: "T" } });
    fireEvent.change(contentInput(), { target: { value: "C" } });
    fireEvent.click(submitButton());

    await waitFor(() => expect(screen.getByText("标题重复")).toBeInTheDocument());
    expect(mocks.onClose).not.toHaveBeenCalled();
  });

  it("Escape 关闭", () => {
    renderEditor();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(mocks.onClose).toHaveBeenCalledTimes(1);
  });

  it("遮罩点击关闭；内层 dialog 点击不关闭", () => {
    renderEditor();
    fireEvent.click(screen.getByRole("dialog"));
    expect(mocks.onClose).not.toHaveBeenCalled();

    // 外层 presentation 遮罩（dialog 的父节点）
    const overlay = screen.getByRole("dialog").parentElement!;
    fireEvent.click(overlay);
    expect(mocks.onClose).toHaveBeenCalledTimes(1);
  });
});
