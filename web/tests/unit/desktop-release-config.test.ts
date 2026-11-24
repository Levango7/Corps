import { describe, expect, it } from "vitest";
import { buildReleaseConfig } from "../../../desktop/scripts/release-config.mjs";

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

  it("remote 必须显式 webUrl，且 updater 保持关闭", () => {
    expect(() => buildReleaseConfig({ mode: "remote" })).toThrow("REMOTE_WEB_URL_MISSING");

    expect(() =>
      buildReleaseConfig({ mode: "remote", webUrl: "https://example.test" }),
    ).not.toThrow();

    expect(() =>
      buildReleaseConfig({
        mode: "remote",
        webUrl: "https://example.test",
        updaterEndpoint: "https://example.test/desktop/updater",
        updaterPubkey: "pub",
      }),
    ).toThrow("REMOTE_UPDATER_NOT_ALLOWED");
  });

  it("remote 只接受 https 或回环 http，拒绝其他明文地址", () => {
    expect(() => buildReleaseConfig({ mode: "remote", webUrl: "http://example.test" })).toThrow(
      "REMOTE_WEB_URL_NOT_HTTPS",
    );

    expect(() =>
      buildReleaseConfig({ mode: "remote", webUrl: "http://127.0.0.1:3000" }),
    ).not.toThrow();

    expect(buildReleaseConfig({ mode: "remote", webUrl: "http://localhost:3000" })).toEqual({
      app: { windows: [{ url: "http://localhost:3000" }] },
      plugins: { updater: { endpoints: [], pubkey: "" } },
    });
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
