import { describe, expect, it } from "vitest";
import { collectDetails, collectKeys, type AxeViolationLike } from "../../e2e/a11y-axe-keys";

/**
 * axe 现场数据摊平的单测。
 *
 * 这份数据是「axe 基线按根因收窄」的取证通道：基线键只到"哪条规则的哪个位置"，
 * 而选择器是 axe 挑的**最小唯一**类集合，里面没出色令牌 ≠ 该元素不经过令牌。
 * 2026-10-31 归因 `--meta` 那批时，27 条 color-contrast 静态只能核到 15 条，
 * 余 12 条卡在继承色查不到 —— 所以把这些数打进日志/落盘，归因才不用猜。
 *
 * 断言对着五类失效设计：
 *  ① 键算得和 collectKeys 不一致 → 现场数据挂不到任何基线项上（等于没采）
 *  ② 只翻 node.any → 落在 failed/all/none 的取色数据被读成空（假阴性）
 *  ③ 同键多节点时取第一条 → 最差项被藏起来，"修好了"是假的
 *  ④ 空 violations 也返回 {} → 夹具没执行过的那一行会被当成"通过"
 *  ⑤ relatedNodes 读错层（挂在节点上而非 check 上）→ bgNodes 恒空但测试仍绿。
 *     这一条是本会话真踩过的：第一版夹具照着我脑中的形状写在节点上，CI 产物 27 条
 *     bgNodes 全空。所以除了"真形状能用"，还留了一条"假形状不能用"的反向对照。
 */

/**
 * 复刻一次真实形状。三点按 axe 的实际输出：
 *  - `target` 是**跨 frame 的数组**，同页面里只有一段，段内已经是 `a > b > c` 整串
 *    （基线键里看到的 ` > ` 就来自这里，不是数组拼出来的）
 *  - 字段名逐字抄 axe-core 4.14.0 `colorContrastEvaluate` 的 `this.data(...)`
 *  - `relatedNodes` 在 **check** 上，每条含 `target` 与 `html`（复现：真浏览器里渲染一层
 *    半透明底，把 `violations[0].nodes[0]` 整坨 dump 出来——节点顶层没有这个键）
 */
function contrastViolation(nodes: AxeViolationLike["nodes"]): AxeViolationLike[] {
  return [{ id: "color-contrast", impact: "serious", nodes }];
}

function colorData(over: Record<string, unknown> = {}) {
  return {
    fgColor: "#9a9a96",
    bgColor: "#f4f4f1",
    contrastRatio: 2.56,
    fontSize: "9.0pt (12px)",
    fontWeight: "normal",
    messageKey: undefined,
    expectedContrastRatio: "4.5:1",
    ...over,
  };
}

describe("collectDetails —— 键的一致性", () => {
  it("每条基线键都有现场数据，且键集与 collectKeys 完全相同", () => {
    const violations = contrastViolation([
      {
        target: ["kbd"],
        impact: "serious",
        any: [
          {
            id: "color-contrast",
            message: "Elements must have sufficient contrast",
            data: colorData(),
          },
        ],
      },
    ]);
    const keys = collectKeys("/w/:wid/board", violations);
    const details = collectDetails("/w/:wid/board", violations);
    expect(keys).toEqual(["/w/:wid/board :: color-contrast :: kbd"]);
    expect(Object.keys(details).sort()).toEqual(keys);
  });

  it("非对比度规则也进同一套键（只有 message，没有色值）", () => {
    const violations: AxeViolationLike[] = [
      {
        id: "button-name",
        impact: "critical",
        nodes: [
          {
            target: ["main > button"],
            any: [
              {
                id: "button-name",
                message: "Button must have a non-empty accessible name",
                data: null,
              },
            ],
          },
        ],
      },
    ];
    const details = collectDetails("/login", violations);
    const key = "/login :: button-name :: main > button";
    expect(Object.keys(details)).toEqual([key]);
    expect(details[key].rule).toBe("button-name");
    expect(details[key].impact).toBe("critical");
    expect(details[key].message).toContain("accessible name");
    expect(details[key].fgColor).toBeUndefined();
  });

  it("空 violations 返回空集，且这个空集是被「真的有条目的用例」对照出来的", () => {
    expect(collectDetails("/login", [])).toEqual({});
    // 反向对照：同样形状但真有一条，必须非空（防止上面的断言靠"函数根本没跑"通过）
    const one = collectDetails(
      "/login",
      contrastViolation([
        { target: ["a"], any: [{ id: "color-contrast", message: "m", data: colorData() }] },
      ]),
    );
    expect(Object.keys(one)).toHaveLength(1);
  });
});

describe("collectDetails —— 取色数据", () => {
  it("读齐 axe 给的八个数（少一个就是「采了但没用上」）", () => {
    const details = collectDetails(
      "/w/:wid/settings",
      contrastViolation([
        {
          target: [".lg\\:flex > nav > div"],
          impact: "moderate",
          any: [
            {
              id: "color-contrast",
              message: "Fix any of the following",
              data: colorData({ contrastRatio: 2.8, fgColor: "#9a9a96", bgColor: "#fefefc" }),
            },
          ],
        },
      ]),
    );
    const d = details["/w/:wid/settings :: color-contrast :: .lg\\:flex > nav > div"];
    expect(d.fgColor).toBe("#9a9a96");
    expect(d.bgColor).toBe("#fefefc");
    expect(d.contrastRatio).toBe(2.8);
    expect(d.expectedContrastRatio).toBe("4.5:1");
    expect(d.fontSize).toBe("9.0pt (12px)");
    expect(d.fontWeight).toBe("normal");
    expect(d.rule).toBe("color-contrast");
    expect(d.impact).toBe("moderate");
  });

  it("failed / all / none 三组里的取色数据一样要读到（只翻 any 就会假阴性）", () => {
    const cases: Array<[string, AxeViolationLike["nodes"][0]]> = [
      [
        "failed",
        {
          target: ["p"],
          failed: [
            { id: "color-contrast", message: "m", data: colorData({ contrastRatio: 1.11 }) },
          ],
        },
      ],
      [
        "all",
        {
          target: ["p"],
          all: [{ id: "color-contrast", message: "m", data: colorData({ contrastRatio: 1.22 }) }],
        },
      ],
      [
        "none",
        {
          target: ["p"],
          none: [{ id: "color-contrast", message: "m", data: colorData({ contrastRatio: 1.33 }) }],
        },
      ],
    ];
    for (const [group, node] of cases) {
      const details = collectDetails("/login", contrastViolation([node]));
      expect(details["/login :: color-contrast :: p"], `组=${group}`).toBeDefined();
      expect(details["/login :: color-contrast :: p"].bgColor, `组=${group}`).toBe("#f4f4f1");
    }
  });

  it("归一化并到同一条键的多个节点，取最差比值（取第一条会把坏的那个藏起来）", () => {
    const violations = contrastViolation([
      {
        target: ["ul > li:nth-child(3) > span"],
        any: [{ id: "color-contrast", message: "m", data: colorData({ contrastRatio: 3.1 }) }],
      },
      {
        target: ["ul > li:nth-child(7) > span"],
        any: [{ id: "color-contrast", message: "m", data: colorData({ contrastRatio: 2.45 }) }],
      },
    ]);
    const keys = collectKeys("/w/:wid/im", violations);
    expect(keys).toHaveLength(1); // 归一化后两条并成一条
    const details = collectDetails("/w/:wid/im", violations);
    expect(Object.values(details)).toHaveLength(1);
    expect(details[keys[0]].contrastRatio).toBe(2.45);
  });

  it("check.relatedNodes 带进 bgNodes + bgHtml：背景是叠加出来时，只看 bgColor 说不清谁画的", () => {
    const longHtml = `<section class="shell">${"内容".repeat(200)}</section>`;
    const details = collectDetails(
      "/w/:wid/documents",
      contrastViolation([
        {
          target: ["section > p"],
          any: [
            {
              id: "color-contrast",
              message: "m",
              data: colorData(),
              relatedNodes: [
                { target: [".shell"], html: longHtml },
                { target: [["html", "body"]], html: '<body class="dark"></body>' },
                { target: [], html: "<div></div>" },
              ],
            },
          ],
        },
      ]),
    );
    const d = details["/w/:wid/documents :: color-contrast :: section > p"];
    expect(d.bgNodes).toEqual([".shell", "html body"]);
    // 只取最近那一层的 outerHTML，且截到 200 字符（列表项整坨文案塞进来的话产物没法看）
    expect(d.bgHtml).toHaveLength(200);
    expect(d.bgHtml).toBe(longHtml.slice(0, 200));
  });

  it("把 relatedNodes 挂在节点上（我第一版的错形状）不会产出 bgNodes —— 反向对照", () => {
    // 这条断言的意义是"读错层就采不到"，而不是"读错层也能凑出东西"。
    // axe 4.14.0 节点顶层实测只有 all/any/failureSummary/html/impact/none/target。
    const node = {
      target: ["section > p"],
      any: [{ id: "color-contrast", message: "m", data: colorData() }],
    } as AxeViolationLike["nodes"][0] & { relatedNodes?: unknown };
    node.relatedNodes = [{ target: ["section"] }, { target: ["body"] }];
    const details = collectDetails("/w/:wid/documents", contrastViolation([node]));
    const d = details["/w/:wid/documents :: color-contrast :: section > p"];
    expect(d.bgNodes).toBeUndefined();
    expect(d.bgHtml).toBeUndefined();
  });

  it("bgNodes 空字符串段被丢掉（relatedNodes 有 target 但为空的层不进产物）", () => {
    const details = collectDetails(
      "/login",
      contrastViolation([
        {
          target: ["p"],
          any: [
            {
              id: "color-contrast",
              message: "m",
              data: colorData(),
              relatedNodes: [{ target: ["body"] }, { target: [] }],
            },
          ],
        },
      ]),
    );
    expect(details["/login :: color-contrast :: p"].bgNodes).toEqual(["body"]);
  });

  it("messageKey 原样带出（equalRatio / shortTextContent 这类值本身不可信的情况要看得见）", () => {
    const details = collectDetails(
      "/login",
      contrastViolation([
        {
          target: ["span"],
          any: [
            {
              id: "color-contrast",
              message: "m",
              data: { bgColor: "#fefefc", messageKey: "shortTextContent", contrastRatio: 1 },
            },
          ],
        },
      ]),
    );
    const d = details["/login :: color-contrast :: span"];
    expect(d.messageKey).toBe("shortTextContent");
    expect(d.bgColor).toBe("#fefefc");
    expect(d.fgColor).toBeUndefined();
  });

  it("非色形状的 data 不会被当成取色数据（防止把别的 check 的字段读成颜色）", () => {
    const details = collectDetails(
      "/login",
      contrastViolation([
        {
          target: ["div"],
          any: [{ id: "aria-prohibited-attr", message: "m", data: { role: null } }],
        },
      ]),
    );
    const d = details["/login :: color-contrast :: div"];
    expect(d.rule).toBe("color-contrast");
    expect(d.fgColor).toBeUndefined();
    expect(d.bgColor).toBeUndefined();
    expect(d.contrastRatio).toBeUndefined();
  });
});
