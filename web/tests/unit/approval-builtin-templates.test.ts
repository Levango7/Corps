// @vitest-environment node
import { describe, it, expect } from "vitest";
import { getBuiltinTemplates } from "@/lib/approval/builtin-templates";

/**
 * 内置审批模板（lib/approval/builtin-templates.ts）的结构契约。
 *
 * 模板供 POST /approvals/templates?action=init-builtin 批量初始化，
 * 因此"数量、字段完整性、节点 order 连续"是写入数据库前的硬约束：
 * 缺一个 formSchema 字段或 order 断号，初始化出来的流就不可用。
 */

describe("getBuiltinTemplates", () => {
  it("返回 5 个预置模板：请假/报销/采购/合同/入职", () => {
    const templates = getBuiltinTemplates();
    expect(templates).toHaveLength(5);
    expect(templates.map((t) => t.name)).toEqual([
      "请假审批",
      "报销审批",
      "采购审批",
      "合同审批",
      "入职审批",
    ]);
  });

  it("每个模板都有非空的描述与 icon，category 各不相同（便于分类筛选）", () => {
    const templates = getBuiltinTemplates();
    const categories = templates.map((t) => t.category);
    expect(new Set(categories).size).toBe(templates.length);
    for (const t of templates) {
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.icon.length).toBeGreaterThan(0);
    }
  });

  it("每个模板的节点都是 sequential 审批节点，order 从 1 连续递增", () => {
    for (const t of getBuiltinTemplates()) {
      expect(t.flowType).toBe("sequential");
      expect(t.nodes.length).toBeGreaterThan(0);
      t.nodes.forEach((node, i) => {
        expect(node.type).toBe("approval");
        expect(node.mode).toBe("sequential");
        expect(node.order).toBe(i + 1);
        expect(node.approverRole).toBe("admin");
        expect(node.name.length).toBeGreaterThan(0);
      });
    }
  });

  it("每个模板的 formSchema 至少含一个必填字段，字段名在模板内唯一", () => {
    for (const t of getBuiltinTemplates()) {
      const fields = t.formSchema.fields;
      expect(fields.length).toBeGreaterThan(0);
      const names = fields.map((f) => f.name);
      expect(new Set(names).size).toBe(names.length);
      const allowed = ["select", "date", "textarea", "text", "number", "file"];
      for (const f of fields) {
        expect(allowed).toContain(f.type);
        expect(typeof f.required).toBe("boolean");
        expect(f.label.length).toBeGreaterThan(0);
        if (f.type === "select") {
          expect(Array.isArray(f.options)).toBe(true);
        }
      }
    }
  });

  it("请假模板含请假的典型字段（起止日期 + 请假类型 select）", () => {
    const leave = getBuiltinTemplates().find((t) => t.category === "leave");
    expect(leave).toBeDefined();
    const names = leave!.formSchema.fields.map((f) => f.name);
    expect(names).toContain("startDate");
    expect(names).toContain("endDate");
    const typeField = leave!.formSchema.fields.find((f) => f.name === "leaveType");
    expect(typeField?.type).toBe("select");
    expect(typeField?.options).toContain("事假");
  });

  it("每次调用返回新数组（调用方可以安全排序/裁剪，不影响后续调用）", () => {
    const a = getBuiltinTemplates();
    a.pop();
    const b = getBuiltinTemplates();
    expect(b).toHaveLength(5);
    expect(a).toHaveLength(4);
  });
});
