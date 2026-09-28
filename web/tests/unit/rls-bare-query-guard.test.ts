// @vitest-environment node
/**
 * RLS 裸查防复发检查（审计第二阶段 2-1a）
 *
 * 背景：受 FORCE RLS 约束的表，裸 prisma.<Model> 直调（不经 runWithWorkspace /
 * runWithAuthOp / runWithSeatCheck / withGuc 注入 GUC）在生产加固模式下
 * 静默返回空——同类缺陷已出现三次（cron 截止日提醒 → 附件归属 → 日历同步，
 * 见 ADR-006 与审计 P1-A）。CI 集成测试以超级用户运行无法暴露，故此静态检查。
 *
 * 规则：app/api 与 lib 下的 .ts 文件中，受 RLS 模型的 prisma.<Model>.xxx 直调
 * 属违规，除非该调用点在函数体内由 GUC helper 的调用包裹（近似判定：同一文件
 * 的同一函数作用域内出现 runWithWorkspace/runWithAuthOp/runWithSeatCheck/
 * withGuc 且裸调用出现在其括号范围内——本测试用简化版：裸调用必须位于
 * GUC helper 调用的实参表达式内部，按文本配对近似判定）。
 *
 * 受保护模型清单不手工维护，而是运行时派生：表清单取自 db/rls-activate.sql 的
 * FORCE RLS ARRAY（只取引号内标识符，忽略 SQL 注释），模型名以 schema.prisma 的
 * @@map 为准。任一处扩容检查即自动收紧——历史手工常量停在 20 表而 SQL 已 79 表，
 * 导致 59 张表的裸查长期无人看守。
 *
 * 已知安全豁免（白名单，逐条注明理由）：
 *  - 测试文件（tests/、e2e/）：不经生产 RLS 路径
 *  - lib/prisma.ts：客户端定义本身
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, "../..");

/**
 * 从 db/rls-activate.sql 解析被 FORCE RLS 覆盖的表名清单。
 *
 * 实现要点：只取单引号内的标识符。该 ARRAY 字面量内部含 SQL 注释
 * （`-- ── 55 张补齐 RLS 的租户表…`），按逗号裸切会把注释文本当成表名——
 * 这正是本测试在 dd828ee4 之后长期失败的根因。口径与
 * scripts/check_rls_coverage.py 的 parse_rls_tables 保持一致（注释天然被忽略）。
 */
function parseRlsTables(): string[] {
  const rls = readFileSync(join(WEB_ROOT, "../db/rls-activate.sql"), "utf8");
  const m = rls.match(/ARRAY\[([\s\S]*?)\]/);
  if (!m) throw new Error("rls-activate.sql 中未找到 FORCE RLS 表清单 ARRAY");
  return [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]);
}

/**
 * 解析 schema.prisma：表名 → 模型名。
 *
 * 以 `@@map("表名")` 为准。不用"去尾 s 猜单数"那一套：模型名与表名并非机械对应
 * （`meeting_minutes` 的模型是 `MeetingMinutes`，猜成 `MeetingMinute` 会让整张表
 * 从裸查扫描中静默消失）。缺省（无 @@map）时 Prisma 的表名即模型名。
 */
function parseSchemaTables(): Map<string, string> {
  const src = readFileSync(join(WEB_ROOT, "prisma/schema.prisma"), "utf8");
  const byTable = new Map<string, string>();
  for (const m of src.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
    const [, name, body] = m;
    const mapped = body.match(/@@map\("(\w+)"\)/);
    byTable.set(mapped ? mapped[1] : name, name);
  }
  return byTable;
}

/** GUC helper 的调用特征（裸调用若出现在这些调用的实参内即视为已包裹） */
const GUC_HELPERS = [
  "runWithWorkspace",
  "runWithAuthOp",
  "runWithSeatCheck",
  "runWithShareToken",
  "withGuc",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

function scanFile(file: string, rlsModels: Set<string>): string[] {
  const violations: string[] = [];
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");

  // 找出所有 GUC helper 调用的实参区间（近似：从 helper( 起做括号配对到闭合）
  const wrappedRanges: Array<[number, number]> = [];
  for (const helper of GUC_HELPERS) {
    let idx = -1;
    while ((idx = src.indexOf(helper + "(", idx + 1)) >= 0) {
      // 括号配对
      let depth = 0;
      let i = idx + helper.length;
      for (; i < src.length; i++) {
        if (src[i] === "(") depth++;
        else if (src[i] === ")") {
          depth--;
          if (depth === 0) break;
        }
      }
      wrappedRanges.push([idx, i]);
    }
  }
  const isWrapped = (pos: number) => wrappedRanges.some(([s, e]) => pos >= s && pos <= e);

  lines.forEach((line, lineNo) => {
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
    // 裸调用特征：prisma.<Model>.
    const re = /prisma\.(\w+)\./g;
    let m;
    while ((m = re.exec(line))) {
      const model = m[1];
      if (!rlsModels.has(model)) continue;
      // 用行在全文中的偏移精确定位调用点
      const lineStart = src.split("\n").slice(0, lineNo).join("\n").length + 1;
      const callPos = lineStart + m.index;
      if (!isWrapped(callPos)) {
        violations.push(`${file.replace(WEB_ROOT, "")}:${lineNo + 1} prisma.${model}`);
      }
    }
  });
  return violations;
}

describe("RLS 裸查防复发（受 FORCE RLS 的租户表禁止裸 prisma 直调）", () => {
  it("app/api 与 lib 下无未包裹的受 RLS 模型直调", () => {
    // 受保护模型 = RLS 表 ∩ schema 模型（经 @@map 对齐），两处声明任一扩容本检查即收紧
    const byTable = parseSchemaTables();
    const rlsModels = new Set(
      parseRlsTables()
        .map((t) => byTable.get(t))
        .filter((m): m is string => Boolean(m)),
    );
    const files = [
      ...walk(join(WEB_ROOT, "app/api"), []),
      ...walk(join(WEB_ROOT, "lib"), []),
    ].filter((f) => /\.(ts|tsx)$/.test(f));

    const violations = [];
    for (const f of files) {
      violations.push(...scanFile(f, rlsModels));
    }
    // 若你看到本测试失败：新代码对受 RLS 表的查询需要走 runWithWorkspace（带 wid 的路由）
    // / runWithAuthOp（系统作业）/ withGuc 注入 GUC，否则加固模式下静默返回空。
    expect(violations, `受 RLS 表的裸直调（应包进 GUC helper）:\n${violations.join("\n")}`).toEqual(
      [],
    );
  });

  it("RLS 表清单与 schema.prisma 一一对应（防双源漂移）", () => {
    const tables = parseRlsTables();
    expect(tables.length, "rls-activate.sql 的表清单为空，解析可能失效").toBeGreaterThan(0);
    // 每张受 RLS 表都要能在 schema 中找到模型，否则上面的扫描会静默漏检整张表。
    // 反方向（含 workspaceId 的模型必须进 RLS）由 scripts/check_rls_coverage.py 在 CI 把关。
    const byTable = parseSchemaTables();
    const unresolved = tables.filter((t) => !byTable.has(t));
    expect(
      unresolved,
      `rls-activate.sql 中这些表在 schema.prisma 找不到对应模型（检查 @@map）:\n${unresolved.join("\n")}`,
    ).toEqual([]);
  });
});
