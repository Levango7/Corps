// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * MailList 契约（components/mail/MailList.tsx）：
 *  1. 挂载即 GET /api/v1/mail/inbox?wid={wid}&pageSize=50（带 status 时追加 &status=）
 *  2. 列表行：发件人 + 主题 + 相对时间（justNow/minutesAgo{count}/hoursAgo/daysAgo）
 *  3. 头部计数 span = mails.length；未读/已读图标 aria-label markRead/markUnread
 *  4. 打开详情：GET /api/v1/mail/{id}?wid={wid}；未读邮件再 PATCH { wid, isRead:true } 并翻转行状态
 *  5. 详情弹层展示 from/to/date/bodyText（pre）；X（aria-label cancel）与遮罩点击关闭
 *  6. 星标切换：PATCH { wid, isStarred: !current }，aria-label star/unstar 翻转
 *  7. 删除：window.confirm 确认后 DELETE /api/v1/mail/{id}?wid={wid}，行移除 + toast success deleted
 *  8. 失败分支：列表加载失败 → 错误条 error（close 可清除→空态 noMails）；
 *     详情/星标/删除失败 → toast error error
 *  9. 空数据 → noMails 空态
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

import MailList from "@/components/mail/MailList";

const WID = "ws-ml-1";
const NOW = Date.now();

/** 列表行 fixture 类型：sentAt 可能为 null（未发送），显式宽类型避免 null 字面量推断 */
interface MailFixture {
  id: string;
  accountId: string;
  fromAddr: string;
  toAddr: string;
  ccAddr: string | null;
  subject: string;
  status: string;
  isRead: boolean;
  isStarred: boolean;
  sentAt: string | null;
  createdAt: string;
}

const M1: MailFixture = {
  id: "m-1",
  accountId: "acc-1",
  fromAddr: "alice@example.com",
  toAddr: "me@example.com",
  ccAddr: null,
  subject: "周报汇总",
  status: "received",
  isRead: false,
  isStarred: false,
  sentAt: null,
  createdAt: new Date(NOW).toISOString(),
};

const M2: MailFixture = {
  id: "m-2",
  accountId: "acc-1",
  fromAddr: "bob@example.com",
  toAddr: "me@example.com",
  ccAddr: null,
  subject: "会议通知",
  status: "received",
  isRead: true,
  isStarred: true,
  sentAt: new Date(NOW - 90_000).toISOString(),
  createdAt: new Date(NOW - 90_000).toISOString(),
};

const DETAIL1 = {
  ...M1,
  bccAddr: null,
  bodyText: "邮件正文第一行",
  bodyHtml: null,
  messageId: "<m-1@example.com>",
  inReplyTo: null,
  attachments: [],
};

function listResponse(items: MailFixture[]) {
  return { items, total: items.length, page: 1, pageSize: 50 };
}

function renderList(status?: string) {
  return render(<MailList workspaceId={WID} status={status} />);
}

beforeEach(() => {
  mocks.api.mockReset();
  mocks.toast.mockReset();
  mocks.api.mockResolvedValue(listResponse([]));
});
afterEach(() => cleanup());

describe("MailList", () => {
  it("挂载即 GET 列表：URL 精确（wid + pageSize=50），期间显示 loading", () => {
    let resolve!: (v: unknown) => void;
    mocks.api.mockReturnValueOnce(
      new Promise((res) => {
        resolve = res;
      }),
    );
    renderList();

    expect(mocks.api).toHaveBeenCalledWith("/api/v1/mail/inbox?wid=ws-ml-1&pageSize=50", {
      signal: expect.any(AbortSignal),
    });
    expect(screen.getByText("mail:loading")).toBeInTheDocument();
    resolve(listResponse([]));
  });

  it("带 status 过滤：URL 追加 &status=sent", () => {
    renderList("sent");
    expect(mocks.api).toHaveBeenCalledWith(
      "/api/v1/mail/inbox?wid=ws-ml-1&pageSize=50&status=sent",
      { signal: expect.any(AbortSignal) },
    );
  });

  it("成功渲染列表：发件人/主题/相对时间/头部计数", async () => {
    mocks.api.mockResolvedValueOnce(listResponse([M1, M2]));
    const { container } = renderList();
    await waitFor(() => expect(screen.queryByText("mail:loading")).toBeFalsy());

    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("bob@example.com")).toBeInTheDocument();
    expect(screen.getByText("周报汇总")).toBeInTheDocument();
    expect(screen.getByText("会议通知")).toBeInTheDocument();
    expect(screen.getByText("mail:justNow")).toBeInTheDocument();
    expect(screen.getByText('mail:minutesAgo:{"count":1}')).toBeInTheDocument();
    const headerCount = container.querySelector("header span");
    expect(headerCount?.textContent).toBe("2");
  });

  it("未读/已读图标 aria-label 区分（markRead/markUnread）", async () => {
    mocks.api.mockResolvedValueOnce(listResponse([M1, M2]));
    renderList();
    await waitFor(() => expect(screen.queryByText("mail:loading")).toBeFalsy());

    // M1 未读 → markRead；M2 已读 → markUnread
    expect(screen.getAllByLabelText("mail:markRead")).toHaveLength(1);
    expect(screen.getAllByLabelText("mail:markUnread")).toHaveLength(1);
  });

  it("打开未读详情：GET /mail/{id}?wid + PATCH {wid,isRead:true}，行状态翻转为已读", async () => {
    mocks.api.mockResolvedValueOnce(listResponse([M1]));
    mocks.api.mockResolvedValueOnce(DETAIL1);
    mocks.api.mockResolvedValueOnce(undefined);
    renderList();
    await waitFor(() => expect(screen.queryByText("mail:loading")).toBeFalsy());

    fireEvent.click(screen.getByLabelText("mail:markRead"));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(3));
    expect(mocks.api).toHaveBeenNthCalledWith(2, "/api/v1/mail/m-1?wid=ws-ml-1");
    expect(mocks.api).toHaveBeenNthCalledWith(3, "/api/v1/mail/m-1", {
      method: "PATCH",
      body: JSON.stringify({ wid: WID, isRead: true }),
    });
    await waitFor(() => expect(screen.getByLabelText("mail:markUnread")).toBeInTheDocument());
  });

  it("详情弹层：subject/from/to/bodyText（pre）渲染，X 按钮关闭", async () => {
    mocks.api.mockResolvedValueOnce(listResponse([M1, M2]));
    mocks.api.mockResolvedValueOnce(DETAIL1);
    const { container } = renderList();
    await waitFor(() => expect(screen.queryByText("mail:loading")).toBeFalsy());

    fireEvent.click(screen.getByLabelText("mail:markRead"));
    await waitFor(() => expect(screen.getByText("邮件正文第一行")).toBeInTheDocument());
    expect(container.querySelector("pre")?.textContent).toBe("邮件正文第一行");
    expect(screen.getAllByText("alice@example.com").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("me@example.com")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("mail:cancel"));
    await waitFor(() => expect(screen.queryByText("邮件正文第一行")).toBeFalsy());
  });

  it("详情加载失败：toast error，弹层不出现", async () => {
    mocks.api.mockResolvedValueOnce(listResponse([M1]));
    mocks.api.mockRejectedValueOnce(new Error("detail boom"));
    renderList();
    await waitFor(() => expect(screen.queryByText("mail:loading")).toBeFalsy());

    fireEvent.click(screen.getByLabelText("mail:markRead"));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("error", "mail:error"));
    expect(screen.queryByText("邮件正文第一行")).toBeFalsy();
  });

  it("星标切换：PATCH body isStarred 翻转，aria-label 随之更新", async () => {
    mocks.api.mockResolvedValueOnce(listResponse([M1, M2]));
    mocks.api.mockResolvedValueOnce(undefined);
    renderList();
    await waitFor(() => expect(screen.queryByText("mail:loading")).toBeFalsy());

    expect(screen.getAllByLabelText("mail:star")).toHaveLength(1); // M1
    fireEvent.click(screen.getAllByLabelText("mail:star")[0]);

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api).toHaveBeenLastCalledWith("/api/v1/mail/m-1", {
      method: "PATCH",
      body: JSON.stringify({ wid: WID, isStarred: true }),
    });
    await waitFor(() => expect(screen.getAllByLabelText("mail:unstar")).toHaveLength(2));
  });

  it("删除：confirm true → DELETE /mail/{id}?wid，行移除 + success toast deleted", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      mocks.api.mockResolvedValueOnce(listResponse([M1, M2]));
      mocks.api.mockResolvedValueOnce(undefined);
      renderList();
      await waitFor(() => expect(screen.queryByText("mail:loading")).toBeFalsy());

      fireEvent.click(screen.getAllByLabelText("mail:delete")[1]);
      await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
      expect(mocks.api).toHaveBeenLastCalledWith("/api/v1/mail/m-2?wid=ws-ml-1", {
        method: "DELETE",
      });
      await waitFor(() => expect(screen.queryByText("bob@example.com")).toBeFalsy());
      await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("success", "mail:deleted"));
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("删除：confirm false → 不发 DELETE，行保留", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      mocks.api.mockResolvedValueOnce(listResponse([M1, M2]));
      renderList();
      await waitFor(() => expect(screen.queryByText("mail:loading")).toBeFalsy());

      fireEvent.click(screen.getAllByLabelText("mail:delete")[1]);
      expect(mocks.api).toHaveBeenCalledTimes(1);
      expect(screen.getByText("bob@example.com")).toBeInTheDocument();
      expect(mocks.toast).not.toHaveBeenCalled();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("删除失败：toast error，行保留", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      mocks.api.mockResolvedValueOnce(listResponse([M1, M2]));
      mocks.api.mockRejectedValueOnce(new Error("delete boom"));
      renderList();
      await waitFor(() => expect(screen.queryByText("mail:loading")).toBeFalsy());

      fireEvent.click(screen.getAllByLabelText("mail:delete")[0]);
      await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("error", "mail:error"));
      expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("列表加载失败：错误条 error，close 清除后显示空态 noMails", async () => {
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    renderList();

    await waitFor(() => expect(screen.getByText("mail:error")).toBeInTheDocument());
    expect(screen.queryByText("mail:noMails")).toBeFalsy();

    fireEvent.click(screen.getByLabelText("mail:close"));
    await waitFor(() => expect(screen.getByText("mail:noMails")).toBeInTheDocument());
  });
});
