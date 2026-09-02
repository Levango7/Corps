// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { createRequire } from "node:module";
import type { ReactNode } from "react";

/**
 * /pricing 定价页单元测试
 *
 * 覆盖四组（docs/design/pricing-page-impl-design.md §8.1）：
 *  1. 常量口径测试（PRICING_PLANS / PRICING_FAQS / PRICING_MATRIX / 派生数字）
 *  2. 页面骨架渲染测试（H1 / 对比表分组 / FAQ details / Footer / TopNav 高亮）
 *  3. PricingSection 交互测试（默认年付 / 切换 / select_billing_period / click_upgrade）
 *  4. TrackedCta / PricingViewTracker 测试（href / onClick / view_pricing 去重）
 *
 * i18n 适配：
 *  - page 为 async 服务端组件，用 getTranslations（next-intl/server）→ 本文件 mock 为
 *    基于 zh.json pricing 命名空间的 t 函数，渲染时传 params={Promise.resolve({locale:"zh"})}。
 *  - PricingSection 为客户端组件，用 useTranslations → 用 NextIntlClientProvider 注水 zh messages。
 *  - 全页面渲染（含 PricingSection）统一包 NextIntlClientProvider 提供上下文。
 *
 * 运行：pnpm vitest run web/tests/unit/pricing-page.test.tsx
 */

// 同步加载 zh messages（createRequire 在 ESM 测试环境提供 CJS require，eval 阶段执行）
const requireJson = createRequire(import.meta.url);
const zhMessages = requireJson("../../messages/zh.json") as { pricing: Record<string, unknown> };

// ─────────────────────────────────────────────────────────────────────────────
// 1. 常量口径测试（纯 node 环境，无需 jsdom；放此处便于一并运行）
// ─────────────────────────────────────────────────────────────────────────────

import {
  PRICING_PLANS,
  PRICING_FAQS,
  PRICING_MATRIX,
  FEATURE_COLUMNS,
  SOCIAL_PROOF,
  YEARLY_MONTHLY_AVERAGE,
  YEARLY_SAVING_PER_SEAT,
} from "@/lib/pricing";

describe("常量口径", () => {
  it("PRICING_PLANS.free 月付为 0、features 长度 14", () => {
    // Assert
    expect(PRICING_PLANS.free.monthlyPrice).toBe(0);
    expect(PRICING_PLANS.free.features).toHaveLength(14);
  });

  it("PRICING_PLANS.pro 月付 29.9、年付 299、features 长度 8", () => {
    // Assert
    expect(PRICING_PLANS.pro.monthlyPrice).toBe(29.9);
    expect(PRICING_PLANS.pro.yearlyPrice).toBe(299);
    expect(PRICING_PLANS.pro.features).toHaveLength(8);
  });

  it("年付派生：月均价 24.9（toFixed(1)）、每席每年省 59.8（29.9×12−299）", () => {
    // Assert
    expect(YEARLY_MONTHLY_AVERAGE.toFixed(1)).toBe("24.9");
    expect(YEARLY_SAVING_PER_SEAT).toBeCloseTo(29.9 * 12 - 299, 1);
    expect(YEARLY_SAVING_PER_SEAT).toBeCloseTo(59.8, 1);
  });

  it("PRICING_FAQS 长度 6 且 questionId 连续 0–5", () => {
    // Assert
    expect(PRICING_FAQS).toHaveLength(6);
    expect(PRICING_FAQS.map((f) => f.questionId)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("PRICING_MATRIX 七分组", () => {
    // Assert
    expect(PRICING_MATRIX).toHaveLength(7);
    expect(PRICING_MATRIX.map((g) => g.group)).toEqual([
      "matrix.g1",
      "matrix.g2",
      "matrix.g3",
      "matrix.g4",
      "matrix.g5",
      "matrix.g6",
      "matrix.g7",
    ]);
  });

  it("FEATURE_COLUMNS 三栏", () => {
    // Assert
    expect(FEATURE_COLUMNS).toHaveLength(3);
    expect(FEATURE_COLUMNS.map((c) => c.icon)).toEqual([
      "GitBranch",
      "KanbanSquare",
      "ShieldCheck",
    ]);
  });

  it("SOCIAL_PROOF MVP 种子期 paidTeams=null（永不渲染空占位）", () => {
    // Assert
    expect(SOCIAL_PROOF.minTeams).toBe(20);
    expect(SOCIAL_PROOF.paidTeams).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mock analytics.track（供组件交互测试断言调用参数）
// ─────────────────────────────────────────────────────────────────────────────

const trackMock = vi.fn();
vi.mock("@/lib/analytics", () => ({
  track: (...args: unknown[]) => trackMock(...args),
}));

/**
 * 构造简化翻译函数：按点分 key 取值 + ICU {var} 字面插值。
 * function 声明被 hoist，可在 vi.mock 工厂（惰性执行）内安全调用。
 */
function makeT(msgs: Record<string, unknown>) {
  return (key: string, values?: Record<string, unknown>): string => {
    const parts = key.split(".");
    const val: unknown = parts.reduce<unknown>(
      (acc, p) => (acc == null ? acc : (acc as Record<string, unknown>)[p]),
      msgs,
    );
    let str = typeof val === "string" ? val : String(val ?? "");
    if (values) {
      for (const [k, v] of Object.entries(values)) {
        str = str.split(`{${k}}`).join(String(v));
      }
    }
    return str;
  };
}

// Mock next-intl/server：部分 mock，保留真实 getRequestConfig（lib/i18n.ts 依赖其 default export），
// 仅覆盖 getTranslations（返回基于 zh.json pricing 的 t）与 setRequestLocale（no-op）。
// 工厂惰性执行，getTranslations 为 async fn 内部动态 import zh.json（避免 hoisting 读取未初始化变量）。
vi.mock("next-intl/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl/server")>();
  return {
    ...actual,
    getTranslations: async () => {
      const zh = (await import("../../messages/zh.json")).default as {
        pricing: Record<string, unknown>;
      };
      return makeT(zh.pricing);
    },
    setRequestLocale: () => {},
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. 页面骨架渲染测试
// ─────────────────────────────────────────────────────────────────────────────

import PricingPage from "@/app/[locale]/pricing/page";

/** 渲染整页：await async 服务端组件 + 包 NextIntlClientProvider 供 PricingSection 注水。 */
async function renderPage() {
  const ui = await PricingPage({ params: Promise.resolve({ locale: "zh" }) });
  return render(
    <NextIntlClientProvider locale="zh" messages={zhMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("页面骨架渲染", () => {
  it("H1 文案「让讨论结论自动落位成任务」", async () => {
    // Act
    await renderPage();
    // Assert
    expect(
      screen.getByRole("heading", { level: 1, name: "让讨论结论自动落位成任务" }),
    ).toBeInTheDocument();
  });

  it("FAQ details 元素数量 === 6", async () => {
    // Act
    await renderPage();
    // Assert
    const faqDetails = screen.getAllByRole("group");
    // details 元素隐式 role=group；过滤掉计费周期切换器（role=group aria-label="计费周期切换"）
    const faqOnly = faqDetails.filter((el) => !el.hasAttribute("aria-label"));
    expect(faqOnly).toHaveLength(6);
  });

  it("Footer 含「© 2026 corps」", async () => {
    // Act
    const { container } = await renderPage();
    // Assert
    expect(container.textContent).toContain("© 2026 corps");
  });

  it("TopNav「定价」链接带 aria-current=page（当前页高亮）", async () => {
    // Act
    await renderPage();
    // Assert
    const pricingLinks = screen.getAllByRole("link", { name: "定价" });
    expect(pricingLinks.length).toBeGreaterThanOrEqual(1);
    expect(pricingLinks[0]).toHaveAttribute("aria-current", "page");
  });

  it("对比表分组行数 === 7（PRICING_MATRIX 七分组）", async () => {
    // Act
    const { container } = await renderPage();
    // Assert：分组标题行用 scope="rowgroup"
    const rowGroups = container.querySelectorAll('th[scope="rowgroup"]');
    expect(rowGroups).toHaveLength(7);
  });

  it("社会证明条 MVP 种子期不渲染（paidTeams=null）", async () => {
    // Act
    const { container } = await renderPage();
    // Assert：不含「正在用 corps 管理决策与任务」文案
    expect(container.textContent).not.toContain("正在用 corps 管理决策与任务");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. PricingSection 交互测试
// ─────────────────────────────────────────────────────────────────────────────

import { PricingSection } from "@/components/pricing/PricingSection";

/** 渲染 PricingSection 并注水 zh messages（useTranslations 依赖 NextIntlClientProvider）。 */
function renderWithI18n(ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="zh" messages={zhMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("PricingSection 交互", () => {
  beforeEach(() => {
    trackMock.mockClear();
  });

  it("默认年付态：¥299 可见、删除线 ¥29.9 原价可见、「省 ¥59.8/席」徽标可见", () => {
    // Act
    const { container } = renderWithI18n(<PricingSection />);
    // Assert
    expect(container.textContent).toContain("¥299");
    expect(container.textContent).toContain("¥29.9"); // 删除线原价
    expect(container.textContent).toContain("省 ¥59.8/席");
  });

  it("切换到月付：价格切 ¥29.9 且徽标消失，并上报 select_billing_period", () => {
    // Arrange
    const { container } = renderWithI18n(<PricingSection />);
    // Act：点击「按月付」分段控件
    const monthlyBtn = screen.getByRole("button", { name: /按月付/ });
    fireEvent.click(monthlyBtn);
    // Assert：年付徽标消失（不再含「省 ¥118/席」）
    expect(container.textContent).not.toContain("省 ¥59.8/席");
    // Assert：select_billing_period 上报 period=monthly
    expect(trackMock).toHaveBeenCalledWith("select_billing_period", {
      period: "monthly",
    });
  });

  it("Pro 卡按钮 click 上报 click_upgrade 且 source===card、period 与当前态一致", () => {
    // Arrange：默认年付
    renderWithI18n(<PricingSection />);
    // Act：点击 Pro 卡「升级到 Pro」按钮
    const proBtn = screen.getByRole("link", { name: "升级到 Pro" });
    fireEvent.click(proBtn);
    // Assert
    expect(trackMock).toHaveBeenCalledWith("click_upgrade", {
      plan: "pro",
      source: "card",
      period: "yearly",
    });
  });

  it("Free 卡按钮 click 上报 click_upgrade 且 plan===free、source===card", () => {
    // Arrange
    renderWithI18n(<PricingSection />);
    // Act：点击 Free 卡「免费开始」按钮（注：TopNav 也有「免费开始」链接，需精确选择 card 内的）
    const freeLinks = screen.getAllByRole("link", { name: "免费开始" });
    // PricingSection 内只有一个 Free 卡按钮
    expect(freeLinks.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(freeLinks[0]);
    // Assert
    expect(trackMock).toHaveBeenCalledWith("click_upgrade", {
      plan: "free",
      source: "card",
      period: "yearly",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. TrackedCta / PricingViewTracker 测试
// ─────────────────────────────────────────────────────────────────────────────

import { TrackedCta } from "@/components/pricing/TrackedCta";
import { PricingViewTracker } from "@/components/pricing/PricingViewTracker";

describe("TrackedCta", () => {
  beforeEach(() => {
    trackMock.mockClear();
  });

  it("渲染为链接且 href 正确", () => {
    // Act
    render(
      <TrackedCta href="/auth/signup?src=pricing" plan="free" source="hero" period="yearly">
        免费开始
      </TrackedCta>,
    );
    // Assert
    const link = screen.getByRole("link", { name: "免费开始" });
    expect(link).toHaveAttribute("href", "/auth/signup?src=pricing");
  });

  it("onClick 上报对应 source=hero、plan=free、period=yearly", () => {
    // Arrange
    render(
      <TrackedCta href="/auth/signup?src=pricing" plan="free" source="hero" period="yearly">
        免费开始
      </TrackedCta>,
    );
    // Act
    fireEvent.click(screen.getByRole("link", { name: "免费开始" }));
    // Assert
    expect(trackMock).toHaveBeenCalledWith("click_upgrade", {
      plan: "free",
      source: "hero",
      period: "yearly",
    });
  });

  it("source=tail_cta 上报正确", () => {
    // Arrange
    render(
      <TrackedCta href="/auth/signup?src=pricing" plan="free" source="tail_cta" period="yearly">
        免费开始
      </TrackedCta>,
    );
    // Act
    fireEvent.click(screen.getByRole("link", { name: "免费开始" }));
    // Assert
    expect(trackMock).toHaveBeenCalledWith("click_upgrade", {
      plan: "free",
      source: "tail_cta",
      period: "yearly",
    });
  });
});

describe("PricingViewTracker", () => {
  beforeEach(() => {
    trackMock.mockClear();
    // 清理 sessionStorage
    if (typeof window !== "undefined" && window.sessionStorage) {
      window.sessionStorage.clear();
    }
  });

  afterEach(() => {
    if (typeof window !== "undefined" && window.sessionStorage) {
      window.sessionStorage.clear();
    }
  });

  it("挂载即上报 view_pricing 且 props.theme 为 light 或 dark", () => {
    // Arrange：默认无 data-theme 属性 → light
    document.documentElement.removeAttribute("data-theme");
    // Act
    render(<PricingViewTracker />);
    // Assert
    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith("view_pricing", { theme: "light" });
    // Assert：sessionStorage 已标记
    expect(window.sessionStorage.getItem("corps_pricing_viewed")).toBe("1");
  });

  it("二次挂载（同 sessionStorage 会话）不上报（去重断言）", () => {
    // Arrange：先标记已上报
    window.sessionStorage.setItem("corps_pricing_viewed", "1");
    // Act
    render(<PricingViewTracker />);
    // Assert：未调用 track
    expect(trackMock).not.toHaveBeenCalled();
  });

  it("data-theme=dark 时上报 theme=dark", () => {
    // Arrange
    document.documentElement.setAttribute("data-theme", "dark");
    // Act
    render(<PricingViewTracker />);
    // Assert
    expect(trackMock).toHaveBeenCalledWith("view_pricing", { theme: "dark" });
    // Cleanup
    document.documentElement.removeAttribute("data-theme");
  });

  it("渲染 null 不产生 DOM", () => {
    // Act
    const { container } = render(<PricingViewTracker />);
    // Assert：容器内无子节点
    expect(container.firstChild).toBeNull();
  });
});
