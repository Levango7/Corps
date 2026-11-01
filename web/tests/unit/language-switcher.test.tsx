// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";

/**
 * 语言切换按钮契约（components/LanguageSwitcherClient.tsx）：
 *  - 渲染 locales 全集（zh/en）按钮 + Languages 图标（aria-hidden，禁 emoji）
 *  - 当前 locale：aria-current="true" + 高亮类；其它无 aria-current
 *  - 点击其它语言 → router.replace(pathname, { locale })；点击当前语言 → 不发导航
 *  - aria-label 由服务器组件传入的 ariaLabel 拼装（"<ariaLabel>：<语言名>"）
 *
 * LanguageSwitcher（服务器组件）依赖 getTranslations，单测覆盖 client 部分即可。
 */
const h = vi.hoisted(() => ({
  replace: vi.fn(),
  pathname: "/w/abc/board",
  locale: "zh",
}));

vi.mock("next-intl", () => ({
  useLocale: () => h.locale,
}));

vi.mock("@/lib/i18n-navigation", () => ({
  useRouter: () => ({ replace: h.replace }),
  usePathname: () => h.pathname,
}));

import { LanguageSwitcherClient } from "@/components/LanguageSwitcherClient";
import { locales, localeNames } from "@/lib/i18n";

beforeEach(() => {
  h.replace.mockReset();
  h.locale = "zh";
});

describe("LanguageSwitcherClient", () => {
  it("渲染全部 locale 按钮：文案=语言名、aria-label=ariaLabel：语言名", () => {
    const { getByRole, getByText } = render(<LanguageSwitcherClient ariaLabel="切换语言" />);
    for (const loc of locales) {
      expect(getByText(localeNames[loc])).toBeTruthy();
      expect(getByRole("button", { name: `切换语言：${localeNames[loc]}` })).toBeTruthy();
    }
  });

  it("当前 locale 高亮（aria-current）且带激活类；其它无 aria-current", () => {
    const { getByRole } = render(<LanguageSwitcherClient ariaLabel="切换语言" />);
    const current = getByRole("button", { name: `切换语言：${localeNames.zh}` });
    expect(current.getAttribute("aria-current")).toBe("true");
    expect(current.className).toContain("bg-[var(--surface-2)]");
    const other = getByRole("button", { name: `切换语言：${localeNames.en}` });
    expect(other.getAttribute("aria-current")).toBeNull();
    expect(other.className).toContain("text-[var(--muted)]");
  });

  it("点击其它语言：router.replace(pathname, { locale })", () => {
    const { getByRole } = render(<LanguageSwitcherClient ariaLabel="切换语言" />);
    fireEvent.click(getByRole("button", { name: `切换语言：${localeNames.en}` }));
    expect(h.replace).toHaveBeenCalledWith("/w/abc/board", { locale: "en" });
  });

  it("点击当前语言：不发导航（no-op）", () => {
    const { getByRole } = render(<LanguageSwitcherClient ariaLabel="切换语言" />);
    fireEvent.click(getByRole("button", { name: `切换语言：${localeNames.zh}` }));
    expect(h.replace).not.toHaveBeenCalled();
  });

  it("图标为 Languages 且 aria-hidden（装饰性，禁 emoji）", () => {
    const { container } = render(<LanguageSwitcherClient ariaLabel="切换语言" />);
    const icon = container.querySelector("svg.lucide-languages");
    expect(icon).toBeTruthy();
    expect(icon!.getAttribute("aria-hidden")).toBe("true");
  });
});
