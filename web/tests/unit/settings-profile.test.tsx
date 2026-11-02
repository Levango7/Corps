// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: mocks.api }));

import { SettingsProfile } from "@/components/settings/SettingsProfile";

const onError = vi.fn();

function renderProfile() {
  return render(<SettingsProfile onError={onError} />);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SettingsProfile", () => {
  it("挂载拉取 /api/v1/users/me 并预填姓名与头像", async () => {
    mocks.api.mockResolvedValueOnce({
      name: "Alice",
      email: "a@b.c",
      image: "https://x.com/a.png",
    });
    renderProfile();
    await waitFor(() => expect(screen.getByDisplayValue("Alice")).toBeInTheDocument());
    expect(screen.getByDisplayValue("https://x.com/a.png")).toBeInTheDocument();
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "https://x.com/a.png");
    expect(img).toHaveAttribute("alt", "settings:profileAvatarAlt");
    expect(mocks.api).toHaveBeenCalledWith("/api/v1/users/me");
  });

  it("姓名/头像为 null 时输入框为空且不渲染预览图", async () => {
    mocks.api.mockResolvedValueOnce({ name: null, email: "a@b.c", image: null });
    renderProfile();
    await waitFor(() => expect(mocks.api).toHaveBeenCalled());
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByLabelText("settings:profileName")).toHaveValue("");
  });

  it("未改动时保存钮禁用且显示「无变更」", async () => {
    mocks.api.mockResolvedValueOnce({ name: "Alice", email: "a@b.c", image: null });
    renderProfile();
    await waitFor(() => expect(screen.getByDisplayValue("Alice")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "settings:save" })).toBeDisabled();
    expect(screen.getByText("settings:noChanges")).toBeInTheDocument();
  });

  it("仅改姓名 → PATCH 只含 name（trim 后）并显示已保存徽标", async () => {
    mocks.api.mockResolvedValueOnce({ name: "Alice", email: "a@b.c", image: null });
    renderProfile();
    await waitFor(() => expect(screen.getByDisplayValue("Alice")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("settings:profileName"), {
      target: { value: "  Bob  " },
    });
    const saveBtn = screen.getByRole("button", { name: "settings:save" });
    expect(saveBtn).toBeEnabled();
    expect(screen.queryByText("settings:noChanges")).not.toBeInTheDocument();
    mocks.api.mockResolvedValueOnce({ name: "Bob", image: null });
    fireEvent.click(saveBtn);
    await waitFor(() => expect(screen.getByText("settings:saved")).toBeInTheDocument());
    expect(mocks.api).toHaveBeenNthCalledWith(2, "/api/v1/users/me", {
      method: "PATCH",
      body: JSON.stringify({ name: "Bob" }),
    });
    // initial 已更新 → dirty 复位
    expect(screen.getByText("settings:noChanges")).toBeInTheDocument();
  });

  it("仅改头像 → PATCH 只含 image", async () => {
    mocks.api.mockResolvedValueOnce({ name: "Alice", email: "a@b.c", image: null });
    renderProfile();
    await waitFor(() => expect(screen.getByDisplayValue("Alice")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("settings:profileAvatar"), {
      target: { value: "  https://y.com/b.png  " },
    });
    const saveBtn = screen.getByRole("button", { name: "settings:save" });
    expect(saveBtn).toBeEnabled();
    mocks.api.mockResolvedValueOnce({ name: "Alice", image: "https://y.com/b.png" });
    fireEvent.click(saveBtn);
    await waitFor(() => expect(screen.getByText("settings:saved")).toBeInTheDocument());
    expect(mocks.api).toHaveBeenNthCalledWith(2, "/api/v1/users/me", {
      method: "PATCH",
      body: JSON.stringify({ image: "https://y.com/b.png" }),
    });
  });

  it("姓名与头像都改 → PATCH 两字段都带", async () => {
    mocks.api.mockResolvedValueOnce({
      name: "Alice",
      email: "a@b.c",
      image: "https://x.com/a.png",
    });
    renderProfile();
    await waitFor(() => expect(screen.getByDisplayValue("Alice")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("settings:profileName"), { target: { value: "Bob" } });
    fireEvent.change(screen.getByLabelText("settings:profileAvatar"), {
      target: { value: "https://y.com/b.png" },
    });
    mocks.api.mockResolvedValueOnce({ name: "Bob", image: "https://y.com/b.png" });
    fireEvent.click(screen.getByRole("button", { name: "settings:save" }));
    await waitFor(() => expect(screen.getByText("settings:saved")).toBeInTheDocument());
    expect(mocks.api).toHaveBeenNthCalledWith(2, "/api/v1/users/me", {
      method: "PATCH",
      body: JSON.stringify({ name: "Bob", image: "https://y.com/b.png" }),
    });
  });

  it("保存进行中按钮禁用、完成后复位", async () => {
    mocks.api.mockResolvedValueOnce({ name: "Alice", email: "a@b.c", image: null });
    renderProfile();
    await waitFor(() => expect(screen.getByDisplayValue("Alice")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("settings:profileName"), { target: { value: "Bob" } });
    const saveBtn = screen.getByRole("button", { name: "settings:save" });
    let resolvePatch!: (value: unknown) => void;
    mocks.api.mockImplementationOnce(
      () =>
        new Promise<unknown>((r) => {
          resolvePatch = r;
        }),
    );
    fireEvent.click(saveBtn);
    await waitFor(() => {
      expect(saveBtn).toBeDisabled();
      expect(saveBtn.querySelector(".animate-spin")).toBeInTheDocument();
    });
    resolvePatch({ name: "Bob", image: null });
    // 保存成功后 dirty 复位 → 按钮再次因 !userDirty 禁用，但 spinner 已消失且出现「无变更」
    await waitFor(() => {
      expect(saveBtn.querySelector(".animate-spin")).not.toBeInTheDocument();
      expect(screen.getByText("settings:noChanges")).toBeInTheDocument();
    });
  });

  it("保存失败（Error）→ onError 收到消息，按钮复位且无已保存徽标", async () => {
    mocks.api.mockResolvedValueOnce({ name: "Alice", email: "a@b.c", image: null });
    renderProfile();
    await waitFor(() => expect(screen.getByDisplayValue("Alice")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("settings:profileName"), { target: { value: "Bob" } });
    const saveBtn = screen.getByRole("button", { name: "settings:save" });
    mocks.api.mockRejectedValueOnce(new Error("名称被占用"));
    fireEvent.click(saveBtn);
    await waitFor(() => expect(onError).toHaveBeenCalledWith("名称被占用"));
    expect(saveBtn).toBeEnabled();
    expect(screen.queryByText("settings:saved")).not.toBeInTheDocument();
  });

  it("保存失败（非 Error）→ error:saveFailed", async () => {
    mocks.api.mockResolvedValueOnce({ name: "Alice", email: "a@b.c", image: null });
    renderProfile();
    await waitFor(() => expect(screen.getByDisplayValue("Alice")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("settings:profileName"), { target: { value: "Bob" } });
    mocks.api.mockRejectedValueOnce("down");
    fireEvent.click(screen.getByRole("button", { name: "settings:save" }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("error:saveFailed"));
  });

  it("加载失败 → onError error:loadFailed", async () => {
    mocks.api.mockRejectedValueOnce(new Error("down"));
    renderProfile();
    await waitFor(() => expect(onError).toHaveBeenCalledWith("error:loadFailed"));
  });

  it("头像 URL 校验：非法显示错误、合法与清空消除错误", async () => {
    mocks.api.mockResolvedValueOnce({ name: "Alice", email: "a@b.c", image: null });
    renderProfile();
    await waitFor(() => expect(screen.getByDisplayValue("Alice")).toBeInTheDocument());
    const imgInput = screen.getByLabelText("settings:profileAvatar");
    fireEvent.change(imgInput, { target: { value: "notaurl" } });
    fireEvent.blur(imgInput);
    expect(screen.getByText("settings:profileAvatarInvalid")).toBeInTheDocument();
    fireEvent.change(imgInput, { target: { value: "https://x.com/a.png" } });
    fireEvent.blur(imgInput);
    expect(screen.queryByText("settings:profileAvatarInvalid")).not.toBeInTheDocument();
    fireEvent.change(imgInput, { target: { value: "" } });
    fireEvent.blur(imgInput);
    expect(screen.queryByText("settings:profileAvatarInvalid")).not.toBeInTheDocument();
  });

  it("已保存徽标 2.4 秒后自动隐藏", async () => {
    mocks.api.mockResolvedValueOnce({ name: "Alice", email: "a@b.c", image: null });
    renderProfile();
    await waitFor(() => expect(screen.getByDisplayValue("Alice")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("settings:profileName"), { target: { value: "Bob" } });
    mocks.api.mockResolvedValueOnce({ name: "Bob", image: null });
    vi.useFakeTimers();
    // 假时钟下的异步保存链（Promise 微任务 + React 更新）要包在 act 里 flushing
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "settings:save" }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("settings:saved")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2400);
    });
    expect(screen.queryByText("settings:saved")).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});
