import { describe, it, expect } from "vitest";
import {
  collectKeys,
  diffBaseline,
  normalizeSelector,
  violationKey,
} from "../../e2e/a11y-axe-keys";

/**
 * axe 基线归一化与 diff 的单测。
 *
 * 这些函数决定 e2e 的 axe 门禁是否可信：
 *  - 归一化过头 → 真实违规被抹平（假绿）
 *  - 归一化不足 → 基线天天飘（红到没人看，等于没门禁）
 *  - diff 少了 stale 判定 → 修好的违规留在基线里，豁免清单只增不减
 * 所以每条断言都对着这四类失效之一。
 */

describe("normalizeSelector", () => {
  it("去掉位置伪类（列表第几项对「哪个组件违规」没有信息量）", () => {
    expect(normalizeSelector("ul > li:nth-child(3) > button")).toBe("ul > li > button");
    expect(normalizeSelector("tbody > tr:nth-of-type(12) > td")).toBe("tbody > tr > td");
  });

  it("动态 id 与长数字归一（列表长度/计数文案不该让基线漂）", () => {
    expect(normalizeSelector("#row-3f2a9c1b-77de > span")).toBe("#row-{id} > span");
    expect(normalizeSelector("p:has-text('共 1234 条')")).toBe("p:has-text('共 {n} 条')");
  });

  it("短数字与语义部分保留（npm 版本号、aria-label 顺序等仍可比）", () => {
    expect(normalizeSelector("input[aria-label='第 7 项']")).toBe("input[aria-label='第 7 项']");
    expect(normalizeSelector("a[href='/w/ab12/docs']")).toBe("a[href='/w/ab12/docs']");
  });

  it("类名与 role 原样保留 —— 这是定位组件的唯一线索", () => {
    expect(normalizeSelector("div.card.text-sm[role='dialog']")).toBe(
      "div.card.text-sm[role='dialog']",
    );
  });
});

describe("collectKeys", () => {
  it("把多节点违规摊平，并按「路由 :: 规则 :: 选择器」拼键", () => {
    const keys = collectKeys("/w/:wid/tasks", [
      { id: "color-contrast", impact: "serious", nodes: [{ target: ["button.primary"] }] },
      {
        id: "label",
        impact: "critical",
        nodes: [{ target: ["input#q"] }, { target: ["select.filter"] }],
      },
    ]);
    expect(keys).toEqual([
      "/w/:wid/tasks :: color-contrast :: button.primary",
      "/w/:wid/tasks :: label :: input#q",
      "/w/:wid/tasks :: label :: select.filter",
    ]);
  });

  it("同一规则同一选择器出现多次只留一条（去重后排序稳定）", () => {
    const keys = collectKeys("/login", [
      { id: "label", nodes: [{ target: ["input"] }, { target: ["input"] }] },
      { id: "label", nodes: [{ target: ["input"] }] },
    ]);
    expect(keys).toEqual(["/login :: label :: input"]);
  });

  it("同一节点被不同规则命中要分别计数（不能按选择器合并）", () => {
    const keys = collectKeys("/login", [
      { id: "label", nodes: [{ target: ["input#email"] }] },
      { id: "color-contrast", nodes: [{ target: ["input#email"] }] },
    ]);
    expect(keys).toHaveLength(2);
  });

  it("target 为数组时用空格连接（axe 的选择器链语义）", () => {
    expect(collectKeys("/x", [{ id: "r", nodes: [{ target: ["main", "ul", "li"] }] }])).toEqual([
      "/x :: r :: main ul li",
    ]);
  });
});

describe("diffBaseline", () => {
  it("新出现的键进 added（这是必须红的那个方向）", () => {
    const d = diffBaseline(["a", "b"], ["a", "b", "c"]);
    expect(d.added).toEqual(["c"]);
    expect(d.stale).toEqual([]);
  });

  it("基线里多出来的键进 stale（修好后不摘基线也要红）", () => {
    const d = diffBaseline(["a", "b", "c"], ["a", "b"]);
    expect(d.added).toEqual([]);
    expect(d.stale).toEqual(["c"]);
  });

  it("完全一致时两侧都空（控制组：不能恒红）", () => {
    expect(diffBaseline(["a", "b"], ["b", "a"])).toEqual({ added: [], stale: [] });
  });

  it("顺序不影响判定（两边都当集合比）", () => {
    expect(diffBaseline(["b", "a"], ["a", "b"])).toEqual({ added: [], stale: [] });
  });

  it("空基线 + 有违规 = 全新增（防「基线缺失被当成通过」）", () => {
    expect(diffBaseline([], ["x"]).added).toEqual(["x"]);
  });
});

describe("violationKey", () => {
  it("三段用 ' :: ' 连接，便于按前缀切片统计", () => {
    expect(violationKey("/w/:wid", "label", "input#q")).toBe("/w/:wid :: label :: input#q");
  });
});
