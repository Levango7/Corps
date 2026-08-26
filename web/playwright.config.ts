import { defineConfig, devices } from "@playwright/test";

/**
 * E2E 浏览器级冒烟配置。
 *
 * - 本地开发：reuseExistingServer 默认开启（非 CI 时），若 :3000 已有 dev server
 *   （需带 RATE_LIMIT_DISABLED=1 启动）则直接复用，不重复拉起。
 * - CI：由 .github/workflows/ci.yml 的 e2e job 先 next build && next start，
 *   再以 PLAYWRIGHT_BASE_URL 注入地址；reuseExistingServer 关闭。
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["json", { outputFile: "pw-report.json" }]] : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    locale: "zh-CN",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
