/**
 * 看板长按快捷菜单的副作用实现（完成 / 复制 / 分享 / 删除）。
 *
 * 从看板页抽出成独立模块的两个原因：
 *  1. 卡片组件只负责呈现与派发，副作用集中一处，避免在 BoardCard / 列表行里各写一份；
 *  2. 依赖全部可注入（apiFetch / copyText / origin），无需渲染 React 即可覆盖全部分支。
 *
 * 后端能力对齐说明（勿凭空加操作）：
 *  - 无专用 duplicate 端点 → 复制 = 读详情后按同字段 POST 新建；
 *  - 无 archived 状态、无软删除字段 → 菜单不提供「归档」；
 *  - DELETE 为硬删除（评论/决策级联消失）→ 只上报删除意图，由页面弹确认框后再执行。
 */
import { api } from "./api";
import { copyText as copyTextDefault } from "./clipboard";
import type { Task } from "./types";

export type TaskQuickAction = "complete" | "duplicate" | "share" | "delete";

/** 与 `api` 结构兼容的最小签名，便于单测注入替身 */
export type ApiCall = <T>(path: string, opts?: RequestInit) => Promise<T>;

export interface QuickActionDeps {
  wid: string;
  /** 状态变更入口：由看板页注入，复用拖拽那套乐观更新 + PATCH + 失败回滚 */
  onComplete: (task: Task) => void | Promise<void>;
  /** 硬删除需用户确认，故此处只上报意图，由页面决定是否弹 ConfirmDialog */
  onRequestDelete: (task: Task) => void;
  refresh: () => void | Promise<void>;
  toast: (type: "success" | "error", message: string) => void;
  /** 文案由调用方传入，保持本模块与 next-intl 解耦（单测无需 mock i18n） */
  messages: { duplicated: string; shareLinkCopied: string; failed: string };
  apiFetch?: ApiCall;
  copyText?: (text: string) => Promise<void>;
  origin?: string;
}

/** 执行一个快捷动作。delete 不产生副作用，仅通过 onRequestDelete 上报意图。 */
export async function runTaskQuickAction(
  action: TaskQuickAction,
  task: Task,
  deps: QuickActionDeps,
): Promise<void> {
  if (action === "complete") {
    await deps.onComplete(task);
    return;
  }

  if (action === "delete") {
    deps.onRequestDelete(task);
    return;
  }

  if (action === "duplicate") {
    await duplicateTask(task, deps);
    return;
  }

  await shareTask(task, deps);
}

/** 确认后真正执行的删除（页面 ConfirmDialog 的 onConfirm 调用它） */
export async function deleteTaskNow(task: Task, deps: QuickActionDeps): Promise<boolean> {
  const apiFetch = deps.apiFetch ?? api;
  try {
    await apiFetch(`/api/v1/workspaces/${deps.wid}/tasks/${task.id}`, { method: "DELETE" });
    await deps.refresh();
    return true;
  } catch {
    deps.toast("error", deps.messages.failed);
    return false;
  }
}

/**
 * 复制 = 新建一条同字段任务。
 *
 * 关键点：必须先拉详情。列表端点为省带宽刻意不返回 description
 * （见 app/api/v1/workspaces/[wid]/tasks/route.ts 的 taskListSelect），
 * 直接用看板态对象复制会静默丢掉描述。
 */
async function duplicateTask(task: Task, deps: QuickActionDeps): Promise<void> {
  const apiFetch = deps.apiFetch ?? api;
  try {
    const detail = await apiFetch<Task>(`/api/v1/workspaces/${deps.wid}/tasks/${task.id}`);
    const source = detail ?? task;
    await apiFetch(`/api/v1/workspaces/${deps.wid}/tasks`, {
      method: "POST",
      body: JSON.stringify({
        title: source.title,
        ...(source.description ? { description: source.description } : {}),
        status: source.status,
        priority: source.priority,
        ...(source.assigneeId ? { assigneeId: source.assigneeId } : {}),
        ...(source.dueDate ? { dueDate: source.dueDate } : {}),
        ...(source.milestoneId ? { milestoneId: source.milestoneId } : {}),
      }),
    });
    await deps.refresh();
    deps.toast("success", deps.messages.duplicated);
  } catch {
    deps.toast("error", deps.messages.failed);
  }
}

/**
 * 分享 = 取（或首次生成）分享 token，把公开页链接写入剪贴板。
 *
 * 关键点：不能每次都 rotate。PATCH `shareToken: "rotate"` 会生成新 token 并使旧链接失效，
 * 若每次点"分享"都 rotate，先前收到链接的人就打不开了——所以先查现有 token，缺失才生成。
 * 公开页为 app/[locale]/tasks/share/[token]，端点同时接受 shareSlug 与 shareToken。
 */
async function shareTask(task: Task, deps: QuickActionDeps): Promise<void> {
  const apiFetch = deps.apiFetch ?? api;
  const copy = deps.copyText ?? copyTextDefault;
  try {
    // 看板态 Task 不含 shareToken（列表端点脱敏），需单独查分享状态
    const current = await apiFetch<{ shareToken: string | null }>(
      `/api/v1/workspaces/${deps.wid}/tasks/${task.id}/share`,
    );
    const token =
      current?.shareToken ??
      (
        await apiFetch<{ shareToken: string | null }>(
          `/api/v1/workspaces/${deps.wid}/tasks/${task.id}`,
          { method: "PATCH", body: JSON.stringify({ shareToken: "rotate" }) },
        )
      ).shareToken;
    if (!token) throw new Error("share token unavailable");

    const origin = deps.origin ?? (typeof window !== "undefined" ? window.location.origin : "");
    await copy(`${origin}/tasks/share/${token}`);
    deps.toast("success", deps.messages.shareLinkCopied);
  } catch {
    deps.toast("error", deps.messages.failed);
  }
}
