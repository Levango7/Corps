/**
 * 文档版本对比的行级 diff（纯函数，无 IO、无业务规则）
 *
 * 为什么不引第三方 diff 库：项目对新增依赖采取「存在性核验 + 锁来源」纪律
 * （见 references/01-standards/generated-code-failure-modes.md §3），
 * 而版本对比只需行级 LCS，新增一个 npm 依赖的供应链成本高于收益。
 * 若日后需要 token 级/字符级 diff，此模块是唯一替换点。
 *
 * 算法：最长公共子序列（LCS）动态规划。
 * 复杂度 O(n*m) 时间与空间，n/m 为行数。为避免大文档把内存打穿，
 * 超过 PAIRING_CELL_BUDGET 时降级为「前后缀裁剪 + 中段整体替换」——
 * 降级结果仍然是**正确**的 diff（只是不做行级配对），不会返回错误数据。
 */

/** LCS 允许的最大单元格数（2000*2000 = 4M，约 16MB Int32Array） */
const PAIRING_CELL_BUDGET = 4_000_000;

/** 单侧最大行数；超过即跳过行级配对，直接走降级路径 */
const MAX_LINES_FOR_PAIRING = 2_000;

export interface DiffStats {
  additions: number;
  deletions: number;
  modifications: number;
}

export interface LineDiff {
  added: string[];
  removed: string[];
  modified: { before: string; after: string; line: number }[];
  stats: DiffStats;
}

type Op = { kind: "equal" | "del" | "ins"; line: string };

/** 按 \n 切行；空串视为单行空内容，保证 "" 与 [""] 行为一致 */
function splitLines(text: string): string[] {
  if (text === "") return [""];
  return text.split("\n");
}

/**
 * 行级 LCS。规模超预算时返回 null，由调用方走降级路径。
 */
function lcsOps(a: string[], b: string[]): Op[] | null {
  const n = a.length;
  const m = b.length;
  if (n * m > PAIRING_CELL_BUDGET || n > MAX_LINES_FOR_PAIRING || m > MAX_LINES_FOR_PAIRING) {
    return null;
  }

  // dp[i][j] = a[i..] 与 b[j..] 的 LCS 长度
  const width = m + 1;
  const dp = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] =
        a[i] === b[j]
          ? dp[(i + 1) * width + (j + 1)] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + (j + 1)]);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: "equal", line: a[i] });
      i++;
      j++;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) {
      ops.push({ kind: "del", line: a[i] });
      i++;
    } else {
      ops.push({ kind: "ins", line: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ kind: "del", line: a[i++] });
  while (j < m) ops.push({ kind: "ins", line: b[j++] });
  return ops;
}

/**
 * 降级 diff：裁掉公共前后缀，中段按「先删后增」整体处理。
 * 对超大文档仍是正确结果（只是丢失中段内部的行级对应关系）。
 */
function coarseOps(a: string[], b: string[]): Op[] {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }
  const ops: Op[] = [];
  for (let k = 0; k < head; k++) ops.push({ kind: "equal", line: a[k] });
  for (let k = head; k < a.length - tail; k++) ops.push({ kind: "del", line: a[k] });
  for (let k = head; k < b.length - tail; k++) ops.push({ kind: "ins", line: b[k] });
  for (let k = a.length - tail; k < a.length; k++) ops.push({ kind: "equal", line: a[k] });
  return ops;
}

/**
 * 把 del/ins 相邻对折叠成 modified。
 *
 * 折叠规则（刻意保守，避免误报）：只有「连续删除段」与「连续新增段」长度
 * **完全相等**时才配对；长度不等就老实输出 added/removed。
 * 理由：长度不等时强行按位置配对会把"改了一行 + 加了一行"说成
 * "改了两行"，那是编造事实——沉默逻辑错误里最便宜也最难发现的一类。
 */
function foldModified(ops: Op[]): LineDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const modified: { before: string; after: string; line: number }[] = [];
  let addedCount = 0;
  let removedCount = 0;

  let idx = 0;
  while (idx < ops.length) {
    if (ops[idx].kind === "equal") {
      idx++;
      continue;
    }
    // 收集一段连续的 del
    const delStart = idx;
    while (idx < ops.length && ops[idx].kind === "del") idx++;
    const dels = ops.slice(delStart, idx);
    // 紧跟其后的连续 ins
    const insStart = idx;
    while (idx < ops.length && ops[idx].kind === "ins") idx++;
    const inss = ops.slice(insStart, idx);

    if (dels.length > 0 && dels.length === inss.length) {
      for (let k = 0; k < dels.length; k++) {
        modified.push({ before: dels[k].line, after: inss[k].line, line: delStart + k + 1 });
        addedCount++;
        removedCount++;
      }
    } else {
      for (const d of dels) {
        removed.push(d.line);
        removedCount++;
      }
      for (const ins of inss) {
        added.push(ins.line);
        addedCount++;
      }
    }
  }

  return {
    added,
    removed,
    modified,
    stats: { additions: addedCount, deletions: removedCount, modifications: modified.length },
  };
}

/**
 * 计算 from → to 的行级差异。
 * @param from 旧内容（完整 markdown）
 * @param to   新内容（完整 markdown）
 */
export function diffMarkdown(from: string, to: string): LineDiff {
  if (from === to) {
    return { added: [], removed: [], modified: [], stats: { additions: 0, deletions: 0, modifications: 0 } };
  }
  const a = splitLines(from);
  const b = splitLines(to);
  return foldModified(lcsOps(a, b) ?? coarseOps(a, b));
}
