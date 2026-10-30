// @vitest-environment node
import { describe, it, expect } from "vitest";

import { routing } from "@/lib/i18n-routing";
import { locales, defaultLocale } from "@/lib/i18n";

/**
 * i18n routing 配置契约（ADR-008 方案 A）：
 *  - localePrefix "as-needed"：默认 zh 不带前缀（既有外链 /auth/login 不破坏）
 *  - localeDetection true：从 cookie / Accept-Language 协商
 * 这里钉配置本身——改策略必须同步改本测试，防止静默改变 URL 形态。
 */
describe("i18n routing 配置（lib/i18n-routing.ts）", () => {
  it("locales 与 lib/i18n 的单一源一致（zh/en）", () => {
    expect(routing.locales).toEqual([...locales]);
    expect([...routing.locales]).toEqual(["zh", "en"]);
  });

  it("默认 locale 为 zh", () => {
    expect(routing.defaultLocale).toBe(defaultLocale);
    expect(routing.defaultLocale).toBe("zh");
  });

  it("localePrefix=as-needed：默认语言不出现在 URL（破坏面最小）", () => {
    expect(routing.localePrefix).toBe("as-needed");
  });

  // 注：localeDetection（cookie / Accept-Language 协商）是 next-intl 的**库默认值**，
  // 本仓库未在 routing 里显式声明（middleware.ts 直接用 createMiddleware(routing)），
  // 因此不在此断言该键——避免把库默认误钉成本仓库承诺。
});
