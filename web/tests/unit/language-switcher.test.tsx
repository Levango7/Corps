// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";

/**
 * 语言切换契约（components/LanguageSwitcherClient.tsx + components/LanguageSwitcher.tsx）：
 *  - 渲染 locales 全集（zh/en）按钮 + Languages 图标（aria-hidden，禁 emoji）
 *  - 当前 locale：aria-current="true" + 高亮类；其它无 aria-current
 *  - 点击其它语言 → router.replace(pathname, { locale })；点击当前语言 → 不发导航
 *  - aria-label 由调用方传入的 ariaLabel 拼装（"<ariaLabel>：<语言名>"）
 *  - 服务器组件 LanguageSwitcher：getTranslations("languageSwitcher") → 把
 *    t("ariaLabel") 作为 ariaLabel 透传给 LanguageSwitcherClient
 */
const h = vi.hoisted(() => ({
  replace: vi.fn(),
  pathname: "/w/abc/board",
  locale: "zh",
  getTranslations: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useLocale: () => h.locale,
}));

vi.mock("next-intl/server", () => ({
  getTranslations: h.getTranslations,
  // LanguageSwitcherClient 间接引入 @/lib/i18n（模块级调用 getRequestConfig）：
  // 桩只保证模块求值不炸，本文件不消费其默认导出
  getRequestConfig: () => Promise.resolve({ messages: {} }),
}));

vi.mock("@/lib/i18n-navigation", () => ({
  useRouter: () => ({ replace: h.replace }),
  usePathname: () => h.pathname,
}));

import { LanguageSwitcherClient } from "@/components/LanguageSwitcherClient";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { locales, localeNames } from "@/lib/i18n";

beforeEach(() => {
  h.replace.mockReset();
  h.locale = "zh";
  // 服务器组件翻译桩：t(key) → "namespace:key"（t 本身必须是同步函数，
  // 否则 JSX 里渲染成 [object Promise]）
  h.getTranslations.mockImplementation((ns: string) => (key: string) => `${ns}:${key}`);
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

describe("LanguageSwitcher（服务器组件）", () => {
  /** 异步服务器组件：先 await 取 JSX 再渲染 */
  async function renderSwitcher() {
    const ui = await LanguageSwitcher();
    return render(ui);
  }

  it("以 languageSwitcher 命名空间调用 getTranslations", async () => {
    await renderSwitcher();
    expect(h.getTranslations).toHaveBeenCalledWith("languageSwitcher");
  });

  it("t(ariaLabel) 作为 ariaLabel 透传：按钮名=languageSwitcher:ariaLabel：语言名", async () => {
    const { getByRole } = await renderSwitcher();
    expect(
      getByRole("button", { name: `languageSwitcher:ariaLabel：${localeNames.zh}` }),
    ).toBeTruthy();
    expect(
      getByRole("button", { name: `languageSwitcher:ariaLabel：${localeNames.en}` }),
    ).toBeTruthy();
  });

  it("渲染 locales 全集（zh/en），当前 locale aria-current=true", async () => {
    const { getByRole } = await renderSwitcher();
    expect(
      getByRole("button", { name: `languageSwitcher:ariaLabel：${localeNames.zh}` }).getAttribute(
        "aria-current",
      ),
    ).toBe("true");
    expect(
      getByRole("button", { name: `languageSwitcher:ariaLabel：${localeNames.en}` }).getAttribute(
        "aria-current",
      ),
    ).toBeNull();
  });

  it("切换动作经服务端拼装文案后仍生效：replace(pathname, { locale })", async () => {
    const { getByRole } = await renderSwitcher();
    fireEvent.click(getByRole("button", { name: `languageSwitcher:ariaLabel：${localeNames.en}` }));
    expect(h.replace).toHaveBeenCalledWith("/w/abc/board", { locale: "en" });
  });

  it("点击当前语言不发导航（服务端 → client 链路无副作用）", async () => {
    const { getByRole } = await renderSwitcher();
    fireEvent.click(getByRole("button", { name: `languageSwitcher:ariaLabel：${localeNames.zh}` }));
    expect(h.replace).not.toHaveBeenCalled();
  });
});
