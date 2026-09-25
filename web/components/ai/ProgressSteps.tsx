/**
 * AI 流式进度步骤指示器。
 *
 * 3 个阶段（聚合数据 → 分析 → 生成），每个阶段显示圆点+文字：
 *  - 已完成阶段：打勾（CheckCircle2，success 色）
 *  - 当前阶段：spinner（Loader2 旋转，accent 色）+ 阶段消息
 *  - 未开始阶段：空心圆点（Circle，muted 色）
 *
 * 样式全走 design token（var(--*)），lucide-react size 14。
 * 与 DailyReportView/ProjectInsightView/ApprovalAdvicePanel 共享。
 */

import { CheckCircle2, Loader2, Circle } from "lucide-react";

/** 阶段编号：1=聚合数据, 2=分析, 3=生成 */
export type ProgressStage = 1 | 2 | 3;

export interface ProgressStepsProps {
  /** 当前进行到的阶段（1/2/3） */
  currentStage: ProgressStage;
  /** 3 个阶段的名称（已国际化，由父组件传入） */
  stageNames: [string, string, string];
  /** 当前阶段的详细消息（来自流式 data part 的 message） */
  currentMessage?: string;
}

export function ProgressSteps({ currentStage, stageNames, currentMessage }: ProgressStepsProps) {
  return (
    <div
      className="flex flex-col gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface-2)] px-[var(--space-4)] py-[var(--space-3)]"
      role="status"
      aria-live="polite"
    >
      {stageNames.map((name, i) => {
        const stage = (i + 1) as ProgressStage;
        const isDone = stage < currentStage;
        const isCurrent = stage === currentStage;

        return (
          <div
            key={stage}
            className={`flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)] transition-colors duration-[var(--motion-fast)] ${
              isCurrent ? "text-[var(--fg)]" : isDone ? "text-[var(--fg-2)]" : "text-[var(--meta)]"
            }`}
          >
            {/* 阶段图标：完成=打勾, 当前=spinner, 未开始=空心圆 */}
            {isDone ? (
              <CheckCircle2 size={14} className="shrink-0 text-[var(--success)]" />
            ) : isCurrent ? (
              <Loader2
                size={14}
                className="shrink-0 animate-spin text-[var(--accent)] motion-reduce:animate-none"
              />
            ) : (
              <Circle size={14} className="shrink-0 text-[var(--meta)]" />
            )}

            {/* 阶段名称 */}
            <span className="font-[weight:var(--weight-medium)]">{name}</span>

            {/* 当前阶段的详细消息 */}
            {isCurrent && currentMessage && (
              <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
                {currentMessage}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
