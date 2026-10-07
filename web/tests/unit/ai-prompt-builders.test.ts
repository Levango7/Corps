// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  ASSISTANT_PROMPT_BUILDERS,
  summarizeHistory,
  formatPreviousOutput,
  type PromptContext,
} from "@/lib/ai/assistant/prompts";

/**
 * AI 助理 12 个 prompt builder 的契约测试。
 *
 * 这些 builder 此前零行覆盖（在 `scripts/zero-coverage-baseline.txt` 里）。
 * 测试的意义不在于覆盖率数字，而在于钉住两类会真实伤人的回归：
 *
 *  1. **能力与 builder 双源漂移**：能力 ID 在 orchestrator 的
 *     `ASSISTANT_CAPABILITIES`（意图白名单）与本目录的
 *     `ASSISTANT_PROMPT_BUILDERS`（builder 映射）两处手工维护——
 *     少一处 builder 会让该能力运行到 500，多一处则被白名单拒成死代码。
 *  2. **prompt 契约退化**：buildSystem 丢掉 JSON 输出约束 → LLM 返回
 *     markdown 打得解析失败；buildPrompt 丢掉前序上下文注入 → 多步能力
 *     的串联语义断裂。
 *
 * 双源一致性用源码文本解析（同 compose-env-coverage.test.ts 的模式）——
 * orchestrator 的 import 链带 AI SDK 与 env 读取，不适合直接 import。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCHESTRATOR_SRC = join(HERE, "../../lib/ai/assistant/orchestrator.ts");

/** 从 orchestrator 源码抽取 ASSISTANT_CAPABILITIES 数组的字符串项 */
function extractOrchestratorCapabilities(): string[] {
  const src = readFileSync(ORCHESTRATOR_SRC, "utf-8");
  const block = src.match(/export const ASSISTANT_CAPABILITIES[^=]*=\s*\[([\s\S]*?)\];/);
  if (!block) throw new Error("未在 orchestrator.ts 找到 ASSISTANT_CAPABILITIES 数组");
  return [...block[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

const EXPECTED_IDS = [
  "task_breakdown",
  "todo_extract",
  "progress_anomaly",
  "bottleneck_analysis",
  "follow_up",
  "decision_assistant",
  "approval_advice",
  "meeting_summary",
  "daily_report",
  "knowledge_extract",
  "semantic_search",
  "risk_alert",
];

const ALL_IDS = Object.keys(ASSISTANT_PROMPT_BUILDERS);

const baseCtx: PromptContext = { message: "帮我拆解这个任务", phase: "in_progress" };

describe("能力与 builder 的完整性（防双源漂移）", () => {
  it("12 个能力 ID 全部有 builder，且无多余项", () => {
    expect(ALL_IDS.sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it("与 orchestrator 的 ASSISTANT_CAPABILITIES 白名单双向一致", () => {
    const orchestratorCaps = extractOrchestratorCapabilities();
    // 白名单里的每个能力都有 builder（否则该能力运行到 unknown capability）
    for (const cap of orchestratorCaps) {
      expect(ALL_IDS, `orchestrator 白名单有 ${cap} 但没有对应 builder`).toContain(cap);
    }
    // 每个 builder 都在白名单里（否则被意图识别拒绝，成为死代码）
    for (const id of ALL_IDS) {
      expect(orchestratorCaps, `builder ${id} 不在 orchestrator 白名单里`).toContain(id);
    }
    expect(orchestratorCaps.length).toBe(ALL_IDS.length);
  });
});

describe.each(ALL_IDS)("builder 契约：%s", (id) => {
  const builder = ASSISTANT_PROMPT_BUILDERS[id as keyof typeof ASSISTANT_PROMPT_BUILDERS];

  it("buildSystem 返回非空且带 JSON 输出约束（丢了它 LLM 会回 markdown）", () => {
    const system = builder.buildSystem(baseCtx);
    expect(system.trim().length).toBeGreaterThan(0);
    expect(system).toContain("JSON");
  });

  it("buildPrompt 至少包含用户消息", () => {
    const prompt = builder.buildPrompt(baseCtx);
    expect(prompt).toContain(baseCtx.message);
  });

  it("有 previousOutput 时注入前序上下文，没有时不注入", () => {
    const withPrev = builder.buildPrompt({
      ...baseCtx,
      previousOutput: "上一步的输出内容-PREV",
    });
    expect(withPrev).toContain("【前序上下文】");
    expect(withPrev).toContain("上一步的输出内容-PREV");

    const without = builder.buildPrompt(baseCtx);
    expect(without).not.toContain("【前序上下文】");
  });

  it("有 history 时注入对话历史摘要，没有时不注入", () => {
    const withHist = builder.buildPrompt({
      ...baseCtx,
      history: [
        { role: "user", content: "之前问的问题-HIST" },
        { role: "assistant", content: "之前的回答" },
      ],
    });
    expect(withHist).toContain("【对话历史】");
    expect(withHist).toContain("之前问的问题-HIST");

    const without = builder.buildPrompt(baseCtx);
    expect(without).not.toContain("【对话历史】");
  });
});

describe("summarizeHistory", () => {
  it("无历史 / 空数组 → 空串", () => {
    expect(summarizeHistory(undefined)).toBe("");
    expect(summarizeHistory([])).toBe("");
  });

  it("正常拼接：角色本地化 + 【对话历史】前缀", () => {
    const out = summarizeHistory([
      { role: "user", content: "问题" },
      { role: "assistant", content: "回答" },
    ]);
    expect(out).toContain("【对话历史】");
    expect(out).toContain("用户：问题");
    expect(out).toContain("助理：回答");
  });

  it("只取最近 12 条（约 6 轮），更早的被丢弃", () => {
    const history = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `第${i}条`,
    }));
    const out = summarizeHistory(history);
    expect(out).not.toContain("第0条"); // 20 条时最早的 8 条应被丢弃
    expect(out).not.toContain("第7条");
    expect(out).toContain("第8条");
    expect(out).toContain("第19条");
  });

  it("单条超 500 字截断并加省略号", () => {
    const long = "长".repeat(600);
    const out = summarizeHistory([{ role: "user", content: long }]);
    expect(out).toContain("…");
    expect(out).not.toContain("长".repeat(501));
  });
});

describe("formatPreviousOutput", () => {
  it("无前序输出 → 空串", () => {
    expect(formatPreviousOutput(undefined)).toBe("");
    expect(formatPreviousOutput("")).toBe("");
  });

  it("正常拼接带 【前序上下文】前缀", () => {
    expect(formatPreviousOutput("内容")).toContain("【前序上下文】\n内容");
  });

  it("超 4000 字截断并显式标注（防静默丢上下文）", () => {
    const long = "x".repeat(4500);
    const out = formatPreviousOutput(long);
    expect(out).toContain("[前序上下文已截断]");
    expect(out.length).toBeLessThan(4200);
  });
});
