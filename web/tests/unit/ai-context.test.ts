import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * AI 上下文聚合器（lib/ai/context.ts）的行为契约。
 *
 * 这个文件把"今日/本周/本季度"算成查询区间，再把结果拼成给 LLM 的 markdown。
 * 算错一格不会崩、不会报错，只会让用户看到一份**日期错位**的答案，
 * 所以断言全部钉在边界值上：
 *  - 周起始是周一（周日当天要回退 6 天，不是 0 天）
 *  - 季度区间跨年到 next year 的 1 月 1 日
 *  - "风险 OKR" 的 20 个百分点是严格大于
 *  - 截断提示按 slice 前的总数算（slice 之后再取长度就永远不显示）
 *  - 展示日期用本地时区（UTC 格式化会在凌晨把日期推错一天）
 *  - 单个 scope 失败不能带崩整份上下文
 */

const WID = "w-1";
const USER = "u-1";

interface Stub {
  count?: number;
  rows?: Record<string, unknown>[];
  agg?: { _sum: { duration: number | null }; _count: number };
  boom?: boolean;
}

interface Call {
  model: string;
  op: string;
  args: Record<string, unknown>;
}

function makeTx(stubs: Record<string, Stub>, calls: Call[]) {
  const model = (name: string) => {
    const s = stubs[name] ?? {};
    const guard = () => {
      if (s.boom) throw new Error(`${name} 查询失败`);
    };
    return {
      count: async (args: Record<string, unknown>) => {
        guard();
        calls.push({ model: name, op: "count", args });
        return s.count ?? 0;
      },
      findMany: async (args: Record<string, unknown>) => {
        guard();
        calls.push({ model: name, op: "findMany", args });
        return s.rows ?? [];
      },
      aggregate: async (args: Record<string, unknown>) => {
        guard();
        calls.push({ model: name, op: "aggregate", args });
        return s.agg ?? { _sum: { duration: null }, _count: 0 };
      },
    };
  };
  return new Proxy({} as Record<string, ReturnType<typeof model>>, {
    get(_t, key: string) {
      return model(key);
    },
  }) as never;
}

const getFeedbackExamplesMock = vi.hoisted(() => vi.fn(async () => [] as unknown[]));
vi.mock("@/lib/ai/feedback", () => ({
  getFeedbackExamples: getFeedbackExamplesMock,
}));

import { buildAiContext, type AiContextScope } from "@/lib/ai/context";

let calls: Call[] = [];
const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

/** 本地时区构造，避免断言本身随 CI 的 UTC 漂移 */
const local = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  new Date(y, mo - 1, d, h, mi, 0, 0);

async function run(scopes: AiContextScope[], stubs: Record<string, Stub> = {}) {
  return buildAiContext(WID, USER, scopes, makeTx(stubs, calls));
}

function callsFor(model: string, op: string) {
  return calls.filter((c) => c.model === model && c.op === op);
}

beforeEach(() => {
  calls = [];
  getFeedbackExamplesMock.mockReset();
  getFeedbackExamplesMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("buildAiContext 的时间边界", () => {
  it("周日当天，本周起点回退到上周一 00:00", async () => {
    // 2026-04-19 是周日，本周一是 2026-04-13
    vi.useFakeTimers();
    vi.setSystemTime(local(2026, 4, 19, 3, 0));

    await run(["time:week"]);
    const where = callsFor("timeEntry", "aggregate")[0].args.where as {
      startTime: { gte: Date };
    };
    expect(where.startTime.gte.getTime()).toBe(local(2026, 4, 13).getTime());
    // 若把周日按"周起始=周日"处理，这里会差 6 天
    expect(where.startTime.gte.getTime()).not.toBe(local(2026, 4, 19).getTime());
  });

  it("今日工时的区间是 [今天 00:00, 明天 00:00)，且按个人 userId 过滤", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(local(2026, 4, 15, 23, 59));

    await run(["time:today"]);
    const where = callsFor("timeEntry", "findMany")[0].args.where as {
      workspaceId: string;
      userId: string;
      startTime: { gte: Date; lt: Date };
    };
    expect(where.startTime.gte.getTime()).toBe(local(2026, 4, 15).getTime());
    // 上界取次日 00:00 而非 23:59:59.999，否则最后一毫秒的记录漏掉
    expect(where.startTime.lt.getTime()).toBe(local(2026, 4, 16).getTime());
    // 个人维度数据不能只按 workspaceId 过滤，否则把同事的工时喂给 LLM
    expect(where.userId).toBe(USER);
    expect(where.workspaceId).toBe(WID);
  });

  it("展示日期/时间按本地时区，不是 UTC", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(local(2026, 4, 15, 12, 0));

    const out = await run(["meetings:upcoming"], {
      meeting: {
        rows: [{ title: "评审", scheduledAt: local(2026, 4, 15, 23, 30), status: "planned" }],
      },
    });
    expect(out).toContain("2026-04-15 23:30");
    // toISOString 在 UTC+8 会把 23:30 显示成 15:30
    expect(out).not.toContain("15:30");
  });
});

describe("buildAiContext 风险 OKR 判定", () => {
  // 2026-07-24 处于 Q3（7/1–10/1，92 天）的第 23 天 → 时间进度恰为 25.0%
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(local(2026, 7, 24, 0, 0));
  });

  const obj = (title: string, period: string, progress: number) => ({
    title,
    period,
    progress,
    keyResults: [],
  });

  it("落后恰好 20 个百分点不算风险，超过才算", async () => {
    const out = await run(["okr:at:risk"], {
      objective: {
        rows: [obj("刚好 20", "2026-Q3", 5), obj("落后 21", "2026-Q3", 4)],
      },
    });
    expect(out).toContain("落后 21");
    expect(out).not.toContain("刚好 20");
  });

  it("周期字符串解析失败/年份异常/周期未开始，都不得进入风险清单", async () => {
    const out = await run(["okr:at:risk"], {
      objective: {
        rows: [
          obj("格式不对", "2026/3", 0),
          obj("四位数以下", "0999-Q1", 0),
          obj("Q4 还没开始", "2026-Q4", 0),
          obj("正常的", "2026-Q3", 0),
        ],
      },
    });
    expect(out).toContain("正常的");
    expect(out).not.toContain("格式不对");
    expect(out).not.toContain("四位数以下");
    expect(out).not.toContain("Q4 还没开始");
  });

  it("Q4 的时间进度上界跨到次年 1 月 1 日", async () => {
    vi.setSystemTime(local(2026, 12, 31, 0, 0));
    // 12/31 距 10/1 已经 91 天，Q4 共 92 天 → 时间进度 98.9%
    const out = await run(["okr:at:risk"], {
      objective: { rows: [obj("年底才发现落后", "2026-Q4", 10)] },
    });
    expect(out).toContain("年底才发现落后");
  });

  it("截断提示按 slice 之前的风险总数计算", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => obj(`目标${i}`, "2026-Q3", 0));
    const out = await run(["okr:at:risk"], { objective: { rows } });
    expect(out).toContain("(共 12 条，已截断至 10 条)");
    // 只渲染前 10 条
    expect(out).toContain("目标9");
    expect(out).not.toContain("目标10");
    expect(out).not.toContain("目标11");
  });
});

describe("buildAiContext 的截断与容错", () => {
  it("条数超过上限时标注总数，未超过时不标注", async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      title: `T${i}`,
      priority: "medium",
    }));
    const over = await run(["tasks:completed:today"], {
      task: { count: 51, rows: many },
    });
    expect(over).toContain("(共 51 条，已截断至 50 条)");

    calls = [];
    const exact = await run(["tasks:completed:today"], { task: { count: 50, rows: many } });
    expect(exact).not.toContain("已截断");
  });

  it("没有数据时输出「无」而不是空段落", async () => {
    const out = await run(["tasks:blocked"]);
    expect(out).toBe("## 任务（阻塞）\n无");
  });

  it("单个 scope 查询失败只丢掉那一段，其余照常聚合", async () => {
    const out = await run(["tasks:overdue", "okr:progress"], {
      objective: { boom: true },
      task: {
        count: 1,
        rows: [{ title: "拖期了", priority: "high", dueDate: local(2026, 4, 1) }],
      },
    });
    // 失败的那段不留空标题、也不留空行——整段消失
    expect(out).toBe("## 任务（逾期）\n- 拖期了 (截止: 2026-04-01, 优先级: high)");
    expect(out).not.toContain("## OKR 进度");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('scope "okr:progress"'),
      "objective 查询失败",
    );
  });

  it("空 scopes 返回空串", async () => {
    expect(await run([])).toBe("");
  });
});

describe("buildAiContext 的反馈示例注入", () => {
  const long = "x".repeat(250);

  it("不传 includeFeedback 时返回 string（向后兼容）", async () => {
    const out = await run(["tasks:blocked"]);
    expect(typeof out).toBe("string");
    expect(getFeedbackExamplesMock).not.toHaveBeenCalled();
  });

  it("有示例时追加反馈 section，并把超长载荷摘要到 200 字符", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(local(2026, 4, 15, 12, 0));
    getFeedbackExamplesMock.mockResolvedValue([
      { originalOutput: { a: 1 }, correctedOutput: long, comment: "以后按这个来" },
    ]);

    const res = await buildAiContext(
      WID,
      USER,
      ["tasks:blocked"],
      makeTx({}, calls),
      true,
      "task_suggest",
    );
    expect(res.context).toContain("## 反馈示例（用户修正后的好结果）");
    expect(res.context).toContain("备注: 以后按这个来");
    expect(res.context).toContain(`${long.slice(0, 200)}…`);
    expect(res.context).not.toContain(long);
    expect(res.feedbackExamples).toHaveLength(1);
    expect(getFeedbackExamplesMock).toHaveBeenCalledWith(WID, "task_suggest", 3, expect.anything());
  });

  it("没有示例时不带 feedbackExamples，也不追加空段落", async () => {
    const res = await buildAiContext(WID, USER, [], makeTx({}, calls), true, "task_suggest");
    expect(res.context).toBe("");
    expect(res.feedbackExamples).toBeUndefined();
  });

  it("未指定 capability 时不查反馈，但仍返回结果对象", async () => {
    const res = await buildAiContext(WID, USER, [], makeTx({}, calls), true);
    expect(getFeedbackExamplesMock).not.toHaveBeenCalled();
    expect(res.feedbackExamples).toBeUndefined();
  });

  it("反馈查询失败不影响主上下文", async () => {
    getFeedbackExamplesMock.mockRejectedValue(new Error("反馈表没建"));
    const res = await buildAiContext(WID, USER, [], makeTx({}, calls), true, "task_suggest");
    expect(res.context).toBe("");
    expect(res.feedbackExamples).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("反馈示例获取失败"), "反馈表没建");
  });
});
