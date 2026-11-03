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
  /**
   * **背景贡献链在 check 这一层**，不在节点那一层。
   * 实测（axe 4.14.0，真浏览器渲染半透明底）节点顶层键只有
   * `all / any / failureSummary / html / impact / none / target`，没有 relatedNodes；
   * 把 relatedNodes 当节点字段读会稳定拿到空数组 —— #243 第一版就是这么错的。
   */
  relatedNodes?: readonly AxeRelatedLike[];
}

export interface AxeRelatedLike {
  target?: readonly (string | readonly string[])[];
  /** axe 直接给出该背景层的 outerHTML 片段，是"谁把底色画上去"的最短路径 */
  html?: string;
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
  const target = node.target.map((t) => (Array.isArray(t) ? t.join(" ") : (t as string))).join(" ");
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
 * 里面没有色令牌 ≠ 这个元素不经过令牌。第一批收窄后靠静态读源码只能核到一部分，
 * 且会把方向读错 —— 这份数据到手后的真实分布是：27 条前景全是令牌
 * （`--p-meta` 21 / `--p-muted` 4 / `--p-accent` 2），而其中 16 条的**实际底色不在任何
 * `--p-*` 里**（半透明外壳层叠加出来的合成色）。也就是说"令牌够不够暗"根本不是全貌。
 *
 * 字段来源逐条实测，不是照抄文档：
 *  - 色值八项来自 `axe.js` 的 `colorContrastEvaluate`（4.14.0 在 31632–31641 行）
 *    `this.data({fgColor, bgColor, contrastRatio, fontSize, fontWeight, messageKey,
 *    expectedContrastRatio, shadowColor, colorParse})`；颜色是 `toHexString()` 的输出，
 *    `fontSize` 形如 `9.0pt (12px)`，`expectedContrastRatio` 形如 `4.5:1`
 *  - **背景贡献链挂在 check 上，不在节点上**。节点顶层键实测只有
 *    `all / any / failureSummary / html / impact / none / target`（复现：真浏览器里渲染一层
 *    半透明底，把 `violations[0].nodes[0]` 的键整坨 dump 出来即可）。第一版把 `relatedNodes`
 *    当节点字段读，CI 产物里 27 条 bgNodes 全空——形状要抄真输出，不能凭印象。
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
  /** 背景贡献链（由近及远，挂在 check 上而非节点上）；合成底场景只看 bgColor 说不清是谁画的 */
  bgNodes?: string[];
  /**
   * 最近那层背景的片段，来自 axe 的 `relatedNodes[].html`。
   * ⚠️ **这个字段不可靠**：axe 自己会把每个属性值截到 ~24 字符再补 `…`（实测一条
   * 带 254 字符 class + 82 字符 style 的按钮，交来的整段只有 92 字符，两个属性都被截）。
   * 所以它能指位、不能当依据 —— 完整属性看 `bgAttrs`。
   */
  bgHtml?: string;
  /**
   * 由近及远的背景层**完整属性**（含该层 computed backgroundColor），由 spec 回查 DOM 得到。
   * 补这个字段的原因：`bgHtml` 被 axe 截断过一次，我照它把「`--accent` 压 `--accent-soft`」
   * 误读成「内联 style 绕过令牌」，据此会白做一轮工。截断的读数不能冒充证据。
   */
  bgAttrs?: string[];
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
      // 记住**是哪个 check**：背景贡献链挂在 check 上，不在节点上。
      let color: ColorData | undefined;
      let colorCheck: AxeCheckLike | undefined;
      for (const check of checks) {
        if (isColorData(check.data)) {
          color = check.data;
          colorCheck = check;
          break;
        }
      }
      const firstMessage = checks.find((c) => typeof c.message === "string")?.message;
      const bgNodes = (colorCheck?.relatedNodes ?? [])
        .map((rn) => (rn.target ?? []).map((t) => (Array.isArray(t) ? t.join(" ") : t)).join(" "))
        .filter((s) => s.length > 0);
      // 最近的那一层背景（axe 按由近及远排）直接给 outerHTML，省掉"猜是谁画的"。
      // 截到 200 字符：一条列表项的 outerHTML 可能整坨塞着文案，产物会胀到没法看。
      const rawHtml = (colorCheck?.relatedNodes ?? [])[0]?.html;
      const bgHtml = rawHtml ? rawHtml.slice(0, 200) : undefined;
      const detail: ViolationDetail = {
        rule: v.id,
        impact: node.impact ?? v.impact ?? null,
        ...(firstMessage ? { message: firstMessage } : {}),
        ...(bgNodes.length ? { bgNodes } : {}),
        ...(bgHtml ? { bgHtml } : {}),
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

/** `formatBgLayer` 的输出上限：单个属性值 / 整条字符串。 */
export const BG_ATTR_VALUE_CAP = 200;
export const BG_ATTR_LINE_CAP = 600;

/** 背景层回查结果（页内采集、Node 侧格式化，所以这里是可以直接构造的纯数据）。 */
export interface BgLayerRaw {
  /** 来自 axe `relatedNodes[].target` 的选择器（bgNodes 里那串） */
  sel: string;
  /** 页内 `querySelector` 是否真的拿到了元素 */
  resolved: boolean;
  tag?: string;
  /** 伪元素（axe 会用 `::before` / `::after` 指向画刷层） */
  pseudo?: string;
  attrs?: readonly (readonly [string, string])[];
  computedBg?: string;
}

/**
 * 把一个背景层摊成一行可读文本：`<tag a="…" b="…"> [::before] [bg=rgba(...)]`。
 *
 * 刻意**不含元素文本**——文本正是 `bgHtml` 撑爆产物的原因，而"谁刷了这层色"只看属性。
 * `resolved: false` 单独成一条（而不是返回空），是为了让读的人分得清"这层查不到"
 * 与"没有这一层"——两者混淆过一次，代价是一条错的归因。
 */
export function formatBgLayer(raw: BgLayerRaw): string {
  if (!raw.resolved) return `${raw.sel} => 回查不到元素`;
  const attrs = (raw.attrs ?? []).map(([k, v]) => {
    const value = v.length > BG_ATTR_VALUE_CAP ? `${v.slice(0, BG_ATTR_VALUE_CAP)}…` : v;
    return `${k}="${value}"`;
  });
  const parts = [
    `<${(raw.tag ?? "element").toLowerCase()}${attrs.length ? " " : ""}${attrs.join(" ")}>`,
  ];
  if (raw.pseudo) parts.push(`[${raw.pseudo}]`);
  if (raw.computedBg) parts.push(`[bg=${raw.computedBg}]`);
  const line = parts.join(" ");
  return line.length > BG_ATTR_LINE_CAP ? `${line.slice(0, BG_ATTR_LINE_CAP)}…` : line;
}

/**
 * **页内**采集器：按 axe 给的选择器回查真实 DOM，摊出该层的完整属性与 computed 底色。
 *
 * 为什么放在这里而不是写在 spec 的 `page.evaluate` 里：Playwright 只序列化函数源码，
 * 所以一个不依赖闭包的导出函数可以原样投进页面跑；同一个函数于是能被单测（jsdom）
 * 与本机浏览器探针**逐字复用**，测的是真正发出去的那份代码，而不是它的抄本。
 *
 * `resolved: false` 单独成一条而不是省略：让读的人分得清"这层查不到"与"没有这一层"。
 */
export function collectBgLayers(list: readonly string[]): BgLayerRaw[] {
  return list.map((sel): BgLayerRaw => {
    /* 伪元素（axe 用它指向真正画刷的那一层）：宿主选择器去掉后缀再查，后缀留进输出 */
    const m = /^(.*?)::?(before|after|marker|selection|placeholder)$/.exec(sel);
    const host = m ? m[1] : sel;
    let el: Element | null;
    try {
      el = host ? document.querySelector(host) : null;
    } catch {
      /* 非法或查不到的选择器：不硬失败，留 resolved:false 并带上原选择器 */
      el = null;
    }
    if (!el) return { sel, resolved: false };
    const attrs: [string, string][] = [];
    for (const a of Array.from(el.attributes)) attrs.push([a.name, a.value]);
    return {
      sel,
      resolved: true,
      tag: el.tagName,
      pseudo: m ? `::${m[2]}` : undefined,
      attrs,
      /* 伪元素的颜色不在宿主 style 里，算不出来就别硬报一个值 */
      computedBg: m ? undefined : getComputedStyle(el).backgroundColor,
    };
  });
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
