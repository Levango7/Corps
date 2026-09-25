/**
 * OKR 进度计算工具。
 *
 * Objective.progress = Σ(KR.currentValue / KR.targetValue × KR.weight) / Σ(KR.weight) × 100
 * 钳制 0-100。targetValue=0 的 KR 进度计为 0（避免除零）；总权重为 0 时进度为 0。
 */
export function computeProgress(
  keyResults: { currentValue: number; targetValue: number; weight: number }[],
): number {
  if (keyResults.length === 0) return 0;
  const totalWeight = keyResults.reduce((sum, kr) => sum + kr.weight, 0);
  if (totalWeight === 0) return 0;
  const weightedSum = keyResults.reduce((sum, kr) => {
    const krProgress = kr.targetValue === 0 ? 0 : kr.currentValue / kr.targetValue;
    return sum + krProgress * kr.weight;
  }, 0);
  const progress = (weightedSum / totalWeight) * 100;
  return Math.max(0, Math.min(100, progress));
}
