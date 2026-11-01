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

export interface AxeCheckLike {
  id?: string;
  message?: string;
  /** axe 各 check 自己决定形状；color-contrast 的形状见 collectDetails 的注释 */
  data?: unknown;
}

export interface AxeRelatedLike {
  target?: readonly (string | readonly string[])[];
}

export interface AxeNodeLike {
  /**
   * axe 的选择器链，越靠后越具体。
   * 元素类型是 `CrossTreeSelector[]`（跨 iframe 时每帧一段），所以允许嵌套数组。
   */
  target: readonly (string | readonly string[])[];
  impact?: string | null;
  html?: string;
  /** "any of" 组：规则要求任一通过，未通过的那些落在这里 */
  any?: readonly AxeCheckLike[];
  /** "all of" 组 */
  all?: readonly AxeCheckLike[];
  /** "none of" 组 */
  none?: readonly AxeCheckLike[];
  /** axe 4.x 里失败项也会直接汇总到 failed */
  failed?: readonly AxeCheckLike[];
  /** 贡献背景色的祖先节点；背景是叠加出来的时，只看 bgColor 会误判 */
  relatedNodes?: readonly AxeRelatedLike[];
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

/** 一个节点对应的基线键（collectKeys 与 collectDetails 共用，防止两处键算得不一样）。 */
export function nodeKey(routeKey: string, ruleId: string, node: AxeNodeLike): string {
  const target = node.target
    .map((t) => (Array.isArray(t) ? t.join(" ") : (t as string)))
    .join(" ");
  return violationKey(routeKey, ruleId, normalizeSelector(target));
}

/** 把某路由的一次 axe 结果摊平成排序去重的键数组。 */
export function collectKeys(routeKey: string, violations: AxeViolationLike[]): string[] {
  const keys = new Set<string>();
  for (const v of violations) {
    for (const node of v.nodes) {
      keys.add(nodeKey(routeKey, v.id, node));
    }
  }
  return [...keys].sort();
}

/**
 * 一条违规的**现场数据**。
 *
 * 为什么要它：基线键只有「路由 + 规则 + 选择器」，选择器是 axe 挑的**最小唯一**类集合，
 * 里面没有色令牌 ≠ 这个元素不经过令牌。2026-10-31 归因 `--meta` 那批时，27 条里静态
 * 只能核到 15 条（选择器带 `--meta` 的 5 + kbd 6 + 侧栏分组标签 4），余 12 条卡在
 * 「继承来的颜色查不到」。把 fg/bg/比值打进日志之后，归因不必再靠读源码猜。
 *
 * 字段来源不是抄文档，是从装的这份 axe-core 里读出来的：
 * `axe.js` 的 `colorContrastEvaluate`（4.14.0 在 31632–31641 行）`this.data({fgColor,
 * bgColor, contrastRatio, fontSize, fontWeight, messageKey, expectedContrastRatio,
 * shadowColor, colorParse})`；颜色是 `toHexString()` 的输出，`fontSize` 形如
 * `9.0pt (12px)`，`expectedContrastRatio` 形如 `4.5:1`。
 */
export interface ViolationDetail {
  rule: string;
  impact?: string | null;
  fgColor?: string;
  bgColor?: string;
  contrastRatio?: number;
  expectedContrastRatio?: string;
  fontSize?: string;
  fontWeight?: string;
  shadowColor?: string;
  /** axe 判定用的键（如 shortTextContent / equalRatio），非空时数值本身不可信 */
  messageKey?: string;
  /** 贡献背景的祖先链；空集意味着"背景不是从元素自己算出来的" */
  bgNodes?: string[];
  /** 首个未通过 check 的 message，供非对比度类规则也能定位 */
  message?: string;
}

interface ColorData {
  fgColor?: string;
  bgColor?: string;
  contrastRatio?: number;
  expectedContrastRatio?: string;
  fontSize?: string;
  fontWeight?: string;
  shadowColor?: string;
  messageKey?: string;
}

function isColorData(value: unknown): value is ColorData {
  if (typeof value !== "object" || value === null) return false;
  const d = value as Record<string, unknown>;
  return typeof d.fgColor === "string" || typeof d.bgColor === "string";
}

/** 节点上所有失败 check（any/all/none/failed 四组都翻，漏一组就会把有色数据读成空）。 */
function failedChecks(node: AxeNodeLike): AxeCheckLike[] {
  return [...(node.any ?? []), ...(node.all ?? []), ...(node.none ?? []), ...(node.failed ?? [])];
}

/**
 * 摊平一次 axe 结果为 `基线键 → 现场数据`。
 *
 * 同键多节点（归一化把列表项并成一条）时取**最差**那条的比值，因为基线是一条键一个位置，
 * 报"第一条"会让修完最差项的人误以为已达标。
 */
export function collectDetails(
  routeKey: string,
  violations: AxeViolationLike[],
): Record<string, ViolationDetail> {
  const out: Record<string, ViolationDetail> = {};
  for (const v of violations) {
    for (const node of v.nodes) {
      const key = nodeKey(routeKey, v.id, node);
      const checks = failedChecks(node);
      // 一个节点的 any 里只有一个 color-contrast check（规则就挂了这一条 check），
      // 所以这里取第一个色形状的数据即可；跨节点的最差取值在下面按键合并时做。
      let color: ColorData | undefined;
      for (const check of checks) {
        if (isColorData(check.data)) {
          color = check.data;
          break;
        }
      }
      const firstMessage = checks.find((c) => typeof c.message === "string")?.message;
      const bgNodes = (node.relatedNodes ?? [])
        .map((rn) => (rn.target ?? []).map((t) => (Array.isArray(t) ? t.join(" ") : t)).join(" "))
        .filter((s) => s.length > 0);
      const detail: ViolationDetail = {
        rule: v.id,
        impact: node.impact ?? v.impact ?? null,
        ...(firstMessage ? { message: firstMessage } : {}),
        ...(bgNodes.length ? { bgNodes } : {}),
      };
      if (color) {
        if (color.fgColor !== undefined) detail.fgColor = color.fgColor;
        if (color.bgColor !== undefined) detail.bgColor = color.bgColor;
        if (color.contrastRatio !== undefined) detail.contrastRatio = color.contrastRatio;
        if (color.expectedContrastRatio !== undefined) {
          detail.expectedContrastRatio = color.expectedContrastRatio;
        }
        if (color.fontSize !== undefined) detail.fontSize = color.fontSize;
        if (color.fontWeight !== undefined) detail.fontWeight = color.fontWeight;
        if (color.shadowColor !== undefined) detail.shadowColor = color.shadowColor;
        if (color.messageKey !== undefined) detail.messageKey = color.messageKey;
      }
      const prev = out[key];
      if (!prev) {
        out[key] = detail;
        continue;
      }
      const worse =
        typeof detail.contrastRatio === "number" &&
        typeof prev.contrastRatio === "number" &&
        detail.contrastRatio < prev.contrastRatio;
      if (worse) out[key] = detail;
    }
  }
  return out;
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
