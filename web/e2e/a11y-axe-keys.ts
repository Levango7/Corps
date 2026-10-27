/**
 * axe 结果的归一化与基线 diff（纯函数，供 e2e 与单测共用）。
 *
 * ## 为什么要归一化
 *
 * axe 的 `violation.nodes[].target` 是 CSS 选择器数组，直接当基线键会**一改就飘**：
 * 列表项会带上 `:nth-child(3)`、DOM id 里带随机 uuid、文案里带时间戳/条数。
 * 一刀切不归一化，基线会天天红，最后没人看——那比没有门禁更糟。
 *
 * 归一化只抹掉**与语义无关**的抖动：
 *   - `:nth-child(n)` / `:nth-of-type(n)` 这类位置伪类 → 去掉（同一条违规在列表里
 *     第 3 项还是第 7 项，对"这个组件违反了哪条规则"没有信息量）
 *   - 纯数字段（≥3 位）→ `{n}`（列表长度、计数文案）
 *   - 长十六进制/uuid 段（≥8 位）→ `{id}`（动态 id）
 * **不动**类名、标签名、role/aria 属性——那才是定位"哪个组件出问题"的部分。
 */

export interface AxeNodeLike {
  /**
   * axe 的选择器链，越靠后越具体。
   * 元素类型是 `CrossTreeSelector[]`（跨 iframe 时每帧一段），所以允许嵌套数组。
   */
  target: readonly (string | readonly string[])[];
}

export interface AxeViolationLike {
  id: string;
  impact?: string | null;
  nodes: AxeNodeLike[];
}

/** 单条违规键：路由 → 规则 → 归一化后的选择器。 */
export function violationKey(routeKey: string, ruleId: string, target: string): string {
  return `${routeKey} :: ${ruleId} :: ${target}`;
}

/** 选择器归一化：去掉位置伪类与动态 id/数字。 */
export function normalizeSelector(selector: string): string {
  return selector
    .replace(/:nth-(?:child|of-type)\(\d+\)/g, "")
    .replace(/\b[0-9a-f]{8,}(?:-[0-9a-f]{4,})*\b/gi, "{id}")
    .replace(/\d{3,}/g, "{n}");
}

/** 把某路由的一次 axe 结果摊平成排序去重的键数组。 */
export function collectKeys(routeKey: string, violations: AxeViolationLike[]): string[] {
  const keys = new Set<string>();
  for (const v of violations) {
    for (const node of v.nodes) {
      const target = node.target
        .map((t) => (Array.isArray(t) ? t.join(" ") : (t as string)))
        .join(" ");
      keys.add(violationKey(routeKey, v.id, normalizeSelector(target)));
    }
  }
  return [...keys].sort();
}

export interface BaselineDiff {
  /** 现测有、基线没有 —— 新增违规，必须红 */
  added: string[];
  /** 基线有、现测没有 —— 已修好但没从基线摘掉，也必须红（收缩语义） */
  stale: string[];
}

/** 基线 diff：只允许收缩，不允许静默新增。 */
export function diffBaseline(
  baseline: readonly string[],
  current: readonly string[],
): BaselineDiff {
  const base = new Set(baseline);
  const cur = new Set(current);
  return {
    added: [...cur].filter((k) => !base.has(k)).sort(),
    stale: [...base].filter((k) => !cur.has(k)).sort(),
  };
}
