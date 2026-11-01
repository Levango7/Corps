import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CONTRAST_INJECT } from "../../e2e/visual-kit/contrast";

/**
 * 对比度内核（visual-kit/contrast.ts 注入串）的单测。
 *
 * 为什么单测要拿**注入串本身**而不是抄一份实现：抄一份就等于用另一套算式验这套算式，
 * 串改了测试还绿。这里用 new Function 把要发给浏览器的源码跑在测试进程里，
 * parse / alphaOf / contrast 三个纯函数不碰 DOM，可以直接调。
 *
 * 触发这层测试的真实缺陷（2026-11-02，路线 A）：alphaOf 第一版按「第四个数」取 alpha，
 * 而 Chromium 把 color-mix 序列化成 `color(srgb 0.94 0.96 0.97)` —— 那个 `srgb` 是个 token，
 * 于是四个片段里最后一个是**蓝通道**，矩阵于是宣称每个派生层都"半透明"。
 * 单靠 e2e 看不出来（告警文本也是它打的），所以在这里钉死。
 */

interface Kernel {
  lum(rgb: number[]): number;
  parse(s: string): number[] | null;
  alphaOf(s: string): number;
  contrast(a: string, b: string): number | null;
}

/** 在测试进程里装载注入串（document 只被 resolve() 用，这里给个空壳防误调用）。 */
function loadKernel(): Kernel {
  const win: { __vk?: Kernel } = {};
  const stubDocument = {
    createElement: () => ({
      style: { setProperty() {}, color: "" },
      remove() {},
    }),
    body: { appendChild() {} },
  };
  new Function("window", "document", CONTRAST_INJECT)(win, stubDocument);
  if (!win.__vk) throw new Error("注入串没有建立 window.__vk");
  return win.__vk;
}

const vk = loadKernel();

describe("contrast 内核 —— parse", () => {
  it("认得 hex 三种写法（corps 的令牌声明就是 hex，早期踩过只认 rgba 的坑）", () => {
    expect(vk.parse("#4263eb")).toEqual([66, 99, 235]);
    expect(vk.parse("#f4f4f1")).toEqual([244, 244, 241]);
    expect(vk.parse("#abc")).toEqual([170, 187, 204]);
  });

  it("认得 rgb() 的逗号式与空格式", () => {
    expect(vk.parse("rgb(66, 99, 235)")).toEqual([66, 99, 235]);
    expect(vk.parse("rgb(66 99 235)")).toEqual([66, 99, 235]);
    expect(vk.parse("rgba(66, 99, 235, 0.5)")).toEqual([66, 99, 235]);
  });

  it("认得 color(srgb …) —— 这是 Chromium 序列化 color-mix 的形式，派生层全靠它", () => {
    expect(vk.parse("color(srgb 1 0.5019607843 0.2509803922)")).toEqual([255, 128, 64]);
    expect(vk.parse("color(srgb 0.938431 0.960392 0.974118)")).toEqual([239, 245, 248]);
  });

  it("非色串返回 null，而且这个 null 是被「真色串能返回数组」对照出来的", () => {
    expect(vk.parse("not-a-color")).toBeNull();
    expect(vk.parse("")).toBeNull();
    // 反向对照：同一函数喂真色必须非空（防止 parse 整个坏掉也"通过"）
    expect(vk.parse("#ffffff")).toEqual([255, 255, 255]);
  });
});

describe("contrast 内核 —— alphaOf", () => {
  it("三个通道 / hex / color(srgb) 无 /a 都是实色（alpha=1）", () => {
    expect(vk.alphaOf("rgb(66, 99, 235)")).toBe(1);
    expect(vk.alphaOf("#fefefc")).toBe(1);
    // 这一条就是修「把 srgb 当通道值、于是蓝通道 0.974 被读成 alpha」的那个缺陷
    expect(vk.alphaOf("color(srgb 0.938431 0.960392 0.974118)")).toBe(1);
  });

  it("两种显式 alpha 写法都要取对", () => {
    expect(vk.alphaOf("rgba(66, 99, 235, 0.5)")).toBe(0.5);
    expect(vk.alphaOf("rgb(66 99 235 / 0.9)")).toBe(0.9);
    expect(vk.alphaOf("color(srgb 0.9 0.9 0.9 / 0.8)")).toBe(0.8);
  });

  it("color-mix 权重和不满时浏览器给的就是 alpha<1（A 之前的三层长这样）", () => {
    expect(vk.alphaOf("color(srgb 0.12 0.14 0.18 / 0.94)")).toBe(0.94);
    expect(vk.alphaOf("color(srgb 0.14 0.16 0.20 / 0.9)")).toBe(0.9);
  });
});

describe("contrast 内核 —— contrast", () => {
  it("黑白 = 21，同色 = 1", () => {
    expect(vk.contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(vk.contrast("#4263eb", "#4263eb")).toBeCloseTo(1, 5);
  });

  it("任一侧解析不出来返回 null（调用方必须判红，不许当通过）", () => {
    expect(vk.contrast("color-mix(in srgb, red 50%, blue)", "#ffffff")).toBeNull();
    expect(vk.contrast("#ffffff", "#ffffff")).not.toBeNull(); // 反向对照
  });

  it("实测值与既有基线同口径：meta 压在 surface 上是 2.80", () => {
    expect(vk.contrast("#9a9a96", "#fefefc")).toBeCloseTo(2.8, 1);
    expect(vk.contrast("#9a9a96", "color(srgb 0.938431 0.960392 0.974118)")).toBeCloseTo(2.57, 1);
  });
});

describe("配对清单的一致性（2026-11-02 起三份）", () => {
  /** 从源码里把 `"名字": ["--a", "--b"]` 这种**结构化行**的键抠出来（不做子串匹配）。 */
  function pairKeys(text: string): string[] {
    return [...text.matchAll(/^ {2}"([a-z0-9/_-]+)": \["--[a-z0-9-]+", "--[a-z0-9-]+"\],$/gm)].map(
      (m) => m[1],
    );
  }
  /** 基线表里的键：`"名字": 数字,`。 */
  function baselineKeys(block: string): string[] {
    return [...block.matchAll(/^ {4}"([a-z0-9/_-]+)": [0-9.]+,$/gm)].map((m) => m[1]);
  }

  const ROOT = resolve(process.cwd());
  const spec = readFileSync(resolve(ROOT, "e2e/contrast-matrix.spec.ts"), "utf8");
  const probe = readFileSync(resolve(ROOT, "e2e/visual-kit/contrast-probe.mjs"), "utf8");

  const specPairs = pairKeys(
    spec.slice(spec.indexOf("const CONTRAST_PAIRS"), spec.indexOf("const BASELINE")),
  );
  const probePairs = pairKeys(
    probe.slice(probe.indexOf("const PAIRS"), probe.indexOf("const browser")),
  );
  const lightBase = baselineKeys(spec.slice(spec.indexOf("  light: {"), spec.indexOf("  dark: {")));
  const darkBase = baselineKeys(
    spec.slice(spec.indexOf("  dark: {"), spec.indexOf("test.describe(")),
  );

  it("抠取本身有效（防「正则没命中任何东西」造成的假绿）", () => {
    expect(specPairs.length).toBeGreaterThanOrEqual(14);
    expect(probePairs.length).toBeGreaterThanOrEqual(14);
    expect(lightBase.length).toBe(specPairs.length);
  });

  it("spec 的配对集 = probe 的配对集（历史上漂过一次，红得莫名其妙）", () => {
    expect(probePairs.sort()).toEqual([...specPairs].sort());
  });

  it("light 与 dark 的基线键都齐（漏一套=那一套静默不判）", () => {
    expect([...lightBase].sort()).toEqual([...specPairs].sort());
    expect([...darkBase].sort()).toEqual([...specPairs].sort());
  });
});
