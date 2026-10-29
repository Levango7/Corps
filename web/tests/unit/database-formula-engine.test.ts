// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  evaluateFormula,
  validateFormula,
  extractFieldReferences,
  FormulaError,
} from "@/lib/database/formula-engine";

/**
 * 公式引擎（lib/database/formula-engine.ts）的语法与求值契约。
 *
 * 引擎是手写递归下降解析器（禁止 eval/Function，防注入），
 * 契约重点不是"哪个数字算出来是多少"，而是：
 *  - 每种公开语法都能被解析并正确求值（字段引用/字面量/运算/三元/方法/函数）
 *  - 非法语法抛 FormulaError（而不是静默返回 null）
 *  - extractFieldReferences 在表达式不完整时仍能工作（编辑过程实时提示依赖）
 */

describe("evaluateFormula —— 字段引用与字面量", () => {
  it("中文字段引用求值", () => {
    expect(evaluateFormula("{{单价}} * {{数量}}", { 单价: 10, 数量: 3 })).toBe(30);
  });

  it('字符串字面量与转义 \\n \t \\\\ \\"', () => {
    expect(evaluateFormula('"hello"', {})).toBe("hello");
    expect(evaluateFormula('"a\\nb"', {})).toBe("a\nb");
    expect(evaluateFormula('"a\\tb"', {})).toBe("a\tb");
    expect(evaluateFormula('"a\\\\b"', {})).toBe("a\\b");
    expect(evaluateFormula('"a\\"b"', {})).toBe('a"b');
  });

  it("数字字面量：整数、小数、负数", () => {
    expect(evaluateFormula("123", {})).toBe(123);
    expect(evaluateFormula("3.14", {})).toBe(3.14);
    expect(evaluateFormula("-5", {})).toBe(-5);
  });

  it("布尔与 null 字面量", () => {
    expect(evaluateFormula("true", {})).toBe(true);
    expect(evaluateFormula("false", {})).toBe(false);
    expect(evaluateFormula("null", {})).toBeNull();
  });

  it("上下文中缺失的字段求值为 null（不抛错，交给比较运算处理）", () => {
    expect(evaluateFormula("{{不存在}}", {})).toBeNull();
  });
});

describe("evaluateFormula —— 运算符", () => {
  it("算术 + - * / % 与优先级（先乘除后加减）", () => {
    expect(evaluateFormula("2 + 3 * 4", {})).toBe(14);
    expect(evaluateFormula("(2 + 3) * 4", {})).toBe(20);
    expect(evaluateFormula("10 % 3", {})).toBe(1);
    expect(evaluateFormula("10 / 4", {})).toBe(2.5);
  });

  it("比较 == != > < >= <=", () => {
    expect(evaluateFormula("1 == 1", {})).toBe(true);
    expect(evaluateFormula("1 != 1", {})).toBe(false);
    expect(evaluateFormula("2 > 1", {})).toBe(true);
    expect(evaluateFormula("2 < 1", {})).toBe(false);
    expect(evaluateFormula("2 >= 2", {})).toBe(true);
    expect(evaluateFormula("2 <= 1", {})).toBe(false);
  });

  it("逻辑 && || ! 与短路", () => {
    expect(evaluateFormula("true && false", {})).toBe(false);
    expect(evaluateFormula("true || false", {})).toBe(true);
    expect(evaluateFormula("!true", {})).toBe(false);
    expect(evaluateFormula("!{{done}}", { done: false })).toBe(true);
  });

  it('字符串与数字比较（{{状态}} == "done" 形态）', () => {
    expect(evaluateFormula('{{状态}} == "done"', { 状态: "done" })).toBe(true);
    expect(evaluateFormula('{{状态}} == "done"', { 状态: "pending" })).toBe(false);
  });
});

describe("evaluateFormula —— 三元与方法/函数", () => {
  it("三元条件返回对应分支", () => {
    expect(evaluateFormula('{{状态}} == "done" ? "完成" : "进行中"', { 状态: "done" })).toBe(
      "完成",
    );
    expect(evaluateFormula('{{状态}} == "done" ? "完成" : "进行中"', { 状态: "todo" })).toBe(
      "进行中",
    );
  });

  it("字符串方法 .length / .toUpperCase() / .toLowerCase()", () => {
    expect(evaluateFormula("{{名称}}.length", { 名称: "hello" })).toBe(5);
    expect(evaluateFormula("{{名称}}.toUpperCase()", { 名称: "abc" })).toBe("ABC");
    expect(evaluateFormula("{{名称}}.toLowerCase()", { 名称: "ABC" })).toBe("abc");
  });

  it("数学函数 round / floor / ceil / abs / min / max", () => {
    expect(evaluateFormula("round(2.5)", {})).toBe(3);
    expect(evaluateFormula("round(2.4)", {})).toBe(2);
    expect(evaluateFormula("floor(2.9)", {})).toBe(2);
    expect(evaluateFormula("ceil(2.1)", {})).toBe(3);
    expect(evaluateFormula("abs(-7)", {})).toBe(7);
    expect(evaluateFormula("min(1, 2)", {})).toBe(1);
    expect(evaluateFormula("max(1, 2)", {})).toBe(2);
  });

  it("函数嵌套字段引用：round({{金额}} * 1.1)", () => {
    expect(evaluateFormula("round({{金额}} * 1.1)", { 金额: 9 })).toBe(10);
  });
});

describe("evaluateFormula —— 错误处理", () => {
  it("非法语法抛 FormulaError", () => {
    expect(() => evaluateFormula("{{单价}} *", {})).toThrow(FormulaError);
    expect(() => evaluateFormula("1 +", {})).toThrow(FormulaError);
    expect(() => evaluateFormula("(1 + 2", {})).toThrow(FormulaError);
  });

  it("未知函数名抛 FormulaError（白名单：只能调用预定义数学函数）", () => {
    expect(() => evaluateFormula("exec(' rm -rf ')", {})).toThrow(FormulaError);
  });

  it("FormulaError 带错误位置（position 为字符偏移）", () => {
    try {
      evaluateFormula("{{单价}} *", {});
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(FormulaError);
      expect((e as FormulaError).position).toBeTypeOf("number");
    }
  });
});

describe("validateFormula", () => {
  it("合法表达式返回 null", () => {
    expect(validateFormula("{{单价}} * {{数量}}")).toBeNull();
    expect(validateFormula('{{状态}} == "done" ? "通过" : "待办"')).toBeNull();
  });

  it("非法表达式返回错误消息字符串（不是 null、不是抛错）", () => {
    const msg = validateFormula("{{单价}} *");
    expect(msg).not.toBeNull();
    expect(typeof msg).toBe("string");
    expect(msg!.length).toBeGreaterThan(0);
  });
});

describe("extractFieldReferences", () => {
  it("去重并保持首次出现顺序", () => {
    expect(extractFieldReferences("{{单价}} * {{数量}} + {{单价}}")).toEqual(["单价", "数量"]);
  });

  it("只需要词法提取：表达式不完整时仍能返回已识别的字段", () => {
    expect(extractFieldReferences("{{状态}} ==")).toEqual(["状态"]);
    expect(extractFieldReferences("{{单价}} *")).toEqual(["单价"]);
  });

  it("无字段引用返回空数组", () => {
    expect(extractFieldReferences("1 + 2")).toEqual([]);
  });

  it("词法错误（未闭合的字段引用）返回空数组而不抛错", () => {
    expect(extractFieldReferences("{{未闭合")).toEqual([]);
  });
});
