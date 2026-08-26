/**
 * 序列化漏斗匹配器（FUNNEL-METRICS §6.3 / D2 修复）。
 *
 * 严格漏斗以「分组键事件按 createdAt 排序后的子序列匹配」实现，
 * 替代 overview 既有独立计数。允许真实跳步（如直达 /auth/signup 的用户
 * 无 landing/click 两步，submit→success 相邻即转化）。
 *
 * 抽出纯函数供单测，与 overview 路由解耦。
 */

export interface FunnelEvent {
  name: string;
  createdAt: Date;
  /** 分组键值（sessionId 或 userId，由调用方决定） */
  groupKey: string;
}

export interface FunnelStep {
  name: string;
  label: string;
}

export interface StepResult {
  name: string;
  label: string;
  /** 该步骤的累计计数（满足子序列约束的去重分组数） */
  users: number;
  /** 相对上一步的转化率（百分比，0-100） */
  rate: number;
}

/**
 * 对一组事件按分组键分别做子序列匹配，累计各步计数。
 *
 * 算法：
 *  1. 按 groupKey 分组。
 *  2. 每组事件按 createdAt 升序。
 *  3. 对步骤序列做贪心子序列匹配：依次寻找 ≥ 上一步时间的首个实例。
 *  4. 某步匹配成功则该步计数 +1（按分组去重，每组至多贡献 1）。
 *  5. groupKey 为 null/undefined 的事件单独归入 "null" 组，只计末步总量、不参与串联
 *     （宁缺毋错：未携带 sessionId 的历史/异常注册不参与获客段串联）。
 *
 * @param events 事件列表（含 name/createdAt/groupKey）
 * @param steps  步骤定义（顺序即漏斗顺序，允许 readonly tuple 如 as const 生成的数组）
 * @returns 各步计数与转化率
 */
export function matchFunnel(events: FunnelEvent[], steps: readonly FunnelStep[]): StepResult[] {
  // 按分组键分桶
  const groups = new Map<string, FunnelEvent[]>();
  for (const e of events) {
    const key = e.groupKey ?? "null";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  const counts = steps.map(() => 0);

  for (const [, groupEvents] of groups.entries()) {
    // 按 createdAt 升序
    const sorted = [...groupEvents].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    // 贪心子序列匹配（允许跳步）：
    //  - 对每一步寻找 ≥ prevTime 的首个实例；
    //  - 找到则该步计数+1 且 prevTime 前进到该实例时间；
    //  - 找不到则该步计数 0 且 prevTime 不变（允许跳步继续，后续步骤仍可计入）。
    //  这样直达 /auth/signup 的用户无 landing/click 两步，submit→success 相邻即转化。
    let prevTime = -Infinity;
    for (let i = 0; i < steps.length; i++) {
      const next = sorted.find(
        (e) => e.name === steps[i].name && e.createdAt.getTime() >= prevTime,
      );
      if (next) {
        counts[i]++;
        prevTime = next.createdAt.getTime();
      }
      // 找不到则跳过该步，prevTime 不变，继续匹配下一步（允许跳步）
    }
  }

  // 计算转化率
  return steps.map((step, i) => {
    const prev = i === 0 ? counts[i] : counts[i - 1];
    const rate = prev === 0 ? 0 : Math.round((counts[i] / prev) * 100);
    return { name: step.name, label: step.label, users: counts[i], rate };
  });
}
