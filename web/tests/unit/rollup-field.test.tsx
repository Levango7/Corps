// @vitest-environment jsdom

/**
 * RollupField 契约（components/database/RollupField.tsx）：
 * Rollup 聚合结果只读显示（async server component，经 next-intl/server 的
 * getTranslations 取文案）。null/undefined/""/[] 均为空值——显示 empty 文案、
 * 容器着 var(--muted)、带 Sigma 图标；number 整数直接显示、小数保留 2 位；
 * string 显示原文；string[] 用 ", " 连接。非空值的数值列带 truncate 与
 * text-[var(--fg)]，图标着 var(--meta)。
 */
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { vi, afterEach, describe, it, expect } from "vitest";
import { RollupField } from "@/components/database/RollupField";
import type { DatabaseField } from "@prisma/client";

vi.mock("next-intl/server", () => ({
  getTranslations: (ns: string) => Promise.resolve((key: string) => `${ns}:${key}`),
}));

// ─── fixtures ───────────────────────────────────────────────

function makeField(): DatabaseField {
  return {
    id: "f-roll",
    databaseId: "db-1",
    name: "汇总",
    type: "rollup",
    options: {} as unknown as DatabaseField["options"],
    sortOrder: 0,
    createdAt: new Date("2026-10-01T00:00:00Z"),
  } as unknown as DatabaseField;
}

/** server component 需先 await 拿到 element 再交给客户端 render */
async function renderRollup(value: number | string | string[] | null | undefined) {
  const el = await RollupField({
    field: makeField(),
    value: value as Parameters<typeof RollupField>[0]["value"],
  });
  return render(el);
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── tests ──────────────────────────────────────────────────

describe("RollupField", () => {
  it("null 显示 empty 文案、muted 色、Sigma 图标", async () => {
    const { container } = await renderRollup(null);
    expect(screen.getByText("database.rollupField:empty")).toBeInTheDocument();
    expect(container.querySelector("svg.lucide-sigma")).not.toBeNull();
    const holder = container.firstElementChild as HTMLElement;
    expect(holder.style.color).toBe("var(--muted)");
  });

  it("undefined 同样视为空值", async () => {
    const { container } = await renderRollup(undefined);
    expect(screen.getByText("database.rollupField:empty")).toBeInTheDocument();
    expect(container.querySelector("svg.lucide-sigma")).not.toBeNull();
  });

  it("空字符串显示 empty", async () => {
    await renderRollup("");
    expect(screen.getByText("database.rollupField:empty")).toBeInTheDocument();
  });

  it("空数组显示 empty", async () => {
    await renderRollup([]);
    expect(screen.getByText("database.rollupField:empty")).toBeInTheDocument();
  });

  it("整数直接显示", async () => {
    const { container } = await renderRollup(42);
    expect(screen.getByText("42")).toBeInTheDocument();
    const span = container.querySelector("span.truncate")!;
    expect(span.className).toContain("text-[var(--fg)]");
  });

  it("小数保留 2 位", async () => {
    await renderRollup(3.14159);
    expect(screen.getByText("3.14")).toBeInTheDocument();
  });

  it("文本原样显示", async () => {
    const { container } = await renderRollup("合计");
    expect(screen.getByText("合计")).toBeInTheDocument();
    expect(container.querySelector("span.truncate")?.textContent).toBe("合计");
  });

  it("字符串数组用 ', ' 连接", async () => {
    const { container } = await renderRollup(["甲", "乙", "丙"]);
    expect(screen.getByText("甲, 乙, 丙")).toBeInTheDocument();
    expect(container.querySelector("span.truncate")?.textContent).toBe("甲, 乙, 丙");
  });
});
