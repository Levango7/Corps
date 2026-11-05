// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * MailComposer 契约（components/mail/MailComposer.tsx）：
 *  1. 挂载即 GET /api/v1/mail/accounts?wid={wid}（带 AbortSignal），先显示 loading
 *  2. 返回后渲染账户 select，默认选中 isDefault 账户（否则第一个）；
 *     选项文案 displayName ? `${displayName} <${email}>` : email
 *  3. 空账户列表 → from 行显示 t("noAccount")，发送/存草稿 disabled
 *  4. 加载失败 → 错误条 t("error")，close 按钮可清除
 *  5. 发送按钮 disabled 条件：sending || !accountId || !to.trim() || !subject.trim()
 *  6. 发送 → POST /api/v1/mail/send body { wid, accountId, to/cc/bcc(trim，空则剔除), subject, bodyText }
 *     成功 toast success t("sentOk") + onSent；失败错误条 + toast error t("sendFailed")
 *  7. 发送中按钮文案 t("sending") 且 disabled
 *  8. 存草稿 → toast success t("draftSaved")，不发额外请求
 *  9. 取消：header X（aria-label）与 footer 按钮均触发 onCancel
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  toast: vi.fn(),
  onSent: vi.fn(),
  onCancel: vi.fn(),
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

import MailComposer from "@/components/mail/MailComposer";

const WID = "ws-mc-1";

const ACCOUNTS = [
  { id: "acc-1", email: "alice@example.com", displayName: "Alice", isDefault: true },
  { id: "acc-2", email: "bob@example.com", displayName: null, isDefault: false },
];

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderComposer() {
  return render(<MailComposer workspaceId={WID} onSent={mocks.onSent} onCancel={mocks.onCancel} />);
}

function sendButton() {
  return screen.getByText("mail:send").closest("button") as HTMLButtonElement;
}

beforeEach(() => {
  mocks.api.mockReset();
  mocks.toast.mockReset();
  mocks.onSent.mockReset();
  mocks.onCancel.mockReset();
});
afterEach(() => cleanup());

describe("MailComposer", () => {
  it("挂载即 GET 账户列表：URL 精确、带 AbortSignal，期间显示 loading 且主按钮 disabled", () => {
    const d = deferred<typeof ACCOUNTS>();
    mocks.api.mockReturnValueOnce(d.promise);
    renderComposer();

    expect(mocks.api).toHaveBeenCalledWith("/api/v1/mail/accounts?wid=ws-mc-1", {
      signal: expect.any(AbortSignal),
    });
    expect(screen.getByText("mail:loading")).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
    expect(screen.getByText("mail:saveDraft").closest("button")).toBeDisabled();
    d.resolve(ACCOUNTS);
  });

  it("成功渲染账户下拉：默认选中 isDefault 账户，选项含 displayName <email> 与裸 email", async () => {
    mocks.api.mockResolvedValueOnce(ACCOUNTS);
    const { container } = renderComposer();

    await waitFor(() => expect(screen.queryByText("mail:loading")).toBeFalsy());
    const select = container.querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe("acc-1");
    const options = Array.from(screen.getAllByRole("option"));
    expect(options.map((o) => o.textContent)).toEqual([
      "Alice <alice@example.com>",
      "bob@example.com",
    ]);
  });

  it("空账户列表：from 行显示 noAccount，发送/存草稿 disabled", async () => {
    mocks.api.mockResolvedValueOnce([]);
    renderComposer();

    await waitFor(() => expect(screen.queryByText("mail:loading")).toBeFalsy());
    expect(screen.getByText("mail:noAccount")).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
    expect(screen.getByText("mail:saveDraft").closest("button")).toBeDisabled();
  });

  it("加载失败：错误条显示 error，close 按钮点击后清除错误", async () => {
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    renderComposer();

    await waitFor(() => expect(screen.getByText("mail:error")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("mail:close"));
    expect(screen.queryByText("mail:error")).toBeFalsy();
  });

  it("to/subject 未填齐时发送 disabled，填齐后恢复可点", async () => {
    mocks.api.mockResolvedValueOnce(ACCOUNTS);
    renderComposer();
    await waitFor(() => expect(screen.queryByText("mail:loading")).toBeFalsy());

    expect(sendButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("mail:to"), { target: { value: "a@example.com" } });
    expect(sendButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("mail:subject"), { target: { value: "  你好  " } });
    expect(sendButton()).not.toBeDisabled();
  });

  it("发送：POST /api/v1/mail/send body 精确（to/subject trim，空 cc/bcc 剔除）", async () => {
    mocks.api.mockResolvedValueOnce(ACCOUNTS);
    mocks.api.mockResolvedValueOnce(undefined);
    renderComposer();
    await waitFor(() => expect(screen.queryByText("mail:loading")).toBeFalsy());

    fireEvent.change(screen.getByLabelText("mail:to"), { target: { value: "  a@example.com  " } });
    fireEvent.change(screen.getByLabelText("mail:subject"), { target: { value: " 周报 " } });
    fireEvent.change(screen.getByLabelText("mail:body"), { target: { value: "正文内容" } });
    fireEvent.click(sendButton());

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api).toHaveBeenLastCalledWith("/api/v1/mail/send", {
      method: "POST",
      body: JSON.stringify({
        wid: WID,
        accountId: "acc-1",
        to: "a@example.com",
        subject: "周报",
        bodyText: "正文内容",
      }),
    });
  });

  it("发送成功：toast success sentOk + onSent 回调", async () => {
    mocks.api.mockResolvedValueOnce(ACCOUNTS);
    mocks.api.mockResolvedValueOnce(undefined);
    renderComposer();
    await waitFor(() => expect(screen.queryByText("mail:loading")).toBeFalsy());

    fireEvent.change(screen.getByLabelText("mail:to"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("mail:subject"), { target: { value: "hi" } });
    fireEvent.click(sendButton());

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("success", "mail:sentOk"));
    expect(mocks.onSent).toHaveBeenCalledTimes(1);
  });

  it("发送失败：错误条 sendFailed + toast error sendFailed", async () => {
    mocks.api.mockResolvedValueOnce(ACCOUNTS);
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    renderComposer();
    await waitFor(() => expect(screen.queryByText("mail:loading")).toBeFalsy());

    fireEvent.change(screen.getByLabelText("mail:to"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("mail:subject"), { target: { value: "hi" } });
    fireEvent.click(sendButton());

    await waitFor(() => expect(screen.getByText("mail:sendFailed")).toBeInTheDocument());
    expect(mocks.toast).toHaveBeenCalledWith("error", "mail:sendFailed");
  });

  it("发送中：按钮文案变 sending 且 disabled，完成后恢复", async () => {
    const d = deferred<undefined>();
    mocks.api.mockResolvedValueOnce(ACCOUNTS);
    mocks.api.mockReturnValueOnce(d.promise);
    renderComposer();
    await waitFor(() => expect(screen.queryByText("mail:loading")).toBeFalsy());

    const btn = sendButton();
    fireEvent.change(screen.getByLabelText("mail:to"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("mail:subject"), { target: { value: "hi" } });
    fireEvent.click(btn);

    await waitFor(() => expect(screen.getByText("mail:sending")).toBeInTheDocument());
    expect(btn).toBeDisabled();
    d.resolve(undefined);
    await waitFor(() => expect(screen.queryByText("mail:sending")).toBeFalsy());
    expect(btn).not.toBeDisabled();
  });

  it("填写 cc/bcc 后 body 携带 trim 后的 cc/bcc；切换账户后使用所选 accountId", async () => {
    mocks.api.mockResolvedValueOnce(ACCOUNTS);
    mocks.api.mockResolvedValueOnce(undefined);
    const { container } = renderComposer();
    await waitFor(() => expect(screen.queryByText("mail:loading")).toBeFalsy());

    fireEvent.change(container.querySelector("select") as HTMLSelectElement, {
      target: { value: "acc-2" },
    });
    fireEvent.change(screen.getByLabelText("mail:to"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("mail:cc"), { target: { value: " c@example.com " } });
    fireEvent.change(screen.getByLabelText("mail:bcc"), { target: { value: "d@example.com" } });
    fireEvent.change(screen.getByLabelText("mail:subject"), { target: { value: "hi" } });
    fireEvent.click(sendButton());

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api).toHaveBeenLastCalledWith("/api/v1/mail/send", {
      method: "POST",
      body: JSON.stringify({
        wid: WID,
        accountId: "acc-2",
        to: "a@example.com",
        cc: "c@example.com",
        bcc: "d@example.com",
        subject: "hi",
        bodyText: "",
      }),
    });
  });

  it("存草稿：toast success draftSaved，不发起额外请求", async () => {
    mocks.api.mockResolvedValueOnce(ACCOUNTS);
    renderComposer();
    await waitFor(() => expect(screen.queryByText("mail:loading")).toBeFalsy());

    fireEvent.click(screen.getByText("mail:saveDraft").closest("button")!);
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("success", "mail:draftSaved"));
    expect(mocks.api).toHaveBeenCalledTimes(1); // 仅账户列表 GET
    expect(mocks.onSent).not.toHaveBeenCalled();
  });

  it("取消：footer 按钮与 header X（aria-label）均触发 onCancel；未传 onCancel 时无取消入口", async () => {
    mocks.api.mockResolvedValueOnce(ACCOUNTS);
    renderComposer();
    await waitFor(() => expect(screen.queryByText("mail:loading")).toBeFalsy());

    fireEvent.click(screen.getByText("mail:cancel"));
    fireEvent.click(screen.getByLabelText("mail:cancel"));
    expect(mocks.onCancel).toHaveBeenCalledTimes(2);

    cleanup();
    mocks.api.mockResolvedValueOnce(ACCOUNTS);
    render(<MailComposer workspaceId={WID} onSent={mocks.onSent} />);
    await waitFor(() => expect(screen.queryByText("mail:loading")).toBeFalsy());
    expect(screen.queryByText("mail:cancel")).toBeFalsy();
    expect(screen.queryByLabelText("mail:cancel")).toBeFalsy();
  });
});
