/**
 * activation 判定纯函数（FUNNEL-METRICS §3.2 / §2.4）。
 *
 * 抽出纯函数供单测布尔矩阵覆盖，与 tasks/route.ts 判定块解耦。
 * 判定块本身在路由内包 try-catch 失败静默（P2-1）。
 */

export interface ActivationInput {
  /** 本工作区首个任务 */
  isFirstTask: boolean;
  /** 是否指派给他人（hasAssignee && !selfAssigned） */
  assignedToOther: boolean;
  /** 距注册的分钟数 */
  minutesSinceRegister: number;
  /** 已存在的 activation_completed 事件数（事务内 tx.count） */
  dupCount: number;
}

/** 15 分钟激活窗口（AC-07）。 */
const ACTIVATION_WINDOW_MIN = 15;

/**
 * 判定是否应打 activation_completed。
 * 条件：isFirstTask && assignedToOther && dupCount===0 && minutesSinceRegister ≤ 15
 */
export function shouldActivate(input: ActivationInput): boolean {
  return (
    input.isFirstTask &&
    input.assignedToOther &&
    input.dupCount === 0 &&
    input.minutesSinceRegister <= ACTIVATION_WINDOW_MIN
  );
}
