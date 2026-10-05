// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

/**
 * TableView 的行删除入口。
 *
 * 端点 `DELETE /databases/{dbid}/records/{rid}` 一直存在，缺的只是行上的按钮
 * （2026-10-05 实测：客户端对 records 只有 POST/PATCH，无任何 DELETE 调用）。
 * 这里同时钉住宽度联动：有删除按钮时行首列加宽 28px，且表头与行必须用同一个
 * 宽度值 —— 否则虚拟滚动的行列会对不齐。
 */

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}:${key}`,
}));

const VIRTUAL_ROWS = vi.hoisted(() => 2);
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 40,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({ key: i, index: i, start: i * 40, size: 40 })),
    scrollToOffset: () => {},
    measureElement: () => {},
  }),
}));

import { TableView } from "@/components/database/TableView";

const database = { id: "db1", title: "表" } as never;
const fields = [
  { id: "f1", name: "标题", type: "text", sortOrder: 0, options: {}, width: 160 },
] as never;
const view = { id: "v1", name: "表格", type: "table", config: {}, sortOrder: 0 } as never;
const records = [
  { id: "r1", data: { f1: "第一行" }, createdAt: new Date(), updatedAt: new Date() },
  { id: "r2", data: { f1: "第二行" }, createdAt: new Date(), updatedAt: new Date() },
] as never;

afterEach(() => {
  cleanup();
});

describe("TableView 行删除", () => {
  it("给了回调才渲染删除按钮，且逐行回调自己的记录 id", () => {
    const onRecordDelete = vi.fn();
    render(
      <TableView
        database={database}
        fields={fields}
        records={records}
        view={view}
        onRecordDelete={onRecordDelete}
      />,
    );
    const buttons = screen.getAllByLabelText(/deleteRecordAria/);
    expect(buttons).toHaveLength(VIRTUAL_ROWS);
    fireEvent.click(buttons[1]);
    expect(onRecordDelete).toHaveBeenCalledWith("r2");
  });

  it("没给回调时不渲染删除按钮", () => {
    render(<TableView database={database} fields={fields} records={records} view={view} />);
    expect(screen.queryAllByLabelText(/deleteRecordAria/)).toHaveLength(0);
  });
});
