import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    // 集成测试是纯 API 测试（fetch localhost），无需 DOM；
    // 组件单元测试通过文件顶部 `// @vitest-environment jsdom` 注释按需切换到 jsdom。
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    // 收集 tests/ 下的测试：工具函数用例 .test.ts，组件用例 .test.tsx
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // 超时预算按**实测成本**设定，不按感觉设定（2026-09-30 在纯 HEAD 的隔离环境实测）：
    //  - tests/integration/rbac.test.ts 的 beforeAll 单独跑（服务已热、无并发）耗时 27.34s，
    //    旧 hookTimeout=30_000 只剩 9% 余量；全量 62 文件并发时两次跑出同一红：
    //    "Hook timed out in 30000ms"（rbac.test.ts:36）。
    //  - tests/unit/rls-bare-query-guard.test.ts 的静态扫描单独跑耗时 13.30s（Windows 下
    //    walk+statSync 偏慢），旧 testTimeout=15_000 只剩 1.27 倍余量，负载下已复现超时红。
    // 抬的是 setup/扫描的预算，**没有任何断言被放宽或删除**；真正的失败仍会照常变红，
    // 只是最多晚 45s/90s 才报出来。待办：把裸查守卫的扫描本身做快（那是根因，抬预算是止血）。
    testTimeout: 45_000,
    hookTimeout: 90_000,
    // 并发隔离：每个测试文件独立进程，避免模块级共享状态串扰
    // （workspace.test.ts 中的 tokenA/tokenB 等模块级变量在 file 隔离下安全）
    isolate: true,
    // 集成测试依赖外部 dev server，禁止 Vitest 自动 watch 干扰
    pool: "forks",
    coverage: {
      // 覆盖率基线阈值：保守设定，避免阻塞 CI 同时防止覆盖率退化
      // 后续可逐步提高 thresholds.lines/branches/functions/statements
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      // 默认为 false：任一测试变红时 Vitest 直接跳过覆盖率评估，门禁等于没跑。
      // 本仓库 CI 连红期间从未产出覆盖率数字，成因之一即在此。
      reportOnFailure: true,
      include: ["app/api/**/*.ts", "lib/**/*.ts", "components/**/*.tsx"],
      exclude: ["**/*.config.*", "**/node_modules/**"],
      // 阈值**只在一处声明**：CI 的 `coverage` job 用 CLI 传
      // --coverage.thresholds.lines=…（棘轮，只许上调）。
      // 这里原另有一份 lines:20/branches:15/…，与那份互不相干地并存：`test` job 跑裸
      // `vitest run --coverage` 时吃到的是本文件的 20%，而实测覆盖率约 4%，于是整条腿判红
      // （2026-09-30 首跑就是如此）。同一指标两处声明 = 改一处、另一处静默腐烂。
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
});
