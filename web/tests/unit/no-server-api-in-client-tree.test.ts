// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { dirname, join, relative, resolve, sep } from "path";
import { fileURLToPath } from "url";

/**
 * 「server-only API 不得进入客户端组件树」门禁
 *
 * ## 为什么需要它
 *
 * 2026-10，提交 1e90b5e9（perf: P0-1 第二批 — 9 个组件 useTranslations→getTranslations
 * 转为 server component）把 9 个组件改成了 async Server Component，用
 * `getTranslations` / `getLocale`（来自 `next-intl/server`）。但它没有检查这些组件的
 * **父级**是不是 `"use client"`。被 client 模块 import 的文件会整体进入客户端包，于是：
 *
 *   - `getTranslations` 抛 `Error: 'getTranslations' is not supported in Client Components.`
 *   - async 组件在客户端树里触发 React 报错 `... is an async Client Component.
 *     Only Server Components can be async at the moment`
 *
 * 结果是**整页崩到路由错误边界**（用户看到「页面出错了 / 渲染过程中发生了意外错误」，
 * 侧栏顶栏一起消失）。当次实测崩页：设置页、文档分享页。
 *
 * ## 本门禁在断言什么
 *
 * 1. 扫 `web/app/**` 与 `web/components/**` 的 `.ts/.tsx`，识别所有 `"use client"` 根；
 * 2. 沿**相对 import / `@/` 别名 import / 动态 import / re-export** 建模块图
 *    （解析范围含 app、components、lib、hooks，保证链路完整）；
 * 3. 求出从任意 client 根可达的全部模块；对这些模块断言：
 *    a. 不得从 `next-intl/server` 导入 `getTranslations` / `getLocale` / `getMessages`
 *       / `getFormatter`（这些 API 在客户端调用必抛）；
 *    b. 不得出现 `export async function ...`（async 组件在客户端树必崩；
 *       可达模块的导出即视为组件/可被当组件使用）。
 *
 * ## 为什么是「可达性」而不是「文件头有没有 use client」
 *
 * 崩溃的那个组件文件本身**没有** `"use client"` —— 它看起来完全像一个 server component。
 * 决定它运行在哪一侧的是**引用它的父模块**。所以只能用 import 图从 client 根反推。
 *
 * ## 基线口径（棘轮，只许收缩）
 *
 * 若存量还有别处违规，可写入 `web/tests/server-api-in-client-tree-baseline.txt`，
 * 每行 `<相对路径>:<行>:<规则>`。基线里已不存在的条目会让测试失败（防豁免腐烂）。
 * 本次修复的 5 个组件必须**不在**基线里 —— 它们必须是真正修好，不是被豁免。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, "../..");
const BASELINE = join(HERE, "../server-api-in-client-tree-baseline.txt");

/** client 根只在这些目录里识别（与任务范围一致：app/** 与 components/**） */
const ROOT_SCAN_DIRS = ["app", "components"];
/** import 解析范围，比根扫描宽，保证可达链不断（lib/hooks 只作为中间节点） */
const RESOLVE_DIRS = ["app", "components", "lib", "hooks"];

const SERVER_ONLY_APIS = ["getTranslations", "getLocale", "getMessages", "getFormatter"];

type Rule = "server-api-import" | "async-export";

interface Violation {
  /** 相对 web/ 的路径，统一用 / */
  file: string;
  /** 1-based 行号 */
  line: number;
  rule: Rule;
  /** 违规原文（trim 后） */
  text: string;
  /** 命中的 API 名（rule=server-api-import 时） */
  api?: string;
  /** 从 client 根到该模块的最短链 */
  chain: ChainNode[];
}

interface ChainNode {
  file: string;
  /** 该文件作为 client 根或 import 边所在的行；根节点为 "use client" 指令行 */
  line: number;
}

interface ModuleInfo {
  file: string;
  isClientRoot: boolean;
  clientLine: number;
  /** 解析后的依赖（相对 web/ 的文件） */
  deps: ChainNode[];
  source: string;
}

const toPosix = (p: string) => p.split(sep).join("/");
const relWeb = (abs: string) => toPosix(relative(WEB, abs));
const underRootScan = (file: string) => ROOT_SCAN_DIRS.some((d) => file.startsWith(`${d}/`));

function listSourceFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) listSourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

/**
 * 判断文件头是否是 `"use client"` 指令。
 * 指令前允许注释与空行（JS 指令序言只要求位于任何语句之前）。
 * 返回 1-based 行号，不是 client 根则返回 -1。
 */
function detectUseClient(src: string): number {
  const lines = src.split(/\r?\n/);
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.trim();
    if (inBlockComment) {
      if (line.includes("*/")) inBlockComment = false;
      continue;
    }
    if (!line) continue;
    if (line.startsWith("//")) continue;
    if (line.startsWith("/*")) {
      if (!line.includes("*/")) inBlockComment = true;
      continue;
    }
    if (/^["']use client["'];?$/.test(line)) return i + 1;
    return -1;
  }
  return -1;
}

/** 解析 import 说明符到 web/ 下的真实文件；解析不到（包名/不存在）返回 null */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("./") || spec.startsWith("../")) {
    base = resolve(dirname(fromFile), spec);
  } else if (spec.startsWith("@/")) {
    base = resolve(WEB, spec.slice(2));
  } else {
    return null; // 第三方包 / node: 内置
  }

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.d.ts`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) {
      // 只跟踪 ts/tsx 源码；json/css 等不参与图
      if (/\.(ts|tsx)$/.test(c)) return c;
      return null;
    }
  }
  return null;
}

/** 抽取一个文件的所有 import 边（含 re-export / 动态 import），带行号 */
function extractDeps(file: string, src: string): ChainNode[] {
  const deps: ChainNode[] = [];
  const patterns = [
    // import ... from "x" / export ... from "x"
    /\bfrom\s*["']([^"']+)["']/g,
    // import "x"
    /\bimport\s*["']([^"']+)["']/g,
    // import("x")
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of src.matchAll(re)) {
      const spec = m[1];
      const resolved = resolveSpecifier(file, spec);
      if (!resolved) continue;
      const idx = m.index ?? 0;
      const line = src.slice(0, idx).split("\n").length;
      const target = relWeb(resolved);
      if (!deps.some((d) => d.file === target && d.line === line)) {
        deps.push({ file: target, line });
      }
    }
  }
  return deps;
}

function buildGraph(): Map<string, ModuleInfo> {
  const graph = new Map<string, ModuleInfo>();
  const files: string[] = [];
  for (const dir of RESOLVE_DIRS) listSourceFiles(join(WEB, dir), files);

  for (const abs of files) {
    const src = readFileSync(abs, "utf8");
    const file = relWeb(abs);
    const clientLine = detectUseClient(src);
    graph.set(file, {
      file,
      isClientRoot: clientLine > 0 && underRootScan(file),
      clientLine,
      deps: extractDeps(abs, src),
      source: src,
    });
  }
  return graph;
}

/** 从所有 client 根做 BFS，返回 模块 → 最短可达链（含根与末节点） */
function reachableFromClientRoots(graph: Map<string, ModuleInfo>): Map<string, ChainNode[]> {
  const chains = new Map<string, ChainNode[]>();
  const queue: string[] = [];

  for (const info of graph.values()) {
    if (!info.isClientRoot) continue;
    chains.set(info.file, [{ file: info.file, line: info.clientLine }]);
    queue.push(info.file);
  }

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    const chain = chains.get(current)!;
    const info = graph.get(current);
    if (!info) continue;
    for (const dep of info.deps) {
      if (chains.has(dep.file)) continue; // BFS 首次到达即最短
      if (!graph.has(dep.file)) continue;
      chains.set(dep.file, [...chain, dep]);
      queue.push(dep.file);
    }
  }
  return chains;
}

/** 抽取 `import { ... } from "next-intl/server"` 中涉及的 server-only API（带行号） */
function findServerApiImports(src: string): Array<{ line: number; api: string; text: string }> {
  const hits: Array<{ line: number; api: string; text: string }> = [];
  const lines = src.split(/\r?\n/);

  // 以 `from "next-intl/server"` 为锚点回溯到最近的 import 关键字，
  // 这样跨行 import 也能取全；不能反向用 "从某行开始贪心到 next-intl/server"，
  // 否则会把前一条 import 语句一起吞进来、取错花括号里的符号（实测踩过）。
  const re = /from\s*["']next-intl\/server["']/g;
  for (const m of src.matchAll(re)) {
    const specEnd = (m.index ?? 0) + m[0].length;
    const backStart = Math.max(0, (m.index ?? 0) - 1000);
    const prefix = src.slice(backStart, m.index ?? 0);
    const importRel = prefix.lastIndexOf("import");
    if (importRel < 0) continue;

    const impStart = backStart + importRel;
    // 语句结束位置取该行行尾（import 一般不以分号跨行）
    let stmtEnd = src.indexOf("\n", specEnd);
    if (stmtEnd < 0) stmtEnd = src.length;
    const stmt = src.slice(impStart, stmtEnd);
    const stmtLine = src.slice(0, impStart).split("\n").length;

    // 命名导入：{ a, b as c }
    const named = stmt.match(/\{([\s\S]*?)\}/);
    if (named) {
      const names = named[1]
        .split(",")
        .map((s) => s.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, "").trim())
        .filter(Boolean);
      for (const api of SERVER_ONLY_APIS) {
        if (names.includes(api)) {
          hits.push({ line: stmtLine, api, text: stmt.split("\n")[0].trim() });
        }
      }
    }

    // 命名空间导入：import * as x from "next-intl/server" → 只要模块被引用即视为风险，
    // 但静态无法确认用了哪个 API，故按 getTranslations 记一条（保守：宁报不漏）。
    if (/\*\s+as\s+\w+/.test(stmt)) {
      const ns = stmt.match(/\*\s+as\s+(\w+)/)![1];
      // 只有该命名空间真的被调用才报
      const callRe = new RegExp(`\\b${ns}\\.(${SERVER_ONLY_APIS.join("|")})\\b`, "g");
      for (const call of src.matchAll(callRe)) {
        const line = src.slice(0, call.index ?? 0).split("\n").length;
        hits.push({ line, api: `${ns}.${call[1]}`, text: lines[line - 1].trim() });
      }
    }
  }

  // 同一行/同一 API 去重
  const seen = new Set<string>();
  return hits.filter((h) => {
    const key = `${h.line}:${h.api}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 抽取「async 组件导出」（带行号）。
 *
 * 只认真正会被 React 当组件用的 async 导出，避免把 `export async function withDbRetry`
 * 这类普通异步工具函数也算成违规（它们可以在客户端模块里合法存在）：
 *   1. `export default async function ...` —— 默认导出即被当组件渲染；
 *   2. `export async function PascalCase(...)` 且函数体里出现 JSX return。
 */
function findAsyncExports(src: string): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];

  const isAsyncComponentBody = (start: number): boolean => {
    // start 指向参数表首个 "(" 之后。先配平参数括号，再定位函数体 "{"，
    // 否则遇到 `({ ws }: Props)` 这种解构参数会把参数里的 "{" 当成函数体。
    let i = start;
    let paren = 1;
    while (i < src.length && paren > 0) {
      const ch = src[i];
      if (ch === "(") paren += 1;
      else if (ch === ")") paren -= 1;
      i += 1;
    }
    // 跳过返回类型注解（`): Promise<ReactElement> {`）
    const braceStart = src.indexOf("{", i);
    if (braceStart < 0) return false;
    let depth = 0;
    let j = braceStart;
    while (j < src.length) {
      const ch = src[j];
      if (ch === '"' || ch === "'" || ch === "`") {
        const quote = ch;
        j += 1;
        while (j < src.length && src[j] !== quote) {
          if (src[j] === "\\") j += 1;
          j += 1;
        }
      } else if (ch === "{") {
        depth += 1;
      } else if (ch === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
      j += 1;
    }
    const body = src.slice(braceStart, j + 1);
    // JSX return 的保守识别：return ( <... ) / return <Tag
    return /return\s*\(?\s*</.test(body);
  };

  for (const m of src.matchAll(/^[ \t]*export\s+default\s+async\s+function\s*\w*\s*\(/gm)) {
    const line = src.slice(0, m.index ?? 0).split("\n").length;
    out.push({ line, text: m[0].trim() });
  }

  for (const m of src.matchAll(/^[ \t]*export\s+async\s+function\s+([A-Z]\w*)\s*\(/gm)) {
    const bodyStart = (m.index ?? 0) + m[0].length;
    if (!isAsyncComponentBody(bodyStart)) continue;
    const line = src.slice(0, m.index ?? 0).split("\n").length;
    out.push({ line, text: m[0].trim() });
  }

  // 同名同行的重复（default 与 PascalCase 规则可能命中同一条）去重
  const seen = new Set<string>();
  return out.filter((h) => {
    const key = `${h.line}:${h.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatChain(chain: ChainNode[]): string {
  return chain.map((c) => `${c.file}:${c.line}`).join("\n    → ");
}

function suggestedFix(rule: Rule, api?: string): string {
  if (rule === "async-export") {
    return '去掉 `async`，并确保该模块已被标为 "use client"（父级是 client 时，子模块自动进入客户端包）';
  }
  if (api === "getMessages" || api === "getFormatter") {
    return "客户端侧没有等价 hook；请改用 useTranslations / useLocale / useFormatter（来自 next-intl），或把调用留在真正的 server 组件里";
  }
  return "改用 `useTranslations` / `useLocale`（来自 `next-intl`，不是 `next-intl/server`），并去掉 `async`";
}

function collectViolations(): {
  violations: Violation[];
  scannedFiles: number;
  clientRoots: number;
  reachableModules: number;
} {
  const graph = buildGraph();
  const reachable = reachableFromClientRoots(graph);
  const violations: Violation[] = [];

  for (const [file, chain] of reachable) {
    const info = graph.get(file);
    if (!info) continue;

    for (const hit of findServerApiImports(info.source)) {
      violations.push({
        file,
        line: hit.line,
        rule: "server-api-import",
        text: hit.text,
        api: hit.api,
        chain,
      });
    }
    for (const hit of findAsyncExports(info.source)) {
      violations.push({ file, line: hit.line, rule: "async-export", text: hit.text, chain });
    }
  }

  violations.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));

  let clientRoots = 0;
  for (const info of graph.values()) if (info.isClientRoot) clientRoots += 1;

  return {
    violations,
    scannedFiles: graph.size,
    clientRoots,
    reachableModules: reachable.size,
  };
}

const keyOf = (v: Violation) => `${v.file}:${v.line}:${v.rule}`;

function loadBaseline(): string[] {
  if (!existsSync(BASELINE)) return [];
  return readFileSync(BASELINE, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .sort();
}

describe("server-only API 不得进入客户端组件树", () => {
  const { violations, scannedFiles, clientRoots, reachableModules } = collectViolations();
  const baseline = loadBaseline();
  const baselineSet = new Set(baseline);

  it("扫描覆盖面没有塌掉（防解析式静默失效）", () => {
    // 阈值按当前仓库规模取值：web/app + web/components 约 500+ 个 ts/tsx。
    // 若这一条先红，说明文件遍历或图构建坏了，而不是"违规清零"。
    expect(scannedFiles).toBeGreaterThan(300);
    expect(clientRoots).toBeGreaterThan(30);
    // 从 client 根可达的模块必然多于 client 根本身（每个页面都带子组件）
    expect(reachableModules).toBeGreaterThan(clientRoots);
  });

  it("修复基线中不得再出现已修好的组件（防用基线掩盖回归）", () => {
    // 这 5 个 + widgets 注册表是 2026-10 修复的，必须真的在代码里修好，
    // 不允许通过把它们写进 baseline 让门禁变绿。
    const mustNotBeBaselined = [
      "components/PublicDocumentView.tsx",
      "components/ai/BehaviorStats.tsx",
      "components/approval/ApprovalFlowDiagram.tsx",
      "components/dashboard/widgets/index.tsx",
      "components/files/PdfPreview.tsx",
      "components/settings/SettingsOverview.tsx",
    ];
    const leaked = baseline.filter((b) => mustNotBeBaselined.some((f) => b.startsWith(`${f}:`)));
    expect(leaked, `以下已修复组件不得进入基线:\n  ${leaked.join("\n  ")}`).toEqual([]);
  });

  it("client 可达模块不得使用 next-intl/server 的 server-only API，也不得导出 async 函数", () => {
    const grown = violations.filter((v) => !baselineSet.has(keyOf(v)));
    const detail = grown
      .map(
        (v) =>
          `client 根文件/行: ${v.chain[0].file}:${v.chain[0].line}\n` +
          `  可达链:\n    ${formatChain(v.chain)}\n` +
          `  违规模块: ${v.file}:${v.line}  [${v.rule}]\n` +
          `  原文: ${v.text}\n` +
          `  建议改法: ${suggestedFix(v.rule, v.api)}`,
      )
      .join("\n\n");
    expect(
      grown,
      grown.length
        ? `客户端组件树里出现了 server-only 用法（会整页崩到错误边界）:\n\n${detail}\n`
        : "",
    ).toEqual([]);
  });

  it("基线不放行已修复的条目（防豁免腐烂）", () => {
    const stale = baseline.filter((entry) => !violations.some((v) => keyOf(v) === entry));
    expect(
      stale,
      `以下条目已不再违规，请从 tests/server-api-in-client-tree-baseline.txt 删除:\n  ${stale.join("\n  ")}`,
    ).toEqual([]);
  });
});
