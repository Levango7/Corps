// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

/**
 * 注册表 + 团队负载契约：
 *  - components/dashboard/widgets/index.tsx：widgetId → 组件/图标/标题 key 三查表；
 *    未知 id 一律回退（组件 → 占位、图标 → BarChart3、标题 → unknownWidget）
 *  - components/dashboard/widgets/TeamLoadWidget.tsx：按 total 降序、四档色阶阈值、
 *    负载条按状态分段且宽度归一化、缺名回退邮箱且头像取首字母大写
 */
const h = vi.hoisted(() => ({ useWidgetData: vi.fn() }));

vi.mock("@/components/dashboard/widgets/useWidgetData", () => ({
  useWidgetData: h.useWidgetData,
}));

// widgets/index.tsx 会把全部 Widget 组件拉进模块图，其中列表型 Widget 引用了
// `@/lib/i18n-navigation`（→ next-intl/navigation → next/navigation，裸 vitest 解析不了）。
vi.mock("@/lib/i18n-navigation", async () => {
  const React = await import("react");
  type LinkProps = { href: string; className?: string; children?: React.ReactNode };
  const Link = React.forwardRef<HTMLAnchorElement, LinkProps>((props, ref) =>
    React.createElement("a", { href: props.href, className: props.className, ref }, props.children),
  );
  Link.displayName = "MockLink";
  return { Link };
});

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}:${key}:${JSON.stringify(vars)}` : `${ns}:${key}`,
}));

import { BarChart3, TrendingDown, PieChart } from "lucide-react";
import {
  getWidgetComponent,
  getWidgetIcon,
  getWidgetTitleKey,
} from "@/components/dashboard/widgets";
import TeamLoadWidget from "@/components/dashboard/widgets/TeamLoadWidget";

beforeEach(() => {
  h.useWidgetData.mockReset();
});

describe("widget 注册表", () => {
  it("已注册 id：图标与标题 key 一一对应", () => {
    expect(getWidgetIcon("burndown")).toBe(TrendingDown);
    expect(getWidgetIcon("priority-dist")).toBe(PieChart);
    expect(getWidgetTitleKey("gantt-chart")).toBe("ganttChart");
    expect(getWidgetTitleKey("milestone-timeline")).toBe("milestoneTimeline");
    expect(getWidgetTitleKey("custom-chart")).toBe("customChart");
    expect(getWidgetTitleKey("task-stats")).toBe("taskStats");
  });

  it("未知 id：图标回退 BarChart3、标题回退 unknownWidget", () => {
    expect(getWidgetIcon("no-such-widget")).toBe(BarChart3);
    expect(getWidgetTitleKey("no-such-widget")).toBe("unknownWidget");
  });

  it("未知 id 的组件：渲染占位文案而不是崩溃", () => {
    const Fallback = getWidgetComponent("no-such-widget");
    const { getByText } = render(<Fallback wid="w1" />);
    expect(getByText("dashboard:unknownWidget")).toBeTruthy();
  });

  it("已注册 id 的组件：取到真实组件而非占位", () => {
    const Comp = getWidgetComponent("recent-activity");
    h.useWidgetData.mockReturnValue({
      data: { items: [] },
      loading: false,
      error: null,
      retry: vi.fn(),
    });
    const { getByText } = render(<Comp wid="w1" />);
    expect(getByText("dashboard:recentActivityEmpty")).toBeTruthy();
    expect(h.useWidgetData).toHaveBeenCalledWith("w1", "recent-activity");
  });
});

describe("TeamLoadWidget", () => {
  const member = (id: string, total: number, name: string | null = null) => ({
    userId: id,
    name,
    email: `${id}@example.com`,
    role: "member" as const,
    load: { todo: total, in_progress: 0, review: 0, done: 0, total },
  });

  it("loading：5 行骨架；空态文案", () => {
    h.useWidgetData.mockReturnValue({ data: null, loading: true, error: null, retry: vi.fn() });
    const { container, rerender } = render(<TeamLoadWidget wid="w1" />);
    expect(container.querySelectorAll(".shimmer").length).toBe(5);
    expect(h.useWidgetData).toHaveBeenCalledWith("w1", "team-load");

    h.useWidgetData.mockReturnValue({
      data: { items: [] },
      loading: false,
      error: null,
      retry: vi.fn(),
    });
    rerender(<TeamLoadWidget wid="w1" />);
    expect(container.textContent).toContain("dashboard:teamLoadEmpty");
  });

  it("按 total 降序、最多 8 行、缺名回退邮箱、首字母大写", () => {
    const items = [
      member("u5", 5, "zoe"),
      member("u2", 12),
      member("u1", 0, "amy"),
      member("u3", 7, "bob"),
      member("u4", 3, "cat"),
      member("u6", 8, "dan"),
      member("u7", 9, "eve"),
      member("u8", 1, "fay"),
      member("u9", 20, "gil"),
    ];
    h.useWidgetData.mockReturnValue({
      data: { items },
      loading: false,
      error: null,
      retry: vi.fn(),
    });
    const { container } = render(<TeamLoadWidget wid="w1" />);

    const totals = Array.from(container.querySelectorAll("span.tabular-nums")).map(
      (s) => s.textContent,
    );
    // 先按 total 降序再截前 8：最小的 0 被挤出
    expect(totals).toEqual(["20", "12", "9", "8", "7", "5", "3", "1"]);
    // 缺名回退邮箱 + 首字母大写
    expect(container.textContent).toContain("u2@example.com");
    expect(container.textContent).toContain("Z");
    expect(container.textContent).toContain("gil");
    expect(container.textContent).not.toContain("amy");
  });

  it("四档色阶阈值：<=2 成功色、<=5 主色、<=8 警告色、其余危险色", () => {
    const items = [member("a", 2), member("b", 5), member("c", 8), member("d", 9)];
    h.useWidgetData.mockReturnValue({
      data: { items },
      loading: false,
      error: null,
      retry: vi.fn(),
    });
    const { container } = render(<TeamLoadWidget wid="w1" />);

    const avatars = Array.from(container.querySelectorAll("span.rounded-full[title]"));
    const colors = avatars.map((a) => a.getAttribute("style"));
    expect(colors[0]).toContain("--danger");
    expect(colors[1]).toContain("--warn");
    expect(colors[2]).toContain("--accent");
    expect(colors[3]).toContain("--success");
  });

  it("负载条：零计数不分段，宽度按 total 归一化", () => {
    h.useWidgetData.mockReturnValue({
      data: {
        items: [
          {
            userId: "u1",
            name: "混合",
            email: "mix@example.com",
            role: "member" as const,
            load: { todo: 2, in_progress: 0, review: 1, done: 1, total: 4 },
          },
        ],
      },
      loading: false,
      error: null,
      retry: vi.fn(),
    });
    const { container } = render(<TeamLoadWidget wid="w1" />);

    // in_progress=0 不出段 → 3 段
    const bar = container.querySelector("div.flex.h-2");
    const segs = Array.from(bar?.children ?? []);
    expect(segs.length).toBe(3);
    expect(segs.map((s) => (s as HTMLElement).style.width)).toEqual(["50%", "25%", "25%"]);
    // 图例四档
    for (const range of ["0-2", "3-5", "6-8", "9+"]) {
      expect(container.textContent).toContain(range);
    }
  });
});
