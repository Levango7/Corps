/**
 * visual-kit/index.d.ts —— TypeScript 类型声明（跨项目共享）
 * ----------------------------------------------------------------------------
 * 让 TS 项目（如 corps 的 .spec.ts）能 import CommonJS 的 visual-kit。
 */

export declare const CONTRAST_INJECT: string;
export declare const ABS_FLOOR: number;
export declare const TOLERANCE: number;

export declare function applyTheme(
  page: import("@playwright/test").Page,
  name: string,
  opts?: { attr?: string; lightValue?: string }
): Promise<void>;

export declare function readTokens(
  page: import("@playwright/test").Page,
  tokenNames: string[]
): Promise<Record<string, string>>;

export declare function readPairs(
  page: import("@playwright/test").Page,
  pairs: Record<string, [string, string]>
): Promise<Record<string, { fg: string; bg: string; c: number | null }>>;

export declare function checkOverflow(
  page: import("@playwright/test").Page
): Promise<number>;

export declare function checkVisible(
  page: import("@playwright/test").Page,
  selectors: string[]
): Promise<Record<string, boolean>>;

export declare function dumpReport(
  lines: string[],
  name: string,
  dir?: string
): string | null;
