/**
 * 独立 HTML 调色板（web/lib/html-palette.ts）单测
 *
 * 这份测试存在的理由不是"给新文件凑覆盖率"（那会撞 zero-coverage 棘轮），
 * 而是**钉死本 PR 的结论**：邮件/导出调色板只有一个真源，三份副本不会漂移。
 *
 * 三层断言，逐层收紧：
 *   1. 防漂移（本 PR 的核心）：三个邮件模板 + 导出路由必须引用
 *      EMAIL_COLORS / EXPORT_COLORS，**源码里不得再出现任何 hex 字面量**，
 *      且四处引用的是同一个模块路径。这条断言正是"三份副本会漂移"这个缺陷的
 *      回归闸门——当初没人能发现漂移，就是因为没有任何一处断言它们必须同源。
 *   2. 格式：全部是 3 位或 6 位小写 hex——邮件与导出 HTML 里只认这种字面量，
 *      混进 `rgb()` / 8 位 hex 会在 Outlook 系客户端上静默失效。
 *   3. 键集合：14 / 9 个键名逐个列出，多一个少一个都要有意识地改这份清单。
 *
 * ⚠️ 刻意**没有**写"23 个色值逐条快照"那层断言。原因：那份快照的信息与
 * `lib/html-palette.ts` 自身完全重复（一个 23 行的文件，改任何一个值都会暴露在
 * diff 首屏），却要在测试里把 23 个 hex 复述一遍——而 P0-4 门禁扫的是 web 下全部
 * ts/tsx（**连测试文件都不豁免**），于是这 23 个复述会以"新增硬编码色值"的名义再登记
 * 23 条基线。那是把"去重"做成"搬家"，净收益为负。
 * 真正值钱的回归风险是**副本漂移**，那由第 1 层断言（同源 + 零残留）覆盖：
 * 源码里一个 hex 都不剩，产物里的色就只能来自调色板这一处。
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EMAIL_COLORS, EXPORT_COLORS } from "@/lib/html-palette";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, "../..");

const EMAIL_TEMPLATE_FILES = [
  "lib/email.ts",
  "lib/ai/push-email.ts",
  "lib/notification/offline-push.ts",
] as const;
const EXPORT_ROUTE_FILE = "app/api/v1/workspaces/[wid]/documents/batch-export/route.ts";

function readWeb(rel: string): string {
  return readFileSync(join(WEB, rel), "utf8");
}

/** hex 色值字面量；与 P0-4 门禁同一口径：前面不能紧跟 [0-9A-Za-z_-] */
const HEX_RE = /(?<![0-9A-Za-z_-])#[0-9a-fA-F]{3,8}\b/g;
/** P0-4 白名单：#fff / #ffffff / #000 / #000000（大小写不敏感） */
const HEX_WHITELIST = new Set(["#fff", "#ffffff", "#000", "#000000"]);

function hexHits(src: string): string[] {
  return (src.match(HEX_RE) ?? []).filter((h) => !HEX_WHITELIST.has(h.toLowerCase()));
}

const IMPORT_EMAIL_RE = /import\s*\{[^}]*\bEMAIL_COLORS\b[^}]*\}\s*from\s*"@\/lib\/html-palette"/;
const IMPORT_EXPORT_RE = /import\s*\{[^}]*\bEXPORT_COLORS\b[^}]*\}\s*from\s*"@\/lib\/html-palette"/;

describe("EMAIL_COLORS —— 邮件调色板键集合", () => {
  it("键集合恰好 14 个（多一个少一个都要有意识地改这份清单）", () => {
    expect(Object.keys(EMAIL_COLORS).sort()).toEqual(
      [
        "accentFg",
        "bodyFg",
        "border",
        "ctaBg",
        "footerFg",
        "footnoteFg",
        "infoBg",
        "noteFg",
        "overdueFg",
        "pageBg",
        "quoteBg",
        "quoteFg",
        "titleFg",
        "warnBg",
      ].sort(),
    );
  });
});

describe("EXPORT_COLORS —— 导出调色板键集合", () => {
  it("键集合恰好 9 个", () => {
    expect(Object.keys(EXPORT_COLORS).sort()).toEqual(
      [
        "border",
        "link",
        "metaFg",
        "quoteBar",
        "quoteFg",
        "rowBorder",
        "surface",
        "text",
        "thBorder",
      ].sort(),
    );
  });
});

describe("色值格式", () => {
  it("每个值都是 3 位或 6 位小写 hex（邮件/导出 HTML 只认这种字面量）", () => {
    for (const [k, v] of Object.entries({ ...EMAIL_COLORS, ...EXPORT_COLORS })) {
      expect(v, `${k} = ${v} 不是合法的 hex 字面量`).toMatch(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
    }
  });

  it("两个调色板没有重复值被拆成两个键（同一色只应有一处定义）", () => {
    // 例外：那支蓝色在邮件里是 CTA 底色、在导出里是链接色，属两套互不相关的
    // 产物，各自保留语义键比跨产物共用更清晰；跨产物共用反而会在改其一的时候
    // 误伤其二。这里只约束**同一调色板内部**不重复。
    for (const [name, palette] of [
      ["EMAIL_COLORS", EMAIL_COLORS],
      ["EXPORT_COLORS", EXPORT_COLORS],
    ] as const) {
      const values = Object.values(palette);
      expect(new Set(values).size, `${name} 内部存在重复色值`).toBe(values.length);
    }
  });
});

describe("防漂移：模板必须引用调色板，不得再写自己的 hex", () => {
  it.each(EMAIL_TEMPLATE_FILES)("%s 引用 EMAIL_COLORS 且不再含 hex 字面量", (rel) => {
    const src = readWeb(rel);
    // 1) 确实引入了同一个真源（不是各写各的）
    expect(src).toMatch(IMPORT_EMAIL_RE);
    // 2) 源码里一个 hex 都不剩（#ffffff 属 P0-4 白名单，允许保留）
    expect(hexHits(src), `${rel} 仍残留硬编码色值，应改用 EMAIL_COLORS`).toEqual([]);
  });

  it("三个邮件模板引用的是同一个 EMAIL_COLORS（同一模块路径）", () => {
    const paths = EMAIL_TEMPLATE_FILES.map((rel) => {
      const m = readWeb(rel).match(/from\s+"([^"]*html-palette)"/);
      expect(m, `${rel} 未引用 html-palette`).not.toBeNull();
      return m![1];
    });
    expect(new Set(paths), `三处引用路径不一致：${paths.join(" / ")}`).toEqual(
      new Set(["@/lib/html-palette"]),
    );
  });

  it(`${EXPORT_ROUTE_FILE} 引用 EXPORT_COLORS 且不再含 hex 字面量`, () => {
    const src = readWeb(EXPORT_ROUTE_FILE);
    expect(src).toMatch(IMPORT_EXPORT_RE);
    expect(hexHits(src)).toEqual([]);
  });

  it("批量导出渲染出的 CSS 里不含 var()（独立文档拿不到 CSS 自定义属性）", () => {
    // 守的是"为什么这里是字面量"这个论证：一旦有人把 EXPORT_COLORS 换成
    // var(--token)，导出物在脱离本站 CSS 后就是一屏无色。这条断言把理由钉在测试里。
    for (const v of Object.values({ ...EMAIL_COLORS, ...EXPORT_COLORS })) {
      expect(v.startsWith("var(")).toBe(false);
    }
  });
});

describe("渲染产物（端到端接线）", () => {
  it("AI 推送邮件渲染出的色值确实来自 EMAIL_COLORS", async () => {
    const { renderPushEmailHtml } = await import("@/lib/ai/push-email");
    const html = renderPushEmailHtml({
      title: "t",
      summary: "s",
      workspaceUrl: "https://example.com/w",
    });
    // 渲染产物里的色值必须**逐字等于**调色板常量——不是"长得像 hex"就算过，
    // 那样就算有人把 push-email 改回自己的字面量也照样绿。
    expect(html).toContain(`background:${EMAIL_COLORS.pageBg}`);
    expect(html).toContain(`color:${EMAIL_COLORS.titleFg}`);
    expect(html).toContain(`border:1px solid ${EMAIL_COLORS.border}`);
    expect(html).toContain(`color:${EMAIL_COLORS.bodyFg}`);
    expect(html).toContain(`background:${EMAIL_COLORS.ctaBg}`);
    expect(html).toContain(`color:${EMAIL_COLORS.footerFg}`);
  });

  /**
   * 比"产物里有这些色"更强的不变式：**产物里的每一个 hex 都必须来自调色板**。
   *
   * 上面那组 toContain 只证明"该在的在"，不证明"不该在的不在"——有人留着
   * `import EMAIL_COLORS` 却又在模板里手写一个红色字面量，上面六条照样全绿。
   * 这条断言从产物反向收口：扫出渲染结果里的全部 hex，逐个查是否属于调色板
   * 取值集合，另外界外一个都容不下。
   *
   * 这也替代了原先"23 个值逐条快照"的作用（理由见文件头）：快照锁的是常量值，
   * 这条锁的是**产物与常量的同源关系**，后者才是副本漂移的真正回归点。
   */
  it("产物里的每一个 hex 都来自调色板，界外一个都不容", async () => {
    const { renderPushEmailHtml } = await import("@/lib/ai/push-email");
    const html = renderPushEmailHtml({
      title: "t",
      summary: "s",
      workspaceUrl: "https://example.com/w",
    });

    const allowed = new Set(
      [...Object.values(EMAIL_COLORS), ...Object.values(EXPORT_COLORS)].map((v) => v.toLowerCase()),
    );
    const found = hexHits(html).map((h) => h.toLowerCase());

    // 先证明提取本身有效，否则"界外为空"可能只是因为一个都没扫到
    expect(found.length, "产物里没扫到任何色值，说明提取逻辑失效了").toBeGreaterThan(0);

    expect(
      [...new Set(found)].filter((h) => !allowed.has(h)),
      "产物里出现了不属于调色板的色值——应改用 EMAIL_COLORS 的键",
    ).toEqual([]);
  });
});
