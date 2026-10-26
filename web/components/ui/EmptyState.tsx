/**
 * EmptyState —— 收编既有实现，**不另造一套**（同 ./Toast.tsx 的理由）。
 *
 * 既有 `components/EmptyState.tsx` 是 default export，且 7 个文件在用；
 * 这里把 default 转成具名再透传类型，让 `components/ui` 的导出面统一（全是具名）。
 * 旧路径保持可用，零迁移。
 */
export { default as EmptyState } from "@/components/EmptyState";
export type { EmptyStateType, EmptyStateProps } from "@/components/EmptyState";
