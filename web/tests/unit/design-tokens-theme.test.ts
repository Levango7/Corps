import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const tailwindEntry = require.resolve("@tailwindcss/postcss");
const postcss = require(require.resolve("postcss", { paths: [dirname(tailwindEntry)] })) as (
  plugins: unknown[],
) => {
  process: (css: string, options: { from: string }) => Promise<{ css: string }>;
};
const tailwindcss = require("@tailwindcss/postcss") as (options: {
  base: string;
  optimize: boolean;
}) => unknown;

const GLOBALS_PATH = resolve(process.cwd(), "app/globals.css");
const GLOBALS_CSS = readFileSync(GLOBALS_PATH, "utf8");
const SOURCE =
  '\n@source inline("bg-surface text-fg border-border shadow-md bg-accent text-accent-fg");\n';

async function compileTheme(css: string): Promise<string> {
  const result = await postcss([tailwindcss({ base: process.cwd(), optimize: false })]).process(
    css + SOURCE,
    { from: GLOBALS_PATH },
  );
  return result.css;
}

describe("Tailwind @theme 生成类", () => {
  it("核心语义颜色与阴影类真实生成，并内联引用设计令牌", async () => {
    const css = await compileTheme(GLOBALS_CSS);
    for (const selector of [".bg-surface", ".text-fg", ".border-border", ".shadow-md"]) {
      expect(css).toMatch(new RegExp(`${selector}\\s*\\{`));
    }
    for (const token of ["--surface", "--fg", "--border", "--elev-md"]) {
      expect(css).toContain(`var(${token})`);
    }
  }, 30_000);

  it("反向变异：颜色命名空间写错时 bg-surface 不得生成", async () => {
    const broken = GLOBALS_CSS.replace(
      "--color-surface: var(--surface);",
      "--colors-surface: var(--surface);",
    );
    expect(broken).not.toBe(GLOBALS_CSS);
    const css = await compileTheme(broken);
    expect(css).not.toMatch(/\.bg-surface\s*\{/);
  }, 30_000);
});
