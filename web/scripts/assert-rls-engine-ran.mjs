/* eslint-disable -- CI 辅助脚本（非应用代码，不参与生产构建）：需要 node 的
   process/console，应用侧 lint 规则（no-undef、no-console 白名单等）不适用。
   与 scripts/layout-audit.mjs 同一惯例。 */
// 断言 tests/integration/rls-engine.test.ts 在加固 CI 里**真的执行了**。
//
// 背景：该文件在缺少 RLS_SMOKE_OWNER_URL / RLS_SMOKE_APP_URL 时退成 describe.skip，
// 于是"接进 CI"这件事可以悄悄失效——而 vitest 的 JSON 报告会把"四条全 skip"的
// suite 仍标成 status=passed，所以只看文件在不在、或只看 suite 状态都会假绿。
// 必须逐条数 assertionResults 的状态。
//
// 用法：node scripts/assert-rls-engine-ran.mjs <vitest-json 路径>
// 退出码：0=真实执行且全绿；1=缺失/被跳过/有失败（打印 ::error:: 供 CI 标注）
import { readFileSync } from "fs";

const MIN_TESTS = 4;
const file = process.argv[2];
if (!file) {
  console.error("::error::用法：node scripts/assert-rls-engine-ran.mjs <vitest-json>");
  process.exit(1);
}

const report = JSON.parse(readFileSync(file, "utf8"));
const entry = (report.testResults ?? []).find((f) =>
  String(f.name).replace(/\\/g, "/").includes("rls-engine.test.ts"),
);
const status = (t) => String((t && t.status) ?? "").toLowerCase();
const assertions = entry?.assertionResults ?? [];
const passed = assertions.filter((a) => status(a) === "passed").length;
const skipped = assertions.filter((a) => ["skipped", "pending", "todo"].includes(status(a))).length;
const failed = assertions.filter((a) => status(a) === "failed").length;

console.log(
  `[rls-engine 守卫] 文件=${entry ? "在" : "不在报告里"} ` +
    `通过=${passed}/${assertions.length} 跳过=${skipped} 失败=${failed} suite状态=${status(entry) || "n/a"}`,
);

if (!entry) {
  console.error("::error::报告里没有 rls-engine.test.ts —— 该文件可能被 filter 掉了");
  process.exit(1);
}
if (entry.status === "failed" || failed > 0) {
  console.error(`::error::引擎级 RLS 断言有 ${failed} 条失败`);
  process.exit(1);
}
if (skipped > 0 || passed < MIN_TESTS) {
  console.error(
    `::error::引擎级 RLS 断言被静默跳过（passed=${passed} skipped=${skipped}，期望 ≥${MIN_TESTS} 且 0 跳过）。` +
      "检查 RLS_SMOKE_OWNER_URL / RLS_SMOKE_APP_URL 是否注入——缺任一即 describe.skip。",
  );
  process.exit(1);
}
console.log(`✓ 引擎级 RLS 断言真实执行：${passed}/${assertions.length} 通过，无跳过`);
