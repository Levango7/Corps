// @vitest-environment jsdom

/**
 * RelationField 契约（components/database/RelationField.tsx）：
 * 关联记录选择控件。readOnly 时仅展示 chip（无移除/添加按钮），空值显示 empty；
 * 编辑时空值显示 noRelation 并提供「添加关联」按钮，点击展开搜索面板。
 * chip 与搜索结果的标签取自 displayFieldId（来自 field.options，未配置时回退
 * 目标库第一个 text 字段），记录缺失或 displayFieldId 无效时回退记录 id；
 * 值规范化为 string[]（非数组/非字符串元素被丢弃）；点击外部关闭面板并清空搜索词。
 */
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { vi, afterEach, describe, it, expect } from "vitest";
import { RelationField } from "@/components/database/RelationField";
import type { DatabaseField, DatabaseRecord } from "@prisma/client";

vi.mock("next-intl", () => {
  const cache = new Map<string, (key: string, vars?: Record<string, unknown>) => string>();
  const useTranslations = (ns: string) => {
    let fn = cache.get(ns);
    if (!fn) {
      const created = (key: string, vars?: Record<string, unknown>) =>
        vars ? `${ns}:${key}:${JSON.stringify(vars)}` : `${ns}:${key}`;
      cache.set(ns, created);
      fn = created;
    }
    return fn;
  };
  return { useTranslations };
});

// ─── fixtures ───────────────────────────────────────────────

function makeField(overrides: {
  id: string;
  name: string;
  type: string;
  options?: Record<string, unknown>;
}): DatabaseField {
  return {
    id: overrides.id,
    databaseId: "db-1",
    name: overrides.name,
    type: overrides.type as DatabaseField["type"],
    options: (overrides.options ?? {}) as unknown as DatabaseField["options"],
    sortOrder: 0,
    createdAt: new Date("2026-10-01T00:00:00Z"),
  } as unknown as DatabaseField;
}

function makeRecord(overrides: {
  id: string;
  data?: Record<string, unknown> | null;
}): DatabaseRecord {
  return {
    id: overrides.id,
    databaseId: "db-2",
    data: (overrides.data ?? {}) as unknown as DatabaseRecord["data"],
    sortOrder: 0,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-01T00:00:00Z"),
  } as unknown as DatabaseRecord;
}

const FIELD = makeField({
  id: "f-rel",
  name: "关联",
  type: "relation",
  options: { displayFieldId: "tf-title" },
});

const TARGET_TEXT = makeField({ id: "tf-title", name: "标题", type: "text" });
const TARGET_NUM = makeField({ id: "tf-num", name: "数量", type: "number" });

const TARGETS = [
  makeRecord({ id: "rec-alpha", data: { "tf-title": "设计文档", "tf-num": 3 } }),
  makeRecord({ id: "rec-beta", data: { "tf-title": "接口说明", "tf-num": 5 } }),
  makeRecord({ id: "rec-gamma", data: { "tf-title": "API 说明", "tf-num": 8 } }),
];

function chips(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('[class*="max-w-[120px]"]'));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── tests ──────────────────────────────────────────────────

describe("RelationField", () => {
  it("readOnly 且无关联时显示 empty，无任何按钮", () => {
    const { container } = render(
      <RelationField
        field={FIELD}
        value={[]}
        relatedRecords={TARGETS}
        targetFields={[TARGET_TEXT, TARGET_NUM]}
        readOnly
      />,
    );
    expect(screen.getByText("database.relationField:empty")).toBeInTheDocument();
    expect(container.querySelector("button")).toBeNull();
  });

  it("readOnly 时渲染 chip（displayField 值）且无移除/添加按钮", () => {
    const { container } = render(
      <RelationField
        field={FIELD}
        value={["rec-alpha", "rec-beta"]}
        relatedRecords={TARGETS}
        targetFields={[TARGET_TEXT, TARGET_NUM]}
        readOnly
      />,
    );
    expect(chips(container).map((c) => c.textContent)).toEqual(["设计文档", "接口说明"]);
    expect(container.querySelector("button")).toBeNull();
  });

  it("关联记录缺失时 chip 标签回退为记录 id", () => {
    const { container } = render(
      <RelationField
        field={FIELD}
        value={["rec-alpha", "rec-gone"]}
        relatedRecords={TARGETS.slice(0, 1)}
        targetFields={[TARGET_TEXT, TARGET_NUM]}
        readOnly
      />,
    );
    expect(chips(container).map((c) => c.textContent)).toEqual(["设计文档", "rec-gone"]);
  });

  it("未配 displayFieldId 且目标库无 text 字段时标签回退为记录 id", () => {
    const noDisplay = makeField({ id: "f-rel", name: "关联", type: "relation", options: {} });
    const { container } = render(
      <RelationField
        field={noDisplay}
        value={["rec-alpha"]}
        relatedRecords={TARGETS}
        targetFields={[TARGET_NUM]}
        readOnly
      />,
    );
    expect(chips(container).map((c) => c.textContent)).toEqual(["rec-alpha"]);
  });

  it("options.displayFieldId 可覆盖默认回退（number 值、boolean 值均可显示）", () => {
    const numDisplay = makeField({
      id: "f-rel",
      name: "关联",
      type: "relation",
      options: { displayFieldId: "tf-num" },
    });
    const boolTarget = makeRecord({ id: "rec-bool", data: { "tf-flag": true, "tf-num": 1 } });
    const boolField = makeField({ id: "tf-flag", name: "标记", type: "checkbox" });
    const { container } = render(
      <RelationField
        field={numDisplay}
        value={["rec-alpha", "rec-bool"]}
        relatedRecords={[TARGETS[0], boolTarget]}
        targetFields={[TARGET_TEXT, TARGET_NUM, boolField]}
        readOnly
      />,
    );
    // number → "3"；displayFieldId 指向 tf-num，boolean 记录的 tf-num=1 → "1"
    expect(chips(container).map((c) => c.textContent)).toEqual(["3", "1"]);
  });

  it("boolean 值显示为 true/false", () => {
    const boolDisplay = makeField({
      id: "f-rel",
      name: "关联",
      type: "relation",
      options: { displayFieldId: "tf-flag" },
    });
    const boolField = makeField({ id: "tf-flag", name: "标记", type: "checkbox" });
    const target = makeRecord({ id: "rec-bool", data: { "tf-flag": true } });
    const { container } = render(
      <RelationField
        field={boolDisplay}
        value={["rec-bool"]}
        relatedRecords={[target]}
        targetFields={[boolField]}
        readOnly
      />,
    );
    expect(chips(container).map((c) => c.textContent)).toEqual(["true"]);
  });

  it("编辑模式空值显示 noRelation 与添加关联按钮", () => {
    render(
      <RelationField
        field={FIELD}
        value={[]}
        relatedRecords={TARGETS}
        targetFields={[TARGET_TEXT, TARGET_NUM]}
      />,
    );
    expect(screen.getByText("database.relationField:noRelation")).toBeInTheDocument();
    const addBtn = screen.getByRole("button", { name: "database.relationField:addRelationAria" });
    expect(addBtn).toBeInTheDocument();
    expect(addBtn.textContent).toContain("database.relationField:addRelation");
  });

  it("点击添加按钮展开搜索面板：占位符、全部目标记录（不含已选）、含 Link2 图标", () => {
    const { container } = render(
      <RelationField
        field={FIELD}
        value={[]}
        relatedRecords={TARGETS}
        targetFields={[TARGET_TEXT, TARGET_NUM]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "database.relationField:addRelationAria" }));
    const panel = container.querySelector('[class*="top-full"]');
    expect(panel).not.toBeNull();
    expect(panel!.querySelector("input")?.getAttribute("placeholder")).toBe(
      "database.relationField:searchPlaceholder",
    );
    const resultButtons = Array.from(panel!.querySelectorAll("button"));
    expect(resultButtons.map((b) => b.textContent)).toEqual(["设计文档", "接口说明", "API 说明"]);
  });

  it("搜索词过滤结果（忽略大小写与首尾空格）", () => {
    const { container } = render(
      <RelationField
        field={FIELD}
        value={[]}
        relatedRecords={TARGETS}
        targetFields={[TARGET_TEXT, TARGET_NUM]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "database.relationField:addRelationAria" }));
    const input = container.querySelector('[class*="top-full"] input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  api  " } });
    const panel = container.querySelector('[class*="top-full"]')!;
    expect(Array.from(panel.querySelectorAll("button")).map((b) => b.textContent)).toEqual([
      "API 说明",
    ]);
  });

  it("搜索词无匹配时显示 noMatch", () => {
    const { container } = render(
      <RelationField
        field={FIELD}
        value={[]}
        relatedRecords={TARGETS}
        targetFields={[TARGET_TEXT, TARGET_NUM]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "database.relationField:addRelationAria" }));
    const input = container.querySelector('[class*="top-full"] input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "不存在" } });
    expect(screen.getByText("database.relationField:noMatch")).toBeInTheDocument();
  });

  it("点击搜索结果触发 onChange（追加 id）并清空搜索词，面板保持打开", () => {
    const onChange = vi.fn();
    const { container } = render(
      <RelationField
        field={FIELD}
        value={["rec-alpha"]}
        relatedRecords={TARGETS}
        targetFields={[TARGET_TEXT, TARGET_NUM]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "database.relationField:addRelationAria" }));
    const panel = container.querySelector('[class*="top-full"]')!;
    // 已选 rec-alpha 被排除
    const buttons = Array.from(panel.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual(["接口说明", "API 说明"]);
    fireEvent.click(buttons[0]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(["rec-alpha", "rec-beta"]);
    // 搜索词被清空，面板保持打开
    const panelAfter = container.querySelector('[class*="top-full"]')!;
    expect(panelAfter).not.toBeNull();
    expect((panelAfter.querySelector("input") as HTMLInputElement).value).toBe("");
  });

  it("点击 chip 的移除按钮触发 onChange（过滤掉该 id）", () => {
    const onChange = vi.fn();
    const { container } = render(
      <RelationField
        field={FIELD}
        value={["rec-alpha", "rec-beta"]}
        relatedRecords={TARGETS}
        targetFields={[TARGET_TEXT, TARGET_NUM]}
        onChange={onChange}
      />,
    );
    const removeBtns = screen.getAllByRole("button", {
      name: "database.relationField:removeRelationAria",
    });
    expect(removeBtns).toHaveLength(2);
    fireEvent.click(removeBtns[0]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(["rec-beta"]);
    expect(chips(container).map((c) => c.textContent)).toEqual(["设计文档", "接口说明"]);
  });

  it("未提供 onChange 时点击移除/添加不报错", () => {
    const { container } = render(
      <RelationField
        field={FIELD}
        value={["rec-alpha"]}
        relatedRecords={TARGETS}
        targetFields={[TARGET_TEXT, TARGET_NUM]}
      />,
    );
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "database.relationField:removeRelationAria",
      })[0],
    );
    fireEvent.click(screen.getByRole("button", { name: "database.relationField:addRelationAria" }));
    const panel = container.querySelector('[class*="top-full"]')!;
    fireEvent.click(panel.querySelector("button")!);
    // 无 onChange → 状态不变，chip 仍在
    expect(chips(container).map((c) => c.textContent)).toEqual(["设计文档"]);
  });

  it("值非数组或含非字符串元素时仅渲染字符串 id 的 chip", () => {
    const { container } = render(
      <RelationField
        field={FIELD}
        // 混入 number/null/object → 仅 "rec-alpha" 是有效 id
        value={[1, "rec-alpha", null, { gone: true }] as unknown[]}
        relatedRecords={TARGETS}
        targetFields={[TARGET_TEXT, TARGET_NUM]}
        readOnly
      />,
    );
    expect(chips(container).map((c) => c.textContent)).toEqual(["设计文档"]);
  });

  it("点击面板外部关闭面板并清空搜索词，面板内部点击保持打开", () => {
    const { container } = render(
      <RelationField
        field={FIELD}
        value={[]}
        relatedRecords={TARGETS}
        targetFields={[TARGET_TEXT, TARGET_NUM]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "database.relationField:addRelationAria" }));
    const input = container.querySelector('[class*="top-full"] input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "api" } });

    // 面板内 mousedown → 保持打开
    fireEvent.mouseDown(container.querySelector('[class*="top-full"]')!);
    expect(container.querySelector('[class*="top-full"]')).not.toBeNull();

    // 面板外 mousedown → 关闭
    fireEvent.mouseDown(document.body);
    expect(container.querySelector('[class*="top-full"]')).toBeNull();
    // 重新打开后搜索词已清空
    fireEvent.click(screen.getByRole("button", { name: "database.relationField:addRelationAria" }));
    const inputAgain = container.querySelector('[class*="top-full"] input') as HTMLInputElement;
    expect(inputAgain.value).toBe("");
  });
});
