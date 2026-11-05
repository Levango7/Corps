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
  return { api: vi.fn(), ApiErrorClass: ApiError };
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
vi.mock("@/lib/api", () => ({ api: mocks.api, ApiError: mocks.ApiErrorClass }));

import { DocumentVersionHistory } from "@/components/DocumentVersionHistory";

const BASE = "/api/v1/workspaces/ws-1/documents/doc-1/versions";

interface VersionShape {
  id: string;
  version: number;
  markdown: string;
  message: string | null;
  source: string;
  author: { id: string | null; name: string | null; email: string } | null;
  createdAt: string;
}

function makeVersion(overrides: Partial<VersionShape> = {}): VersionShape {
  return {
    id: "vid-1",
    version: 1,
    markdown: "版本一内容",
    message: "首次发布",
    source: "publish",
    author: { id: "u-1", name: "Alice", email: "a@x.com" },
    createdAt: new Date(Date.now() - 30_000).toISOString(),
    ...overrides,
  };
}

const listPayload = (items: Version[]) => ({
  items,
  currentVersion: items.length > 0 ? Math.max(...items.map((v) => v.version)) : 0,
  page: 1,
  limit: 20,
  total: items.length,
  hasMore: false,
});
type Version = ReturnType<typeof makeVersion>;

function renderHistory(onRestored?: (doc: unknown) => void) {
  return render(
    <DocumentVersionHistory
      wid="ws-1"
      docId="doc-1"
      onClose={vi.fn()}
      onRestored={onRestored as never}
    />,
  );
}

const comparePayload = {
  from: { version: 1, createdAt: "2026-01-01T00:00:00Z", author: { name: "Alice" } },
  to: { version: 2, createdAt: "2026-01-02T00:00:00Z", author: { name: "Bob" } },
  diff: { added: ["新增行"], removed: ["删除行"], modified: [] },
  stats: { additions: 1, deletions: 1, modifications: 0 },
};

beforeEach(() => {
  mocks.api.mockReset();
  mocks.api.mockResolvedValue(listPayload([]));
  document.documentElement.lang = "en";
});

afterEach(() => {
  cleanup();
});

describe("DocumentVersionHistory", () => {
  it("挂载即拉取版本列表：端点路径精确；pending 时显示 loading", () => {
    mocks.api.mockReturnValue(new Promise(() => {}));
    renderHistory();
    expect(mocks.api).toHaveBeenCalledTimes(1);
    expect(mocks.api).toHaveBeenCalledWith(BASE);
    expect(screen.getByText("document:loading")).toBeInTheDocument();
  });

  it("渲染版本项：版本号 / 作者 / 说明 / 来源标签 / 最新徽章；最新版无回滚按钮", async () => {
    mocks.api.mockResolvedValue(
      listPayload([
        makeVersion({ id: "vid-1", version: 1 }),
        makeVersion({ id: "vid-2", version: 2, source: "manual", message: null }),
      ]),
    );
    renderHistory();
    await waitFor(() => expect(screen.getByText("v2")).toBeInTheDocument());
    // 作者与说明合在一个 <p>（{author} · {message}），用正则匹配整段
    expect(screen.getByText(/Alice · 首次发布/)).toBeInTheDocument();
    expect(screen.getByText(/Alice · document:versionNoMessage/)).toBeInTheDocument();
    expect(screen.getByText("document:sourcePublish")).toBeInTheDocument();
    expect(screen.getByText("document:sourceManual")).toBeInTheDocument();
    const latestItem = screen.getByText("v2").closest("li")!;
    expect(within(latestItem).getByText("document:versionLatest")).toBeInTheDocument();
    expect(within(latestItem).queryByText("document:versionRollback")).not.toBeInTheDocument();
    const oldItem = screen.getByText("v1").closest("li")!;
    expect(
      within(oldItem).getByRole("button", { name: "document:versionRollback" }),
    ).toBeInTheDocument();
  });

  it("空版本列表显示空态 + 提示", async () => {
    renderHistory();
    await waitFor(() => expect(screen.getByText("document:versionEmpty")).toBeInTheDocument());
    expect(screen.getByText("document:versionEmptyHint")).toBeInTheDocument();
  });

  it("加载失败显示 e.message", async () => {
    mocks.api.mockRejectedValue(new Error("网络断了"));
    renderHistory();
    await waitFor(() => expect(screen.getByText("网络断了")).toBeInTheDocument());
  });

  it("响应信封非法（items 非数组 / currentVersion 非整数）显示 versionLoadFailed", async () => {
    mocks.api.mockResolvedValue({ items: "oops", currentVersion: 1 });
    renderHistory();
    await waitFor(() => expect(screen.getByText("document:versionLoadFailed")).toBeInTheDocument());
  });

  it("查看版本：模态显示版本号标题与 Markdown 内容，关闭后消失", async () => {
    mocks.api.mockResolvedValue(
      listPayload([makeVersion({ id: "vid-1", version: 2, markdown: "某版本内容" })]),
    );
    renderHistory();
    await waitFor(() => expect(screen.getByText("v2")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "document:versionView" }));
    const modal = screen
      .getByText('document:versionViewTitle:{"version":2}')
      .closest<HTMLElement>('[role="dialog"]')!;
    expect(within(modal).getByText("某版本内容")).toBeInTheDocument();
    fireEvent.click(within(modal).getByRole("button", { name: "document:close" }));
    expect(screen.queryByText('document:versionViewTitle:{"version":2}')).not.toBeInTheDocument();
  });

  it("对比流程：开启对比 → 选两个版本 → GET compare?from=&to= 精确 → 弹 diff 视图", async () => {
    mocks.api
      .mockResolvedValueOnce(
        listPayload([
          makeVersion({ id: "vid-1", version: 1 }),
          makeVersion({ id: "vid-2", version: 2 }),
        ]),
      )
      .mockResolvedValueOnce(comparePayload);
    renderHistory();
    await waitFor(() => expect(screen.getByText("v1")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "document:versionCompare" }));
    expect(screen.getByText("document:compareSelectFirst")).toBeInTheDocument();
    fireEvent.click(screen.getByText("v1"));
    expect(screen.getByText("document:compareSelectSecond")).toBeInTheDocument();
    fireEvent.click(screen.getByText("v2"));

    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith(`${BASE}/compare?from=1&to=2`));
    await waitFor(() =>
      expect(
        screen.getByText('document:versionCompareTitle:{"from":1,"to":2}'),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("document:diffAdded")).toBeInTheDocument();
    expect(screen.getByText("+ 新增行")).toBeInTheDocument();
    expect(screen.getByText("document:diffRemoved")).toBeInTheDocument();
    expect(screen.getByText("- 删除行")).toBeInTheDocument();
  });

  it("对比请求失败（ApiError）显示 e.message", async () => {
    mocks.api
      .mockResolvedValueOnce(
        listPayload([
          makeVersion({ id: "vid-1", version: 1 }),
          makeVersion({ id: "vid-2", version: 2 }),
        ]),
      )
      .mockRejectedValueOnce(new mocks.ApiErrorClass("对比服务不可用"));
    renderHistory();
    await waitFor(() => expect(screen.getByText("v1")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "document:versionCompare" }));
    fireEvent.click(screen.getByText("v1"));
    fireEvent.click(screen.getByText("v2"));
    await waitFor(() => expect(screen.getByText("对比服务不可用")).toBeInTheDocument());
  });

  it("对比结果无差异时显示 diffNoChanges", async () => {
    mocks.api
      .mockResolvedValueOnce(
        listPayload([
          makeVersion({ id: "vid-1", version: 1 }),
          makeVersion({ id: "vid-2", version: 2 }),
        ]),
      )
      .mockResolvedValueOnce({
        ...comparePayload,
        diff: { added: [], removed: [], modified: [] },
        stats: { additions: 0, deletions: 0, modifications: 0 },
      });
    renderHistory();
    await waitFor(() => expect(screen.getByText("v1")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "document:versionCompare" }));
    fireEvent.click(screen.getByText("v1"));
    fireEvent.click(screen.getByText("v2"));
    await waitFor(() => expect(screen.getByText("document:diffNoChanges")).toBeInTheDocument());
  });

  it("回滚：确认后 POST restore，回调 onRestored，列表重新拉取", async () => {
    const onRestored = vi.fn();
    const restoredDoc = {
      title: "标题",
      markdown: "内容",
      publishedMarkdown: null,
      publishedAt: null,
      shareToken: null,
    };
    mocks.api
      .mockResolvedValueOnce(
        listPayload([
          makeVersion({ id: "vid-1", version: 1 }),
          makeVersion({ id: "vid-2", version: 2 }),
        ]),
      )
      .mockResolvedValueOnce({
        document: restoredDoc,
        snapshotVersion: 1,
        restoredFromVersionId: "vid-1",
      })
      .mockResolvedValueOnce(
        listPayload([
          makeVersion({ id: "vid-1", version: 1 }),
          makeVersion({ id: "vid-2", version: 2 }),
        ]),
      );
    renderHistory(onRestored);
    await waitFor(() => expect(screen.getByText("v1")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "document:versionRollback" }));
    expect(screen.getByText("document:versionRollbackTitle")).toBeInTheDocument();
    expect(screen.getByText('document:versionRollbackConfirm:{"version":1}')).toBeInTheDocument();
    const dialog = screen
      .getByText("document:versionRollbackTitle")
      .closest<HTMLElement>('[role="dialog"]')!;
    fireEvent.click(within(dialog).getByRole("button", { name: "document:versionRollback" }));

    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(`${BASE}/vid-1/restore`, { method: "POST" }),
    );
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith(restoredDoc));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(3)); // 列表 → restore → 重新拉列表
    expect(mocks.api).toHaveBeenLastCalledWith(BASE);
  });

  it("回滚：点取消关闭确认框且不发请求", async () => {
    mocks.api.mockResolvedValue(
      listPayload([
        makeVersion({ id: "vid-1", version: 1 }),
        makeVersion({ id: "vid-2", version: 2 }),
      ]),
    );
    renderHistory();
    await waitFor(() => expect(screen.getByText("v1")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "document:versionRollback" }));
    const dialog = screen
      .getByText("document:versionRollbackTitle")
      .closest<HTMLElement>('[role="dialog"]')!;
    fireEvent.click(within(dialog).getByRole("button", { name: "document:cancel" }));
    expect(screen.queryByText("document:versionRollbackTitle")).not.toBeInTheDocument();
    expect(mocks.api).toHaveBeenCalledTimes(1);
  });

  it("回滚失败（ApiError）显示 e.message", async () => {
    mocks.api
      .mockResolvedValueOnce(
        listPayload([
          makeVersion({ id: "vid-1", version: 1 }),
          makeVersion({ id: "vid-2", version: 2 }),
        ]),
      )
      .mockRejectedValueOnce(new mocks.ApiErrorClass("回滚被策略拒绝"));
    renderHistory();
    await waitFor(() => expect(screen.getByText("v1")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "document:versionRollback" }));
    const dialog = screen
      .getByText("document:versionRollbackTitle")
      .closest<HTMLElement>('[role="dialog"]')!;
    fireEvent.click(within(dialog).getByRole("button", { name: "document:versionRollback" }));
    await waitFor(() => expect(screen.getByText("回滚被策略拒绝")).toBeInTheDocument());
  });

  it("创建版本：空说明 POST body message=null；填写后 message 原文；成功后收起表单并刷新列表", async () => {
    mocks.api
      .mockResolvedValueOnce(listPayload([]))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(listPayload([]))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(listPayload([]));
    renderHistory();
    await waitFor(() => expect(screen.getByText("document:versionEmpty")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "document:versionCreate" }));
    expect(screen.getByLabelText("document:versionMessagePlaceholder")).toBeInTheDocument();
    fireEvent.submit(screen.getByLabelText("document:versionMessagePlaceholder").closest("form")!);
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(BASE, {
        method: "POST",
        body: JSON.stringify({ message: null }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "document:versionCreate" }));
    fireEvent.change(screen.getByLabelText("document:versionMessagePlaceholder"), {
      target: { value: "手工快照" },
    });
    fireEvent.submit(screen.getByLabelText("document:versionMessagePlaceholder").closest("form")!);
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(BASE, {
        method: "POST",
        body: JSON.stringify({ message: "手工快照" }),
      }),
    );
    await waitFor(() =>
      expect(screen.queryByLabelText("document:versionMessagePlaceholder")).not.toBeInTheDocument(),
    );
    expect(mocks.api).toHaveBeenCalledTimes(5);
  });

  it("创建版本失败（非 ApiError）显示 versionCreateFailed 兜底文案", async () => {
    mocks.api
      .mockResolvedValueOnce(listPayload([]))
      .mockRejectedValueOnce(new Error("plain error"));
    renderHistory();
    await waitFor(() => expect(screen.getByText("document:versionEmpty")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "document:versionCreate" }));
    fireEvent.submit(screen.getByLabelText("document:versionMessagePlaceholder").closest("form")!);
    await waitFor(() =>
      expect(screen.getByText("document:versionCreateFailed")).toBeInTheDocument(),
    );
  });
});
