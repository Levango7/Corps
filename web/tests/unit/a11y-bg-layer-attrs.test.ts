// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  BG_ATTR_LINE_CAP,
  BG_ATTR_VALUE_CAP,
  collectBgLayers,
  formatBgLayer,
} from "../../e2e/a11y-axe-keys";

/**
 * 背景层取数（`collectBgLayers` + `formatBgLayer`）的单测。
 *
 * 触发这层的真实缺陷（2026-11-03，路线 B 收口时）：归因 2 条 `color-contrast` 时我读了
 * axe 的 `relatedNodes[].html`，而 **axe 自己**会把每个属性值截到 ~24 字符再补省略号
 * （本机探针：class 254 字符 + style 82 字符的一条按钮，交来的整段只有 92 字符，
 * 两个属性都被截）。我照那份截断读数写下「选中态按钮内联 style 绕过令牌」——
 * 真相是 `style="… background: var(--accent-soft) …"`，颜色走的就是令牌。
 * 所以补一条**不被截断**的通道，并让它可测：投进页面的函数就是这里导入的这个，
 * jsdom 跑的是 shipped 代码本身，不是它的抄本。
 *
 * 断言对着五类失效设计：
 *  ① 属性值被再次截短（那这条通道与 bgHtml 没区别）
 *  ② 选择器查不到时静默省略该层 → "没采到" 被读成 "没有这一层"
 *  ③ 伪元素后缀直接当选择器查（querySelector 抛错，整批采数消失）
 *  ④ 输出条数与输入层数不等（`.filter` 掉一层）→ 由近及远的对应关系断掉
 *  ⑤ 空属性列表渲染出 `<div >` 这类带杂散空格的形状
 */

function mount(html: string): void {
  document.body.innerHTML = html;
}

describe("collectBgLayers：按 axe 的选择器回查真 DOM", () => {
  it("属性值原样给出，不被截断——这是它相对 bgHtml 的唯一存在理由", () => {
    const longStyle =
      "border-color: var(--accent); background: var(--accent-soft); color: var(--accent);";
    const longClass = `w-full sm:flex-1 flex flex-col items-center gap-2 py-2.5 ${"x".repeat(180)}`;
    mount(`<button aria-pressed="true" class="${longClass}" style="${longStyle}">密度</button>`);

    const [layer] = collectBgLayers(["button"]);
    expect(layer?.resolved).toBe(true);
    expect(layer?.tag).toBe("BUTTON");
    const style = layer?.attrs?.find(([k]) => k === "style")?.[1];
    /* 截断回归位：axe 会把这段截成 "border-color: var(--..."（24 字符） */
    expect(style).toBe(longStyle);
    expect(style && style.length).toBeGreaterThan(80);
    const cls = layer?.attrs?.find(([k]) => k === "class")?.[1];
    expect(cls && cls.length).toBe(longClass.length);
  });

  it("查不到的选择器留一条 resolved:false，并带上原选择器（不静默省略）", () => {
    mount("<button id=ok>x</button>");
    const layers = collectBgLayers(["#ok", "#not-here"]);
    expect(layers).toHaveLength(2);
    expect(layers[0]?.resolved).toBe(true);
    expect(layers[1]).toEqual({ sel: "#not-here", resolved: false });
  });

  it("伪元素后缀：拿宿主元素、把后缀记进 pseudo，并且不硬报底色", () => {
    mount('<span class="tip" style="background-color: rgb(235, 238, 250)">t</span>');
    const [layer] = collectBgLayers([".tip::before"]);
    expect(layer?.resolved).toBe(true);
    expect(layer?.pseudo).toBe("::before");
    /* 伪元素的画刷不在宿主 style 里，宁可留空也不要一个"看起来对"的底色 */
    expect(layer?.computedBg).toBeUndefined();
  });

  it("非法选择器不炸整批：querySelector 抛错也落进 resolved:false", () => {
    mount("<p>a</p>");
    const layers = collectBgLayers(["..bad..", "p"]);
    expect(layers).toHaveLength(2);
    expect(layers[0]?.resolved).toBe(false);
    expect(layers[1]?.resolved).toBe(true);
  });

  it("输出条数与输入严格相等（由近及远的顺序是这数据的含义）", () => {
    mount('<div class="a"><div class="b">x</div></div>');
    const layers = collectBgLayers([".missing", ".a", ".b"]);
    expect(layers.map((l) => l.sel)).toEqual([".missing", ".a", ".b"]);
    expect(layers.map((l) => l.resolved)).toEqual([false, true, true]);
  });

  it("computed 底色从渲染后的样式里取（页内真值，不是声明原文）", () => {
    mount('<section style="background-color: rgb(235, 238, 250)">s</section>');
    const [layer] = collectBgLayers(["section"]);
    expect(layer?.computedBg).toBe("rgb(235, 238, 250)");
  });
});

describe("formatBgLayer：把回查结果摊成一行", () => {
  it("resolved:false 单独成一条文案，读的人不会把它当成「没有这层」", () => {
    expect(formatBgLayer({ sel: ".gone", resolved: false })).toBe(".gone => 回查不到元素");
  });

  it("空属性列表不出杂散空格", () => {
    expect(formatBgLayer({ sel: "div", resolved: true, tag: "DIV" })).toBe("<div>");
    expect(formatBgLayer({ sel: "div", resolved: true, tag: "DIV", attrs: [] })).toBe("<div>");
  });

  it("单个属性值过长按 BG_ATTR_VALUE_CAP 截，整条过长按 BG_ATTR_LINE_CAP 截", () => {
    const fat = formatBgLayer({
      sel: "button",
      resolved: true,
      tag: "BUTTON",
      attrs: [["style", "y".repeat(BG_ATTR_VALUE_CAP + 500)]],
    });
    expect(fat).toContain("…");
    expect(fat.length).toBeLessThanOrEqual(BG_ATTR_VALUE_CAP + 30);

    const many = formatBgLayer({
      sel: "button",
      resolved: true,
      tag: "BUTTON",
      attrs: Array.from({ length: 12 }, (_, i) => [`data-a${i}`, "z".repeat(90)]),
    });
    expect(many.length).toBeLessThanOrEqual(BG_ATTR_LINE_CAP + 1);
  });

  it("伪元素与 computed 底色各占一个标记，顺序是 tag → pseudo → bg", () => {
    expect(
      formatBgLayer({
        sel: ".tip::before",
        resolved: true,
        tag: "SPAN",
        pseudo: "::before",
        attrs: [["class", "tip"]],
      }),
    ).toBe('<span class="tip"> [::before]');
    expect(
      formatBgLayer({
        sel: ".card",
        resolved: true,
        tag: "SECTION",
        attrs: [["class", "card"]],
        computedBg: "rgb(235, 238, 250)",
      }),
    ).toBe('<section class="card"> [bg=rgb(235, 238, 250)]');
  });
});
