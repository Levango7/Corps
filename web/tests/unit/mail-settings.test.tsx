// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * MailSettings 契约（components/mail/MailSettings.tsx）：
 *  1. 挂载即 GET /api/v1/mail/accounts?wid={wid}（带 AbortSignal），先显示 loading
 *  2. 账户行：email + isDefault 勾选图标；副行 displayName ? `${displayName} · ` : ""
 *     + `${smtpHost}:${smtpPort}` + smtpSecure ? " (SSL)" : ""；头部计数 span
 *  3. 添加表单：email/displayName/smtpHost/smtpPort/password 输入 + SSL/TLS checkbox；
 *     提交按钮 disabled 条件 = adding || !email.trim() || !smtpHost.trim() || !password.trim()
 *  4. 添加成功 → POST /api/v1/mail/accounts（body 含 credential，displayName 空则剔除，
 *     smtpPort Number 化），新账户置顶 + 表单重置 + toast success updated
 *  5. 添加失败 → toast error error，表单保留
 *  6. 删除：window.confirm 确认 → DELETE /api/v1/mail/accounts/{id}?wid={wid}，
 *     行移除 + toast success accountDeleted；confirm false 不发请求；失败 toast error
 *  7. 加载失败 → 错误条 error（close 清除）；空列表 → noAccount 空态
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

import MailSettings from "@/components/mail/MailSettings";

const WID = "ws-ms-1";
const CREATED_AT = new Date().toISOString();

const A1 = {
  id: "acc-1",
  email: "alice@example.com",
  displayName: "Alice",
  provider: "smtp",
  smtpHost: "smtp.a.com",
  smtpPort: 587,
  smtpSecure: true,
  isDefault: true,
  createdAt: CREATED_AT,
};

const A2 = {
  id: "acc-2",
  email: "bob@example.com",
  displayName: null,
  provider: "smtp",
  smtpHost: "smtp.b.com",
  smtpPort: 25,
  smtpSecure: false,
  isDefault: false,
  createdAt: CREATED_AT,
};

const A3 = {
  id: "acc-3",
  email: "new@example.com",
  displayName: "New",
  provider: "smtp",
  smtpHost: "smtp.n.com",
  smtpPort: 465,
  smtpSecure: true,
  isDefault: false,
  createdAt: CREATED_AT,
};

function renderSettings() {
  return render(<MailSettings workspaceId={WID} />);
}

function addButton() {
  // "addAccount" 文案同时出现在表单标题 h3 与提交按钮上，取按钮所在元素
  return screen
    .getAllByText("mail:addAccount")
    .map((el) => el.closest("button"))
    .find((b): b is HTMLButtonElement => b !== null)!;
}

/** 按渲染顺序返回添加表单各输入框 */
function formInputs() {
  return {
    email: screen.getByLabelText("mail:email") as HTMLInputElement,
    displayName: screen.getByLabelText("mail:displayName") as HTMLInputElement,
    smtpHost: screen.getByLabelText("mail:smtpHost") as HTMLInputElement,
    smtpPort: screen.getByLabelText("mail:smtpPort") as HTMLInputElement,
    password: screen.getByLabelText("mail:password") as HTMLInputElement,
    secure: screen.getByLabelText("SSL/TLS") as HTMLInputElement,
  };
}

beforeEach(() => {
  mocks.api.mockReset();
  mocks.toast.mockReset();
  mocks.api.mockResolvedValue([]);
});
afterEach(() => cleanup());

describe("MailSettings", () => {
  it("挂载即 GET 账户列表：URL 精确，期间显示 loading", () => {
    let resolve!: (v: unknown) => void;
    mocks.api.mockReturnValueOnce(
      new Promise((res) => {
        resolve = res;
      }),
    );
    renderSettings();

    expect(mocks.api).toHaveBeenCalledWith("/api/v1/mail/accounts?wid=ws-ms-1", {
      signal: expect.any(AbortSignal),
    });
    expect(screen.getByText("mail:loading")).toBeInTheDocument();
    resolve([]);
  });

  it("成功渲染账户行：email、displayName · host:port (SSL) 副行与头部计数", async () => {
    mocks.api.mockResolvedValueOnce([A1, A2]);
    const { container } = renderSettings();
    await waitFor(() => expect(screen.queryByText("mail:loading")).toBeFalsy());

    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("bob@example.com")).toBeInTheDocument();
    expect(screen.getByText("Alice · smtp.a.com:587 (SSL)")).toBeInTheDocument();
    expect(screen.getByText("smtp.b.com:25")).toBeInTheDocument();
    const headerCount = container.querySelector("header span");
    expect(headerCount?.textContent).toBe("2");
  });

  it("空账户列表：显示 noAccount 空态", async () => {
    renderSettings();
    await waitFor(() => expect(screen.queryByText("mail:loading")).toBeFalsy());
    expect(screen.getByText("mail:noAccount")).toBeInTheDocument();
  });

  it("加载失败：错误条 error，close 清除后转入空态", async () => {
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    renderSettings();

    await waitFor(() => expect(screen.getByText("mail:error")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("mail:close"));
    await waitFor(() => expect(screen.getByText("mail:noAccount")).toBeInTheDocument());
  });

  it("必填三项未填齐时添加按钮 disabled，填齐后恢复", async () => {
    renderSettings();
    await waitFor(() => expect(screen.queryByText("mail:loading")).toBeFalsy());

    expect(addButton()).toBeDisabled();
    const inputs = formInputs();
    fireEvent.change(inputs.email, { target: { value: "new@example.com" } });
    expect(addButton()).toBeDisabled();
    fireEvent.change(inputs.smtpHost, { target: { value: "smtp.n.com" } });
    expect(addButton()).toBeDisabled();
    fireEvent.change(inputs.password, { target: { value: "pw-123456" } });
    expect(addButton()).not.toBeDisabled();
  });

  it("添加成功：POST body 精确（displayName/smtpPort 数字化/smtpSecure/credential），新账户置顶且表单重置", async () => {
    mocks.api.mockResolvedValueOnce([A1]);
    mocks.api.mockResolvedValueOnce(A3);
    const { container } = renderSettings();
    await waitFor(() => expect(screen.queryByText("mail:loading")).toBeFalsy());

    const inputs = formInputs();
    fireEvent.change(inputs.email, { target: { value: " new@example.com " } });
    fireEvent.change(inputs.displayName, { target: { value: " New " } });
    fireEvent.change(inputs.smtpHost, { target: { value: " smtp.n.com " } });
    fireEvent.change(inputs.smtpPort, { target: { value: "465" } });
    fireEvent.change(inputs.password, { target: { value: "pw-123456" } });
    fireEvent.click(inputs.secure);
    fireEvent.click(addButton());

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api).toHaveBeenLastCalledWith("/api/v1/mail/accounts", {
      method: "POST",
      body: JSON.stringify({
        wid: WID,
        email: "new@example.com",
        displayName: "New",
        smtpHost: "smtp.n.com",
        smtpPort: 465,
        smtpSecure: true,
        credential: "pw-123456",
      }),
    });
    // 新账户置顶（第一行），A1 下移
    const rows = container.querySelectorAll("header ~ div > div.space-y-1\\.5 > div");
    expect(rows[0]?.textContent).toContain("new@example.com");
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("success", "mail:updated"));
    expect(formInputs().email.value).toBe("");
    expect(formInputs().password.value).toBe("");
    expect(formInputs().smtpPort.value).toBe("587");
  });

  it("添加失败：toast error，表单值保留", async () => {
    renderSettings();
    await waitFor(() => expect(screen.queryByText("mail:loading")).toBeFalsy());

    const inputs = formInputs();
    fireEvent.change(inputs.email, { target: { value: "new@example.com" } });
    fireEvent.change(inputs.smtpHost, { target: { value: "smtp.n.com" } });
    fireEvent.change(inputs.password, { target: { value: "pw-123456" } });
    mocks.api.mockRejectedValueOnce(new Error("add boom"));
    fireEvent.click(addButton());

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("error", "mail:error"));
    expect(formInputs().email.value).toBe("new@example.com");
  });

  it("displayName 留空时 POST body 不含 displayName 键", async () => {
    renderSettings();
    await waitFor(() => expect(screen.queryByText("mail:loading")).toBeFalsy());

    const inputs = formInputs();
    fireEvent.change(inputs.email, { target: { value: "new@example.com" } });
    fireEvent.change(inputs.smtpHost, { target: { value: "smtp.n.com" } });
    fireEvent.change(inputs.password, { target: { value: "pw-123456" } });
    mocks.api.mockResolvedValueOnce(A3);
    fireEvent.click(addButton());

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api).toHaveBeenLastCalledWith("/api/v1/mail/accounts", {
      method: "POST",
      body: JSON.stringify({
        wid: WID,
        email: "new@example.com",
        smtpHost: "smtp.n.com",
        smtpPort: 587,
        smtpSecure: false,
        credential: "pw-123456",
      }),
    });
  });

  it("删除：confirm true → DELETE /accounts/{id}?wid，行移除 + success toast accountDeleted", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      mocks.api.mockResolvedValueOnce([A1, A2]);
      mocks.api.mockResolvedValueOnce(undefined);
      const { container } = renderSettings();
      await waitFor(() => expect(screen.queryByText("mail:loading")).toBeFalsy());

      fireEvent.click(screen.getAllByLabelText("mail:delete")[0]);
      await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
      expect(mocks.api).toHaveBeenLastCalledWith("/api/v1/mail/accounts/acc-1?wid=ws-ms-1", {
        method: "DELETE",
      });
      await waitFor(() => expect(screen.queryByText("alice@example.com")).toBeFalsy());
      expect(container.querySelector("header span")?.textContent).toBe("1");
      await waitFor(() =>
        expect(mocks.toast).toHaveBeenCalledWith("success", "mail:accountDeleted"),
      );
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("删除：confirm false → 不发 DELETE，行保留", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      mocks.api.mockResolvedValueOnce([A1]);
      renderSettings();
      await waitFor(() => expect(screen.queryByText("mail:loading")).toBeFalsy());

      fireEvent.click(screen.getByLabelText("mail:delete"));
      expect(mocks.api).toHaveBeenCalledTimes(1);
      expect(screen.getByText("alice@example.com")).toBeInTheDocument();
      expect(mocks.toast).not.toHaveBeenCalled();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("删除失败：toast error，行保留", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      mocks.api.mockResolvedValueOnce([A1]);
      mocks.api.mockRejectedValueOnce(new Error("delete boom"));
      renderSettings();
      await waitFor(() => expect(screen.queryByText("mail:loading")).toBeFalsy());

      fireEvent.click(screen.getByLabelText("mail:delete"));
      await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("error", "mail:error"));
      expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    } finally {
      confirmSpy.mockRestore();
    }
  });
});
