// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

/**
 * 多维表格「建字段 / 建视图 / 删记录」三个入口的行为契约。
 *
 * 起因（2026-10-05 实测）：8 个 database 端点里 fields POST、views POST、
 * records DELETE 全都存在，但全仓客户端只在「建库」时硬编码 type:"text" 与
 * "table"，事后没有任何 UI 能加列、加视图或删行 —— 属于"能力存在但没通电"。
 * 本文件钉住补上的入口，并特意钉住两件事：
 *  1. 没给回调就不渲染按钮（避免出现点了没反应的死按钮）；
 *  2. 可建类型只开放 query-engine 真能算的 9 种（防止建出渲染得出来却算不动的死字段）。
 */

type AnyProps = Record<string, unknown>;
const captured: Record<string, AnyProps> = {};

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}:${key}`,
}));

// 只关心编辑器把回调传到哪去，视图本体用桩替换（TableView 另有一档测试）
vi.mock("@/components/database/TableView", () => ({
  TableView: (props: AnyProps) => {
    captured.tableView = props;
    return <div data-testid="stub-table-view" />;
  },
}));
vi.mock("@/components/database/BoardView", () => ({
  BoardView: () => <div data-testid="stub-board" />,
}));
vi.mock("@/components/database/GanttView", () => ({
  GanttView: () => <div data-testid="stub-gantt" />,
}));
vi.mock("@/components/database/CalendarView", () => ({
  CalendarView: () => <div data-testid="stub-calendar" />,
}));

import { DatabaseEditor } from "@/components/database/DatabaseEditor";

const database = { id: "db1", title: "表", emoji: null } as never;
const field = { id: "f1", name: "标题", type: "text", sortOrder: 0 } as never;
const view = { id: "v1", name: "表格", type: "table", config: {}, sortOrder: 0 } as never;

function renderEditor(props: Record<string, unknown> = {}) {
  return render(
    <DatabaseEditor
      database={database}
      fields={[field]}
      records={[]}
      views={[view]}
      currentViewId="v1"
      {...props}
    />,
  );
}

beforeEach(() => {
  captured.tableView = undefined as unknown as AnyProps;
});

afterEach(() => {
  cleanup();
});

describe("多维表格三个入口", () => {
  it("未提供回调时不渲染新建视图与字段管理按钮（避免死按钮）", () => {
    renderEditor();
    expect(screen.queryByRole("button", { name: /addView/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /fields/ })).not.toBeInTheDocument();
  });

  it("新建视图：填名 + 选类型 → 回调收到 {name,type}，且默认不提交空名", () => {
    const onViewCreate = vi.fn();
    renderEditor({ onViewCreate });
    fireEvent.click(screen.getByRole("button", { name: /addView/ }));
    const form = screen.getByTestId("create-view-form");
    const submit = screenWithin(form, "create");
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/newViewNameAria/), {
      target: { value: "看板视图" },
    });
    fireEvent.change(screen.getByLabelText(/newViewTypeAria/), { target: { value: "board" } });
    fireEvent.click(submit);

    expect(onViewCreate).toHaveBeenCalledWith({ name: "看板视图", type: "board" });
    // 提交成功后面板收起，名字清空
    expect(screen.queryByTestId("create-view-form")).not.toBeInTheDocument();
  });

  it("字段管理：只开放 query-engine 支持的 9 种类型，不含 formula/relation/rollup", () => {
    const onFieldCreate = vi.fn();
    renderEditor({ onFieldCreate });
    fireEvent.click(screen.getByRole("button", { name: /fields/ }));

    const select = screen.getByLabelText(/newFieldTypeAria/) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toHaveLength(9);
    expect(options).toEqual(
      expect.arrayContaining(["text", "number", "select", "multiselect", "checkbox"]),
    );
    for (const dead of ["formula", "relation", "rollup"]) {
      expect(options).not.toContain(dead);
    }

    fireEvent.change(screen.getByLabelText(/newFieldNameAria/), {
      target: { value: "工时" },
    });
    fireEvent.change(select, { target: { value: "number" } });
    fireEvent.click(screenWithin(screen.getByTestId("fields-panel"), "create"));

    expect(onFieldCreate).toHaveBeenCalledWith({ name: "工时", type: "number" });
  });

  it("删记录回调会透传给 TableView", () => {
    const onRecordDelete = vi.fn();
    renderEditor({ onRecordDelete });
    expect(captured.tableView?.onRecordDelete).toBe(onRecordDelete);
  });

  it("不提供 onRecordDelete 时 TableView 收到 undefined（行首列不加宽）", () => {
    renderEditor();
    expect(captured.tableView?.onRecordDelete).toBeUndefined();
  });
});

/** 面板内可能有多个同名按钮，用局部查询避免跨面板误命中 */
function screenWithin(container: HTMLElement, key: string) {
  const btn = Array.from(container.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes(key),
  );
  if (!btn) throw new Error(`未找到含 ${key} 的按钮`);
  return btn;
}
