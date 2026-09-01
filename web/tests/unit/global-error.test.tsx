// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import GlobalError from "@/app/global-error";

/**
 * global-error.tsx 回归测试（防复发）
 *
 * 验证在没有 NextIntlClientProvider 的情况下仍能正常渲染，不抛
 * "context from NextIntlClientProvider was not found"。
 *
 * 背景：global-error 在 React 树中位于 root layout 之上，拿不到
 * NextIntlClientProvider；曾因误用 useTranslations 导致兜底错误页自身崩溃、
 * 用户看到纯白屏，错误边界彻底失效。故该组件必须保持零 i18n 依赖。
 *
 * 注意：该组件自带 <html>/<body>（Next.js global-error 的硬性要求），
 * jsdom 会剥离嵌套的 html/body 标签，故不能用 screen.getByText，
 * 改为断言 container.innerHTML。
 */

function setNavigatorLang(lang: string) {
  Object.defineProperty(window.navigator, "language", {
    value: lang,
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
  setNavigatorLang("en-US");
});

describe("global-error 兜底渲染（无 Provider）", () => {
  it("浏览器语言为中文时渲染中文兜底文案，且不抛异常", () => {
    setNavigatorLang("zh-CN");
    const error = Object.assign(new Error("boom"), { digest: "abc123" });

    // 若组件内部仍调用 useTranslations，这里会直接抛出
    const { container } = render(<GlobalError error={error} reset={() => {}} />);
    const html = container.innerHTML;

    expect(html).toContain("应用发生严重错误");
    expect(html).toContain("页面渲染时发生未预期的异常，请尝试重试或刷新。");
    expect(html).toContain("错误编号：abc123");
    expect(html).toContain("重试");
    expect(html).toContain("刷新页面");
  });

  it("浏览器语言为英文时渲染英文兜底文案", () => {
    setNavigatorLang("en-US");
    const error = Object.assign(new Error("boom"), { digest: "abc123" });

    const { container } = render(<GlobalError error={error} reset={() => {}} />);
    const html = container.innerHTML;

    expect(html).toContain("A critical error occurred");
    expect(html).toContain("Error ID: abc123");
    expect(html).toContain("Retry");
    expect(html).toContain("Refresh page");
  });

  it("源码中不应再 import 或调用 next-intl 的 useTranslations", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("app/global-error.tsx", "utf-8");
    // 注释中会提到 next-intl / useTranslations，故只匹配真实语句
    expect(src).not.toMatch(/from\s+["']next-intl["']/);
    expect(src).not.toMatch(/=\s*useTranslations\s*\(/);
  });
});
