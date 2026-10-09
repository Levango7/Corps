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

/**
 * 存量裸查登记表（tests/rls-bare-query-baseline.txt，2026-10-08 建立）。
 *
 * 守卫的大小写口径修复后一次性暴露 33 处存量裸查；按仓库既有登记表惯例
 * （参照 RLS 豁免表 / write-access registry）只允许收缩：
 *  - 未登记文件出现裸查 → NEW（红）
 *  - 已登记文件处数增加 → GROWTH（红）
 *  - 已登记文件处数减少 → STALE（红，强制同步收缩登记表）
 *
 * **2026-10-09 全量收编后登记表已清空并删除**（workflow 域 12 处、push 6 处、
 * 模板 8 处、反馈 3 处、助手 1 处、cron 2 处——每处独立短 GUC 事务，模板/公开行
 * 另加了策略逃生口）。此后**任何**未包裹的裸查都直接判 NEW。若未来确有需要
 * 登记的存量（放弃某处收编），重建同名文件即可，格式：
 * `<相对 web/ 路径> | <处数> | reason`，`#` 开头为注释。
 */
function parseBareQueryBaseline(): Map<string, number> {
  const map = new Map<string, number>();
  let text: string;
  try {
    text = readFileSync(join(HERE, "../rls-bare-query-baseline.txt"), "utf8");
  } catch {
    // 登记表不存在 = 无存量（全量收编后的常态）
    return map;
  }
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length < 3) {
      throw new Error(
        `rls-bare-query-baseline.txt 行格式错误（需 path | count | reason）: ${line}`,
      );
    }
    const count = Number(parts[1]);
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error(`rls-bare-query-baseline.txt 处数非法: ${line}`);
    }
    map.set(parts[0], count);
  }
  return map;
}

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
      if (!rlsModels.has(model.toLowerCase())) continue;
      // 用行在全文中的偏移精确定位调用点
      const lineStart = src.split("\n").slice(0, lineNo).join("\n").length + 1;
      const callPos = lineStart + m.index;
      if (!isWrapped(callPos)) {
        // 路径统一为正斜杠（与登记表口径一致，跨平台稳定）
        const rel = file.replace(WEB_ROOT, "").replace(/\\/g, "/").replace(/^\//, "");
        violations.push(`${rel}:${lineNo + 1} prisma.${model}`);
      }
    }
  });
  return violations;
}

describe("RLS 裸查防复发（受 FORCE RLS 的租户表禁止裸 prisma 直调）", () => {
  it("app/api 与 lib 下无未包裹的受 RLS 模型直调（登记表只允许收缩）", () => {
    // 受保护模型 = RLS 表 ∩ schema 模型（经 @@map 对齐），两处声明任一扩容本检查即收紧
    const byTable = parseSchemaTables();
    // 2026-10-08 口径修复：守卫此前用 schema 的 PascalCase 模型名直接比对
    // prisma 访问器（camelCase，如 prisma.aiUsageLog），has() 恒为 false——
    // 该守卫从未拦下过任何裸查。按不区分大小写比对修复。
    const rlsModels = new Set(
      parseRlsTables()
        .map((t) => byTable.get(t))
        .filter((m): m is string => Boolean(m))
        .map((m) => m.toLowerCase()),
    );
    const files = [
      ...walk(join(WEB_ROOT, "app/api"), []),
      ...walk(join(WEB_ROOT, "lib"), []),
    ].filter((f) => /\.(ts|tsx)$/.test(f));

    const violations: string[] = [];
    for (const f of files) {
      violations.push(...scanFile(f, rlsModels));
    }

    // 按文件聚合与登记表比对（2026-10-08 建立）：
    //  - 未登记文件出现裸查 → 红（新增即拦）
    //  - 已登记文件处数 > 基线 → 红（登记表不是扩容许可证）
    //  - 处数 < 基线 → 红（修复后必须同步收缩登记表，防止虚胖）
    const baseline = parseBareQueryBaseline();
    const byFile = new Map<string, string[]>();
    for (const v of violations) {
      const rel = v.split(":")[0].replace(/^\//, "");
      if (!byFile.has(rel)) byFile.set(rel, []);
      byFile.get(rel)!.push(v);
    }

    const problems: string[] = [];
    for (const [rel, vs] of byFile) {
      const allowed = baseline.get(rel);
      if (allowed === undefined) {
        problems.push(`NEW ${rel}: ${vs.length} 处（未登记）\n    ${vs.join("\n    ")}`);
      } else if (vs.length > allowed) {
        problems.push(`GROWTH ${rel}: ${vs.length} > 基线 ${allowed}\n    ${vs.join("\n    ")}`);
      }
    }
    for (const [rel, allowed] of baseline) {
      const count = byFile.get(rel)?.length ?? 0;
      if (count < allowed) {
        problems.push(
          `STALE ${rel}: 基线 ${allowed}，实际 ${count} —— 修复后请同步收缩 rls-bare-query-baseline.txt`,
        );
      }
    }

    // 若你看到本测试失败：新代码对受 RLS 表的查询需要走 runWithWorkspace（带 wid 的路由）
    // / runWithAuthOp（系统作业）/ withGuc 注入 GUC，否则加固模式下静默返回空/写被拒。
    // 存量债登记在 tests/rls-bare-query-baseline.txt（只允许收缩）。
    expect(
      problems,
      `受 RLS 表的裸直调与登记表不一致（应包进 GUC helper）:\n${problems.join("\n")}`,
    ).toEqual([]);
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
