// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";

const mocks = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(
      message: string,
      public status = 0,
      public code = 0,
    ) {
      super(message);
      this.name = "ApiError";
    }
  }
  return { api: vi.fn(), apiList: vi.fn(), ApiErrorClass: ApiError };
});

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
vi.mock("@/lib/api", () => ({
  api: mocks.api,
  apiList: mocks.apiList,
  ApiError: mocks.ApiErrorClass,
}));

import { DocumentComments } from "@/components/DocumentComments";

const BASE = "/api/v1/workspaces/ws-1/documents/doc-1/comments";
const BODY_LABEL = "document:commentBodyPlaceholder";
const PATH_LABEL = "document:commentAnchorPlaceholder";
const ANCHOR_LABEL = "document:commentAnchorTextPlaceholder";

interface CommentShape {
  id: string;
  anchorPath: string;
  anchorText: string;
  body: string;
  mentions: string[];
  parentId: string | null;
  resolved: boolean;
  resolvedAt: string | null;
  author: { id: string | null; name: string | null; email: string; image: string | null } | null;
  resolver: { id: string | null; name: string | null; email: string; image: string | null } | null;
  replies: CommentShape[];
  createdAt: string;
  updatedAt: string;
}

function makeComment(overrides: Partial<CommentShape> = {}): CommentShape {
  const now = new Date().toISOString();
  return {
    id: "c-1",
    anchorPath: "docs/readme.md",
    anchorText: "锚点原文",
    body: "评论正文",
    mentions: [],
    parentId: null,
    resolved: false,
    resolvedAt: null,
    author: { id: "u-1", name: "Alice", email: "alice@example.com", image: null },
    resolver: null,
    replies: [],
    createdAt: new Date(Date.now() - 30_000).toISOString(),
    updatedAt: now,
    ...overrides,
  };
}

function renderComments() {
  return render(<DocumentComments wid="ws-1" docId="doc-1" onClose={vi.fn()} />);
}

beforeEach(() => {
  mocks.api.mockReset();
  mocks.apiList.mockReset();
  mocks.apiList.mockResolvedValue([]);
  document.documentElement.lang = "en";
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DocumentComments", () => {
  it("挂载即拉取评论列表：GET 端点路径精确；pending 时显示 loading", () => {
    mocks.apiList.mockReturnValue(new Promise(() => {}));
    renderComments();
    expect(mocks.apiList).toHaveBeenCalledTimes(1);
    expect(mocks.apiList).toHaveBeenCalledWith(BASE);
    expect(screen.getByText("document:loading")).toBeInTheDocument();
  });

  it("空列表显示空态 + 提示", async () => {
    renderComments();
    await waitFor(() => expect(screen.getByText("document:commentEmpty")).toBeInTheDocument());
    expect(screen.getByText("document:commentEmptyHint")).toBeInTheDocument();
  });

  it("加载失败显示 e.message", async () => {
    mocks.apiList.mockRejectedValue(new Error("网络断了"));
    renderComments();
    await waitFor(() => expect(screen.getByText("网络断了")).toBeInTheDocument());
  });

  it("渲染评论项：作者名 / 正文 / 锚点引用 / 相对时间 / 首字母头像 / 未解决计数徽章", async () => {
    mocks.apiList.mockResolvedValue([makeComment({ body: "这条要改" })]);
    renderComments();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    expect(screen.getByText("这条要改")).toBeInTheDocument();
    expect(screen.getByText("锚点原文")).toBeInTheDocument();
    expect(screen.getByText("just now")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument(); // openCount 徽章
  });

  it("默认「未解决」筛选隐藏已解决评论；未解决为 0 且总数 > 0 时显示 noMatch", async () => {
    mocks.apiList.mockResolvedValue([makeComment({ id: "c-2", body: "已解决的", resolved: true })]);
    renderComments();
    await waitFor(() => expect(screen.getByText("document:commentNoMatch")).toBeInTheDocument());
    expect(screen.queryByText("已解决的")).not.toBeInTheDocument();
  });

  it("筛选切换：「全部」显示两条且已解决项带徽章；「已解决」只显示已解决项", async () => {
    mocks.apiList.mockResolvedValue([
      makeComment({ id: "c-1", body: "未解决的" }),
      makeComment({ id: "c-2", body: "已解决的", resolved: true }),
    ]);
    renderComments();
    await waitFor(() => expect(screen.getByText("未解决的")).toBeInTheDocument());
    expect(screen.queryByText("已解决的")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "document:commentFilterAll" }));
    expect(screen.getByText("已解决的")).toBeInTheDocument();
    expect(screen.getByText("document:commentResolved")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "document:commentFilterResolved" }));
    expect(screen.getByText("已解决的")).toBeInTheDocument();
    expect(screen.queryByText("未解决的")).not.toBeInTheDocument();
  });

  it("未解决优先、同状态按时间倒序排列", async () => {
    mocks.apiList.mockResolvedValue([
      makeComment({
        id: "old",
        body: "较早未解决",
        createdAt: new Date(Date.now() - 90_000).toISOString(),
      }),
      makeComment({ id: "new", body: "较新未解决" }),
      makeComment({ id: "res", body: "已解决", resolved: true }),
    ]);
    const { container } = renderComments();
    await waitFor(() => expect(screen.getByText("较新未解决")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "document:commentFilterAll" }));
    const bodies = Array.from(container.querySelectorAll("ul > li > p")).map((p) => p.textContent);
    expect(bodies).toEqual(["较新未解决", "较早未解决", "已解决"]);
  });

  it("添加评论：正文为空时提交按钮禁用；填写后 POST body 精确并把新评论置顶", async () => {
    mocks.apiList.mockResolvedValue([makeComment({ id: "old", body: "旧评论" })]);
    mocks.api.mockResolvedValue(makeComment({ id: "c-new", body: "新评论正文", author: null }));
    renderComments();
    await waitFor(() => expect(screen.getByText("旧评论")).toBeInTheDocument());

    const addBtn = screen.getByRole("button", { name: "document:commentAdd" });
    expect(addBtn).toBeDisabled(); // 无 anchorPath
    fireEvent.change(screen.getByLabelText(PATH_LABEL), { target: { value: "src/a.ts" } });
    expect(addBtn).toBeDisabled(); // 无 body
    fireEvent.change(screen.getByLabelText(ANCHOR_LABEL), { target: { value: "锚文本" } });
    fireEvent.change(screen.getByLabelText(BODY_LABEL), { target: { value: "新评论正文" } });
    expect(addBtn).toBeEnabled();
    fireEvent.click(addBtn);

    await waitFor(() => expect(screen.getByText("新评论正文")).toBeInTheDocument());
    expect(mocks.api).toHaveBeenCalledWith(BASE, {
      method: "POST",
      body: JSON.stringify({
        anchorPath: "src/a.ts",
        anchorText: "锚文本",
        body: "新评论正文",
      }),
    });
    const bodies = Array.from(
      screen.getByText("新评论正文").closest("ul")!.querySelectorAll("li > p"),
    ).map((p) => p.textContent);
    expect(bodies[0]).toBe("新评论正文");
    expect(screen.getByText("document:unknownAuthor")).toBeInTheDocument();
  });

  it("添加评论失败：ApiError 显示 e.message；普通 Error 显示兜底文案", async () => {
    mocks.apiList.mockResolvedValue([]);
    renderComments();
    await waitFor(() => expect(screen.getByText("document:commentEmpty")).toBeInTheDocument());

    mocks.api.mockRejectedValue(new mocks.ApiErrorClass("评论内容过长"));
    fireEvent.change(screen.getByLabelText(PATH_LABEL), { target: { value: "a.ts" } });
    fireEvent.change(screen.getByLabelText(BODY_LABEL), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "document:commentAdd" }));
    await waitFor(() => expect(screen.getByText("评论内容过长")).toBeInTheDocument());

    mocks.api.mockClear();
    mocks.api.mockRejectedValue(new Error("plain"));
    fireEvent.click(screen.getByRole("button", { name: "document:commentAdd" }));
    await waitFor(() => expect(screen.getByText("document:commentAddFailed")).toBeInTheDocument());
  });

  it("回复：POST body 精确（parentId + 空锚点），回复追加到线程并清空输入", async () => {
    mocks.apiList.mockResolvedValue([makeComment({ id: "c-1", body: "根评论" })]);
    mocks.api.mockResolvedValue(
      makeComment({
        id: "r-1",
        parentId: "c-1",
        body: "回复内容",
        author: { id: "u-2", name: "Bob", email: "b@x.com", image: null },
      }),
    );
    renderComments();
    await waitFor(() => expect(screen.getByText("根评论")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "document:commentReply" }));
    const item = screen.getByText("根评论").closest("li")!;
    const replyInput = screen.getByLabelText("document:commentReplyPlaceholder");
    fireEvent.change(replyInput, { target: { value: "回复内容" } });
    fireEvent.submit(item.querySelector("form")!);

    await waitFor(() => expect(screen.getByText("回复内容")).toBeInTheDocument());
    expect(mocks.api).toHaveBeenCalledWith(BASE, {
      method: "POST",
      body: JSON.stringify({ parentId: "c-1", anchorPath: "", anchorText: "", body: "回复内容" }),
    });
    expect(within(item).getByText("Bob")).toBeInTheDocument();
    expect(screen.queryByLabelText("document:commentReplyPlaceholder")).not.toBeInTheDocument();
  });

  it("解决评论：POST /resolve，响应替换原评论（全筛选下可见徽章与重开按钮）", async () => {
    mocks.apiList.mockResolvedValue([makeComment({ id: "c-1", body: "待解决" })]);
    mocks.api.mockResolvedValue(
      makeComment({
        id: "c-1",
        body: "待解决",
        resolved: true,
        resolver: { id: "u-1", name: "Alice", email: "a@x.com", image: null },
      }),
    );
    renderComments();
    await waitFor(() => expect(screen.getByText("待解决")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "document:commentResolve" }));
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(`${BASE}/c-1/resolve`, { method: "POST" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "document:commentFilterAll" }));
    expect(screen.getByText("document:commentResolved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "document:commentReopen" })).toBeInTheDocument();
  });

  it("重新打开已解决评论：POST /reopen，响应未解决后从已解决筛选中消失", async () => {
    mocks.apiList.mockResolvedValue([makeComment({ id: "c-2", body: "已解决项", resolved: true })]);
    mocks.api.mockResolvedValue(makeComment({ id: "c-2", body: "已解决项", resolved: false }));
    renderComments();
    await waitFor(() => expect(screen.getByText("document:commentNoMatch")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "document:commentFilterResolved" }));
    fireEvent.click(screen.getByRole("button", { name: "document:commentReopen" }));
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(`${BASE}/c-2/reopen`, { method: "POST" }),
    );
    await waitFor(() => expect(screen.queryByText("已解决项")).not.toBeInTheDocument());
  });

  it("编辑评论：图标按钮进入编辑态，PATCH body 精确，成功后显示新内容", async () => {
    mocks.apiList.mockResolvedValue([makeComment({ id: "c-1", body: "原始内容" })]);
    mocks.api.mockResolvedValue(makeComment({ id: "c-1", body: "新内容" }));
    renderComments();
    await waitFor(() => expect(screen.getByText("原始内容")).toBeInTheDocument());

    const item = screen.getByText("原始内容").closest("li")!;
    const buttons = within(item).getAllByRole("button");
    fireEvent.click(buttons[2]); // [回复, 解决, 编辑(铅笔), 删除(垃圾桶)]
    const editInput = screen.getByLabelText("document:commentEditBody");
    expect(editInput).toHaveValue("原始内容");
    fireEvent.change(editInput, { target: { value: "新内容" } });
    fireEvent.submit(item.querySelector("form")!);

    await waitFor(() => expect(screen.getByText("新内容")).toBeInTheDocument());
    expect(mocks.api).toHaveBeenCalledWith(`${BASE}/c-1`, {
      method: "PATCH",
      body: JSON.stringify({ body: "新内容" }),
    });
    expect(screen.queryByLabelText("document:commentEditBody")).not.toBeInTheDocument();
  });

  it("删除评论：confirm 确认后发 DELETE 并移除；取消确认则不调用", async () => {
    mocks.apiList.mockResolvedValue([makeComment({ id: "c-1", body: "要删的" })]);
    renderComments();
    await waitFor(() => expect(screen.getByText("要删的")).toBeInTheDocument());
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      const item = screen.getByText("要删的").closest("li")!;
      fireEvent.click(within(item).getAllByRole("button")[3]);
      expect(confirmSpy).toHaveBeenCalledWith("document:commentDeleteConfirm");
      expect(mocks.api).not.toHaveBeenCalled();

      confirmSpy.mockReturnValue(true);
      fireEvent.click(within(item).getAllByRole("button")[3]);
      await waitFor(() =>
        expect(mocks.api).toHaveBeenCalledWith(`${BASE}/c-1`, { method: "DELETE" }),
      );
      await waitFor(() => expect(screen.queryByText("要删的")).not.toBeInTheDocument());
    } finally {
      confirmSpy.mockRestore();
    }
  });
});
