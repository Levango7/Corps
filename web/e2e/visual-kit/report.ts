/**
 * visual-kit/report.ts —— 实测值落盘工具（跨项目共享）
 * ----------------------------------------------------------------------------
 * 从 Interaction 的 theme-matrix.spec.js 抽出（v3.7.122）。
 * 用途：把视觉实测值（对比度、尺寸等）写入文件，便于人工复核与将来调阈值。
 * Playwright 默认吞掉 console.log，写文件更可靠。
 *
 * ⚠️ 本文件会被 Playwright 以 CommonJS 语义转译（web/package.json 无
 * type:module），`import.meta` 在该模式下是语法错，因此**禁用 import.meta**；
 * 默认目录用 process.cwd() 定位 —— Playwright 的 cwd = playwright.config.ts
 * 所在目录（即 web/），与 contrast-probe 的输出目录（web/_probe/）一致。
 */

import fs from "node:fs";
import path from "node:path";

/** 把若干行文本落盘。dir 可覆盖（默认 <cwd>/_probe/），name 为文件名（不含扩展名）。 */
export function dumpReport(lines: string[], name: string, dir?: string): string | null {
  try {
    const d = dir || path.resolve(process.cwd(), "_probe");
    const file = path.join(d, name + ".txt");
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
    return file;
  } catch {
    /* 落盘失败不影响断言 */
    return null;
  }
}
