import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildReleaseConfig } from "../../../desktop/scripts/release-config.mjs";

const tauriConfig = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../desktop/src-tauri/tauri.conf.json", import.meta.url)),
    "utf8",
  ),
) as { app: { windows: Array<Record<string, unknown>> } };
const baseWindow = tauriConfig.app.windows[0];

describe("buildReleaseConfig", () => {
  it("embedded 默认关闭 updater，且不允许混入 CORPS_WEB_URL", () => {
    expect(buildReleaseConfig({ mode: "embedded" })).toEqual({});
    expect(() => buildReleaseConfig({ mode: "embedded", webUrl: "https://example.test" })).toThrow(
      "EMBEDDED_WEB_URL_NOT_ALLOWED",
    );
  });

  it("embedded 启用自动更新必须端点与公钥成对", () => {
    expect(() =>
      buildReleaseConfig({
        mode: "embedded",
        updaterEndpoint: "https://example.test/desktop/updater",
      }),
    ).toThrow("UPDATER_PAIR_INCOMPLETE");

    expect(
      buildReleaseConfig({
        mode: "embedded",
        updaterEndpoint: "https://example.test/desktop/updater",
        updaterPubkey: "pub",
      }),
    ).toEqual({
      plugins: {
        updater: {
          endpoints: ["https://example.test/desktop/updater"],
          pubkey: "pub",
        },
      },
    });
  });

  it("remote 必须显式 webUrl", () => {
    expect(() => buildReleaseConfig({ mode: "remote" })).toThrow("REMOTE_WEB_URL_MISSING");
  });

  it("remote 覆盖 URL 时保留完整基础窗口属性", () => {
    const webUrl = "https://example.test/login";

    expect(buildReleaseConfig({ mode: "remote", webUrl, baseWindow })).toMatchObject({
      app: { windows: [{ ...baseWindow, url: webUrl }] },
    });
  });

  it("remote 跳过前端构建且不打包 standalone", () => {
    const webUrl = "https://example.test";

    expect(buildReleaseConfig({ mode: "remote", webUrl, baseWindow })).toMatchObject({
      build: {
        frontendDist: webUrl,
        beforeBuildCommand: null,
      },
      bundle: { resources: [] },
    });
  });

  it("remote 强制关闭 updater，忽略环境残留的 embedded 配置", () => {
    expect(
      buildReleaseConfig({
        mode: "remote",
        webUrl: "https://example.test",
        baseWindow,
        updaterEndpoint: "https://example.test/desktop/updater",
        updaterPubkey: "pub",
      }),
    ).toMatchObject({
      plugins: { updater: { endpoints: [], pubkey: "" } },
    });
  });

  it("remote 只接受 https 或回环 http，拒绝其他明文地址", () => {
    expect(() => buildReleaseConfig({ mode: "remote", webUrl: "http://example.test" })).toThrow(
      "REMOTE_WEB_URL_NOT_HTTPS",
    );

    expect(() =>
      buildReleaseConfig({ mode: "remote", webUrl: "http://127.0.0.1:3000", baseWindow }),
    ).not.toThrow();
    expect(() =>
      buildReleaseConfig({ mode: "remote", webUrl: "http://[::1]:3000", baseWindow }),
    ).not.toThrow();
  });

  it("remote 拒绝包含用户信息的 URL", () => {
    for (const webUrl of [
      "https://user:pass@example.test",
      "https://@example.test",
      "https://:@example.test",
    ]) {
      expect(() => buildReleaseConfig({ mode: "remote", webUrl, baseWindow })).toThrow(
        "REMOTE_WEB_URL_USERINFO_NOT_ALLOWED",
      );
    }
  });

  it("非法 shell 模式 fail loud", () => {
    expect(() =>
      buildReleaseConfig({
        mode: "auto" as "embedded" | "remote",
        webUrl: "https://example.test",
      }),
    ).toThrow("RELEASE_MODE_INVALID");
  });
});

describe("prepare-release CLI", () => {
  let fixtureRoot: string;
  let scriptPath: string;
  let generatedConfigPath: string;

  beforeAll(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), "corps-release-config-"));
    const desktopDir = fileURLToPath(new URL("../../../desktop/", import.meta.url));
    const scriptsDir = join(fixtureRoot, "desktop", "scripts");
    const tauriDir = join(fixtureRoot, "desktop", "src-tauri");
    mkdirSync(scriptsDir, { recursive: true });
    mkdirSync(tauriDir, { recursive: true });
    cpSync(
      join(desktopDir, "scripts", "prepare-release.mjs"),
      join(scriptsDir, "prepare-release.mjs"),
    );
    cpSync(
      join(desktopDir, "scripts", "release-config.mjs"),
      join(scriptsDir, "release-config.mjs"),
    );
    cpSync(join(desktopDir, "src-tauri", "tauri.conf.json"), join(tauriDir, "tauri.conf.json"));
    scriptPath = join(scriptsDir, "prepare-release.mjs");
    generatedConfigPath = join(tauriDir, "tauri.release.conf.json");
  });

  afterAll(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  function runPrepareRelease(webUrl = "") {
    return spawnSync(process.execPath, [scriptPath], {
      encoding: "utf8",
      env: {
        ...process.env,
        CORPS_SHELL_MODE: "remote",
        CORPS_WEB_URL: webUrl,
        CORPS_UPDATER_ENDPOINT: "",
        CORPS_UPDATER_PUBKEY: "",
      },
    });
  }

  it("remote 缺少 URL 时子进程非零退出", () => {
    const result = runPrepareRelease();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("REMOTE_WEB_URL_MISSING");
  });

  it("remote 日志只打印 origin，不泄露 query 或 hash", () => {
    const result = runPrepareRelease("https://example.test/app?token=do-not-log#frag");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("remote origin = https://example.test");
    expect(result.stdout).not.toContain("do-not-log");
    expect(result.stdout).not.toContain("#frag");
    expect(JSON.parse(readFileSync(generatedConfigPath, "utf8"))).toMatchObject({
      build: { frontendDist: "https://example.test/app?token=do-not-log#frag" },
      bundle: { resources: [] },
    });
  });
});

describe("desktop release CI", () => {
  it("桌面构建不复用移动端共享 Web URL 变量", () => {
    const workflow = readFileSync(
      fileURLToPath(new URL("../../../.github/workflows/tauri-build.yml", import.meta.url)),
      "utf8",
    );

    expect(workflow).not.toContain("${{ vars.CORPS_WEB_URL }}");
    expect(workflow).toContain("inputs.corps_web_url || vars.CORPS_DESKTOP_WEB_URL");
  });

  it("Rust release-mode 测试进入 required Build", () => {
    const workflow = readFileSync(
      fileURLToPath(new URL("../../../.github/workflows/ci.yml", import.meta.url)),
      "utf8",
    ).replace(/\r\n/g, "\n");
    const buildJob = workflow.match(/^ {2}build:\n([\s\S]*?)(?=^ {2}[a-z][\w-]*:\n)/m)?.[1];

    expect(buildJob).toContain(
      "cargo test --test release_mode -- --ignored remote_build_env_disables_sidecar",
    );
  });
});
