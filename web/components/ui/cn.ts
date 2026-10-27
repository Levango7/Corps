/**
 * 极小的类名拼接（刻意不引入 clsx / tailwind-merge）。
 *
 * 约束（重要）：`className` 只用于**布局类**（margin / width / grid / gap）。
 * 颜色、尺寸、状态走组件的 variant props——因为本仓没有 tailwind-merge，
 * 无法消解同类冲突；而 CSS 里"后写的规则赢"取决于样式表顺序、不取决于字符串顺序，
 * 所以"传 className 覆盖颜色"这种用法本来就不可靠。与其让它半灵不灵，
 * 不如约定清楚，由 variant 穷举所有合法外观。
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
