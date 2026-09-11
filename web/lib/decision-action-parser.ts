/**
 * F1: 决策驱动执行 — 行动项解析与同步
 *
 * 从决策 Markdown 中解析 `- [ ]` / `- [x]` 格式的行动项（含 @指派人 或 日期才触发），
 * 并与 DB 中已有 DecisionActionItem 做 diff 同步：新增→创建 Task；变更→更新 Task（除非
 * 用户已手动修改过，userModified=true 则跳过字段同步）；删除→标记 removed=true（Task 保留）。
 *
 * syncActionItems 在调用方已开启的 RLS 事务内执行，不自建事务，保证与决策创建/编辑原子化。
 */
import type { Prisma, Task } from "@prisma/client";

export interface ParsedActionItem {
  lineIndex: number;
  checked: boolean;
  assigneeName: string | null; // @后跟的文本，待模糊匹配
  dueDate: string | null; // YYYY-MM-DD
  priority: "low" | "medium" | "high" | "urgent";
  title: string; // 去掉标记后的纯文本
}

/** 从决策 markdown 中解析行动项 */
export function parseActionItems(markdown: string): ParsedActionItem[] {
  const lines = markdown.split("\n");
  const items: ParsedActionItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 匹配 - [ ] 或 - [x] 开头
    const match = line.match(/^\s*-\s*\[([xX\s])\]\s+(.*)/);
    if (!match) continue;
    const checked = match[1].toLowerCase() === "x";
    const rest = match[2];
    // 必须含 @用户名 或 日期才触发
    const hasAssignee = /@\S+/.test(rest);
    const hasDate = /\d{4}-\d{2}-\d{2}/.test(rest);
    if (!hasAssignee && !hasDate) continue;
    // 提取各部分
    const assigneeMatch = rest.match(/@(\S+)/);
    const dateMatch = rest.match(/(\d{4}-\d{2}-\d{2})/);
    const prioMatch = rest.match(/#(low|medium|high|urgent)/i);
    // 清理 title
    let title = rest
      .replace(/@\S+/g, "")
      .replace(/\d{4}-\d{2}-\d{2}/g, "")
      .replace(/#(low|medium|high|urgent)/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    items.push({
      lineIndex: i,
      checked,
      assigneeName: assigneeMatch?.[1] ?? null,
      dueDate: dateMatch?.[1] ?? null,
      priority: (prioMatch?.[1].toLowerCase() as ParsedActionItem["priority"]) ?? "medium",
      title: title || "未命名行动项",
    });
  }
  return items;
}

/** 将 YYYY-MM-DD 字符串转为 Date（UTC 午夜，避免时区偏移） */
function parseDate(s: string | null): Date | null {
  if (!s) return null;
  return new Date(`${s}T00:00:00.000Z`);
}

/** 比较 parsed dueDate（string|null）与 DB dueDate（Date|null）是否一致 */
function dueDateEqual(parsed: string | null, existing: Date | null): boolean {
  if (!parsed && !existing) return true;
  if (!parsed || !existing) return false;
  return parseDate(parsed)!.getTime() === existing.getTime();
}

/**
 * 在已开启的 RLS 事务内同步行动项。不自建事务——由调用方（runWithWorkspace 回调）
 * 传入 tx，保证决策创建/编辑与行动项同步原子化。
 *
 * @param tx         Prisma 事务客户端（已注入 workspace_id GUC）
 * @param decisionId 决策 ID
 * @param markdown   决策 Markdown 全文
 * @param workspaceId 工作区 ID
 * @param actorId    操作者用户 ID（用于 Task.createdBy，可选）
 */
export async function syncActionItems(
  tx: Prisma.TransactionClient,
  decisionId: string,
  markdown: string,
  workspaceId: string,
  actorId?: string,
): Promise<{ created: number; updated: number; removed: number; tasks: Task[] }> {
  const parsed = parseActionItems(markdown);
  const existing = await tx.decisionActionItem.findMany({
    where: { decisionId, removed: false },
  });

  // 预加载 workspace members 用于 @用户名 模糊匹配
  const members = await tx.member.findMany({
    where: { workspaceId },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  /** 模糊匹配 assignee：精确 email → 精确 name → 包含匹配 */
  function matchAssignee(name: string | null): string | null {
    if (!name) return null;
    const lower = name.toLowerCase();
    // 1. 精确匹配 email
    const byEmail = members.find((m) => m.user.email.toLowerCase() === lower);
    if (byEmail) return byEmail.userId;
    // 2. 精确匹配 name
    const byName = members.find((m) => m.user.name?.toLowerCase() === lower);
    if (byName) return byName.userId;
    // 3. 模糊匹配：name 包含输入 或 输入包含 name
    const byFuzzy = members.find((m) => {
      const n = m.user.name?.toLowerCase();
      if (!n) return false;
      return n.includes(lower) || lower.includes(n);
    });
    if (byFuzzy) return byFuzzy.userId;
    return null;
  }

  const parsedByLine = new Map(parsed.map((p) => [p.lineIndex, p]));
  const existingByLine = new Map(existing.map((e) => [e.lineIndex, e]));

  const tasks: Task[] = [];
  let created = 0;
  let updated = 0;
  let removed = 0;

  // ── 新增 + 变更 ──
  for (const item of parsed) {
    const existingItem = existingByLine.get(item.lineIndex);
    const assigneeId = matchAssignee(item.assigneeName);
    const dueDate = parseDate(item.dueDate);

    if (!existingItem) {
      // 新增：创建 Task + DecisionActionItem
      const task = await tx.task.create({
        data: {
          workspaceId,
          title: item.title,
          priority: item.priority,
          dueDate,
          assigneeId,
          status: item.checked ? "done" : "todo",
          createdBy: actorId ?? null,
        },
      });
      await tx.decisionActionItem.create({
        data: {
          decisionId,
          taskId: task.id,
          lineIndex: item.lineIndex,
          checked: item.checked,
          assigneeId,
          dueDate,
          priority: item.priority,
          title: item.title,
        },
      });
      // 通知指派人
      if (assigneeId) {
        await tx.notification.create({
          data: {
            userId: assigneeId,
            workspaceId,
            type: "task_assigned",
            entityId: task.id,
            entityTitle: task.title,
          },
        });
      }
      tasks.push(task);
      created++;
    } else {
      // 变更检查：字段是否不同
      const changed =
        existingItem.checked !== item.checked ||
        existingItem.title !== item.title ||
        existingItem.priority !== item.priority ||
        !dueDateEqual(item.dueDate, existingItem.dueDate) ||
        existingItem.assigneeId !== assigneeId;

      if (changed && !existingItem.userModified && existingItem.taskId) {
        // 用户未手动改过 → 同步更新 Task 字段
        const task = await tx.task.update({
          where: { id: existingItem.taskId },
          data: {
            title: item.title,
            priority: item.priority,
            dueDate,
            assigneeId,
            status: item.checked ? "done" : "todo",
          },
        });
        // 同步 DecisionActionItem 元数据
        await tx.decisionActionItem.update({
          where: { id: existingItem.id },
          data: {
            checked: item.checked,
            assigneeId,
            dueDate,
            priority: item.priority,
            title: item.title,
          },
        });
        // assignee 变更 → 通知新指派人
        if (assigneeId && assigneeId !== existingItem.assigneeId) {
          await tx.notification.create({
            data: {
              userId: assigneeId,
              workspaceId,
              type: "task_assigned",
              entityId: task.id,
              entityTitle: task.title,
            },
          });
        }
        tasks.push(task);
        updated++;
      }
    }
  }

  // ── 删除（DB 中有，parsed 中无）──
  for (const existingItem of existing) {
    if (!parsedByLine.has(existingItem.lineIndex)) {
      await tx.decisionActionItem.update({
        where: { id: existingItem.id },
        data: { removed: true },
      });
      removed++;
    }
  }

  return { created, updated, removed, tasks };
}
// ─── F1 增强：行动项模板库 ────────────────────────────────────────────────
// 预定义行动计划模板，用户可在 ActionItemPanel 中一键插入到决策编辑器。
// 模板中的 {dueDate} 占位符在插入时由前端替换为当前日期 + 7 天（YYYY-MM-DD）。

export interface ActionTemplate {
  id: string;
  name: string; // 模板名称
  description: string; // 模板描述
  markdown: string; // 插入决策的 markdown 片段
}

export const ACTION_TEMPLATES: ActionTemplate[] = [
  {
    id: "review-revise-merge",
    name: "decision.template.reviewReviseMerge.name",
    description: "decision.template.reviewReviseMerge.description",
    markdown: `## 执行计划\n\n- [ ] @reviewer {dueDate} 完成代码评审 #high\n- [ ] @author {dueDate} 根据评审意见修改 #medium\n- [ ] @reviewer {dueDate} 确认修改并合并 #high`,
  },
  {
    id: "investigate-decide-implement",
    name: "decision.template.investigateDecideImplement.name",
    description: "decision.template.investigateDecideImplement.description",
    markdown: `## 执行计划\n\n- [ ] @investigator {dueDate} 完成技术调研并输出方案 #high\n- [ ] @team {dueDate} 方案评审会议 #medium\n- [ ] @implementor {dueDate} 完成开发实施 #high`,
  },
  {
    id: "plan-do-check",
    name: "decision.template.planDoCheck.name",
    description: "decision.template.planDoCheck.description",
    markdown: `## 执行计划\n\n- [ ] @owner {dueDate} 制定详细执行计划 #medium\n- [ ] @executor {dueDate} 按计划执行 #high\n- [ ] @reviewer {dueDate} 检查执行结果并反馈 #medium`,
  },
  {
    id: "design-develop-test-deploy",
    name: "decision.template.designDevelopTestDeploy.name",
    description: "decision.template.designDevelopTestDeploy.description",
    markdown: `## 执行计划\n\n- [ ] @designer {dueDate} 完成UI/UX设计 #medium\n- [ ] @developer {dueDate} 完成开发 #high\n- [ ] @tester {dueDate} 完成测试验证 #high\n- [ ] @devops {dueDate} 部署上线 #medium`,
  },
];