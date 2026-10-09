#!/usr/bin/env node
/* eslint-disable -- 运维/演示脚本（非应用代码，不参与生产构建）：需要 node 的
   process/console/fetch 等运行时全局，应用侧 lint 规则（no-undef、no-console
   白名单等）不适用。与 scripts/assert-rls-engine-ran.mjs、layout-audit.mjs 同一惯例。 */
/**
 * 模拟团队播种器 —— 给 QA/演示造一个"像真的在跑"的 10 人小团队。
 *
 * 团队构成（用户拍板的场景）：
 *   · 1 名总负责人（owner）
 *   · 3 个组（产品组 / 研发组 / 运营组），每组 1 名组负责人（admin）
 *   · 6 名组员（member）——产品组 2 / 研发组 3 / 运营组 1
 *
 * 播种内容：成员与角色、3 个组标签、2 个里程碑、24 个主任务 + 5 个子任务（含阻塞/
 * 四种状态）、4 条决策记录（含版本留痕与 Mermaid）、3 篇文档、3 个会话与
 * 20+ 条消息、通知、公告、约 45 条 AI 用量日志（让用量仪表盘有数据）。
 *
 * 用法：
 *   cd web && node scripts/seed-simulation-team.mjs
 *   环境变量：SIM_OWNER_URL 可显式覆盖 DB 连接（默认取根 .env 的 DATABASE_OWNER_URL，
 *   本机 compose 栈为 localhost:5433）；SIM_API_BASE 覆盖 API 根（默认 127.0.0.1:APP_PORT）。
 *
 * 行为（幂等可重跑）：
 *   1) 缺失的模拟账号经 **HTTP 注册接口**创建（走真实链路保证密码哈希可登录）
 *      ⚠️ 注册接口限流 10 次/小时/IP，恰好够一轮；如需注销重建，等窗口或改
 *      环境后重启服务。
 *   2) 删除模拟账号拥有的全部工作区（含上一轮模拟团队），级联清空旧内容
 *   3) 经 DATABASE_OWNER_URL（postgres 超级用户，天然绕过 RLS）重建团队与内容
 *   4) 打印账号清单、登录入口与内容统计
 *
 * 安全边界：只认领 @sim.example.com 的账号与 sim-team-10 工作区；其余数据
 * 一概不碰。脚本只在本机开发/演示环境使用。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prismaPkg from "@prisma/client";

const { PrismaClient } = prismaPkg;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "..");

// ─── 环境加载（手动解析 .env，process.env 优先）─────────────────────────────

function parseEnvInto(env, text) {
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    if (env[m[1]] !== undefined) continue; // process.env / 先加载的文件优先
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[m[1]] = v;
  }
}

function loadEnv() {
  const env = { ...process.env };
  for (const file of [path.join(REPO_ROOT, ".env"), path.join(WEB_ROOT, ".env.local")]) {
    try {
      parseEnvInto(env, readFileSync(file, "utf8"));
    } catch {
      // 文件不存在则跳过
    }
  }
  return env;
}

// ─── 团队定义 ──────────────────────────────────────────────────────────────

const TEAM_SLUG = "sim-team-10";
const TEAM_NAME = "青松小队 · 10 人模拟团队";
const SIM_DOMAIN = "@sim.example.com";
const SIM_PASSWORD = "Sim2026#Team";

/** 10 人名单：注册顺序即 sim01..sim10；role 决定工作区权限，group 决定分组 */
const MEMBERS = [
  { key: "lead", email: `sim01${SIM_DOMAIN}`, name: "陈磊", role: "owner", group: "管理层" },
  { key: "pm", email: `sim02${SIM_DOMAIN}`, name: "林晓", role: "admin", group: "产品组" },
  { key: "dev", email: `sim03${SIM_DOMAIN}`, name: "周航", role: "admin", group: "研发组" },
  { key: "ops", email: `sim04${SIM_DOMAIN}`, name: "赵敏", role: "admin", group: "运营组" },
  { key: "pm2", email: `sim05${SIM_DOMAIN}`, name: "吴桐", role: "member", group: "产品组" },
  { key: "pm3", email: `sim06${SIM_DOMAIN}`, name: "许佳", role: "member", group: "产品组" },
  { key: "dev2", email: `sim07${SIM_DOMAIN}`, name: "郑凯", role: "member", group: "研发组" },
  { key: "dev3", email: `sim08${SIM_DOMAIN}`, name: "何俊", role: "member", group: "研发组" },
  { key: "dev4", email: `sim09${SIM_DOMAIN}`, name: "孙宇", role: "member", group: "研发组" },
  { key: "ops2", email: `sim10${SIM_DOMAIN}`, name: "高远", role: "member", group: "运营组" },
];

const GROUPS = ["产品组", "研发组", "运营组"];

const LABELS = [
  { name: "产品组", color: "var(--accent)" },
  { name: "研发组", color: "var(--success)" },
  { name: "运营组", color: "var(--warn)" },
  { name: "需求", color: "var(--muted)" },
  { name: "缺陷", color: "var(--danger)" },
];

// ─── 内容素材 ──────────────────────────────────────────────────────────────

const MILESTONES = [
  { key: "m1", name: "v0.1 内测", due: -4, description: "完成核心功能闭环，30 人内测开放" },
  { key: "m2", name: "v0.2 公测", due: 12, description: "按内测反馈收敛，开放公开注册" },
];

/**
 * 任务清单：24 条。
 * 字段：key / title / group / status / priority / owner(成员 key) / due(相对天) /
 *       created(几天前) / updated(几天前) / ms(里程碑) / blocked / blockedReason /
 *       labels(附加标签) / parent(父任务 key，子任务用) / desc
 */
const TASKS = [
  // ── 产品组 ──
  {
    key: "p1",
    title: "竞品调研：5 家同类工具的定价与功能对比",
    group: "产品组",
    status: "done",
    priority: "high",
    owner: "pm",
    due: -12,
    created: 21,
    updated: 13,
    ms: "m1",
    desc: "覆盖定价梯度、免费额度、协作能力三块。结论已沉淀为决策记录。",
  },
  {
    key: "p2",
    title: "v0.2 需求清单评审与冻结",
    group: "产品组",
    status: "review",
    priority: "urgent",
    owner: "pm",
    due: 3,
    created: 9,
    updated: 1,
    ms: "m2",
    labels: ["需求"],
    desc: "冻结窗口前完成 MoSCoW 排序，冻结后只接受 P0 缺陷。",
  },
  {
    key: "p3",
    title: "用户访谈脚本（8 人样本）",
    group: "产品组",
    status: "done",
    priority: "medium",
    owner: "pm2",
    due: -8,
    created: 19,
    updated: 9,
    ms: "m1",
  },
  {
    key: "p4",
    title: "内测反馈整理（第一轮）",
    group: "产品组",
    status: "in_progress",
    priority: "high",
    owner: "pm3",
    due: 2,
    created: 6,
    updated: 0,
    ms: "m2",
    desc: "汇总问卷 + 访谈 + 群聊三类渠道，输出高频问题 Top10。",
  },
  {
    key: "p4a",
    title: "整理问卷自由填写字段",
    group: "产品组",
    status: "done",
    priority: "medium",
    owner: "pm3",
    due: 0,
    created: 6,
    updated: 2,
    parent: "p4",
  },
  {
    key: "p4b",
    title: "归类高频问题并标注严重度",
    group: "产品组",
    status: "in_progress",
    priority: "high",
    owner: "pm3",
    due: 2,
    created: 4,
    updated: 0,
    parent: "p4",
  },
  {
    key: "p5",
    title: "帮助中心文案初稿",
    group: "产品组",
    status: "todo",
    priority: "medium",
    owner: "pm2",
    due: 8,
    created: 4,
    updated: 4,
    ms: "m2",
  },
  {
    key: "p6",
    title: "定价页 A/B 方案设计与埋点",
    group: "产品组",
    status: "todo",
    priority: "low",
    owner: "pm3",
    due: 14,
    created: 3,
    updated: 3,
  },
  // ── 研发组 ──
  {
    key: "d1",
    title: "登录态过期导致编辑内容丢失",
    group: "研发组",
    status: "done",
    priority: "urgent",
    owner: "dev",
    due: -6,
    created: 16,
    updated: 7,
    ms: "m1",
    labels: ["缺陷"],
    desc: "凌晨批次更新后暴露：token 过期静默跳登录页，草稿未落盘。",
  },
  {
    key: "d2",
    title: "看板拖拽在 Safari 偶发失效",
    group: "研发组",
    status: "in_progress",
    priority: "high",
    owner: "dev2",
    due: 5,
    created: 11,
    updated: 0,
    labels: ["缺陷"],
    blocked: true,
    blockedReason: "WebKit 拖拽事件差异，需先确认 polyfill 方案再动手（已提评审）",
  },
  {
    key: "d3",
    title: "任务搜索慢查询治理（补复合索引）",
    group: "研发组",
    status: "done",
    priority: "medium",
    owner: "dev3",
    due: -5,
    created: 15,
    updated: 6,
    ms: "m1",
  },
  {
    key: "d4",
    title: "邮件通知模板重做（品牌化）",
    group: "研发组",
    status: "review",
    priority: "medium",
    owner: "dev4",
    due: 4,
    created: 10,
    updated: 1,
    ms: "m2",
  },
  {
    key: "d5",
    title: "附件上传 >30MB 超时",
    group: "研发组",
    status: "in_progress",
    priority: "urgent",
    owner: "dev2",
    due: 1,
    created: 5,
    updated: 0,
    labels: ["缺陷"],
    desc: "内测用户高频反馈，分片上传方案本周落地。",
  },
  {
    key: "d6",
    title: "移动端看板横滑体验优化",
    group: "研发组",
    status: "todo",
    priority: "medium",
    owner: "dev3",
    due: 9,
    created: 6,
    updated: 6,
    ms: "m2",
  },
  {
    key: "d6a",
    title: "复现并定位手势冲突",
    group: "研发组",
    status: "done",
    priority: "medium",
    owner: "dev3",
    due: -1,
    created: 6,
    updated: 3,
    parent: "d6",
  },
  {
    key: "d7",
    title: "数据导出 CSV（任务 / 决策）",
    group: "研发组",
    status: "todo",
    priority: "high",
    owner: "dev4",
    due: 10,
    created: 2,
    updated: 2,
    ms: "m2",
    labels: ["需求"],
  },
  {
    key: "d8",
    title: "权限矩阵补单测（覆盖 viewer 边界）",
    group: "研发组",
    status: "done",
    priority: "medium",
    owner: "dev",
    due: -3,
    created: 12,
    updated: 4,
  },
  {
    key: "d9",
    title: "v0.2 灰度发布方案",
    group: "研发组",
    status: "todo",
    priority: "high",
    owner: "dev",
    due: 11,
    created: 2,
    updated: 2,
    ms: "m2",
  },
  {
    key: "d10",
    title: "日志分级与敏感信息脱敏",
    group: "研发组",
    status: "review",
    priority: "high",
    owner: "dev3",
    due: 2,
    created: 8,
    updated: 1,
  },
  // ── 运营组 ──
  {
    key: "o1",
    title: "内测用户招募（目标 30 人）",
    group: "运营组",
    status: "done",
    priority: "urgent",
    owner: "ops",
    due: -7,
    created: 18,
    updated: 8,
    ms: "m1",
    desc: "渠道：老同事 8 / 社区 14 / 合作方 8，实际到 32 人。",
  },
  {
    key: "o1a",
    title: "渠道名单确认与联系",
    group: "运营组",
    status: "done",
    priority: "high",
    owner: "ops2",
    due: -10,
    created: 18,
    updated: 11,
    parent: "o1",
  },
  {
    key: "o1b",
    title: "邀请函发送与入群引导",
    group: "运营组",
    status: "in_progress",
    priority: "high",
    owner: "ops2",
    due: 0,
    created: 12,
    updated: 0,
    parent: "o1",
  },
  {
    key: "o2",
    title: "首周数据看板（激活 / 留存口径）",
    group: "运营组",
    status: "in_progress",
    priority: "high",
    owner: "ops2",
    due: 3,
    created: 7,
    updated: 0,
    ms: "m2",
  },
  {
    key: "o3",
    title: "用户成功手册 v1",
    group: "运营组",
    status: "todo",
    priority: "medium",
    owner: "ops",
    due: 12,
    created: 3,
    updated: 3,
    ms: "m2",
  },
  {
    key: "o4",
    title: "社区 FAQ 首版",
    group: "运营组",
    status: "todo",
    priority: "low",
    owner: "ops2",
    due: 15,
    created: 2,
    updated: 2,
  },
  {
    key: "o5",
    title: "内测奖励发放规则（草案）",
    group: "运营组",
    status: "review",
    priority: "medium",
    owner: "ops2",
    due: 1,
    created: 6,
    updated: 1,
  },
  // ── 跨组 ──
  {
    key: "x1",
    title: "每周跨组同步会纪要（持续）",
    group: "管理层",
    status: "in_progress",
    priority: "medium",
    owner: "lead",
    due: 4,
    created: 20,
    updated: 1,
  },
  {
    key: "x2",
    title: "v0.1 内测复盘报告",
    group: "管理层",
    status: "done",
    priority: "high",
    owner: "lead",
    due: -2,
    created: 6,
    updated: 2,
    ms: "m1",
  },
  {
    key: "x3",
    title: "风险登记表维护",
    group: "管理层",
    status: "todo",
    priority: "low",
    owner: "lead",
    due: 20,
    created: 1,
    updated: 1,
  },
];

/** 决策记录（挂到任务上；versions 全部落 DecisionVersion，最后一条为当前版本） */
const DECISIONS = [
  {
    task: "d1",
    author: "dev",
    versions: [
      {
        at: 12,
        md: `# 事故复盘：登录态过期导致编辑内容丢失

## 发生了什么
凌晨批次更新后，3 名内测用户反馈「写了一半的决策记录突然跳到登录页，回来内容没了」。

## 根因
- access token 15 分钟过期，前端 401 拦截直接跳登录，**未做本地草稿落盘**；
- 拦截器没有区分「可以静默续期」与「会话真失效」两种情况。

## 处置
1. 401 先尝试 refresh，失败才跳登录（已上线）；
2. 编辑器接入本地草稿（localStorage，带工作区与用户维度 key）；
3. 跳登录前弹确认，提示「内容已暂存」。

## 跟进
- [x] refresh 静默续期
- [x] 草稿落盘
- [ ] 全站编辑器覆盖复核（关联任务）`,
      },
      {
        at: 7,
        md: `# 事故复盘：登录态过期导致编辑内容丢失（v2 · 补充根因）

## 补充：为什么第一版没盖住全部场景
复核发现**决策记录编辑器**与**文档编辑器**是两套实现，第一版只改了前者。
第二版把草稿落盘抽成公共 hook，两处共用。

## 结论
- 同类问题排查时先列「实现有几套」，再定覆盖清单；
- 已加入回归用例：401 → refresh 成功 → 内容不丢。`,
      },
    ],
  },
  {
    task: "p1",
    author: "pm",
    versions: [
      {
        at: 13,
        md: `# 定价调研结论（5 家同类工具）

| 产品 | 免费额度 | 起步价 | 协作能力 |
| --- | --- | --- | --- |
| A | 3 项目 | ¥39/人/月 | 弱（仅评论） |
| B | 10 人 | ¥29/人/月 | 中（任务共享） |
| C | 无限人 7 天 | ¥49/人/月 | 强 |
| D | 5 人 | ¥25/人/月 | 弱 |
| E | 无 | ¥19/人/月 | 中 |

## 结论
- 我们 10 人免费 + ¥29.9 的定位处于市场空档，**不做低价竞争**；
- 差异化押注「决策留痕 + 讨论落位」，两家竞品均无此能力。`,
      },
    ],
  },
  {
    task: "d9",
    author: "dev",
    versions: [
      {
        at: 2,
        md: `# v0.2 灰度发布方案

## 分批
1. **内测群**（32 人）：直接全量，观察 48h；
2. **新注册用户**：灰度 20%，指标正常后 24h 内放全量；
3. **老用户**：最后放量。

## 回滚判据（任一触发即回滚）
- 登录成功率 < 99%；
- 前端错误率 > 1%；
- P0 缺陷数 > 0。

\`\`\`mermaid
flowchart LR
  A[内测群全量] -->|48h 指标正常| B[新用户 20%]
  B -->|24h 正常| C[新用户 100%]
  B -->|指标异常| R[回滚]
  C -->|48h 正常| D[老用户全量]
\`\`\``,
      },
    ],
  },
  {
    task: "o2",
    author: "ops",
    versions: [
      {
        at: 1,
        md: `# 激活 / 留存口径定义

## 激活
注册后 **48h 内**完成任一「价值动作」：建任务 / 写决策 / 发消息。

## 留存
- 次留：激活用户次日有任一读行为；
- 周留：激活当周第 2 个自然日仍在。

## 为什么这样定
纯登录口径会把"来看了看就走"算成活跃，与产品目标（讨论落位）背离。`,
      },
    ],
  },
];

/** 文档中心 */
const DOCUMENTS = [
  {
    title: "团队公约 v1",
    author: "lead",
    icon: "scroll",
    emoji: "📌",
    created: 20,
    updated: 5,
    published: true,
    md: `# 青松小队 · 团队公约

## 沟通
1. 结论必须落进任务或决策记录——**群里聊出花不算数**；
2. 面对面/语音超过 10 分钟的讨论，会后 24h 内补决策记录；
3. @人 说事，不 @ 人闲聊。

## 任务
1. 卡住超过 1 天必须标「阻塞」并写原因；
2. 子任务拆到什么粒度：一个人 2 天能做完；
3. 每周五 17:00 前更新自己名下任务状态。

## 响应时效
| 类型 | 期望响应 |
| --- | --- |
| 线上故障 | 30 分钟 |
| 阻塞求助 | 当天下班前 |
| 常规评论 | 24 小时 |`,
  },
  {
    title: "新人上手指南",
    author: "pm",
    icon: "compass",
    emoji: "🧭",
    created: 15,
    updated: 3,
    published: true,
    md: `# 新人上手指南

## 第一天
1. 让组长把你加进「全员群」与所属组的组标签任务；
2. 通读《团队公约》与最近的决策记录（任务详情 → 决策区）；
3. 认领一个带 \`需求\` 标签的小任务练手。

## 工具走查
- **看板**：任务四态（待办 / 进行中 / 评审 / 完成），拖拽即改状态；
- **决策记录**：每个关键任务都带「为什么这么定」，版本可回溯；
- **文档中心**：团队知识沉淀，公开链接可分享给外部只读查看。

## 求助路径
任务里直接评论 @组长 → 标阻塞 → 若 24h 无响应找总负责人。`,
  },
  {
    title: "v0.2 迭代规划（草稿）",
    author: "pm",
    icon: "map",
    emoji: "🗺️",
    created: 4,
    updated: 0,
    published: false,
    md: `# v0.2 迭代规划（草稿，冻结前请勿引用）

## 目标
按第一轮内测反馈收敛，开放公开注册。

## 范围（待评审冻结）
- [ ] 附件分片上传（>30MB）
- [ ] 数据导出 CSV
- [ ] 移动端看板体验
- [ ] 帮助中心 + FAQ

## 明确不做
- 自定义工作流引擎（排期 v0.3）
- 多语言（内测用户无诉求）`,
  },
];

/** 会话与消息 */
const CONVERSATIONS = [
  {
    key: "all",
    type: "group",
    title: "青松小队 · 全员群",
    description: "全员日常同步",
    created: 21,
    memberKeys: MEMBERS.map((m) => m.key),
    messages: [
      {
        by: "lead",
        at: 20,
        body: "欢迎 10 位！内测目标不变：30 名真实用户，两周后复盘。有问题随时开任务，别潜水。",
      },
      { by: "pm", at: 20, body: "产品组这周出竞品调研结论，周五前给到大家。" },
      { by: "dev", at: 19, body: "研发侧本周主要修内测反馈的两个 bug，登录态和附件上传。" },
      { by: "ops", at: 18, body: "招募进度同步：已确认 24 人，还差 6 个名额，目标周三凑齐。" },
      { by: "pm2", at: 15, body: "访谈脚本已发文档中心，大家有补充直接评论。" },
      { by: "dev2", at: 11, body: "Safari 拖拽失效的问题我先标阻塞了，等 polyfill 方案评审结果。" },
      {
        by: "lead",
        at: 8,
        body: "注意：以后会上说定的结论，散会后 24 小时内必须补决策记录，团队公约刚更新了这条。",
      },
      { by: "ops2", at: 6, body: "@赵敏 邀请函模板改好了吗？今天要批量发第二批。" },
      { by: "dev3", at: 3, body: "慢查询治理上线后，任务列表 P95 从 480ms 降到 90ms。" },
      {
        by: "pm3",
        at: 1,
        body: "第一轮反馈整理完成 60%，高频问题 Top10 明天发群里，先剧透一句：附件和大文件是重灾区。",
        mentions: ["lead"],
      },
      { by: "lead", at: 0, body: "辛苦。明天同步会上过一遍 Top10，能当场定级的当场定。" },
    ],
  },
  {
    key: "devgroup",
    type: "group",
    title: "研发组",
    description: "研发组内部同步",
    created: 20,
    memberKeys: ["dev", "dev2", "dev3", "dev4"],
    messages: [
      {
        by: "dev",
        at: 12,
        body: "附件超时这个优先修，内测用户已经第三次提了。分片上传方案我中午发出来。",
      },
      { by: "dev2", at: 12, body: "收到，我先把上传组件的进度条逻辑改成按分片。" },
      { by: "dev4", at: 9, body: "邮件模板重做这版把 Logo 和配色对齐了，评审区等大家拍。" },
      { by: "dev3", at: 5, body: "日志脱敏的对照表在任务评论里，大家看下有没有漏的字段。" },
      { by: "dev", at: 1, body: "提醒：周三晚是冻结窗口，之后只收 P0。" },
    ],
  },
  {
    key: "direct1",
    type: "direct",
    title: null,
    created: 9,
    memberKeys: ["lead", "ops"],
    messages: [
      { by: "ops", at: 9, body: "内测奖励预算批下来了吗？我这边要写发放规则。" },
      {
        by: "lead",
        at: 9,
        body: "批了，人均一杯咖啡的钱，重点是荣誉感——给最早的 30 人挂个「创始内测」标识。",
      },
      { by: "ops", at: 8, body: "好，那规则我按「标识 + 京东卡」双轨写，明天给你看。" },
      {
        by: "lead",
        at: 0,
        body: "规则草案看过了，加一条：连续两天不活跃的自动退出内测群，位置让给候补。",
      },
    ],
  },
];

/** 通知（to=成员 key；task=任务 key） */
const NOTIFICATIONS = [
  { to: "lead", type: "mention", task: "p4", read: false, at: 1 },
  { to: "lead", type: "task_assigned", task: "x3", read: false, at: 1 },
  { to: "lead", type: "comment_added", task: "d9", read: true, at: 2 },
  { to: "dev", type: "task_assigned", task: "d9", read: false, at: 2 },
  { to: "dev", type: "task_updated", task: "d1", read: true, at: 7 },
  { to: "dev2", type: "task_assigned", task: "d5", read: false, at: 5 },
  { to: "dev2", type: "comment_added", task: "d2", read: true, at: 4 },
  { to: "pm", type: "task_assigned", task: "p2", read: false, at: 1 },
  { to: "pm3", type: "mention", task: "p4", read: true, at: 2 },
  { to: "ops", type: "task_assigned", task: "o3", read: false, at: 3 },
  { to: "ops2", type: "task_updated", task: "o2", read: false, at: 0 },
  { to: "dev3", type: "task_updated", task: "d10", read: false, at: 1 },
];

/** 公告 */
const ANNOUNCEMENTS = [
  {
    title: "v0.2 需求冻结窗口：本周三 18:00",
    author: "lead",
    type: "warning",
    pinned: true,
    at: 1,
    content:
      "周三 18:00 后进入冻结窗口：只接受 P0 缺陷修复，新需求一律排入 v0.3。产品组负责在冻结前完成 MoSCoW 排序评审。",
  },
  {
    title: "内测奖励规则（草案公示）",
    author: "ops",
    type: "info",
    pinned: false,
    at: 3,
    content:
      "最早的 30 位内测用户将获得「创始内测」专属标识 + 咖啡礼金。连续两天不活跃自动退出内测群，位置让给候补名单。意见请到任务「内测奖励发放规则」下评论。",
  },
];

/** AI 用量素材：能力 → 典型 token 规模 */
const AI_CAPABILITIES = [
  ["daily-report", "deepseek-chat", 3200, 1500],
  ["daily-report", "deepseek-chat", 2800, 1200],
  ["project-insight", "deepseek-reasoner", 5600, 2600],
  ["project-insight", "deepseek-reasoner", 4900, 2100],
  ["task-breakdown", "deepseek-chat", 1800, 900],
  ["task-breakdown", "deepseek-chat", 2100, 1100],
  ["knowledge-qa", "deepseek-reasoner", 6400, 3000],
  ["knowledge-qa", "deepseek-reasoner", 5200, 2400],
  ["completion", "deepseek-chat", 900, 400],
  ["completion", "deepseek-chat", 1200, 600],
  ["summarize", "deepseek-chat", 2400, 700],
  ["translate", "deepseek-chat", 1500, 800],
  ["im-reply", "deepseek-chat", 700, 300],
  ["meeting-flow", "deepseek-reasoner", 4200, 1800],
  ["follow-up-suggestions", "deepseek-chat", 1600, 500],
  ["decision-assistant", "deepseek-reasoner", 5100, 2300],
];

// ─── 工具 ──────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const nowMs = Date.now();

/** 几天前的某个整点 */
function ago(days, hour = 10) {
  const d = new Date(nowMs - days * DAY_MS);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** 几天后的某个整点 */
function ahead(days, hour = 18) {
  return ago(-days, hour);
}

function log(msg) {
  console.info(msg);
}

// ─── 步骤 1：确保账号存在（缺失走 HTTP 注册）────────────────────────────────

async function ensureUsers(prisma, apiBase) {
  const usersByKey = {};
  const createdEmails = [];
  for (const m of MEMBERS) {
    let user = await prisma.user.findUnique({ where: { email: m.email } });
    if (!user) {
      const res = await fetch(`${apiBase}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: m.email,
          password: SIM_PASSWORD,
          name: m.name,
          workspaceName: `${m.name} 的工作区`,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        const hint = res.status === 429 ? "（注册限流 10 次/小时，请稍后再跑）" : "";
        throw new Error(`注册 ${m.email} 失败 HTTP ${res.status}${hint}: ${body.slice(0, 200)}`);
      }
      user = await prisma.user.findUnique({ where: { email: m.email } });
      if (!user) {
        throw new Error(
          `注册 ${m.email} 成功但库里查不到用户行——脚本连的库与运行实例不是同一个。\n` +
            `  排查：docker ps 看 db 容器映射到宿主机的端口（compose 的 db.ports），\n` +
            `  让根 .env 的 DATABASE_OWNER_URL 指向该端口，或用 SIM_OWNER_URL 显式覆盖。`,
        );
      }
      createdEmails.push(m.email);
    }
    usersByKey[m.key] = user;
  }
  return { usersByKey, createdEmails };
}

// ─── 步骤 2+3：重建团队内容 ───────────────────────────────────────────────

async function reseedTeam(prisma, usersByKey) {
  const userIds = Object.values(usersByKey).map((u) => u.id);

  // 2) 清掉模拟账号名下的一切工作区（自动注册产物 + 上一轮团队），级联清内容
  const owned = await prisma.workspace.findMany({
    where: { ownerId: { in: userIds } },
    select: { id: true, slug: true },
  });
  if (owned.length > 0) {
    await prisma.workspace.deleteMany({ where: { id: { in: owned.map((w) => w.id) } } });
  }
  log(`  清理旧工作区：${owned.length} 个（${owned.map((w) => w.slug).join(", ") || "无"}）`);

  // 3) 团队工作区 + 成员
  const lead = usersByKey.lead;
  const team = await prisma.workspace.create({
    data: {
      name: TEAM_NAME,
      slug: TEAM_SLUG,
      ownerId: lead.id,
      plan: "free",
      seatLimit: 10,
      createdAt: ago(21, 9),
    },
  });

  const memberRows = MEMBERS.map((m, i) => ({
    userId: usersByKey[m.key].id,
    workspaceId: team.id,
    role: m.role,
    invitedBy: m.key === "lead" ? null : lead.id,
    joinedAt: ago(m.key === "lead" ? 21 : m.role === "admin" ? 20 : 18 - (i % 4), 9 + (i % 8)),
    invitedAt: ago(m.key === "lead" ? 21 : 20, 9),
  }));
  await prisma.member.createMany({ data: memberRows });

  // 标签 / 里程碑
  const labels = {};
  for (const l of LABELS) {
    labels[l.name] = await prisma.label.create({
      data: { workspaceId: team.id, name: l.name, color: l.color },
    });
  }
  const milestones = {};
  for (const ms of MILESTONES) {
    milestones[ms.key] = await prisma.milestone.create({
      data: {
        workspaceId: team.id,
        name: ms.name,
        dueDate: ahead(ms.due, 18),
        description: ms.description,
        createdAt: ago(20, 10),
      },
    });
  }

  // 任务（两遍：先父后子）
  const statusOrder = { todo: 1000, in_progress: 1000, review: 1000, done: 1000 };
  const taskIds = {};
  const ensureLabel = (key) => {
    if (!labels[key]) throw new Error(`未知标签 ${key}（组名须在 LABELS 中）: ${key}`);
  };
  const baseData = (t) => {
    const status = t.status;
    statusOrder[status] += 1000;
    return {
      workspaceId: team.id,
      title: t.title,
      description: t.desc ?? null,
      status,
      priority: t.priority,
      assigneeId: usersByKey[t.owner].id,
      dueDate: t.due === 0 ? ago(0, 18) : t.due > 0 ? ahead(t.due, 18) : ago(-t.due, 18),
      sortOrder: statusOrder[status],
      createdBy: t.owner === "lead" ? lead.id : usersByKey[t.owner].id,
      milestoneId: t.ms ? milestones[t.ms].id : null,
      blocked: t.blocked ?? false,
      blockedReason: t.blockedReason ?? null,
      createdAt: ago(t.created, 9 + (t.created % 8)),
      updatedAt: ago(t.updated, 10 + (t.updated % 8)),
    };
  };
  for (const t of TASKS.filter((x) => !x.parent)) {
    const created = await prisma.task.create({ data: baseData(t) });
    taskIds[t.key] = created.id;
    if (GROUPS.includes(t.group)) ensureLabel(t.group);
    const labelNames = [t.group, ...(t.labels ?? [])].filter((n) => labels[n]);
    for (const ln of labelNames) {
      await prisma.taskLabel.create({ data: { taskId: created.id, labelId: labels[ln].id } });
    }
  }
  for (const t of TASKS.filter((x) => x.parent)) {
    const created = await prisma.task.create({
      data: { ...baseData(t), parentId: taskIds[t.parent] },
    });
    taskIds[t.key] = created.id;
  }

  // 决策记录 + 版本留痕
  let decisionCount = 0;
  for (const d of DECISIONS) {
    const authorId = usersByKey[d.author].id;
    const latest = d.versions[d.versions.length - 1];
    const decision = await prisma.decision.create({
      data: {
        taskId: taskIds[d.task],
        workspaceId: team.id,
        markdown: latest.md,
        version: d.versions.length,
        authorId,
        createdAt: ago(d.versions[0].at, 15),
        updatedAt: ago(latest.at, 15),
      },
    });
    for (let i = 0; i < d.versions.length; i++) {
      await prisma.decisionVersion.create({
        data: {
          decisionId: decision.id,
          workspaceId: team.id,
          markdown: d.versions[i].md,
          version: i + 1,
          authorId,
          createdAt: ago(d.versions[i].at, 15),
        },
      });
    }
    decisionCount += 1;
  }

  // 评论（真实感的零星讨论）
  const COMMENTS = [
    {
      task: "p2",
      by: "lead",
      at: 3,
      body: "MoSCoW 里「数据导出」我认为是 Should 不是 Must，冻结前再掂量一下。",
    },
    {
      task: "p2",
      by: "pm",
      at: 2,
      body: "同意，导出让位给附件上传；但导出承诺要在公测公告里写清楚。",
    },
    {
      task: "d2",
      by: "dev",
      at: 4,
      body: "polyfill 方案评审约在周四上午，@郑凯 你先把最小复现传上来。",
      mentions: ["dev2"],
    },
    {
      task: "d2",
      by: "dev2",
      at: 3,
      body: "复现已传（附 Safari 17/18 各一段录屏），路径在评论附件区。",
    },
    { task: "d5", by: "dev2", at: 2, body: "分片上传原型能跑通 200MB，今晚合到 feature 分支。" },
    { task: "d5", by: "dev", at: 1, body: "注意失败重试的幂等：同一分片重复上传要以 sha 去重。" },
    {
      task: "d9",
      by: "lead",
      at: 2,
      body: "回滚判据加一条：支付/登录任何一个 5xx 直接回滚，不等指标。",
    },
    {
      task: "o2",
      by: "lead",
      at: 1,
      body: "激活口径我认同，但阈值 48h 会不会太宽？先按这个跑一周再调。",
    },
    { task: "d1", by: "ops", at: 7, body: "用户那边我已经补偿说明，他们接受，愿意继续内测。" },
  ];
  for (const c of COMMENTS) {
    await prisma.comment.create({
      data: {
        taskId: taskIds[c.task],
        workspaceId: team.id,
        authorId: usersByKey[c.by].id,
        body: c.body,
        mentions: (c.mentions ?? []).map((k) => usersByKey[k].id),
        createdAt: ago(c.at, 11 + (c.at % 6)),
      },
    });
  }

  // 文档
  let docCount = 0;
  for (const doc of DOCUMENTS) {
    await prisma.document.create({
      data: {
        workspaceId: team.id,
        title: doc.title,
        markdown: doc.md,
        publishedMarkdown: doc.published ? doc.md : null,
        publishedAt: doc.published ? ago(doc.updated, 16) : null,
        authorId: usersByKey[doc.author].id,
        icon: doc.icon,
        emoji: doc.emoji,
        visibility: "workspace",
        sortOrder: docCount * 1000,
        createdAt: ago(doc.created, 14),
        updatedAt: ago(doc.updated, 14),
      },
    });
    docCount += 1;
  }

  // 会话与消息
  let msgCount = 0;
  for (const conv of CONVERSATIONS) {
    const memberIds = conv.memberKeys.map((k) => usersByKey[k].id);
    const lastMsg = conv.messages[conv.messages.length - 1];
    const isDirect = conv.type === "direct";
    const creatorKey = isDirect ? conv.memberKeys[0] : "lead";
    const conversation = await prisma.conversation.create({
      data: {
        workspaceId: team.id,
        type: conv.type,
        title: conv.title,
        description: conv.description ?? null,
        createdBy: usersByKey[creatorKey].id,
        createdAt: ago(conv.created, 10),
        updatedAt: ago(lastMsg.at, 10),
        lastMessageAt: ago(lastMsg.at, 10),
      },
    });
    await prisma.conversationMember.createMany({
      data: memberIds.map((uid, i) => ({
        conversationId: conversation.id,
        userId: uid,
        role: i === 0 && !isDirect ? "owner" : "member",
        joinedAt: ago(conv.created, 10),
        // 让总负责人在全员群有 1 条未读（提示 QA 消息小红点）
        lastReadAt: uid === lead.id && conv.key === "all" ? ago(2, 20) : ago(0, 9),
      })),
    });
    for (const msg of conv.messages) {
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          workspaceId: team.id,
          authorId: usersByKey[msg.by].id,
          body: msg.body,
          type: "text",
          mentions: (msg.mentions ?? []).map((k) => usersByKey[k].id),
          createdAt: ago(msg.at, 9 + (msg.at % 10)),
        },
      });
      msgCount += 1;
    }
  }
  // 任务内聊天（挂在 Safari 拖拽缺陷上）
  const taskChatMsgs = [
    { by: "dev2", at: 5, body: "最小复现传上了，Safari 17 稳定复现，18 低概率。" },
    { by: "dev", at: 5, body: "看到了，等周四评审定 polyfill，先别动手改。" },
    { by: "dev2", at: 2, body: "临时 workaround（双击卡片换列）已加，内测用户先顶着。" },
  ];
  for (const msg of taskChatMsgs) {
    await prisma.message.create({
      data: {
        taskId: taskIds.d2,
        workspaceId: team.id,
        authorId: usersByKey[msg.by].id,
        body: msg.body,
        type: "text",
        createdAt: ago(msg.at, 14),
      },
    });
    msgCount += 1;
  }

  // 通知
  for (const n of NOTIFICATIONS) {
    const t = TASKS.find((x) => x.key === n.task);
    await prisma.notification.create({
      data: {
        userId: usersByKey[n.to].id,
        workspaceId: team.id,
        type: n.type,
        entityId: taskIds[n.task],
        entityTitle: t ? t.title : "任务",
        read: n.read,
        createdAt: ago(n.at, 12),
      },
    });
  }

  // 公告
  for (const a of ANNOUNCEMENTS) {
    await prisma.announcement.create({
      data: {
        workspaceId: team.id,
        title: a.title,
        content: a.content,
        type: a.type,
        pinned: a.pinned,
        publishedBy: usersByKey[a.author].id,
        publishedAt: ago(a.at, 10),
        createdAt: ago(a.at, 10),
      },
    });
  }

  // AI 用量日志（约 45 条，铺满最近 8 天，让用量仪表盘有数据）
  const memberKeys = MEMBERS.map((m) => m.key);
  let usageCount = 0;
  for (let day = 7; day >= 0; day--) {
    const perDay = day === 0 ? 3 : 5 + (day % 2);
    for (let i = 0; i < perDay; i++) {
      const [capability, model, inTok, outTok] =
        AI_CAPABILITIES[(day * 3 + i) % AI_CAPABILITIES.length];
      const inputTokens = inTok + ((day * 137 + i * 29) % 400);
      const outputTokens = outTok + ((day * 61 + i * 13) % 200);
      const inputRate = model === "deepseek-reasoner" ? 0.55 / 1e6 : 0.14 / 1e6;
      const outputRate = model === "deepseek-reasoner" ? 2.19 / 1e6 : 0.28 / 1e6;
      const success = !(day === 3 && i === 1) && !(day === 5 && i === 2);
      await prisma.aiUsageLog.create({
        data: {
          workspaceId: team.id,
          userId: usersByKey[memberKeys[(day + i) % memberKeys.length]].id,
          capability,
          model,
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          cost: inputTokens * inputRate + outputTokens * outputRate,
          durationMs: 900 + ((day * 211 + i * 97) % 9000),
          success,
          createdAt: ago(day, 9 + (i % 9)),
        },
      });
      usageCount += 1;
    }
  }

  // 顺手把模拟账号标为已验证、写一次 lastLoginAt（QA 登录时遇到邮箱验证开关也不卡）
  await prisma.user.updateMany({
    where: { id: { in: userIds } },
    data: { emailVerified: true, lastLoginAt: ago(0, 9) },
  });

  return { team, decisionCount, docCount, msgCount, usageCount };
}

// ─── 主流程 ────────────────────────────────────────────────────────────────

async function main() {
  const env = loadEnv();
  // SIM_OWNER_URL 显式覆盖 > 根 .env 的 DATABASE_OWNER_URL。
  // 注意：脚本连的库必须与运行实例是同一个——本机 compose 栈的 db 映射在
  // 127.0.0.1:5433（compose 的 db.ports），.env 若仍写别的端口会"注册成功但
  // 查不到用户"（下方 ensureUsers 会以此特征给出诊断）。
  const ownerUrl = env.SIM_OWNER_URL || env.DATABASE_OWNER_URL || env.DATABASE_URL;
  if (!ownerUrl) {
    console.error("缺少 SIM_OWNER_URL / DATABASE_OWNER_URL / DATABASE_URL（应来自仓库根 .env）");
    process.exitCode = 1;
    return;
  }
  const appPort = env.APP_PORT || "3001";
  const apiBase = env.SIM_API_BASE || `http://127.0.0.1:${appPort}/api/v1`;

  const prisma = new PrismaClient({ datasourceUrl: ownerUrl });
  try {
    log(`\n=== 模拟团队播种（${TEAM_NAME}）===`);
    log(`  API: ${apiBase}`);

    log("\n[1/3] 确保 10 个模拟账号存在（缺失走注册接口）...");
    const { usersByKey, createdEmails } = await ensureUsers(prisma, apiBase);
    log(`  已存在: ${10 - createdEmails.length} / 新注册: ${createdEmails.length}`);
    for (const e of createdEmails) log(`    + ${e}`);

    log("\n[2/3] 重建团队与内容...");
    const result = await reseedTeam(prisma, usersByKey);
    log(
      `  任务 ${TASKS.length} 条（含子任务）· 决策 ${result.decisionCount} 条 · 文档 ${result.docCount} 篇 · 消息 ${result.msgCount} 条 · AI 用量 ${result.usageCount} 条`,
    );

    log("\n[3/3] 完成。账号清单：");
    log("  ┌────────┬──────────────────────────┬────────────────┬─────────────┐");
    log("  │ 姓名   │ 邮箱                     │ 角色           │ 组          │");
    log("  ├────────┼──────────────────────────┼────────────────┼─────────────┤");
    for (const m of MEMBERS) {
      const role = m.role === "owner" ? "总负责人" : m.role === "admin" ? "组负责人" : "成员";
      log(
        `  │ ${m.name.padEnd(4, "　")}   │ ${m.email.padEnd(24)} │ ${role.padEnd(10, "　")}     │ ${m.group.padEnd(6, "　")}    │`,
      );
    }
    log("  └────────┴──────────────────────────┴────────────────┴─────────────┘");
    log(`  统一密码：${SIM_PASSWORD}`);
    log(`  登录页：  http://127.0.0.1:${appPort}/auth/login`);
    log(`  团队直达：http://127.0.0.1:${appPort}/w/${result.team.id}`);
    log("\n  重跑即重置（保留账号，重建全部内容）；注册限流 10 次/小时，正常重跑不触发。\n");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("\n播种失败：", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
