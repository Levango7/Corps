// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";

/**
 * AiNotConfiguredBanner 契约（components/ai/AiNotConfiguredBanner.tsx，default 导出）：
 *  1. 探测中（loading）不渲染
 *  2. configured=false 渲染提示条（data-testid=ai-not-configured-banner，aria-live=polite）
 *  3. configured=true 渲染 null
 *  4. 探测失败（网络异常）不渲染——fail-open 仅限横幅，鉴权与限额在服务端 fail-closed
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: mocks.api }));

vi.mock("next-intl", () => {
  const cache = new Map<string, (key: string, vars?: Record<string, unknown>) => string>();
  const useTranslations = (ns: string) => {
    let fn = cache.get(ns);
    if (!fn) {
      fn = (key: string) => `${ns}.${key}`;
      cache.set(ns, fn);
    }
    return fn;
  };
  return { useTranslations };
});

vi.mock("lucide-react", () => ({ Sparkles: () => null }));

import AiNotConfiguredBanner from "@/components/ai/AiNotConfiguredBanner";

describe("AiNotConfiguredBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.api.mockReset();
  });
  afterEach(() => cleanup());

  it("configured=false 渲染提示条", async () => {
    mocks.api.mockResolvedValue({ configured: false });
    render(<AiNotConfiguredBanner />);
    await waitFor(() => expect(screen.getByTestId("ai-not-configured-banner")).toBeInTheDocument());
    expect(screen.getByTestId("ai-not-configured-banner").getAttribute("aria-live")).toBe("polite");
  });

  it("configured=true 渲染 null", async () => {
    mocks.api.mockResolvedValue({ configured: true });
    const { container } = render(<AiNotConfiguredBanner />);
    await waitFor(() => expect(mocks.api).toHaveBeenCalled());
    expect(container.querySelector("[data-testid=ai-not-configured-banner]")).toBeNull();
  });

  it("探测失败不渲染（fail-open 仅限横幅）", async () => {
    mocks.api.mockRejectedValue(new Error("network boom"));
    const { container } = render(<AiNotConfiguredBanner />);
    await waitFor(() => expect(mocks.api).toHaveBeenCalled());
    expect(container.querySelector("[data-testid=ai-not-configured-banner]")).toBeNull();
  });
});
