// @vitest-environment node
/**
 * 分页信封消费口径守卫（防复发）
 *
 * 背景：同一 API 前缀下并存两种响应形状——裸数组与分页信封
 * （{ items, total, hasMore } / { items, nextCursor, hasMore } …），消费方各自判断。
 * 该类缺陷实测已出现在 9+ 个消费点、跨多种键名，且形态会演进：
 *   · 初版：客户端把信封当裸数组 → 渲染期 TypeError，整页被路由级错误边界接管
 *     （NewTaskDialog 的 .map、KnowledgeBase 的 [...items]）；
 *   · 变体：信封的列表键不是 items（会话成员的数组挂在 items 上、并无 members 键；
 *     文档版本的 items 取值是 result.versions），客户端按"字面语义键"取
 *     → Array.isArray 兜底成 [] → **静默失效**（列表恒空、不报错、不崩）。
 *
 * 「单测全绿、线上崩/空」的两次根因都是 mock 形状与真实端点不一致；人眼逐处核对不可持续，
 * 故加此静态守卫。规则（宁少勿错：误报的守卫会被绕过，等于名存实亡）：
 *   · 服务端：route.ts 的 GET/POST handler 内同时出现「行首列表键」与「行首分页键」
 *     → 判定该端点为分页信封端点；
 *   · 客户端：`api<SimpleType[]>("字面量 URL")` 的调用点若命中等价端点 → 违规；
 *     正确处理是 apiList<T>（lib/api.ts：{ items } 与裸数组双兼容）或显式读 data.items。
 *
 * 已知盲区（如实记录，不假装覆盖）：
 *   · URL 走变量/前缀拼接（如 api<ChatMessage[]>(base)）无法静态归因，跳过；
 *   · 只判 GET/POST（列表读的业务面）；
 *   · 列表键名白名单是枚举式，新增语义键名需同步本文件——「检测器自检」用例会因
 *     真实端点形状变化而失败，这是有意的：形状变更必须被人重新审一遍。
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, "../..");
const APP_DIR = join(WEB_ROOT, "app");
const API_DIR = join(APP_DIR, "api");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** 列表语义键白名单（实测出现过的键名） */
const LIST_KEYS = [
  "items",
  "members",
  "versions",
  "results",
  "logs",
  "records",
  "entries",
  "rows",
  "files",
  "folders",
  "children",
  "sessions",
  "events",
  "messages",
  "notifications",
  "templates",
  "comments",
  "links",
  "grants",
  "presence",
];
const LIST_KEY_RE = new RegExp(`(?<![\\w$.])(?:${LIST_KEYS.join("|")})\\s*[:,]`);
const PAGING_KEY_RE = /(?<![\w$.])(?:total|hasMore|nextCursor)\s*[:,]/;
/**
 * 载荷装配形态（实测两种，缺一即漏检）：
 *  · 内联：`NextResponse.json({ code, data: { items, total: … } })`
 *  · 先建字面量：`return { items, nextCursor, hasMore }` 再 `data: result`
 *    （conversations 路由是后者——只认内联形态会漏掉它，这类"变量信封"还骗过了
 *     一次纯正则扫描，必须显式覆盖）
 */
const PAYLOAD_OBJ_RE = /(?:data\s*:\s*\{|return\s*\{)/;
const HANDLER_RE = /export\s+async\s+function\s+(GET|POST)\b/g;

/** 动态段归一化：`${wid}` 与 `[wid]` 是同一个位置参数 */
function normalizePath(p: string): string {
  return p
    .replace(/\?.*$/, "")
    .replace(/\$\{[^}]*\}/g, "*")
    .replace(/\[[^\]]+\]/g, "*")
    .replace(/\/+$/, "");
}

/** route.ts 文件 → 归一化 URL 模板 */
function routeUrlOf(file: string): string {
  const rel = relative(API_DIR, file)
    .replace(/\\/g, "/")
    .replace(/\/route\.ts$/, "");
  return normalizePath(`/api/${rel}`);
}

/** 单个 route.ts 内「分页信封」handler：方法 + 该 handler 的正文（正文用于提取载荷键） */
interface WrappedHandler {
  method: string;
  body: string;
}

function wrappedHandlers(file: string): WrappedHandler[] {
  const text = readFileSync(file, "utf8");
  const marks: Array<{ method: string; start: number }> = [];
  let m: RegExpExecArray | null;
  HANDLER_RE.lastIndex = 0;
  while ((m = HANDLER_RE.exec(text)) !== null) marks.push({ method: m[1], start: m.index });
  const out: WrappedHandler[] = [];
  for (let i = 0; i < marks.length; i++) {
    const body = text.slice(
      marks[i].start,
      i + 1 < marks.length ? marks[i + 1].start : text.length,
    );
    if (PAYLOAD_OBJ_RE.test(body) && LIST_KEY_RE.test(body) && PAGING_KEY_RE.test(body)) {
      out.push({ method: marks[i].method, body });
    }
  }
  return out;
}

interface WrappedEndpoint {
  file: string;
  methods: string[];
  bodies: string[];
}

/** 采集全部分页信封端点：归一化 URL → { 文件, 方法, handler 正文 } */
function collectWrappedEndpoints(): Map<string, WrappedEndpoint> {
  const map = new Map<string, WrappedEndpoint>();
  for (const f of walk(API_DIR)) {
    if (!/[\\/]route\.ts$/.test(f)) continue;
    const handlers = wrappedHandlers(f);
    if (handlers.length > 0) {
      map.set(routeUrlOf(f), {
        file: relative(WEB_ROOT, f).replace(/\\/g, "/"),
        methods: handlers.map((h) => h.method),
        bodies: handlers.map((h) => h.body),
      });
    }
  }
  return map;
}

/**
 * 载荷对象里处于"键位"的标识符；两种写法都要认（实测两种都存在，漏一种就会误报）：
 *  · 显式：`items: notifications` / `total,`
 *  · 简写：`{ unread }`（notifications 的 count 分支就是这么写的——只认显式键时
 *    该端点会被误判为"没有 unread 键"，守卫就变成了误报源）
 * 近似判定，可能多收标识符（更宽松）；本守卫按"宁可漏报不误报"设计：误报会被绕过。
 */
const KEY_IN_BODY_RE = /(?<![\w$.])([A-Za-z_$][\w$]*)\s*[:,]|[{,]\s*([A-Za-z_$][\w$]*)\s*(?=[,}])/g;

function payloadKeysOf(ep: WrappedEndpoint): Set<string> {
  const keys = new Set<string>();
  for (const body of ep.bodies) {
    KEY_IN_BODY_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = KEY_IN_BODY_RE.exec(body)) !== null) {
      keys.add(m[1] ?? m[2]);
    }
  }
  return keys;
}

/** 客户端调用点：api<SimpleType[]>(`/api/...`)；联合类型/对象字面量（自己处理形状）不在被约束范围 */
const API_ARRAY_CALL_RE =
  /api\s*<\s*[A-Za-z_$][\w$.]*(?:\s*<[^<>]*>)?\s*\[\]\s*>\s*\(\s*(?:`([^`]*)`|"([^"]*)"|'([^']*)')/g;

interface CallSite {
  file: string;
  line: number;
  url: string;
}

function collectArrayCallSites(): { literal: CallSite[]; unresolved: number } {
  const literal: CallSite[] = [];
  let unresolved = 0;
  for (const f of clientFiles()) {
    const text = readFileSync(f, "utf8");
    API_ARRAY_CALL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = API_ARRAY_CALL_RE.exec(text)) !== null) {
      const url = m[1] ?? m[2] ?? m[3] ?? "";
      if (!url.startsWith("/api/")) {
        unresolved++;
        continue;
      }
      const line = text.slice(0, m.index).split("\n").length;
      literal.push({ file: relative(WEB_ROOT, f).replace(/\\/g, "/"), line, url });
    }
  }
  return { literal, unresolved };
}

/** 客户端待扫文件（服务端路由自身不在被约束范围） */
function clientFiles(): string[] {
  const out: string[] = [];
  const dirs = [
    APP_DIR,
    join(WEB_ROOT, "components"),
    join(WEB_ROOT, "hooks"),
    join(WEB_ROOT, "lib"),
  ];
  for (const dir of dirs) {
    for (const f of walk(dir)) {
      if (!f.endsWith(".ts") && !f.endsWith(".tsx")) continue;
      if (f.startsWith(API_DIR)) continue;
      out.push(f);
    }
  }
  return out;
}

/** 客户端"对象类型"调用点：api<{ members?: X[] }>(`/api/...`) → 连同被读的键名一起采集 */
const API_OBJ_CALL_RE = /api\s*<\s*\{\s*([^}]*)\}\s*>\s*\(\s*(?:`([^`]*)`|"([^"]*)"|'([^']*)')/g;
const TYPE_KEY_RE = /(?<![\w$.])([A-Za-z_$][\w$]*)\s*\??\s*:/g;

interface ObjCallSite extends CallSite {
  keys: string[];
}

function collectObjectCallSites(): ObjCallSite[] {
  const out: ObjCallSite[] = [];
  for (const f of clientFiles()) {
    const text = readFileSync(f, "utf8");
    API_OBJ_CALL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = API_OBJ_CALL_RE.exec(text)) !== null) {
      const url = m[2] ?? m[3] ?? m[4] ?? "";
      if (!url.startsWith("/api/")) continue;
      const keys: string[] = [];
      TYPE_KEY_RE.lastIndex = 0;
      let km: RegExpExecArray | null;
      const typeBody = m[1] ?? "";
      while ((km = TYPE_KEY_RE.exec(typeBody)) !== null) keys.push(km[1]);
      if (keys.length === 0) continue;
      const line = text.slice(0, m.index).split("\n").length;
      out.push({ file: relative(WEB_ROOT, f).replace(/\\/g, "/"), line, url, keys });
    }
  }
  return out;
}

describe("分页信封消费口径守卫", () => {
  const wrapped = collectWrappedEndpoints();
  const { literal, unresolved } = collectArrayCallSites();

  it("守卫不得静默退化：既认得出分页端点，也扫得到字面量调用点", () => {
    expect(wrapped.size, "未识别到任何分页信封端点——检测器或路由布局已变").toBeGreaterThan(20);
    expect(literal.length, "未扫到 api<X[]>(字面量 URL) 调用点——检测器正则已失效").toBeGreaterThan(
      3,
    );
  });

  it("检测器自检：真实端点形状与判定一致（分页端点 / 裸数组端点各两例）", () => {
    // 分页信封（GET）：route.ts 内 items 与 total/hasMore 同行首键
    expect(wrapped.get("/api/v1/workspaces/*/tasks")?.methods).toContain("GET");
    expect(wrapped.get("/api/v1/workspaces/*/documents/*/versions")?.methods).toContain("GET");
    // 裸数组（GET）：data 直接挂数组标识符
    expect(wrapped.has("/api/v1/workspaces/*/tasks/*/messages")).toBe(false);
    expect(wrapped.has("/api/v1/workspaces/*/tasks/*/decisions/*/versions")).toBe(false);
  });

  it("没有任何客户端把分页信封当裸数组消费", () => {
    const violations = literal
      .filter((c) => wrapped.has(normalizePath(c.url)))
      .map((c) => `${c.file}:${c.line} → ${c.url}（该端点返回分页信封，应改用 apiList）`);
    expect(
      violations,
      `分页信封被当裸数组消费（${violations.length} 处）；正解：lib/api.ts 的 apiList<T>，` +
        `或显式读 data.items：\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("客户端不得按端点不存在的键取列表（错键 → 兜底成空，静默失效）", () => {
    const objCalls = collectObjectCallSites();
    const violations: string[] = [];
    for (const c of objCalls) {
      const ep = wrapped.get(normalizePath(c.url));
      if (!ep) continue; // 只约束分页信封端点
      const keys = payloadKeysOf(ep);
      for (const k of c.keys) {
        if (!keys.has(k)) {
          violations.push(
            `${c.file}:${c.line} → ${c.url} 读键 "${k}"，但端点载荷无此键（应读 items 或用 apiList）`,
          );
        }
      }
    }
    expect(objCalls.length, "未扫到 api<{...}>(字面量 URL) 调用点——本档守卫已空转").toBeGreaterThan(
      0,
    );
    expect(
      violations,
      `按不存在的键取列表（${violations.length} 处）——这类取值会被 Array.isArray 兜底成空数组，` +
        `不报错也不崩，比崩溃更难发现：\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("匹配逻辑自检：构造一条已知违规必须被抓（防「永远绿灯」）", () => {
    // 用真实端点 + 合成调用点验证"URL 归一化 → 命中端点"这条链路（最易悄悄失灵的环节）
    const synthetic: CallSite = {
      file: "<synthetic>",
      line: 1,
      url: "/api/v1/workspaces/${wid}/tasks?limit=20",
    };
    expect(
      wrapped.has(normalizePath(synthetic.url)),
      "合成的 /tasks 调用未被判定为命中分页端点——匹配链路已坏",
    ).toBe(true);
  });

  it("扫描根覆盖：app 与 components 两侧都扫到了调用点", () => {
    expect(literal.some((c) => c.file.startsWith("app/"))).toBe(true);
    expect(literal.some((c) => c.file.startsWith("components/"))).toBe(true);
  });

  it("盲区与规模口径：无法静态归因的调用点数、识别到的端点与调用点总量（审计用，不设阈值）", () => {
    // 输出到 CI 日志：守卫"看到了什么"应可审计，而不是只给一个绿点
    console.log(
      `[envelope-guard] 分页信封端点 ${wrapped.size} 个 / 字面量调用点 ${literal.length} 个 / ` +
        `无法静态归因 ${unresolved} 个`,
    );
    expect(unresolved).toBeGreaterThanOrEqual(0);
  });
});
