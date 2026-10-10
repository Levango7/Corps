import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { resolveDatabaseUrl } from "../lib/db-pool";
// better-auth/crypto 导出公开的 hashPassword，使用与 Better Auth 一致的哈希算法
// （默认 scrypt）。seed 必须用此函数哈希密码，否则登录时 signInEmail 验证失败。
import { hashPassword } from "better-auth/crypto";

// Prisma 7：连接走 driver adapter（v6 的 datasources/隐式 env 读取均已移除）。
// DATABASE_URL 缺失时 resolveDatabaseUrl 抛 DatabaseUrlMissingError，报错可读。
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: resolveDatabaseUrl() }),
});

/**
 * 幂等地创建演示用户：
 *   1. 用 Better Auth 的 hashPassword 生成密码哈希（scrypt，与生产一致）
 *   2. 写入 users.password_hash（schema 字段，保持数据一致性）
 *   3. 写入 accounts.password（providerId="credential"）—— Better Auth signInEmail
 *      实际查找的位置，缺失则登录失败。
 * 若用户已存在则跳过（支持重复运行 seed）。
 */
async function ensureUser(email: string, name: string, password: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // 确保凭据 account 记录存在（历史 seed 可能只写了 user.password_hash）
    const credAccount = await prisma.account.findFirst({
      where: { userId: existing.id, providerId: "credential" },
    });
    if (!credAccount) {
      const hashed = await hashPassword(password);
      await prisma.account.create({
        data: {
          userId: existing.id,
          providerId: "credential",
          // Better Auth ≥1.7.3 的 credential 行以「用户 id」作为 accountId 检索
          // （旧 seed 按 1.7.1 语义写 email ⇒ signInEmail 查不到 ⇒ 恒 401）
          accountId: existing.id,
          // createLocalAccountIssuer("credential") 与库列默认值一致，留空即由 DB 填充
          password: hashed,
        },
      });
    } else if (credAccount.accountId !== existing.id) {
      // 自愈：把按旧语义（accountId=email）写入的行改回用户 id
      await prisma.account.update({
        where: { id: credAccount.id },
        data: { accountId: existing.id },
      });
    }
    return existing;
  }

  const hashedPassword = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      email,
      name,
      password: hashedPassword,
    },
  });
  // Better Auth signInEmail 通过 accounts(providerId="credential") 验证密码；
  // ≥1.7.3 用「用户 id」作为 accountId 检索，issuer 省略即由 DB DEFAULT 落
  // "local:credential"（与 better-auth 自建账号实测一致）。
  await prisma.account.create({
    data: {
      userId: user.id,
      providerId: "credential",
      accountId: user.id,
      password: hashedPassword,
    },
  });
  return user;
}

/**
 * seed 的幂等入口：任务/决策没有 (workspaceId,title) 之类的唯一约束可 upsert，
 * 所以先查后建。此前两者都是裸 create，重复跑 seed 会成倍累积（实测 tasks 6→12）。
 */
async function ensureTask(args: { data: Prisma.TaskUncheckedCreateInput }) {
  const hit = await prisma.task.findFirst({
    where: { workspaceId: args.data.workspaceId, title: args.data.title },
  });
  return hit ?? prisma.task.create(args);
}

async function ensureDecision(args: { data: Prisma.DecisionUncheckedCreateInput }) {
  const hit = await prisma.decision.findFirst({ where: { taskId: args.data.taskId } });
  return hit ?? prisma.decision.create(args);
}

/** 文档幂等入口：按 (workspaceId, title) 先查后建，避免重复跑 seed 累积。 */
async function ensureDocument(args: { data: Prisma.DocumentUncheckedCreateInput }) {
  const hit = await prisma.document.findFirst({
    where: { workspaceId: args.data.workspaceId, title: args.data.title },
  });
  return hit ?? prisma.document.create(args);
}

/** 评论幂等入口：按 (taskId, body) 先查后建。 */
async function ensureComment(args: { data: Prisma.CommentUncheckedCreateInput }) {
  const hit = await prisma.comment.findFirst({
    where: { taskId: args.data.taskId, body: args.data.body },
  });
  return hit ?? prisma.comment.create(args);
}

async function main() {
  // 生产环境保护——禁止运行 seed
  if (process.env.NODE_ENV === "production") {
    console.warn("⚠️  Seed 脚本禁止在生产环境运行！已自动跳过。");
    return;
  }

  console.log("🌱 开始播种演示数据...");

  // 1. 创建演示用户（密码用 Better Auth 的 scrypt 哈希）
  const demoUser = await ensureUser("demo@corps.app", "演示用户", "Demo123456!");
  console.log(`  ✓ 演示用户: ${demoUser.email}`);

  const alice = await ensureUser("alice@corps.app", "Alice（产品负责人）", "Alice1234!");
  console.log(`  ✓ Alice: ${alice.email}`);

  const bob = await ensureUser("bob@corps.app", "Bob（开发工程师）", "Bob12345!");
  console.log(`  ✓ Bob: ${bob.email}`);

  // 2. 创建演示工作区
  const demoWs = await prisma.workspace.upsert({
    where: { slug: "demo" },
    update: {},
    create: {
      name: "演示工作区 · corps 产品开发",
      slug: "demo",
      ownerId: demoUser.id,
    },
  });
  console.log(`  ✓ 工作区: ${demoWs.name}`);

  // 3. 添加成员（三角色演示）
  await prisma.member.upsert({
    where: { userId_workspaceId: { userId: demoUser.id, workspaceId: demoWs.id } },
    update: {},
    create: { userId: demoUser.id, workspaceId: demoWs.id, role: "owner" },
  });
  await prisma.member.upsert({
    where: { userId_workspaceId: { userId: alice.id, workspaceId: demoWs.id } },
    update: {},
    create: { userId: alice.id, workspaceId: demoWs.id, role: "admin" },
  });
  await prisma.member.upsert({
    where: { userId_workspaceId: { userId: bob.id, workspaceId: demoWs.id } },
    update: {},
    create: { userId: bob.id, workspaceId: demoWs.id, role: "member" },
  });
  console.log("  ✓ 成员: owner(demo) + admin(Alice) + member(Bob)");

  // 4. 创建演示任务
  const tasks = await Promise.all([
    ensureTask({
      data: {
        workspaceId: demoWs.id,
        title: "完成 corps MVP 需求评审",
        description: "基于 SPEC.md 与 PRD 进行需求评审，确认 P0 范围",
        status: "done",
        priority: "high",
        assigneeId: alice.id,
        createdBy: demoUser.id,
      },
    }),
    ensureTask({
      data: {
        workspaceId: demoWs.id,
        title: "实现多租户 RLS 隔离",
        description: "PostgreSQL 18.4 RLS + app_role NOBYPASSRLS 双层保障",
        status: "in_progress",
        priority: "high",
        assigneeId: bob.id,
        createdBy: demoUser.id,
      },
    }),
    ensureTask({
      data: {
        workspaceId: demoWs.id,
        title: "搭建前端 UI 对齐设计原型",
        description: "Calm Precision 设计系统，globals.css 与 design-tokens.css 对齐",
        status: "in_progress",
        priority: "medium",
        assigneeId: bob.id,
        createdBy: alice.id,
      },
    }),
    ensureTask({
      data: {
        workspaceId: demoWs.id,
        title: "接入 Stripe 计费 webhook",
        description: "席位 quantity 自动同步，AC-08/09 验收",
        status: "todo",
        priority: "medium",
        createdBy: alice.id,
      },
    }),
    ensureTask({
      data: {
        workspaceId: demoWs.id,
        title: "编写端到端测试（AC-01~AC-06）",
        description: "Vitest + Testing Library，覆盖核心验收标准",
        status: "todo",
        priority: "low",
        assigneeId: bob.id,
        createdBy: demoUser.id,
      },
    }),
    ensureTask({
      data: {
        workspaceId: demoWs.id,
        title: "配置 CI/CD 流水线",
        description: "GitHub Actions: lint → test → build → deploy CloudBase",
        status: "review",
        priority: "medium",
        createdBy: alice.id,
      },
    }),
  ]);
  console.log(`  ✓ 任务: ${tasks.length} 条（各状态演示）`);

  // 5. 创建决策记录
  const taskForDecision = tasks[0]; // "完成 corps MVP 需求评审"
  await ensureDecision({
    data: {
      taskId: taskForDecision.id,
      workspaceId: demoWs.id,
      markdown: `# 需求评审决策

## 决议
- MVP 聚焦"任务看板"为锚点，不做 IM、不做实时协同编辑
- 多租户隔离采用 PostgreSQL RLS 引擎层强制

## 参会人
- Demo（owner）
- Alice（产品负责人）

## 下一步
- Bob 负责实现 RLS 隔离
- Alice 负责 SPEC.md 冻结`,
      authorId: demoUser.id,
    },
  });
  console.log("  ✓ 决策记录: 1 条");

  // 6. 子任务（演示父任务看板卡上的 done/total 进度条）
  const rlsTask = tasks[1]; // "实现多租户 RLS 隔离"
  const subtasks = await Promise.all([
    ensureTask({
      data: {
        workspaceId: demoWs.id,
        title: "设计 RLS 策略矩阵（表 × 操作）",
        description: "19 张业务表逐张定义 SELECT/INSERT/UPDATE/DELETE 四类策略",
        status: "done",
        priority: "high",
        parentId: rlsTask.id,
        createdBy: demoUser.id,
      },
    }),
    ensureTask({
      data: {
        workspaceId: demoWs.id,
        title: "编写 rls-activate.sql 幂等激活脚本",
        description: "corps_app 最小权限角色 + FORCE ROW LEVEL SECURITY",
        status: "done",
        priority: "high",
        parentId: rlsTask.id,
        createdBy: bob.id,
      },
    }),
    ensureTask({
      data: {
        workspaceId: demoWs.id,
        title: "加固模式回归：以最小权限角色跑集成测试",
        description: "验证跨租户请求在引擎层被拒（不依赖应用代码自觉）",
        status: "in_progress",
        priority: "medium",
        parentId: rlsTask.id,
        createdBy: bob.id,
      },
    }),
  ]);
  console.log(`  ✓ 子任务: ${subtasks.length} 条（父任务进度条演示）`);

  // 7. 阻塞任务（演示"被依赖卡住"的红色徽标与原因展示）
  await ensureTask({
    data: {
      workspaceId: demoWs.id,
      title: "接入日历同步（Google / Outlook）",
      description: "跨租户只读扫描任务与截止日，需先有 RLS 隔离基线",
      status: "todo",
      priority: "low",
      blocked: true,
      blockedReason: "依赖「实现多租户 RLS 隔离」完成——隔离未定型前不接入外部日历",
      createdBy: alice.id,
    },
  });
  console.log("  ✓ 阻塞任务: 1 条（阻塞徽标演示）");

  // 8. 补充决策记录（演示"决策留痕 + 双向回链任务"）
  await ensureDecision({
    data: {
      taskId: rlsTask.id,
      workspaceId: demoWs.id,
      markdown: `# 隔离方案决策：为什么选引擎层 RLS 而不是应用层过滤

## 背景
应用层"每个查询记得带 workspaceId"的模式，在多轮迭代后必然出现漏写。

## 备选方案
| 方案 | 隔离强度 | 维护成本 |
|---|---|---|
| 应用层过滤 | 依赖代码自觉 | 每加一个端点都要记得 |
| 数据库 RLS | 引擎强制 | 一次性定义，之后自动生效 |

## 决议
采用 PostgreSQL RLS + \`corps_app\`（NOBYPASSRLS）+ FORCE ROW LEVEL SECURITY。
跨租户请求在数据库层被直接拦截，**不依赖应用代码自觉**。

## 风险与对策
- 风险：新表忘记纳入 RLS → 对策：CI 门禁扫描 schema 与 RLS 名单求差集，非空即红
- 风险：策略写错导致越权 → 对策：加固模式回归以最小权限角色跑全量集成测试`,
      authorId: bob.id,
    },
  });
  console.log("  ✓ 决策记录补充: 1 条（方案对比 + 风险对策）");

  // 9. 演示文档（体现"文档中心"——团队公约沉淀 + 公开只读分享）
  const guideMarkdown = `# 团队协作公约

## 一、任务怎么流转
1. 任何结论都先落到**任务卡**上，再开始做
2. 大任务拆**子任务**，父任务卡自动显示 done/total 进度
3. 被外部依赖卡住时**标记阻塞并写清原因**，不要让它悄悄烂在 todo 里

## 二、决策为什么要留痕
会议上的结论 30 天后必然失忆。corps 要求每条重要任务携带一份**决策记录**：
- 写清"为什么这么定"，而不只是"定了什么"
- 列出备选方案与被否决的原因
- 决策变更时保留版本，旧版本仍可查

> 目的：新成员加入时，能自己看懂历史决策的来龙去脉，不用反复问人。

## 三、文档与任务的分工
- **任务**：一次性的、有明确终点的执行单元
- **文档**：长期沉淀的团队公约、规范、新人手册

两者正交，不要用任务当文档用。`;

  const docs = await Promise.all([
    ensureDocument({
      data: {
        workspaceId: demoWs.id,
        title: "团队协作公约",
        markdown: guideMarkdown,
        publishedMarkdown: guideMarkdown,
        publishedAt: new Date(),
        authorId: demoUser.id,
      },
    }),
    ensureDocument({
      data: {
        workspaceId: demoWs.id,
        title: "新人上手指南",
        markdown: `# 新人上手指南

## 第一天：先看懂
1. 打开**任务看板**，按状态列浏览当前所有工作
2. 随机点开 2–3 张卡片，读一遍里面的**决策记录**——这是本团队最重要的沉淀
3. 到**文档中心**读「团队协作公约」

## 第一周：开始参与
1. 从看板认领一个 \`priority: low\` 的任务
2. 在任务详情页用**轻沟通 IM** 提问，不要私聊
3. 有结论就写进决策记录——**写下来才算数**

## 常用入口
- 看板：所有任务的唯一真相源
- 决策：任务的"为什么"
- 文档：团队的长期记忆
- AI 助手：续写、摘要、翻译、任务拆解（所有建议需你确认后才落位）`,
        authorId: alice.id,
      },
    }),
  ]);
  console.log(`  ✓ 文档: ${docs.length} 篇（含 1 篇已发布，可演示公开分享）`);

  // 10. 评论（演示"任务内轻沟通"）
  await ensureComment({
    data: {
      taskId: rlsTask.id,
      workspaceId: demoWs.id,
      authorId: alice.id,
      body: "策略矩阵我review过了，`members` 表的 UPDATE 记得加 WITH CHECK，防止借 UPDATE 把 workspace_id 改到别的租户。",
    },
  });
  await ensureComment({
    data: {
      taskId: rlsTask.id,
      workspaceId: demoWs.id,
      authorId: bob.id,
      body: "已加，见 rls-activate.sql 的 p_members_update。另外补了一条 CI 门禁：schema 里含 workspaceId 的表与 RLS 名单求差集，差集非空直接失败。",
    },
  });
  console.log("  ✓ 评论: 2 条（任务内轻沟通演示）");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  console.log(`\n🎉 Seed 完成！运行 \`npm run dev\` 后访问 ${appUrl}`);
}

main()
  .catch((e) => {
    console.error("❌ Seed 失败:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
