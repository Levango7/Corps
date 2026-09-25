// AI 执行引擎——在 RLS 事务中安全执行 AI 建议的操作。
//
// 设计要点：
// - 所有操作经 runWithWorkspace 包裹，注入 app.workspace_id / app.user_id GUC，受行级安全策略约束
// - createTask：创建任务，workspaceId/createdBy 由引擎强制设置（不接受外部传入，防越权）
// - linkToOkr：Task 模型当前无 keyResultId 字段，跳过并返回 skipped 标记（保留接口供未来扩展）
// - notify：创建站内通知
// - createDocument：创建文档，workspaceId 由引擎强制设置，authorId 默认取当前用户
// - scheduleMeeting：安排会议，roomName 用 crypto.randomUUID 生成保证唯一，可批量创建参与者
// - updateTaskStatus：更新任务状态，RLS 已注入 workspace_id GUC 确保只更新当前工作区任务
// - createDecision：创建决策，关联 taskId，version 由模型默认为 1
// - sendAnnouncement：发送公告，targetAudience 为 JSON 字段，默认 {"type":"all"}
// - 批量执行（executeAiActions）在单个事务内顺序执行，任一操作抛异常则整体回滚（原子性）
// - 审计：RLS 已注入 user_id 作 DB 层审计，此处另用 console.info 记录 AI 操作日志便于追溯

import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { runWithWorkspace } from "@/lib/auth";

/** AI 可执行的操作类型 */
export type AiAction =
  | {
      type: "createTask";
      title: string;
      description: string;
      priority: string;
      assigneeId?: string;
      dueDate?: string;
    }
  | { type: "linkToOkr"; taskId: string; keyResultId: string }
  | { type: "notify"; userId: string; message: string }
  | { type: "createDocument"; title: string; markdown: string; authorId?: string }
  | {
      type: "scheduleMeeting";
      title: string;
      description?: string;
      scheduledAt: string;
      participantIds?: string[];
    }
  | { type: "updateTaskStatus"; taskId: string; status: string }
  | { type: "createDecision"; taskId: string; markdown: string }
  | {
      type: "sendAnnouncement";
      title: string;
      content: string;
      announcementType?: string;
      targetAudience?: Prisma.InputJsonValue;
    };

/** 执行结果 */
export interface AiActionResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

type Tx = Prisma.TransactionClient;

/**
 * 在事务中安全执行 AI 建议的操作。
 *
 * 执行前通过 runWithWorkspace 注入 RLS 上下文校验权限，执行后记录审计日志。
 * 失败返回 { success: false, error }，不抛异常（方便调用方逐一处理）。
 *
 * @param wid 工作区 ID
 * @param userId 操作发起人 ID（RLS 上下文 + 任务 createdBy）
 * @param action 待执行的操作
 */
export async function executeAiAction(
  wid: string,
  userId: string,
  action: AiAction,
): Promise<AiActionResult> {
  try {
    return await runWithWorkspace(
      wid,
      async (tx) => executeAction(tx, wid, userId, action),
      userId,
    );
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 批量执行多个 AI 操作（原子性，任一失败全部回滚）。
 *
 * 所有操作在单个 runWithWorkspace 事务内顺序执行。任一操作抛异常则整个事务回滚，
 * 返回全部操作失败的结果（已执行的操作被回滚，未执行的不再执行）。
 *
 * @param wid 工作区 ID
 * @param userId 操作发起人 ID
 * @param actions 待执行的操作列表
 * @returns 与 actions 等长的结果数组（成功时各操作结果；回滚时全部失败）
 */
export async function executeAiActions(
  wid: string,
  userId: string,
  actions: AiAction[],
): Promise<AiActionResult[]> {
  if (actions.length === 0) return [];
  try {
    return await runWithWorkspace(
      wid,
      async (tx) => {
        const results: AiActionResult[] = [];
        for (const action of actions) {
          // executeAction 抛异常会传播出去，使整个事务回滚（原子性保证）
          const result = await executeAction(tx, wid, userId, action);
          results.push(result);
        }
        return results;
      },
      userId,
    );
  } catch (error) {
    // 事务已回滚，所有操作均未生效
    const errorMsg = error instanceof Error ? error.message : String(error);
    return actions.map(() => ({ success: false, error: errorMsg }));
  }
}

/** 单个操作的执行逻辑（在事务 tx 内，可能抛异常） */
async function executeAction(
  tx: Tx,
  wid: string,
  userId: string,
  action: AiAction,
): Promise<AiActionResult> {
  switch (action.type) {
    case "createTask": {
      // 白名单校验 priority 枚举值，防止非法值写入
      const validPriorities = ["low", "medium", "high", "urgent"];
      if (!validPriorities.includes(action.priority)) {
        return { success: false, error: `无效的优先级: ${action.priority}` };
      }
      // 校验 dueDate 日期有效性，防止非法日期字符串写入
      if (action.dueDate) {
        const d = new Date(action.dueDate);
        if (isNaN(d.getTime())) {
          return { success: false, error: `无效的截止日期: ${action.dueDate}` };
        }
      }
      // workspaceId / createdBy 由引擎强制设置，不接受外部传入（防越权写其他工作区）
      const created = await tx.task.create({
        data: {
          workspaceId: wid,
          title: action.title,
          description: action.description,
          priority: action.priority,
          assigneeId: action.assigneeId,
          dueDate: action.dueDate ? new Date(action.dueDate) : undefined,
          createdBy: userId,
        },
      });
      console.info(
        `[ai-executor] createTask: id=${created.id} title="${created.title.slice(0, 50).replace(/["\n]/g, " ")}" by=${userId} wid=${wid}`,
      );
      return { success: true, result: created };
    }

    case "linkToOkr": {
      // Task 模型当前无 keyResultId 字段（OKR 与任务无直接关联），跳过关联操作。
      // 保留接口以便未来模型扩展时启用——届时在此处补充 tx.task.update 逻辑。
      console.info(
        `[ai-executor] linkToOkr skipped: task=${action.taskId} -> kr=${action.keyResultId} (no keyResultId field on Task)`,
      );
      return {
        success: true,
        result: { skipped: true, reason: "Task 模型无 keyResultId 字段，已跳过 OKR 关联" },
      };
    }

    case "notify": {
      // 验证目标用户是否为当前工作区成员（纵深防御，不依赖 RLS）
      const member = await tx.member.findFirst({
        where: { workspaceId: wid, userId: action.userId },
        select: { userId: true },
      });
      if (!member) {
        return { success: false, error: "目标用户不属于当前工作区" };
      }
      // Notification.entityId 为 UUID，通知场景用目标用户 ID 作关联实体。
      //
      // 设计说明：entityId 字段在 Notification 模型中是通用关联实体引用（如关联 Task/Document），
      // 此处复用为"通知接收人"载体——用 action.userId（目标用户）填充。
      // 这是一种设计妥协：Notification 无专用 recipientId 字段，而 userId 字段已用于
      // "通知归属人"（即接收人），entityId 在 ai_notify 场景下无其他业务实体可关联，
      // 故借用目标用户 ID 使前端能通过 entityId 反查通知来源用户。
      // 若未来 Notification 模型新增专用 sourceUserId 字段，应迁移至此字段。
      const created = await tx.notification.create({
        data: {
          userId: action.userId,
          workspaceId: wid,
          type: "ai_notify",
          entityId: action.userId,
          // 注：slice 按 UTF-16 code unit 截断，极端情况下可能截断代理对（emoji），影响极小
          entityTitle: action.message.slice(0, 255),
        },
      });
      console.info(`[ai-executor] notify: id=${created.id} to=${action.userId} wid=${wid}`);
      return { success: true, result: created };
    }

    case "createDocument": {
      // workspaceId 由引擎强制设置，不接受外部传入（防越权写其他工作区）
      // authorId：若外部传入，须校验为当前工作区成员（纵深防御，与 notify/scheduleMeeting 一致）；
      // 未传入则默认取当前用户（操作发起人），此时无需校验。
      const authorId = action.authorId ?? userId;
      if (action.authorId && action.authorId !== userId) {
        const member = await tx.member.findFirst({
          where: { workspaceId: wid, userId: action.authorId },
          select: { userId: true },
        });
        if (!member) {
          return { success: false, error: "作者不属于当前工作区" };
        }
      }
      const created = await tx.document.create({
        data: {
          workspaceId: wid,
          title: action.title,
          markdown: action.markdown,
          authorId,
        },
      });
      console.info(
        `[ai-executor] createDocument: id=${created.id} title="${created.title.slice(0, 50).replace(/["\n]/g, " ")}" by=${userId} wid=${wid}`,
      );
      return { success: true, result: created };
    }

    case "scheduleMeeting": {
      // roomName 用完整 crypto.randomUUID 生成保证唯一（meeting- 前缀 + 36 字符 UUID = 44 字符，符合 VarChar(100)）
      const roomName = `meeting-${randomUUID()}`;
      const created = await tx.meeting.create({
        data: {
          workspaceId: wid,
          title: action.title,
          description: action.description,
          createdBy: userId,
          roomName,
          status: "scheduled",
          type: "scheduled",
          scheduledAt: new Date(action.scheduledAt),
        },
      });
      // 如果有参与者，先验证是否为工作区成员，再批量创建
      let validParticipantCount = 0;
      if (action.participantIds && action.participantIds.length > 0) {
        // 去重
        const uniqueIds = [...new Set(action.participantIds)];
        // 验证是否为工作区成员（纵深防御，不依赖 RLS）
        const validMembers = await tx.member.findMany({
          where: { workspaceId: wid, userId: { in: uniqueIds } },
          select: { userId: true },
        });
        const validIds = validMembers.map((m) => m.userId);
        if (validIds.length > 0) {
          await tx.meetingParticipant.createMany({
            data: validIds.map((pid) => ({
              meetingId: created.id,
              userId: pid,
              role: "guest",
            })),
          });
        }
        validParticipantCount = validIds.length;
      }
      console.info(
        `[ai-executor] scheduleMeeting: id=${created.id} title="${created.title.slice(0, 50).replace(/["\n]/g, " ")}" participants=${validParticipantCount} by=${userId} wid=${wid}`,
      );
      return { success: true, result: created };
    }

    case "updateTaskStatus": {
      // 白名单校验 status 枚举值，防止非法值写入
      const validStatuses = ["todo", "in_progress", "review", "done"];
      if (!validStatuses.includes(action.status)) {
        return { success: false, error: `无效的任务状态: ${action.status}` };
      }
      // 先验证任务属于当前工作区（纵深防御，不依赖 RLS）
      const task = await tx.task.findFirst({
        where: { id: action.taskId, workspaceId: wid },
        select: { id: true },
      });
      if (!task) {
        return { success: false, error: "任务不存在或不属于当前工作区" };
      }
      const updated = await tx.task.update({
        where: { id: action.taskId },
        data: { status: action.status },
      });
      console.info(
        `[ai-executor] updateTaskStatus: id=${action.taskId} status="${action.status}" by=${userId} wid=${wid}`,
      );
      return { success: true, result: updated };
    }

    case "createDecision": {
      // 验证任务属于当前工作区（纵深防御，不依赖 RLS）
      const task = await tx.task.findFirst({
        where: { id: action.taskId, workspaceId: wid },
        select: { id: true },
      });
      if (!task) {
        return { success: false, error: "任务不存在或不属于当前工作区" };
      }
      // workspaceId 由引擎强制设置，version 由模型默认为 1
      const created = await tx.decision.create({
        data: {
          workspaceId: wid,
          taskId: action.taskId,
          markdown: action.markdown,
          authorId: userId,
        },
      });
      console.info(
        `[ai-executor] createDecision: id=${created.id} task=${action.taskId} by=${userId} wid=${wid}`,
      );
      return { success: true, result: created };
    }

    case "sendAnnouncement": {
      // 白名单校验 announcementType 枚举值（仅在传入时校验，未传入则默认 "info"）
      if (action.announcementType) {
        const validTypes = ["info", "warning", "urgent"];
        if (!validTypes.includes(action.announcementType)) {
          return { success: false, error: `无效的公告类型: ${action.announcementType}` };
        }
      }
      // targetAudience 为 JSON 字段，默认 {"type":"all"}；announcementType 默认 "info"
      // 注：业务字段命名为 announcementType 以避免与判别字段 type 冲突
      const created = await tx.announcement.create({
        data: {
          workspaceId: wid,
          title: action.title,
          content: action.content,
          type: action.announcementType ?? "info",
          targetAudience: (action.targetAudience ?? { type: "all" }) as Prisma.InputJsonValue,
          publishedBy: userId,
        },
      });
      console.info(
        `[ai-executor] sendAnnouncement: id=${created.id} title="${created.title.slice(0, 50).replace(/["\n]/g, " ")}" type="${created.type}" by=${userId} wid=${wid}`,
      );
      return { success: true, result: created };
    }

    default: {
      // 穷尽性检查：新增 action type 时若忘记处理此处会编译报错
      const _exhaustive: never = action;
      return { success: false, error: `未知操作类型: ${String(_exhaustive)}` };
    }
  }
}
