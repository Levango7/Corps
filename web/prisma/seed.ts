import { PrismaClient } from "@prisma/client";
// better-auth/crypto 导出公开的 hashPassword，使用与 Better Auth 一致的哈希算法
// （默认 scrypt）。seed 必须用此函数哈希密码，否则登录时 signInEmail 验证失败。
import { hashPassword } from "better-auth/crypto";

const prisma = new PrismaClient();

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
          accountId: email,
          password: hashed,
        },
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
  // Better Auth signInEmail 通过 accounts(providerId="credential") 验证密码
  await prisma.account.create({
    data: {
      userId: user.id,
      providerId: "credential",
      accountId: email,
      password: hashedPassword,
    },
  });
  return user;
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
