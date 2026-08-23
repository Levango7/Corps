import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // 生产环境保护——禁止运行 seed
  if (process.env.NODE_ENV === "production") {
    console.warn("⚠️  Seed 脚本禁止在生产环境运行！已自动跳过。");
    return;
  }

  console.log("🌱 开始播种演示数据...");

  // 1. 创建演示用户
  const demoUser = await prisma.user.upsert({
    where: { email: "demo@corps.app" },
    update: {},
    create: {
      email: "demo@corps.app",
      name: "演示用户",
      password: "Demo123456!",
    },
  });
  console.log(`  ✓ 演示用户: ${demoUser.email}`);

  const alice = await prisma.user.upsert({
    where: { email: "alice@corps.app" },
    update: {},
    create: {
      email: "alice@corps.app",
      name: "Alice（产品负责人）",
      password: "Alice1234!",
    },
  });
  console.log(`  ✓ Alice: ${alice.email}`);

  const bob = await prisma.user.upsert({
    where: { email: "bob@corps.app" },
    update: {},
    create: {
      email: "bob@corps.app",
      name: "Bob（开发工程师）",
      password: "Bob12345!",
    },
  });
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
    prisma.task.create({
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
    prisma.task.create({
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
    prisma.task.create({
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
    prisma.task.create({
      data: {
        workspaceId: demoWs.id,
        title: "接入 Stripe 计费 webhook",
        description: "席位 quantity 自动同步，AC-08/09 验收",
        status: "todo",
        priority: "medium",
        createdBy: alice.id,
      },
    }),
    prisma.task.create({
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
    prisma.task.create({
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
  await prisma.decision.create({
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

  console.log("\n🎉 Seed 完成！运行 `npm run dev` 后访问 http://localhost:3000");
}

main()
  .catch((e) => {
    console.error("❌ Seed 失败:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });