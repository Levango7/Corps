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
 * 已知安全豁免（白名单，逐条注明理由）：
 *  - 测试文件（tests/、e2e/）：不经生产 RLS 路径
 *  - lib/prisma.ts：客户端定义本身
 *  - lib/calendar/sync.ts 的 calendarConnection/taskCalendarEvent：user 作用域表，
 *    不在 RLS 15 表清单（决策 A 前的临时豁免——决策 A 落地后应移除本行）
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, "../..");

/** rls-activate.sql 15 表对应的 Prisma 模型名（schema.prisma 单数驼峰命名） */
const RLS_MODELS = new Set([
  "Member", // members
  "Task", // tasks
  "Comment", // comments
  "Decision", // decisions
  "DecisionVersion", // decision_versions
  "Subscription", // subscriptions
  "Notification", // notifications
  "Workspace", // workspaces
  "Invitation", // invitations
  "AnalyticsEvent", // analytics_events
  "Label", // labels
  "Milestone", // milestones
  "Message", // messages
  "MessageAttachment", // message_attachments
  "TaskLabel", // task_labels
]);

/** GUC helper 的调用特征（裸调用若出现在这些调用的实参内即视为已包裹） */
const GUC_HELPERS = ["runWithWorkspace", "runWithAuthOp", "runWithSeatCheck", "withGuc"];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

function scanFile(file: string): string[] {
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
      if (!RLS_MODELS.has(model)) continue;
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

describe("RLS 裸查防复发（受 FORCE RLS 的 15 表禁止裸 prisma 直调）", () => {
  it("app/api 与 lib 下无未包裹的受 RLS 模型直调", () => {
    const files = [
      ...walk(join(WEB_ROOT, "app/api"), []),
      ...walk(join(WEB_ROOT, "lib"), []),
    ].filter((f) => /\.(ts|tsx)$/.test(f));

    const violations = [];
    for (const f of files) {
      violations.push(...scanFile(f));
    }
    // 决策 A 前的临时豁免：calendarConnection/taskCalendarEvent 不在 RLS 清单，
    // 此断言只拦 15 表。若你看到本测试失败：新代码对受 RLS 表的查询需要走
    // runWithWorkspace（带 wid 的路由）/ runWithAuthOp（系统作业）/ withGuc。
    expect(violations, `受 RLS 表的裸直调（应包进 GUC helper）:\n${violations.join("\n")}`).toEqual(
      [],
    );
  });

  it("RLS 模型清单与 db/rls-activate.sql 保持同步（防双源漂移）", () => {
    const rls = readFileSync(join(WEB_ROOT, "../db/rls-activate.sql"), "utf8");
    const m = rls.match(/ARRAY\[([\s\S]*?)\]/);
    expect(m, "rls-activate.sql 中未找到 FORCE RLS 表清单 ARRAY").not.toBeNull();
    const tables = m![1]
      .split(",")
      .map((s) => s.trim().replace(/'/g, ""))
      .filter(Boolean);
    // 表名 → Prisma 模型名（schema 单数驼峰）：先去表名尾 s 再 camelCase
    // （decision_versions → decision_version → DecisionVersion）
    const toModel = (t: string): string => {
      const singular = /[^s]s$/.test(t) ? t.slice(0, -1) : t;
      const camel = singular
        .split("_")
        .map((p: string, i: number) => (i === 0 ? p : p[0].toUpperCase() + p.slice(1)))
        .join("");
      return camel[0].toUpperCase() + camel.slice(1); // Prisma 模型名 PascalCase
    };
    // schema.prisma 的模型名（单数驼峰）：核对清单中每张表
    // 都能在 schema 中找到对应模型（避免表改名后检查失效）
    const schema = readFileSync(join(WEB_ROOT, "prisma/schema.prisma"), "utf8");
    for (const t of tables) {
      expect(
        new RegExp(`model ${toModel(t)} \\{`).test(schema),
        `rls-activate.sql 表 ${t} 在 schema.prisma 中无对应模型 ${toModel(t)}`,
      ).toBe(true);
    }
  });
});
