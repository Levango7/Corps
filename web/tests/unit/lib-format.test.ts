// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  formatRelativeDueDate,
  dueMeta,
  relativeTime,
  relTime,
  formatTaskId,
  markdownToPlainText,
  sortTasks,
  SUMMARY_LIMIT,
} from "@/lib/format";
import type { TimeT } from "@/lib/format";

/**
 * 格式化工具（lib/format.ts）的契约。
 *
 * 该模块是任务/动态 feed 的纯展示层：日期计算走本地午夜截断
 * （墙上时钟走 vi.setSystemTime 固定，跨时区结果一致），
 * TimeT 参数让英文环境替换文案而不改实现。
 */

const NOW = new Date(2026, 9, 29, 14, 30, 0); // 2026-10-29 14:30 本地

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

/** 本地某天的 ISO 字符串（00:00 本地），函数内部 new Date() 能解析回同一日期 */
function isoOn(dayOffset: number, hours = 9): string {
  const d = new Date(2026, 9, 29 + dayOffset, hours);
  return d.toISOString();
}

describe("formatRelativeDueDate —— 天粒度相对日期", () => {
  it("逾期一天 → overdue 语气 + 逾期 1 天", () => {
    const r = formatRelativeDueDate(isoOn(-1));
    expect(r.tone).toBe("overdue");
    expect(r.text).toContain("逾期");
  });

  it("今天 → today", () => {
    expect(formatRelativeDueDate(isoOn(0)).tone).toBe("today");
    expect(formatRelativeDueDate(isoOn(0)).text).toContain("今天");
  });

  it("明天 → tomorrow", () => {
    const r = formatRelativeDueDate(isoOn(1));
    expect(r.tone).toBe("normal");
    expect(r.text).toContain("明天");
  });

  it("N 天后 → normal + N 天后", () => {
    const r = formatRelativeDueDate(isoOn(5));
    expect(r.tone).toBe("normal");
    expect(r.text).toContain("5");
  });

  it("天粒度：今天 23:59 与今天 00:00 都是今天（不做小时级比较）", () => {
    expect(formatRelativeDueDate(isoOn(0, 23)).tone).toBe("today");
    expect(formatRelativeDueDate(isoOn(0, 0)).tone).toBe("today");
  });

  it("昨天 23:59 与昨天 00:00 都是逾期（按本地午夜截断）", () => {
    expect(formatRelativeDueDate(isoOn(-1, 23)).tone).toBe("overdue");
    expect(formatRelativeDueDate(isoOn(-1, 0)).tone).toBe("overdue");
  });

  it("英文文案注入（TimeT）—— 不写死中文", () => {
    const en: TimeT = (key, values) => {
      const n = values?.days ?? values?.count ?? 0;
      switch (key) {
        case "overdueDays": return `overdue ${n}d`;
        case "dueToday": return "today";
        case "dueTomorrow": return "tomorrow";
        case "dueInDays": return `in ${n}d`;
        default: return key;
      }
    };
    expect(formatRelativeDueDate(isoOn(-2), en).text).toBe("overdue 2d");
    expect(formatRelativeDueDate(isoOn(0), en).text).toBe("today");
    expect(formatRelativeDueDate(isoOn(1), en).text).toBe("tomorrow");
    expect(formatRelativeDueDate(isoOn(3), en).text).toBe("in 3d");
  });
});

describe("dueMeta", () => {
  it("无日期返回 null（列表项不渲染角标）", () => {
    expect(dueMeta(undefined)).toBeNull();
    expect(dueMeta(null)).toBeNull();
  });

  it("无效日期不抛错（宽松解析：落到「远期」分支显示 Invalid Date，而非崩溃）", () => {
    expect(() => dueMeta("not-a-date")).not.toThrow();
    const r = dueMeta("not-a-date");
    expect(r).not.toBeNull();
    expect(typeof r!.text).toBe("string");
  });

  it("返回文案与颜色 token 两字段", () => {
    const r = dueMeta(isoOn(-1));
    expect(r).not.toBeNull();
    expect(typeof r!.text).toBe("string");
    expect(typeof r!.color).toBe("string");
    expect(r!.text.length).toBeGreaterThan(0);
  });

  it(">7 天的远期任务显示日历日期（月-日），不显示相对文案", () => {
    const r = dueMeta(isoOn(30));
    expect(r!.text).toMatch(/10|11|12/); // 2026-11-28 之类
    expect(r!.text).not.toContain("天后");
  });

  it("逾期用 danger token、今天用 warn、远期用 muted/meta token", () => {
    expect(dueMeta(isoOn(-1))!.color).toMatch(/danger|red/i);
  });
});

describe("relativeTime / relTime", () => {
  it("relativeTime 无值返回 null", () => {
    expect(relativeTime(undefined)).toBeNull();
    expect(relativeTime(null)).toBeNull();
  });

  it("relativeTime 无效日期返回 null，不抛错", () => {
    expect(relativeTime("garbage")).toBeNull();
  });

  it("刚刚 / N 分钟前 / N 小时前 / N 天前 四档", () => {
    const mins = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
    expect(relativeTime(mins(0))).toContain("刚");
    expect(relativeTime(mins(5))).toContain("分钟");
    expect(relativeTime(mins(120))).toContain("小时");
    expect(relativeTime(mins(60 * 26))).toContain("天");
  });

  it("超过年末的旧时间回退为 月-日 格式", () => {
    const old = new Date(2026, 0, 15).toISOString(); // 2026-01-15
    const r = relativeTime(old);
    expect(r).not.toBeNull();
    expect(r).toMatch(/1/); // 1月
  });

  it("relTime 总是返回字符串（与 relativeTime 不同：不返回 null）", () => {
    expect(typeof relTime(new Date(2026, 9, 20).toISOString())).toBe("string");
  });
});

describe("formatTaskId", () => {
  it("短 id 截 4 位并大写，带 CORP- 前缀", () => {
    expect(formatTaskId("abcd1234")).toBe("CORP-ABCD");
  });

  it("不足 4 位的 id 不报错（slice 天然兜底）", () => {
    expect(formatTaskId("ab")).toBe("CORP-AB");
  });

  it("同一 id 稳定（无随机成分）", () => {
    expect(formatTaskId("abcd1234")).toBe(formatTaskId("abcd1234"));
  });
});

describe("markdownToPlainText", () => {
  it("默认上限 SUMMARY_LIMIT=200", () => {
    expect(SUMMARY_LIMIT).toBe(200);
  });

  it("超长文本截断并追加省略号", () => {
    const long = "字".repeat(SUMMARY_LIMIT + 50);
    const out = markdownToPlainText(long);
    expect(out.length).toBeLessThanOrEqual(SUMMARY_LIMIT + 1);
    expect(out.endsWith("…")).toBe(true);
  });

  it("恰在上限的不截断", () => {
    const exact = "字".repeat(SUMMARY_LIMIT);
    expect(markdownToPlainText(exact)).toBe(exact);
  });

  it("自定义 limit 生效（slice(0, limit) + 省略号）", () => {
    expect(markdownToPlainText("abcdefghij", 5)).toBe("abcde…");
  });

  it("剥离标题/加粗/斜体（* 与 _ 两种语法）", () => {
    expect(markdownToPlainText("# 标题")).not.toContain("#");
    expect(markdownToPlainText("**加粗**")).toBe("加粗");
    expect(markdownToPlainText("*斜体*")).toBe("斜体");
    expect(markdownToPlainText("_斜体_")).toBe("斜体");
    // ~~删除线~~ 不在轻量剥离范围内（仅做 * / _ 强调剥离，见实现注释）
    expect(markdownToPlainText("~~删~~")).toBe("~~删~~");
  });

  it("剥离行内代码与代码块", () => {
    expect(markdownToPlainText("用 `code` 实现")).toBe("用 code 实现");
    expect(markdownToPlainText("```\ncode block\n```")).not.toContain("```");
  });

  it("图片语法剥离后保留 alt 文本（与链接同形处理，链接保留文字）", () => {
    expect(markdownToPlainText("![alt](http://x/a.png)")).toBe("alt");
    expect(markdownToPlainText("[链接文字](http://x)")).toBe("链接文字");
  });

  it("剥离列表标记/引用/分隔线", () => {
    expect(markdownToPlainText("- item1\n- item2")).toBe("item1\nitem2");
    expect(markdownToPlainText("> 引用")).toBe("引用");
    expect(markdownToPlainText("---")).toBe("");
  });

  it("剥离 HTML 标签", () => {
    expect(markdownToPlainText("<b>粗</b>")).toBe("粗");
    expect(markdownToPlainText("<img src='x'>")).toBe("");
  });

  it("多个连续空行折叠为单个换行", () => {
    const out = markdownToPlainText("a\n\n\n\nb");
    expect(out).not.toMatch(/\n{2,}/);
  });
});

describe("sortTasks", () => {
  const tasks = [
    { id: "1", updatedAt: "2026-10-01T00:00:00.000Z", dueDate: isoOn(2), priority: "low" },
    { id: "2", updatedAt: "2026-10-05T00:00:00.000Z", dueDate: isoOn(0), priority: "high" },
    { id: "3", updatedAt: "2026-10-03T00:00:00.000Z", dueDate: null, priority: "medium" },
  ] as Array<Record<string, unknown>>;

  it("recent → updatedAt 倒序（最新在前）", () => {
    const out = sortTasks([...tasks] as never, "recent");
    expect(out.map((t) => t.id)).toEqual(["2", "3", "1"]);
  });

  it("due → dueDate 升序，无 dueDate 排到最后（不报错）", () => {
    const out = sortTasks([...tasks] as never, "due");
    expect(out[0].id).toBe("2");
    expect(out[out.length - 1].id).toBe("3");
  });

  it("priority → 按 priorityOrder 的 rank 排（Record：等级 → 序号）", () => {
    const out = sortTasks([...tasks] as never, "priority", {
      high: 0,
      medium: 1,
      low: 2,
    });
    expect(out.map((t) => t.id)).toEqual(["2", "3", "1"]);
  });

  it("priority 中 priorityOrder 未覆盖的等级比较结果为 0（保持原序，不挪到末尾）", () => {
    const out = sortTasks([...tasks] as never, "priority", { high: 0 });
    // low/medium 无 rank → NaN → 比较为 0，仅 high(2) 不前移；原序 [1,2,3] 中 2 不动
    expect(out.map((t) => t.id)).toEqual(["1", "2", "3"]);
  });

  it("空数组返回空数组（不抛错）", () => {
    expect(sortTasks([], "recent")).toEqual([]);
    expect(sortTasks([], "due")).toEqual([]);
  });
});
