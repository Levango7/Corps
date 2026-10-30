// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  exportDecisionsCsv,
  exportTasksCsv,
  type CsvDecision,
  type CsvTask,
} from "@/lib/csv-export";

/**
 * CSV 导出契约（lib/csv-export.ts）：
 *  - RFC 4180：字段含逗号/引号/换行时双引号包裹、内部引号双写
 *  - 首字符 UTF-8 BOM（\uFEFF）保证 Excel 中文不乱码
 *  - 行分隔 CRLF；文件名 corps-{slug}-{kind}-YYYYMMDD-HHMM.csv
 *  - 触发浏览器下载（Blob + a[download]），URL 延迟 revoke 防泄漏
 *
 * 捕获方式：mock URL.createObjectURL 拿到 Blob 本体（jsdom 的 Blob.text() 可读回）。
 */
let captured: { blob: Blob; filename: string }[];

beforeEach(() => {
  captured = [];
  let n = 0;
  // jsdom 不实现 URL.createObjectURL —— 直接定义在构造函数上，捕获 Blob 本体
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn((obj: Blob) => {
      captured.push({ blob: obj, filename: "" });
      return `blob:mock-${n++}`;
    }),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(() => {}),
  });
  // 拦截锚点点击：document.createElement 造出的 a[download] 在 click 时记录文件名
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    if (captured.length) captured[captured.length - 1].filename = this.download;
  });
});

describe("exportTasksCsv", () => {
  const tasks: CsvTask[] = [
    {
      id: "t1",
      title: '含,逗号 与 "引号" 的标题',
      status: "todo",
      assigneeName: "张三",
      dueDate: "2026-11-01T00:00:00.000Z",
      createdAt: "2026-10-01T00:00:00.000Z",
    },
    {
      id: "t2",
      title: "换行\n标题",
      status: "done",
      assigneeName: null,
      dueDate: null,
      createdAt: "2026-10-02T00:00:00.000Z",
    },
  ];

  it("BOM + 表头 + 转义：逗号/引号/换行字段按 RFC 4180 处理，空指派与空日期留空", async () => {
    exportTasksCsv(tasks, "ws-a");
    expect(captured).toHaveLength(1);
    // Blob.text() 会吃掉 UTF-8 BOM（TextDecoder 默认行为）——字节级检查 BOM
    const bytes = new Uint8Array(await captured[0].blob.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = await captured[0].blob.text();
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("标题,状态,指派人,截止日期,创建日期");
    expect(lines[1]).toContain('"含,逗号 与 ""引号"" 的标题"');
    expect(lines[2].startsWith('"换行\n标题",done,,')).toBe(true);
  });

  it("文件名：corps-{slug}-tasks-YYYYMMDD-HHMM.csv", () => {
    exportTasksCsv(tasks, "my-ws");
    expect(captured[0].filename).toMatch(/^corps-my-ws-tasks-\d{8}-\d{4}\.csv$/);
  });

  it("空列表：仍产出表头行（BOM + header + 无数据行）", async () => {
    exportTasksCsv([], "ws");
    const bytes = new Uint8Array(await captured[0].blob.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = await captured[0].blob.text();
    expect(csv).toBe("标题,状态,指派人,截止日期,创建日期");
  });
});

describe("exportDecisionsCsv", () => {
  const decisions: CsvDecision[] = [
    {
      id: "d1",
      taskTitle: "任务一",
      markdown: "## 决定\n先做 A，再做 B",
      authorName: "李四",
      createdAt: "2026-10-03T00:00:00.000Z",
    },
  ];

  it("表头与字段：决策内容中的换行被引号包裹", async () => {
    exportDecisionsCsv(decisions, "ws-b");
    const csv = await captured[0].blob.text();
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("任务标题,决策内容,作者,时间");
    expect(csv).toContain('"## 决定\n先做 A，再做 B"');
  });

  it("文件名：corps-{slug}-decisions-*.csv", () => {
    exportDecisionsCsv(decisions, "ws-b");
    expect(captured[0].filename).toMatch(/^corps-ws-b-decisions-\d{8}-\d{4}\.csv$/);
  });

  it("作者为 null → 空字段", async () => {
    exportDecisionsCsv([{ ...decisions[0], authorName: null }], "ws");
    const csv = await captured[0].blob.text();
    expect(csv.slice(1).split("\r\n")[1]).toContain("任务一,");
    expect(csv).not.toContain("null");
  });
});
