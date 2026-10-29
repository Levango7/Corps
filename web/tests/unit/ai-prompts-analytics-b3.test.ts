// 零覆盖清偿批 b3（协同/项目分析类 prompt 构造器）——覆盖 lib/ai/prompts 下
// agent-collaboration / bottleneck-analysis / burndown-analysis /
// progress-anomaly / risk-alert / team-performance 六个文件。
import { describe, expect, it } from "vitest";

import type { FeedbackExample } from "@/lib/ai/feedback";
import type { WorkspaceContext } from "@/lib/ai/prompts/daily-briefing";
import {
  buildAgentCoordinationPrompt,
  buildAgentResponsePrompt,
  type AgentBrief,
} from "@/lib/ai/prompts/agent-collaboration";
import {
  buildBottleneckSystemPrompt,
  buildBottleneckUserPrompt,
  toBottleneckTask,
  toTaskDepFromEdge,
  type BottleneckTask,
  type TaskDep,
} from "@/lib/ai/prompts/bottleneck-analysis";
import {
  buildBurndownSystemPrompt,
  buildBurndownUserPrompt,
  toBurndownTask,
  type AnalysisPeriod,
  type BurndownTask,
} from "@/lib/ai/prompts/burndown-analysis";
import {
  buildProgressAnomalyPrompt,
  buildProgressAnomalyUserPrompt,
} from "@/lib/ai/prompts/progress-anomaly";
import { buildRiskAlertPrompt, buildRiskAlertUserPrompt } from "@/lib/ai/prompts/risk-alert";
import {
  buildTeamPerformanceSystemPrompt,
  buildTeamPerformanceUserPrompt,
  toTeamMember,
  toTeamTask,
  type AnalysisPeriod as TeamAnalysisPeriod,
  type TeamMember,
  type TeamTask,
} from "@/lib/ai/prompts/team-performance";

const shot: FeedbackExample[] = [
  { originalOutput: null, correctedOutput: "更好的输出", comment: "更简洁" },
];

describe("agent-collaboration", () => {
  const agents: AgentBrief[] = [
    { name: "CodeAgent", role: "代码生成", capabilities: ["TypeScript", "测试"] },
    { name: "ReviewAgent", role: "代码评审", capabilities: [] },
  ];

  it("协调器 prompt 列出 Agent 能力并约束分配数量", () => {
    const p = buildAgentCoordinationPrompt(agents, "实现登录模块");
    expect(p).toContain("多 Agent 协同协调器");
    expect(p).toContain("- CodeAgent（角色: 代码生成，能力: TypeScript, 测试）");
    // 空能力回退“通用”
    expect(p).toContain("- ReviewAgent（角色: 代码评审，能力: 通用）");
    expect(p).toContain("## 待分配任务\n\n实现登录模块");
    expect(p).toContain("最多 2 个分配项");
    expect(p).toContain('"assignments"');
  });

  it("无可用 Agent 走占位分支且上限回退 5", () => {
    const p = buildAgentCoordinationPrompt([], "-empty-");
    expect(p).toContain("（无可用 Agent）");
    expect(p).toContain("最多 5 个分配项");
  });

  it("响应 prompt 注入角色、专属提示词与消息", () => {
    const p = buildAgentResponsePrompt("CodeAgent", "代码生成", "只写 TypeScript", "写登录表单");
    expect(p.startsWith("你是 Agent「CodeAgent」，角色为「代码生成」。")).toBe(true);
    expect(p).toContain("## 你的专属系统提示词\n\n只写 TypeScript");
    expect(p).toContain("## 接收到的消息\n\n写登录表单");
    expect(p).toContain('"handoff"');
    // 空专属提示词走默认分支
    expect(buildAgentResponsePrompt("A", "R", "", "M")).toContain(
      "（无专属提示词，按角色默认行为执行）",
    );
  });
});

describe("bottleneck-analysis", () => {
  const task: BottleneckTask = {
    id: "t1",
    title: "数据迁移",
    status: "in_progress",
    priority: "high",
    assigneeId: null,
    dueDate: new Date("2026-09-01T00:00:00Z"),
    blocked: true,
    blockedReason: "外部接口未就绪",
    parentId: null,
    milestoneId: "m1",
  };
  const dep: TaskDep = { sourceTaskId: "t1", targetTaskId: "t2", relation: "depends_on" };

  it("system prompt 声明瓶颈/关键路径契约并支持反馈注入", () => {
    const p = buildBottleneckSystemPrompt();
    expect(p).toContain("识别项目瓶颈与关键路径");
    expect(p).toContain('"bottlenecks"');
    expect(p).toContain('"criticalPath"');
    expect(p).toContain('"insights"');
    expect(buildBottleneckSystemPrompt(shot)).toContain("## 参考示例");
  });

  it("user prompt 按固定行格式拼接任务与依赖", () => {
    const p = buildBottleneckUserPrompt([task], [dep]);
    expect(p).toContain(
      "- id: t1 | 标题: 数据迁移 | 状态: in_progress | 优先级: high | 负责人: 未分配 | 截止: 2026-09-01 | 阻塞: true | 阻塞原因: 外部接口未就绪 | 父任务: 无 | 里程碑: m1",
    );
    expect(p).toContain("- t1 --[depends_on]--> t2");
    expect(p).toContain("任务数据（共 1 条）：");
    expect(p).toContain("依赖关系（共 1 条）：");
  });

  it("空任务/空依赖走占位分支", () => {
    const p = buildBottleneckUserPrompt([], []);
    expect(p).toContain("（无任务）");
    expect(p).toContain("（无依赖）");
  });

  it("任务超 200 条、依赖超 100 条分别截断", () => {
    const many = Array.from({ length: 201 }, (_, i) => ({ ...task, id: `t${i}` }));
    const p = buildBottleneckUserPrompt(
      many,
      Array.from({ length: 101 }, () => dep),
    );
    expect(p).toContain("[已截断，仅显示前 200 条]");
    // 第二段依赖截断标记同样出现
    expect(p.match(/已截断/g)).toHaveLength(2);
  });

  it("toBottleneckTask 透传分析所需字段", () => {
    expect(toBottleneckTask(task)).toEqual(task);
  });

  it("toTaskDepFromEdge 命中映射表才返回依赖，否则 null", () => {
    const sourceMap = new Map([["kn1", "t1"]]);
    const targetMap = new Map([["kn2", "t2"]]);
    expect(
      toTaskDepFromEdge(
        { sourceNodeId: "kn1", targetNodeId: "kn2", relation: "depends_on" },
        sourceMap,
        targetMap,
      ),
    ).toEqual({
      sourceTaskId: "t1",
      targetTaskId: "t2",
      relation: "depends_on",
    });
    expect(
      toTaskDepFromEdge(
        { sourceNodeId: "nope", targetNodeId: "kn2", relation: "x" },
        sourceMap,
        targetMap,
      ),
    ).toBeNull();
    expect(
      toTaskDepFromEdge(
        { sourceNodeId: "kn1", targetNodeId: "nope", relation: "x" },
        sourceMap,
        targetMap,
      ),
    ).toBeNull();
  });
});

describe("burndown-analysis", () => {
  const period: AnalysisPeriod = {
    start: new Date("2026-09-09T00:00:00Z"),
    end: new Date("2026-09-15T00:00:00Z"),
  };
  const task: BurndownTask = {
    title: "接口联调",
    status: "in_progress",
    dueDate: null,
    createdAt: new Date("2026-09-10T00:00:00Z"),
    updatedAt: new Date("2026-09-12T00:00:00Z"),
  };

  it("system prompt 声明理想/实际燃尽线契约", () => {
    const p = buildBurndownSystemPrompt();
    expect(p).toContain("燃尽图分析");
    expect(p).toContain('"idealLine"');
    expect(p).toContain('"actualLine"');
    expect(p).toContain('"predictedCompletion"');
    expect(p).toContain('"deviation"');
    expect(buildBurndownSystemPrompt(shot)).toContain("## 参考示例");
  });

  it("user prompt 拼接周期与任务行", () => {
    const p = buildBurndownUserPrompt([task], period);
    expect(p.startsWith("分析周期：2026-09-09 至 2026-09-15")).toBe(true);
    expect(p).toContain(
      "- 标题: 接口联调 | 状态: in_progress | 截止: 无 | 创建: 2026-09-10 | 更新: 2026-09-12",
    );
    expect(p).toContain("任务数据（共 1 条）：");
  });

  it("任务超 200 条截断、空任务走占位", () => {
    const many = Array.from({ length: 201 }, (_, i) => ({ ...task, title: `t${i}` }));
    expect(buildBurndownUserPrompt(many, period)).toContain("[任务列表已截断，仅显示前 200 条]");
    expect(buildBurndownUserPrompt([], period)).toContain("（无任务数据）");
  });

  it("toBurndownTask 透传分析所需字段", () => {
    expect(toBurndownTask(task)).toEqual(task);
  });
});

describe("progress-anomaly", () => {
  const ctx: WorkspaceContext = {
    context: "- 剩余任务 12",
    workspaceId: "ws-anomaly",
    userId: "u-1",
  };

  it("system prompt 声明异常检测维度与 schema", () => {
    const p = buildProgressAnomalyPrompt(ctx);
    expect(p).toContain("进度异常检测助手");
    expect(p).toContain("工作区范围：ws-anomaly");
    expect(p).toContain('"anomalies"');
    for (const f of ["metric", "expected", "actual", "deviation", "explanation"]) {
      expect(p).toContain(`"${f}"`);
    }
    expect(p).toContain("当前进度各项指标正常");
  });

  it("user prompt 以进度数据开头并截断超长上下文", () => {
    expect(buildProgressAnomalyUserPrompt(ctx)).toBe("工作区进度数据：\n- 剩余任务 12");
    expect(buildProgressAnomalyUserPrompt({ ...ctx, context: "x".repeat(12001) })).toContain(
      "[上下文已截断]",
    );
  });
});

describe("risk-alert", () => {
  const ctx: WorkspaceContext = {
    context: "- 逾期 1 项",
    workspaceId: "ws-risk",
    userId: "u-1",
  };

  it("system prompt 声明风险三级枚举与判定规则", () => {
    const p = buildRiskAlertPrompt(ctx);
    expect(p).toContain("风险预警助手");
    expect(p).toContain("工作区范围：ws-risk");
    expect(p).toContain('"level": "critical" | "warning" | "info"');
    expect(p).toContain('"category"');
    expect(p).toContain('"suggestion"');
    expect(p).toContain("当前工作区暂无显著风险");
  });

  it("user prompt 以工作区数据开头并截断超长上下文", () => {
    expect(buildRiskAlertUserPrompt(ctx)).toBe("工作区数据：\n- 逾期 1 项");
    expect(buildRiskAlertUserPrompt({ ...ctx, context: "x".repeat(12001) })).toContain(
      "[上下文已截断]",
    );
  });
});

describe("team-performance", () => {
  const period: TeamAnalysisPeriod = {
    start: new Date("2026-09-07T00:00:00Z"),
    end: new Date("2026-09-13T00:00:00Z"),
  };
  const member: TeamMember = { userId: "u1", name: "张三", role: "前端" };
  const task: TeamTask = {
    title: "登录表单",
    status: "done",
    assigneeId: "u1",
    dueDate: new Date("2026-09-12T00:00:00Z"),
    createdAt: new Date("2026-09-08T00:00:00Z"),
    updatedAt: new Date("2026-09-10T00:00:00Z"),
  };

  it("system prompt 声明完成率/周期/负载契约", () => {
    const p = buildTeamPerformanceSystemPrompt();
    expect(p).toContain("团队效能分析");
    expect(p).toContain('"completionRate"');
    expect(p).toContain('"avgCycleDays"');
    expect(p).toContain('"workload"');
    expect(p).toContain('"strengths"');
    expect(buildTeamPerformanceSystemPrompt(shot)).toContain("## 参考示例");
  });

  it("user prompt 拼接周期、成员与任务行", () => {
    const p = buildTeamPerformanceUserPrompt([member], [task], period);
    expect(p.startsWith("分析周期：2026-09-07 至 2026-09-13")).toBe(true);
    expect(p).toContain("- userId: u1 | 姓名: 张三 | 角色: 前端");
    expect(p).toContain(
      "- 标题: 登录表单 | 状态: done | 负责人: u1 | 截止: 2026-09-12 | 创建: 2026-09-08",
    );
    expect(p).toContain("成员列表（共 1 人）：");
    expect(p).toContain("任务列表（共 1 条）：");
  });

  it("成员超 50 人、任务超 200 条分别截断；空列表走占位", () => {
    const manyMembers = Array.from({ length: 51 }, (_, i) => ({ ...member, userId: `u${i}` }));
    const manyTasks = Array.from({ length: 201 }, (_, i) => ({ ...task, title: `t${i}` }));
    const p = buildTeamPerformanceUserPrompt(manyMembers, manyTasks, period);
    expect(p).toContain("[已截断，仅显示前 50 条]");
    expect(p).toContain("[已截断，仅显示前 200 条]");
    const empty = buildTeamPerformanceUserPrompt([], [], period);
    expect(empty).toContain("（无成员）");
    expect(empty).toContain("（无任务）");
  });

  it("toTeamMember 优先用 name 回退 email", () => {
    expect(
      toTeamMember({ userId: "u1", role: "前端", user: { name: "张三", email: "z@x.com" } }).name,
    ).toBe("张三");
    expect(
      toTeamMember({ userId: "u1", role: "前端", user: { name: null, email: "z@x.com" } }).name,
    ).toBe("z@x.com");
  });

  it("toTeamTask 透传分析所需字段", () => {
    expect(toTeamTask(task)).toEqual(task);
  });
});
