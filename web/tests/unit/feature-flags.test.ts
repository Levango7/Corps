// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  decideFlag,
  flagEnvKeys,
  isFlagEnabled,
  parseFlagAllowlist,
  parseFlagRollout,
} from "@/lib/feature-flags";

/**
 * 功能开关三态放量单元测试（lib/feature-flags.ts）
 *
 * 意义不在覆盖率数字，而在于：**任何把 fail-closed 改成 fail-open 的改动
 * 都必须在这里变红**——拼错的 ROLLOUT env、缺失的 wid、没配的白名单，
 * 任何一条走到「意外放量」都是回归。
 *
 * 覆盖：
 *  - ROLLOUT 解析：off/allowlist/on 原样解析；大小写不敏感
 *  - ROLLOUT 非法值 fail-closed 到 off（空串 / 拼错 / 语义含糊的值）
 *  - allowlist 命中 / 未命中 / wid 缺失 / 白名单未配置
 *  - on 态全量放行且不看白名单与身份
 *  - 多 flag 互不干扰（env key 按 flag 名隔离）
 *  - flag 名大小写归一到同一组 env key
 *
 * Mock 策略：纯函数直接打；isFlagEnabled 走真实 env 读取，
 * 用 save/restore 保证不污染其他测试的 process.env。
 */

const ENV_KEYS = ["FLAG_NEW_EDITOR_ROLLOUT", "FLAG_NEW_EDITOR_WORKSPACES", "FLAG_AI_DIGEST_ROLLOUT", "FLAG_AI_DIGEST_WORKSPACES"];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("parseFlagRollout", () => {
  it("已知值原样解析", () => {
    expect(parseFlagRollout("off")).toBe("off");
    expect(parseFlagRollout("allowlist")).toBe("allowlist");
    expect(parseFlagRollout("on")).toBe("on");
  });

  it("取值大小写不敏感", () => {
    expect(parseFlagRollout("OFF")).toBe("off");
    expect(parseFlagRollout("AllowList")).toBe("allowlist");
    expect(parseFlagRollout("ON")).toBe("on");
    expect(parseFlagRollout(" on ")).toBe("on");
  });

  it("空串 / 拼错 / 语义含糊的值一律 fail-closed 到 off", () => {
    for (const raw of ["", "   ", undefined, null, "ONN", "0", "1", "true", "enabled", "percentage", "rollout"]) {
      expect(parseFlagRollout(raw as string | undefined)).toBe("off");
    }
  });
});

describe("parseFlagAllowlist", () => {
  it("逗号分隔，条目两侧空白容忍", () => {
    expect(parseFlagAllowlist("ws-a, ws-b ,ws-c")).toEqual(["ws-a", "ws-b", "ws-c"]);
  });

  it("空段与纯空白条目被丢弃", () => {
    expect(parseFlagAllowlist("ws-a,,ws-b,  ")).toEqual(["ws-a", "ws-b"]);
    expect(parseFlagAllowlist("")).toEqual([]);
    expect(parseFlagAllowlist("   ")).toEqual([]);
    expect(parseFlagAllowlist(undefined)).toEqual([]);
    expect(parseFlagAllowlist(null)).toEqual([]);
  });
});

describe("decideFlag（纯裁决）", () => {
  it("off 恒为 false，不看白名单与身份", () => {
    expect(decideFlag("off", ["ws-1"], "ws-1")).toBe(false);
    expect(decideFlag("off", [], "ws-1")).toBe(false);
    expect(decideFlag("off", ["ws-1"])).toBe(false);
  });

  it("on 恒为 true，不看白名单与身份", () => {
    expect(decideFlag("on", [], "ws-1")).toBe(true);
    expect(decideFlag("on", [], "ws-other")).toBe(true);
    expect(decideFlag("on", [])).toBe(true);
  });

  it("allowlist 命中放行、未命中拒绝", () => {
    expect(decideFlag("allowlist", ["ws-1", "ws-2"], "ws-1")).toBe(true);
    expect(decideFlag("allowlist", ["ws-1"], "ws-other")).toBe(false);
  });

  it("allowlist 且 wid 缺失 / 空白 ⇒ false（fail-closed）", () => {
    expect(decideFlag("allowlist", ["ws-1"])).toBe(false);
    expect(decideFlag("allowlist", ["ws-1"], undefined)).toBe(false);
    expect(decideFlag("allowlist", ["ws-1"], "")).toBe(false);
    expect(decideFlag("allowlist", ["ws-1"], "   ")).toBe(false);
  });

  it("allowlist 且白名单为空 ⇒ 无人放行", () => {
    expect(decideFlag("allowlist", [], "ws-1")).toBe(false);
  });
});

describe("flagEnvKeys", () => {
  it("flag 名 trim + 大写归一到同一组 env key", () => {
    expect(flagEnvKeys("NEW_EDITOR")).toEqual({
      rollout: "FLAG_NEW_EDITOR_ROLLOUT",
      workspaces: "FLAG_NEW_EDITOR_WORKSPACES",
    });
    expect(flagEnvKeys("new_editor")).toEqual(flagEnvKeys("New_Editor"));
  });
});

describe("isFlagEnabled（env 接线）", () => {
  it("ROLLOUT 未配置 ⇒ off ⇒ false", () => {
    expect(isFlagEnabled("NEW_EDITOR", "ws-1")).toBe(false);
  });

  it("ROLLOUT 非法值 ⇒ fail-closed ⇒ false", () => {
    process.env.FLAG_NEW_EDITOR_ROLLOUT = "enabled";
    expect(isFlagEnabled("NEW_EDITOR", "ws-1")).toBe(false);
    process.env.FLAG_NEW_EDITOR_ROLLOUT = "";
    expect(isFlagEnabled("NEW_EDITOR", "ws-1")).toBe(false);
  });

  it("on ⇒ 全量 true，即使配了白名单也忽略它", () => {
    process.env.FLAG_NEW_EDITOR_ROLLOUT = "on";
    process.env.FLAG_NEW_EDITOR_WORKSPACES = "ws-1";
    expect(isFlagEnabled("NEW_EDITOR", "ws-other")).toBe(true);
    expect(isFlagEnabled("NEW_EDITOR")).toBe(true);
  });

  it("allowlist 命中放行、未命中拒绝", () => {
    process.env.FLAG_NEW_EDITOR_ROLLOUT = "allowlist";
    process.env.FLAG_NEW_EDITOR_WORKSPACES = "ws-1, ws-2";
    expect(isFlagEnabled("NEW_EDITOR", "ws-1")).toBe(true);
    expect(isFlagEnabled("NEW_EDITOR", "ws-2")).toBe(true);
    expect(isFlagEnabled("NEW_EDITOR", "ws-3")).toBe(false);
  });

  it("allowlist 但 WORKSPACES 未配置 ⇒ false（白名单为空）", () => {
    process.env.FLAG_NEW_EDITOR_ROLLOUT = "allowlist";
    expect(isFlagEnabled("NEW_EDITOR", "ws-1")).toBe(false);
  });

  it("allowlist 但 wid 缺失 ⇒ false", () => {
    process.env.FLAG_NEW_EDITOR_ROLLOUT = "allowlist";
    process.env.FLAG_NEW_EDITOR_WORKSPACES = "ws-1";
    expect(isFlagEnabled("NEW_EDITOR")).toBe(false);
    expect(isFlagEnabled("NEW_EDITOR", "")).toBe(false);
    expect(isFlagEnabled("NEW_EDITOR", "  ")).toBe(false);
  });

  it("flag 名大小写不敏感：落到同一组 env key", () => {
    process.env.FLAG_NEW_EDITOR_ROLLOUT = "allowlist";
    process.env.FLAG_NEW_EDITOR_WORKSPACES = "ws-1";
    expect(isFlagEnabled("new_editor", "ws-1")).toBe(true);
    expect(isFlagEnabled("New_Editor", "ws-2")).toBe(false);
  });

  it("多 flag 互不干扰", () => {
    process.env.FLAG_NEW_EDITOR_ROLLOUT = "on";
    process.env.FLAG_AI_DIGEST_ROLLOUT = "allowlist";
    process.env.FLAG_AI_DIGEST_WORKSPACES = "ws-9";
    // NEW_EDITOR on：任何工作区都放行
    expect(isFlagEnabled("NEW_EDITOR", "ws-9")).toBe(true);
    expect(isFlagEnabled("NEW_EDITOR")).toBe(true);
    // AI_DIGEST allowlist：只有白名单内的工作区放行
    expect(isFlagEnabled("AI_DIGEST", "ws-9")).toBe(true);
    expect(isFlagEnabled("AI_DIGEST", "ws-1")).toBe(false);
    expect(isFlagEnabled("AI_DIGEST")).toBe(false);
  });

  it("env 每次调用现读：同进程内改值下一调用即生效", () => {
    process.env.FLAG_NEW_EDITOR_ROLLOUT = "off";
    expect(isFlagEnabled("NEW_EDITOR", "ws-1")).toBe(false);
    process.env.FLAG_NEW_EDITOR_ROLLOUT = "on";
    expect(isFlagEnabled("NEW_EDITOR", "ws-1")).toBe(true);
    process.env.FLAG_NEW_EDITOR_ROLLOUT = "typo";
    expect(isFlagEnabled("NEW_EDITOR", "ws-1")).toBe(false);
  });
});
