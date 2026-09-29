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
    // 超时预算按**分条件实测**取值，冷/热两种条件都必须写清，否则数字会误导人
    // （2026-09-30 复算修正：本注释此前把冷启动值误标成"服务已热"，见 CHANGELOG 同日修正条目）：
    //  - tests/integration/rbac.test.ts：热态单跑 tests=5.32s（并发会话独立测得 5.27s，互相印证）；
    //    但**冷启动首次命中**（dev server 刚起、路由未编译、62 文件并发）把同一个 beforeAll 推到 27s+，
    //    放大约 5 倍——成因是 Next 懒编译的首次命中成本，不是用例本身慢。
    //    旧 hookTimeout=30_000 在冷态几乎无余量，本地两次复现同一红：Hook timed out in 30000ms。
    //  - tests/unit/rls-bare-query-guard.test.ts：热态 tests=0.94s；首次命中 8.67s，负载下测过 13.30s。
    //    旧 testTimeout=15_000 对首次命中只留 1.1~1.7 倍余量。
    // CI 永远是冷启动，所以预算必须按冷态取值，不能按热态。抬的是 setup/扫描预算，
    // **没有放宽任何断言**：真实失败仍会照常变红，只是最晚 45s/90s 才报。
    // 另一半修复在调用点：rbac-members.test.ts 与 auth-flow.test.ts 原写死 `, 30_000`，
    // 会直接盖掉这里的全局值——只改本文件对那两个文件无效（字面量已删，配置为单一来源）。
    // 遗留：守卫扫描首次命中 8.67s 本身偏慢（walk+statSync），做快它才是治本，抬预算是止血。
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
