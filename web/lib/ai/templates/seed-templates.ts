/**
 * 方向 E：AI 工作流模板种子数据。
 *
 * 每个模板的 steps 是 JSON 数组：`[{ name, capability, config }]`
 *  - name：步骤名称（展示用）
 *  - capability：AI 能力标识（对应 lib/ai/orchestrator 中注册的能力）
 *  - config：步骤配置（传给 capability 的参数）
 *
 * 来源：经验 2026-09-14-multi-database-field-type-layered-implementation-pattern
 *       —— 纯函数库 + 字段配置接口，此处用类型化常量导出。
 */

/** 单个工作流模板步骤 */
export interface TemplateStep {
  name: string;
  capability: string;
  config: Record<string, unknown>;
}

/** 模板分类枚举 */
export type TemplateCategory =
  | "project"
  | "meeting"
  | "review"
  | "onboarding"
  | "custom";

/** 种子模板定义（不含 id / 时间戳 / usageCount，由 DB 填充） */
export interface SeedTemplate {
  name: string;
  description: string;
  category: TemplateCategory;
  steps: TemplateStep[];
  isPublic: boolean;
}

/**
 * 6 个预置场景化模板。
 *
 * 设计原则：
 *  - steps 按"先后顺序"排列，实例化时映射为 Workflow.actions（order = index + 1）
 *  - capability 取值对齐 lib/ai/orchestrator 已注册能力（summarize / translate /
 *    format / task-breakdown / workflow-build / meeting-flow / project-insight /
 *    daily-report / announcement-draft / approval-advice / knowledge-qa 等）
 *  - config 仅放该能力必需的参数，保持精简
 */
export const SEED_TEMPLATES: readonly SeedTemplate[] = [
  {
    name: "新产品上线流程",
    description:
      "从需求评审到上线发布的完整流程，覆盖评审、排期、开发、测试与上线五个关键节点。",
    category: "project",
    isPublic: true,
    steps: [
      {
        name: "需求评审",
        capability: "task-breakdown",
        config: { focus: "需求评审", output: "评审纪要 + 风险清单" },
      },
      {
        name: "开发排期",
        capability: "project-insight",
        config: { focus: "排期", output: "里程碑 + 负责人" },
      },
      {
        name: "开发执行",
        capability: "daily-report",
        config: { focus: "开发进度", output: "每日进度汇总" },
      },
      {
        name: "测试验证",
        capability: "approval-advice",
        config: { focus: "测试报告", output: "风险评级 + 上线建议" },
      },
      {
        name: "上线发布",
        capability: "announcement-draft",
        config: { type: "info", audience: "全体成员", output: "上线公告" },
      },
    ],
  },
  {
    name: "周会跟进流程",
    description:
      "周会全流程闭环：议程收集 → 会议纪要 → 行动项分配 → 跟进复盘，确保会议决议落地。",
    category: "meeting",
    isPublic: true,
    steps: [
      {
        name: "议程收集",
        capability: "knowledge-qa",
        config: { focus: "本周议题", output: "议程大纲" },
      },
      {
        name: "会议纪要",
        capability: "meeting-flow",
        config: { output: "纪要 + 决策" },
      },
      {
        name: "行动项分配",
        capability: "task-breakdown",
        config: { focus: "行动项", output: "任务 + 负责人 + 截止日" },
      },
      {
        name: "跟进复盘",
        capability: "daily-report",
        config: { focus: "行动项进度", output: "完成率 + 风险项" },
      },
    ],
  },
  {
    name: "项目复盘流程",
    description:
      "项目结束后的结构化复盘：数据收集 → 分析 → 复盘会议 → 改进项，沉淀经验教训。",
    category: "review",
    isPublic: true,
    steps: [
      {
        name: "数据收集",
        capability: "project-insight",
        config: { focus: "项目全量数据", output: "进度 + 质量 + 成本" },
      },
      {
        name: "数据分析",
        capability: "knowledge-qa",
        config: { focus: "偏差与根因", output: "分析报告" },
      },
      {
        name: "复盘会议",
        capability: "meeting-flow",
        config: { output: "纪要 + 经验教训" },
      },
      {
        name: "改进项",
        capability: "task-breakdown",
        config: { focus: "改进措施", output: "任务 + 负责人" },
      },
    ],
  },
  {
    name: "新人 onboarding",
    description:
      "新人入职引导流程：账号开通 → 文档阅读 → 任务分配 → 一周检查，加速融入团队。",
    category: "onboarding",
    isPublic: true,
    steps: [
      {
        name: "账号开通",
        capability: "announcement-draft",
        config: { type: "info", audience: "新人 + IT", output: "开通清单" },
      },
      {
        name: "文档阅读",
        capability: "knowledge-qa",
        config: { focus: "团队规范 + 项目背景", output: "阅读指引" },
      },
      {
        name: "任务分配",
        capability: "task-breakdown",
        config: { focus: "入职首周任务", output: "任务 + 导师" },
      },
      {
        name: "一周检查",
        capability: "daily-report",
        config: { focus: "新人首周", output: "融入度 + 待办" },
      },
    ],
  },
  {
    name: "需求评审流程",
    description:
      "轻量需求评审闭环：需求收集 → 评审会议 → 优先级排序 → 排期，适合迭代规划。",
    category: "project",
    isPublic: true,
    steps: [
      {
        name: "需求收集",
        capability: "knowledge-qa",
        config: { focus: "需求池", output: "需求清单" },
      },
      {
        name: "评审会议",
        capability: "meeting-flow",
        config: { output: "评审纪要 + 决策" },
      },
      {
        name: "优先级排序",
        capability: "project-insight",
        config: { focus: "价值 / 工作量", output: "优先级矩阵" },
      },
      {
        name: "排期",
        capability: "task-breakdown",
        config: { focus: "迭代排期", output: "里程碑 + 负责人" },
      },
    ],
  },
  {
    name: "Bug 修复流程",
    description:
      "标准 Bug 修复流水线：确认 → 定位 → 修复 → 验证 → 关闭，附带风险评级与公告。",
    category: "project",
    isPublic: true,
    steps: [
      {
        name: "Bug 确认",
        capability: "knowledge-qa",
        config: { focus: "复现步骤", output: "确认报告" },
      },
      {
        name: "根因定位",
        capability: "project-insight",
        config: { focus: "代码 + 日志", output: "根因分析" },
      },
      {
        name: "修复执行",
        capability: "task-breakdown",
        config: { focus: "修复方案", output: "任务 + 负责人" },
      },
      {
        name: "验证",
        capability: "approval-advice",
        config: { focus: "修复验证", output: "风险评级" },
      },
      {
        name: "关闭公告",
        capability: "announcement-draft",
        config: { type: "info", audience: "受影响方", output: "关闭通知" },
      },
    ],
  },
] as const;