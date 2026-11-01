// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";

/**
 * Web Vitals 采集组件契约（components/web-vitals-reporter.tsx）：
 *  - 挂载即向 useReportWebVitals 注册回调；组件本身不渲染任何 DOM
 *  - 开发（非 production）：详细格式 `[web-vitals] NAME = value (rating) | id=… nav=…`
 *  - 生产：简洁格式 `[web-vitals] NAME=value rating=…`（便于日志聚合）
 *  - 数值统一 toFixed(2)
 */
const h = vi.hoisted(() => ({
  callback: null as null | ((metric: Record<string, unknown>) => void),
  log: vi.fn(),
}));

vi.mock("next/web-vitals", () => ({
  useReportWebVitals: (cb: (metric: Record<string, unknown>) => void) => {
    h.callback = cb;
  },
}));

import { WebVitalsReporter } from "@/components/web-vitals-reporter";

const metric = (over: Record<string, unknown> = {}) => ({
  name: "LCP",
  value: 1234.567,
  rating: "good",
  id: "v3-123",
  navigationType: "navigate",
  ...over,
});

beforeEach(() => {
  h.callback = null;
  h.log.mockReset();
  vi.spyOn(console, "log").mockImplementation(h.log);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("WebVitalsReporter", () => {
  it("挂载即注册回调；不渲染 DOM", () => {
    const { container } = render(<WebVitalsReporter />);
    expect(container.firstChild).toBeNull();
    expect(h.callback).toBeTypeOf("function");
  });

  it("开发环境：详细格式（含 rating / id / nav），数值 toFixed(2)", () => {
    render(<WebVitalsReporter />);
    h.callback!(metric());
    expect(h.log).toHaveBeenCalledWith(
      "[web-vitals] LCP = 1234.57 (good) | id=v3-123 nav=navigate",
    );
  });

  it("生产环境：简洁格式（name=value rating=…）", () => {
    vi.stubEnv("NODE_ENV", "production");
    render(<WebVitalsReporter />);
    h.callback!(metric({ name: "CLS", value: 0.05, rating: "good" }));
    expect(h.log).toHaveBeenCalledWith("[web-vitals] CLS=0.05 rating=good");
  });
});
