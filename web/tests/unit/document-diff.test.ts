// @vitest-environment node
import { describe, it, expect } from "vitest";
import { diffMarkdown } from "@/lib/document-diff";

/**
 * 行级 diff 的单元测试
 *
 * 为什么单独测：diff 是 compare 端点的全部业务价值所在，
 * 而 compare 端点的集成测试只能证明"有差异返回"，证明不了差异**算得对**。
 * 沉默逻辑错误（编译过、跑得动、结果错）最常发生在这种算法里。
 */

describe("diffMarkdown — 相同内容", () => {
  it("完全相同则无任何差异", () => {
    const d = diffMarkdown("a\nb\nc", "a\nb\nc");
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.modified).toEqual([]);
    expect(d.stats).toEqual({ additions: 0, deletions: 0, modifications: 0 });
  });

  it('空串与空串无差异（不得因 [""] 与 [] 的实现差异产生假差异）', () => {
    const d = diffMarkdown("", "");
    expect(d.stats.additions + d.stats.deletions + d.stats.modifications).toBe(0);
  });
});

describe("diffMarkdown — 增删改判定", () => {
  it("纯新增行进 added，且不进 removed", () => {
    const d = diffMarkdown("a\nb", "a\nb\nc");
    expect(d.added).toEqual(["c"]);
    expect(d.removed).toEqual([]);
    expect(d.stats.additions).toBe(1);
    expect(d.stats.deletions).toBe(0);
  });

  it("纯删除行进 removed，且不进 added", () => {
    const d = diffMarkdown("a\nb\nc", "a\nc");
    expect(d.removed).toEqual(["b"]);
    expect(d.added).toEqual([]);
    expect(d.stats.deletions).toBe(1);
  });

  it("等长替换折叠为 modified（不谎报为一增一删）", () => {
    const d = diffMarkdown("a\nold\nc", "a\nnew\nc");
    expect(d.modified).toEqual([{ before: "old", after: "new", line: 2 }]);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.stats.modifications).toBe(1);
  });

  it("不等长替换不强行配对，如实报 added + removed", () => {
    // 删 1 行加 2 行：强行按位置配对会编造出"改了 2 行"的事实
    const d = diffMarkdown("a\nold\nc", "a\nnew1\nnew2\nc");
    expect(d.modified).toEqual([]);
    expect(d.removed).toEqual(["old"]);
    expect(d.added).toEqual(["new1", "new2"]);
    expect(d.stats.additions).toBe(2);
    expect(d.stats.deletions).toBe(1);
  });

  it("多行等长替换逐行配对", () => {
    const d = diffMarkdown("a\nx1\nx2\nc", "a\ny1\ny2\nc");
    expect(d.modified.length).toBe(2);
    expect(d.modified[0]).toEqual({ before: "x1", after: "y1", line: 2 });
    expect(d.modified[1]).toEqual({ before: "x2", after: "y2", line: 3 });
  });
});

describe("diffMarkdown — 顺序与内容守恒", () => {
  it("内容不同的两段必然产生可见差异（防静默返回空 diff）", () => {
    const d = diffMarkdown("# v1\n第一版", "# v2\n第二版");
    const total = d.added.length + d.removed.length + d.modified.length;
    expect(total).toBeGreaterThan(0);
  });

  it("行序颠倒要报出差异而不是当成集合相同", () => {
    const d = diffMarkdown("a\nb\nc", "c\nb\na");
    const total = d.added.length + d.removed.length + d.modified.length;
    expect(total).toBeGreaterThan(0);
  });

  it("保留未改动行（不把整篇都算成改动）", () => {
    const d = diffMarkdown("keep1\nold\nkeep2", "keep1\nnew\nkeep2");
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.modified).toHaveLength(1);
  });

  it("尾部追加不影响前面行的配对", () => {
    const d = diffMarkdown("a\nb", "a\nb\nc\nd");
    expect(d.added).toEqual(["c", "d"]);
    expect(d.removed).toEqual([]);
  });
});

describe("diffMarkdown — 大输入降级不产生错误结果", () => {
  it("超大文档走降级路径时结果仍自洽（不会崩、不会谎报相同）", () => {
    const big = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join("\n");
    const big2 = big.replace("line 0", "line 0 changed");
    const d = diffMarkdown(big, big2);
    const total = d.added.length + d.removed.length + d.modified.length;
    expect(total).toBeGreaterThan(0);
    // 降级只影响配对精度，不影响"确有差异"这一事实
    expect(d.stats.additions + d.stats.deletions).toBeGreaterThan(0);
  });
});
