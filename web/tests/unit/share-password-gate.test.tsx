// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));

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

import { SharePasswordGate } from "@/components/SharePasswordGate";

const submitMock = vi.fn();
const closeMock = vi.fn();

function renderGate(
  overrides: {
    error?: string | null;
    remainingAttempts?: number;
    lockedUntil?: Date | null;
    withClose?: boolean;
  } = {},
) {
  return render(
    <SharePasswordGate
      open
      onSubmit={submitMock}
      onClose={overrides.withClose ? closeMock : undefined}
      error={overrides.error}
      remainingAttempts={overrides.remainingAttempts}
      lockedUntil={overrides.lockedUntil}
    />,
  );
}

const LOCKED_LABEL = "shareGate:dialogLabel";
const PLACEHOLDER = "shareGate:passwordPlaceholder";
const ACCESS = "shareGate:access";

beforeEach(() => {
  submitMock.mockReset();
  submitMock.mockResolvedValue(undefined);
  closeMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("SharePasswordGate", () => {
  it("open=false 时渲染 null", () => {
    const { container } = render(<SharePasswordGate open={false} onSubmit={submitMock} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("open=true 渲染 dialog 遮罩 + 标题 + 描述 + 密码输入框", () => {
    renderGate();
    const dialog = screen.getByRole("dialog", { name: LOCKED_LABEL });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("shareGate:title")).toBeInTheDocument();
    expect(screen.getByText("shareGate:description")).toBeInTheDocument();
    const input = screen.getByPlaceholderText(PLACEHOLDER);
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("autocomplete", "new-password");
  });

  it("密码为空时「访问」按钮禁用", () => {
    renderGate();
    expect(screen.getByRole("button", { name: ACCESS })).toBeDisabled();
  });

  it("输入密码后提交，onSubmit 收到密码原文", async () => {
    renderGate();
    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: "s3cret" } });
    fireEvent.submit(screen.getByPlaceholderText(PLACEHOLDER).closest("form")!);
    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(1));
    expect(submitMock).toHaveBeenCalledWith("s3cret");
  });

  it("空密码提交表单不触发 onSubmit", () => {
    renderGate();
    fireEvent.submit(screen.getByPlaceholderText(PLACEHOLDER).closest("form")!);
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("提交期间按钮禁用，完成后恢复", async () => {
    let resolveSubmit!: () => void;
    submitMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve;
        }),
    );
    renderGate();
    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: ACCESS }));
    await waitFor(() => expect(screen.getByRole("button", { name: ACCESS })).toBeDisabled());
    await act(async () => {
      resolveSubmit();
    });
    await waitFor(() => expect(screen.getByRole("button", { name: ACCESS })).toBeEnabled());
  });

  it("error 非空时渲染错误提示文案", () => {
    renderGate({ error: "密码错误，请重试" });
    expect(screen.getByText("密码错误，请重试")).toBeInTheDocument();
  });

  it("有 error 时显示剩余尝试次数（count 变量注入）", () => {
    renderGate({ error: "密码错误", remainingAttempts: 2 });
    expect(screen.getByText('shareGate:remainingAttempts:{"count":2}')).toBeInTheDocument();
  });

  it("无 error 且次数 > 3 时不显示剩余次数；次数为 0 也不显示", () => {
    const first = renderGate({ remainingAttempts: 5 });
    expect(screen.queryByText('shareGate:remainingAttempts:{"count":5}')).not.toBeInTheDocument();
    first.unmount();
    renderGate({ remainingAttempts: 0 });
    expect(screen.queryByText('shareGate:remainingAttempts:{"count":0}')).not.toBeInTheDocument();
  });

  it("无 error 但次数 <= 3 时显示剩余次数", () => {
    renderGate({ remainingAttempts: 2 });
    expect(screen.getByText('shareGate:remainingAttempts:{"count":2}')).toBeInTheDocument();
  });

  it("lockedUntil 在未来：显示锁定提示（分钟向上取整），隐藏输入框与按钮", () => {
    renderGate({ lockedUntil: new Date(Date.now() + 10 * 60 * 1000) });
    expect(screen.getByText('shareGate:locked:{"minutes":10}')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(PLACEHOLDER)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ACCESS })).not.toBeInTheDocument();
  });

  it("lockedUntil 在过去：视为未锁定，正常显示表单", () => {
    renderGate({ lockedUntil: new Date(Date.now() - 60 * 1000) });
    expect(screen.queryByText(/shareGate:locked:/)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(PLACEHOLDER)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ACCESS })).toBeInTheDocument();
  });

  it("Escape：提供 onClose 时调用 onClose；未提供时清空输入", () => {
    const first = renderGate({ withClose: true });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(closeMock).toHaveBeenCalledTimes(1);
    first.unmount();
    closeMock.mockClear();

    renderGate();
    const input = screen.getByPlaceholderText(PLACEHOLDER);
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(closeMock).not.toHaveBeenCalled();
    expect(input).toHaveValue("");
  });

  it("点击遮罩（提供 onClose）才关闭；点击卡片内部不关闭；未提供 onClose 时遮罩点击无效", () => {
    const first = renderGate({ withClose: true });
    const overlay = screen.getByRole("dialog", { name: LOCKED_LABEL });
    fireEvent.click(overlay.firstElementChild!);
    expect(closeMock).not.toHaveBeenCalled();
    fireEvent.click(overlay);
    expect(closeMock).toHaveBeenCalledTimes(1);
    first.unmount();
    closeMock.mockClear();

    renderGate();
    fireEvent.click(screen.getByRole("dialog", { name: LOCKED_LABEL }));
    expect(closeMock).not.toHaveBeenCalled();
  });
});
