/**
 * Toast —— 收编既有实现，**不另造一套**。
 *
 * 仓库里已经有 `components/Toast.tsx`（ToastProvider + useToast，41 个文件在用）。
 * 设计系统要把 11 个原语收进 `components/ui/`，但"收进来"的正确做法是让它成为
 * 唯一的实现，而不是在 ui/ 下再写一个同名组件——那正是 #45 要消除的病
 * （同一能力两套实现，然后慢慢分叉）。
 *
 * 所以本文件只是稳定入口：`@/components/ui/Toast` 与 `@/components/Toast` 指向同一份代码。
 * 后续批次（B3 迁移）再把物理文件搬进来、把旧路径改成 re-export，届时 41 处 import 一处都不用改。
 *
 * 层级说明：现有实现对每个 toast 用 `role="alert"`（见 components/Toast.tsx），
 * 与 DESIGN.md §a11y「Toast 用 role=status/alert」一致，故不在这里包装。
 */
export * from "@/components/Toast";
