// @vitest-environment node
import { describe, it, expect } from "vitest";

import {
  CAPABILITIES,
  PROMPT_BUILDERS,
  SCOPES_BY_CAPABILITY,
  extractPushContent,
  safeSlice,
} from "@/lib/ai/push-runner";

/**
 * AI 推送生成器的纯函数与配置表契约（lib/ai/push-runner.ts）：
 *  - safeSlice：按 **Unicode 码点**截断（代理对 emoji 不被劈成半个）
 *  - extractPushContent：LLM 输出 → { title, summary, detail } 的防御性解析
 *    （非对象 null；title 缺省/空串回退 "{capability} 推送"；title 200 / summary 5000
 *    按 DB 列长截断；detail 为原始对象）
 *  - 配置表一致性：三个 capability 在 SCOPES/PROMPT_BUILDERS 都有条目，
 *    且 useReasoner 与「风险/异常类用推理模型、日报用默认模型」的约定一致
 */
describe("safeSlice：按码点截断", () => {
  it("普通字符串按长度截断", () => {
    expect(safeSlice("abcdef", 3)).toBe("abc");
    expect(safeSlice("abc", 10)).toBe("abc");
  });

  it("代理对字符不被劈开（按码点计数）", () => {
    // 注：用 CJK Ext B 的 𠀀（U+20000，同为代理对 2 个 UTF-16 单元）而非 emoji ——
    // P0-1 门禁禁止源码出现 emoji（含测试），代理对语义等价（b1 批次同款规避姿势）
    const s = "\u{20000}\u{20000}\u{20000}";
    expect(safeSlice(s, 2)).toBe("\u{20000}\u{20000}");
    expect(Array.from(safeSlice(s, 2)).length).toBe(2);
    expect(safeSlice(s, 2)).not.toContain("\uFFFD");
    // 劈半的反例：UTF-16 直接 slice 会留下孤立高代理项
    expect(s.slice(0, 3)).not.toBe(safeSlice(s, 2));
  });

  it("中英混排按码点", () => {
    expect(safeSlice("中文abc", 4)).toBe("中文ab");
  });
});

describe("extractPushContent：LLM 输出解析", () => {
  it("合法对象：title/summary 按列长截断（200/5000），detail 保留原对象", () => {
    const raw = { title: "T".repeat(300), summary: "S".repeat(6000), extra: 1 };
    const out = extractPushContent(raw, "daily_briefing")!;
    expect(out.title).toHaveLength(200);
    expect(out.summary).toHaveLength(5000);
    expect(out.detail).toBe(raw);
  });

  it("title 缺失 / 空串 / 纯空白：回退 '{capability} 推送'", () => {
    expect(extractPushContent({}, "risk_alert")!.title).toBe("risk_alert 推送");
    expect(extractPushContent({ title: "" }, "risk_alert")!.title).toBe("risk_alert 推送");
    expect(extractPushContent({ title: "   " }, "risk_alert")!.title).toBe("risk_alert 推送");
  });

  it("title 非字符串：回退；summary 缺失/非字符串：空串", () => {
    const out = extractPushContent({ title: 42, summary: { a: 1 } }, "progress_anomaly")!;
    expect(out.title).toBe("progress_anomaly 推送");
    expect(out.summary).toBe("");
  });

  it("非对象/ null：返回 null（调用方据此跳过落库）", () => {
    expect(extractPushContent(null, "daily_briefing")).toBeNull();
    expect(extractPushContent("text", "daily_briefing")).toBeNull();
    expect(extractPushContent(undefined, "daily_briefing")).toBeNull();
  });
});

describe("配置表一致性", () => {
  it("CAPABILITIES 三项在 SCOPES 与 PROMPT_BUILDERS 都有条目且范围非空", () => {
    expect([...CAPABILITIES]).toEqual(["daily_briefing", "risk_alert", "progress_anomaly"]);
    for (const cap of CAPABILITIES) {
      expect(SCOPES_BY_CAPABILITY[cap].length).toBeGreaterThan(0);
      expect(typeof PROMPT_BUILDERS[cap].buildSystem).toBe("function");
      expect(typeof PROMPT_BUILDERS[cap].buildUser).toBe("function");
    }
  });

  it("模型档位约定：日报用默认模型（false），风险/异常用推理模型（true）", () => {
    expect(PROMPT_BUILDERS.daily_briefing.useReasoner).toBe(false);
    expect(PROMPT_BUILDERS.risk_alert.useReasoner).toBe(true);
    expect(PROMPT_BUILDERS.progress_anomaly.useReasoner).toBe(true);
  });

  it("prompt builder 是纯字符串函数：给定 ctx 返回非空 system/user", () => {
    const ctx = { context: "CTX", workspaceId: "w1", userId: "u1" } as never;
    for (const cap of CAPABILITIES) {
      const sys = PROMPT_BUILDERS[cap].buildSystem(ctx);
      const usr = PROMPT_BUILDERS[cap].buildUser(ctx);
      expect(typeof sys).toBe("string");
      expect(sys.length).toBeGreaterThan(0);
      expect(typeof usr).toBe("string");
      expect(usr.length).toBeGreaterThan(0);
    }
  });
});
