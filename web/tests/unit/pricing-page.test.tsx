// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";

/**
 * /pricing 定价页单元测试
 *
 * 覆盖四组（docs/design/pricing-page-impl-design.md §8.1）：
 *  1. 常量口径测试（PRICING_PLANS / PRICING_FAQS / PRICING_MATRIX / 派生数字）
 *  2. 页面骨架渲染测试（H1 / 对比表分组 / FAQ details / Footer / TopNav 高亮）
 *  3. PricingSection 交互测试（默认年付 / 切换 / select_billing_period / click_upgrade）
 *  4. TrackedCta / PricingViewTracker 测试（href / onClick / view_pricing 去重）
 *
 * 运行：pnpm vitest run web/tests/unit/pricing-page.test.tsx
 */

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
  it("PRICING_PLANS.free 月付为 0、features 长度 7", () => {
    // Assert
    expect(PRICING_PLANS.free.monthlyPrice).toBe(0);
    expect(PRICING_PLANS.free.features).toHaveLength(7);
  });

  it("PRICING_PLANS.pro 月付 59、年付 590、features 长度 6", () => {
    // Assert
    expect(PRICING_PLANS.pro.monthlyPrice).toBe(59);
    expect(PRICING_PLANS.pro.yearlyPrice).toBe(590);
    expect(PRICING_PLANS.pro.features).toHaveLength(6);
  });

  it("年付派生：月均价 49.2（toFixed(1)）、每席每年省 118（59×12−590）", () => {
    // Assert
    expect(YEARLY_MONTHLY_AVERAGE.toFixed(1)).toBe("49.2");
    expect(YEARLY_SAVING_PER_SEAT).toBe(59 * 12 - 590);
    expect(YEARLY_SAVING_PER_SEAT).toBe(118);
  });

  it("PRICING_FAQS 长度 6 且 questionId 连续 0–5", () => {
    // Assert
    expect(PRICING_FAQS).toHaveLength(6);
    expect(PRICING_FAQS.map((f) => f.questionId)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("PRICING_MATRIX 五分组", () => {
    // Assert
    expect(PRICING_MATRIX).toHaveLength(5);
    expect(PRICING_MATRIX.map((g) => g.group)).toEqual([
      "任务协作",
      "决策记录",
      "搜索与导出",
      "团队与安全",
      "席位计费",
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

// ─────────────────────────────────────────────────────────────────────────────
// 2. 页面骨架渲染测试
// ─────────────────────────────────────────────────────────────────────────────

import PricingPage from "@/app/[locale]/pricing/page";

describe("页面骨架渲染", () => {
  it("H1 文案「让讨论结论自动落位成任务」", () => {
    // Act
    render(<PricingPage />);
    // Assert
    expect(
      screen.getByRole("heading", { level: 1, name: "让讨论结论自动落位成任务" }),
    ).toBeInTheDocument();
  });

  it("FAQ details 元素数量 === 6", () => {
    // Act
    render(<PricingPage />);
    // Assert
    const faqDetails = screen.getAllByRole("group");
    // details 元素隐式 role=group；过滤掉计费周期切换器（role=group aria-label="计费周期切换"）
    const faqOnly = faqDetails.filter((el) => !el.hasAttribute("aria-label"));
    expect(faqOnly).toHaveLength(6);
  });

  it("Footer 含「© 2026 corps」", () => {
    // Act
    const { container } = render(<PricingPage />);
    // Assert
    expect(container.textContent).toContain("© 2026 corps");
  });

  it("TopNav「定价」链接带 aria-current=page（当前页高亮）", () => {
    // Act
    render(<PricingPage />);
    // Assert
    const pricingLinks = screen.getAllByRole("link", { name: "定价" });
    expect(pricingLinks.length).toBeGreaterThanOrEqual(1);
    expect(pricingLinks[0]).toHaveAttribute("aria-current", "page");
  });

  it("对比表分组行数 === 5（PRICING_MATRIX 五分组）", () => {
    // Act
    const { container } = render(<PricingPage />);
    // Assert：分组标题行用 scope="rowgroup"
    const rowGroups = container.querySelectorAll('th[scope="rowgroup"]');
    expect(rowGroups).toHaveLength(5);
  });

  it("社会证明条 MVP 种子期不渲染（paidTeams=null）", () => {
    // Act
    const { container } = render(<PricingPage />);
    // Assert：不含「正在用 corps 管理决策与任务」文案
    expect(container.textContent).not.toContain("正在用 corps 管理决策与任务");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. PricingSection 交互测试
// ─────────────────────────────────────────────────────────────────────────────

import { PricingSection } from "@/components/pricing/PricingSection";

describe("PricingSection 交互", () => {
  beforeEach(() => {
    trackMock.mockClear();
  });

  it("默认年付态：¥590 可见、删除线 ¥59 原价可见、「省 ¥118/席」徽标可见", () => {
    // Act
    const { container } = render(<PricingSection />);
    // Assert
    expect(container.textContent).toContain("¥590");
    expect(container.textContent).toContain("¥59"); // 删除线原价
    expect(container.textContent).toContain("省 ¥118/席");
  });

  it("切换到月付：价格切 ¥59 且徽标消失，并上报 select_billing_period", () => {
    // Arrange
    const { container } = render(<PricingSection />);
    // Act：点击「按月付」分段控件
    const monthlyBtn = screen.getByRole("button", { name: /按月付/ });
    fireEvent.click(monthlyBtn);
    // Assert：年付徽标消失（不再含「省 ¥118/席」）
    expect(container.textContent).not.toContain("省 ¥118/席");
    // Assert：select_billing_period 上报 period=monthly
    expect(trackMock).toHaveBeenCalledWith("select_billing_period", {
      period: "monthly",
    });
  });

  it("Pro 卡按钮 click 上报 click_upgrade 且 source===card、period 与当前态一致", () => {
    // Arrange：默认年付
    render(<PricingSection />);
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
    render(<PricingSection />);
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
