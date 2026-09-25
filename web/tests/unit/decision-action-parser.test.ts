import { describe, it, expect } from "vitest";
import {
  parseActionItems,
  ACTION_TEMPLATES,

} from "@/lib/decision-action-parser";

describe("parseActionItems", () => {
  it("解析未勾选的行动项", () => {
    const md = `- [ ] @alice 2024-01-15 完成设计`;
    const items = parseActionItems(md);
    expect(items).toHaveLength(1);
    expect(items[0].checked).toBe(false);
    expect(items[0].assigneeName).toBe("alice");
    expect(items[0].dueDate).toBe("2024-01-15");
    expect(items[0].title).toBe("完成设计");
  });

  it("解析已勾选的行动项", () => {
    const md = `- [x] @bob 2024-02-01 完成开发`;
    const items = parseActionItems(md);
    expect(items).toHaveLength(1);
    expect(items[0].checked).toBe(true);
  });

  it("大写 X 也识别为已勾选", () => {
    const md = `- [X] @bob 2024-02-01 完成开发`;
    const items = parseActionItems(md);
    expect(items[0].checked).toBe(true);
  });

  it("无 @指派人 且无日期的行不触发", () => {
    const md = `- [ ] 普通待办事项`;
    const items = parseActionItems(md);
    expect(items).toHaveLength(0);
  });

  it("只有 @指派人 也触发", () => {
    const md = `- [ ] @alice 完成评审`;
    const items = parseActionItems(md);
    expect(items).toHaveLength(1);
    expect(items[0].assigneeName).toBe("alice");
    expect(items[0].dueDate).toBeNull();
  });

  it("只有日期也触发", () => {
    const md = `- [ ] 2024-03-01 完成测试`;
    const items = parseActionItems(md);
    expect(items).toHaveLength(1);
    expect(items[0].assigneeName).toBeNull();
    expect(items[0].dueDate).toBe("2024-03-01");
  });

  it("解析优先级标签", () => {
    const md = `- [ ] @alice 2024-01-15 完成设计 #high`;
    const items = parseActionItems(md);
    expect(items[0].priority).toBe("high");
  });

  it("默认优先级为 medium", () => {
    const md = `- [ ] @alice 2024-01-15 完成设计`;
    const items = parseActionItems(md);
    expect(items[0].priority).toBe("medium");
  });

  it("支持所有优先级级别", () => {
    for (const prio of ["low", "medium", "high", "urgent"] as const) {
      const md = `- [ ] @alice 2024-01-15 任务 #${prio}`;
      const items = parseActionItems(md);
      expect(items[0].priority).toBe(prio);
    }
  });

  it("优先级标签大写也识别", () => {
    const md = `- [ ] @alice 2024-01-15 任务 #HIGH`;
    const items = parseActionItems(md);
    expect(items[0].priority).toBe("high");
  });

  it("多行混合解析", () => {
    const md = `
## 执行计划

- [ ] @alice 2024-01-15 完成设计 #high
- [x] @bob 2024-02-01 完成开发 #medium
- [ ] 普通待办（不触发）
- [ ] @charlie 2024-03-01 完成测试 #low
`;
    const items = parseActionItems(md);
    expect(items).toHaveLength(3);
    expect(items[0].assigneeName).toBe("alice");
    expect(items[1].checked).toBe(true);
    expect(items[2].assigneeName).toBe("charlie");
  });

  it("lineIndex 正确记录行号", () => {
    const md = `\n\n- [ ] @alice 2024-01-15 任务`;
    const items = parseActionItems(md);
    expect(items[0].lineIndex).toBe(2);
  });

  it("标题为空时使用默认标题", () => {
    const md = `- [ ] @alice 2024-01-15`;
    const items = parseActionItems(md);
    expect(items[0].title).toBe("未命名行动项");
  });

  it("标题清理：去除多余空格", () => {
    const md = `- [ ] @alice   2024-01-15   完成   设计   #high`;
    const items = parseActionItems(md);
    expect(items[0].title).toBe("完成 设计");
  });

  it("空字符串返回空数组", () => {
    expect(parseActionItems("")).toEqual([]);
  });

  it("无行动项的文本返回空数组", () => {
    expect(parseActionItems("普通文本\n更多文本")).toEqual([]);
  });
});

describe("ACTION_TEMPLATES", () => {
  it("包含 4 个预定义模板", () => {
    expect(ACTION_TEMPLATES).toHaveLength(4);
  });

  it("每个模板有 id, name, description, markdown", () => {
    for (const t of ACTION_TEMPLATES) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.markdown).toBeTruthy();
    }
  });

  it("模板 markdown 中包含 {dueDate} 占位符", () => {
    for (const t of ACTION_TEMPLATES) {
      expect(t.markdown).toContain("{dueDate}");
    }
  });

  it("模板 id 唯一", () => {
    const ids = ACTION_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});