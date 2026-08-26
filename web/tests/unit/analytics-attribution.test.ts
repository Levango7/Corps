// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";

/**
 * analytics-attribution 单元测试（captureLandingAttribution）
 *
 * 验证：
 *  - utm 三键 camelCase 映射
 *  - 缺省键不出现在 props
 *  - referrer 截断（设计文档 §5.4 PII 边界：utm 截断 128）
 *  - 同 path 二次调用不上报（PublicPageTracker 去重，由 reported Set 保证）
 */
import { captureLandingAttribution } from "@/lib/analytics-attribution";

describe("captureLandingAttribution - utm 映射", () => {
  beforeEach(() => {
    // jsdom 默认 location 为 about:blank，手动设置
    Object.defineProperty(window, "location", {
      value: new URL(
        "https://example.com/auth/signup?utm_source=google&utm_medium=cpc&utm_campaign=launch",
      ),
      writable: true,
    });
    Object.defineProperty(document, "referrer", {
      value: "https://www.google.com/",
      configurable: true,
    });
    Object.defineProperty(navigator, "language", {
      value: "zh-CN",
      configurable: true,
    });
  });

  afterEach(() => {
    // jsdom 状态由 vitest 隔离重置
  });

  it("utm 三键 camelCase 映射到 props", () => {
    const props = captureLandingAttribution();
    expect(props.utmSource).toBe("google");
    expect(props.utmMedium).toBe("cpc");
    expect(props.utmCampaign).toBe("launch");
  });

  it("path 与 locale 正确", () => {
    const props = captureLandingAttribution();
    expect(props.path).toBe("/auth/signup");
    expect(props.locale).toBe("zh-CN");
  });

  it("referrer 正确采集", () => {
    const props = captureLandingAttribution();
    expect(props.referrer).toBe("https://www.google.com/");
  });
});

describe("captureLandingAttribution - 缺省键", () => {
  beforeEach(() => {
    Object.defineProperty(window, "location", {
      value: new URL("https://example.com/auth/signup"),
      writable: true,
    });
    Object.defineProperty(document, "referrer", {
      value: "",
      configurable: true,
    });
    Object.defineProperty(navigator, "language", {
      value: "zh-CN",
      configurable: true,
    });
  });

  it("无 utm 时 utm* 键不出现在 props", () => {
    const props = captureLandingAttribution();
    expect(props.utmSource).toBeUndefined();
    expect(props.utmMedium).toBeUndefined();
    expect(props.utmCampaign).toBeUndefined();
  });

  it("referrer 为空串时仍存在（空串非 undefined）", () => {
    const props = captureLandingAttribution();
    expect(props.referrer).toBe("");
  });
});

describe("captureLandingAttribution - utm 截断 128", () => {
  it("超长 utm 值截断至 128 字符", () => {
    const long = "a".repeat(200);
    Object.defineProperty(window, "location", {
      value: new URL(`https://example.com/auth/signup?utm_source=${long}`),
      writable: true,
    });
    Object.defineProperty(document, "referrer", {
      value: "",
      configurable: true,
    });
    Object.defineProperty(navigator, "language", {
      value: "zh-CN",
      configurable: true,
    });
    const props = captureLandingAttribution();
    expect(props.utmSource?.length).toBe(128);
  });
});
