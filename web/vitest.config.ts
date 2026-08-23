import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    // 集成测试是纯 API 测试（fetch localhost），无需 DOM
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    // 仅收集 tests/ 下的测试，避免误抓 app/ 中的 *.test.ts 当作用例
    include: ["tests/**/*.test.ts"],
    // 集成测试需要起 Next dev server + DB 往返，给足超时余量
    testTimeout: 15_000,
    hookTimeout: 30_000,
    // 并发隔离：每个测试文件独立进程，避免模块级共享状态串扰
    // （workspace.test.ts 中的 tokenA/tokenB 等模块级变量在 file 隔离下安全）
    isolate: true,
    // 集成测试依赖外部 dev server，禁止 Vitest 自动 watch 干扰
    pool: "forks",
    coverage: {
      // 覆盖率仅作可见性指标，不设阈值（避免 T-3 阶段被未覆盖文件阻塞 CI）
      // 后续可逐步提高 thresholds.lines/branches/functions/statements
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["app/api/**/*.ts", "lib/**/*.ts"],
      exclude: ["**/*.config.*", "**/node_modules/**"],
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
});
