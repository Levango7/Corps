# corps 数据库迁移规范

> 版本：v1.0 ｜ 日期：2026-08-23 ｜ 适用范围：Prisma 迁移 + raw SQL

---

## 第1章 Prisma 迁移流程

### 1.1 迁移管线

```
开发环境（本地）  →  预发布环境（Staging）  →  生产环境（Production）
     ↓                      ↓                        ↓
prisma migrate dev    prisma migrate deploy    prisma migrate deploy
```

### 1.2 命令使用场景

| 命令 | 场景 | 说明 |
|------|------|------|
| `prisma migrate dev --name xxx` | 本地开发 | 自动生成迁移 SQL + 执行 |
| `prisma migrate deploy` | Staging/Production | 仅执行已有迁移，不做差异检测 |
| `prisma migrate status` | 任意环境 | 检查迁移状态 |
| `prisma migrate resolve` | 故障恢复 | 解决迁移冲突 |

### 1.3 迁移文件命名

```
prisma/migrations/
└── 20260823_init/
    └── migration.sql
└── 20260824_add_review_status/
    └── migration.sql
```

命名：`YYYYMMDD_功能描述`

---

## 第2章 可回滚策略

### 2.1 强制要求（与 SPEC.md §10 对齐）

每次迁移必须包含 down migration，确保"每次部署可一键回滚"。

### 2.2 回滚实现

```sql
-- ===== UP (migration) =====
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS review_status text;

-- ===== DOWN (rollback) =====
-- ALTER TABLE tasks DROP COLUMN IF EXISTS review_status;
```

回滚 SQL 以注释形式保留在迁移文件中，需要时取消注释执行。

### 2.3 回滚测试

每次迁移完成后：
1. 在 Staging 环境执行 UP migration
2. 验证功能正常
3. 执行 DOWN migration
4. 验证可回滚且无数据丢失

---

## 第3章 Seed 数据

### 3.1 Seed 脚本

创建 `web/prisma/seed.ts`：

```typescript
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // 仅在开发环境运行
  if (process.env.NODE_ENV === "production") {
    console.log("Seed 脚本禁止在生产环境运行");
    return;
  }

  // 创建演示用户
  const demoUser = await prisma.user.upsert({
    where: { email: "demo@corps.app" },
    update: {},
    create: {
      email: "demo@corps.app",
      name: "演示用户",
      password: "Demo123456!", // 仅 dev 用
    },
  });

  // 创建演示工作区
  const demoWorkspace = await prisma.workspace.upsert({
    where: { slug: "demo" },
    update: {},
    create: {
      name: "演示工作区",
      slug: "demo",
      ownerId: demoUser.id,
    },
  });

  // 创建演示任务
  await prisma.task.createMany({
    data: [
      { workspaceId: demoWorkspace.id, title: "了解 corps 看板功能", status: "todo", priority: "high", createdBy: demoUser.id },
      { workspaceId: demoWorkspace.id, title: "邀请团队成员", status: "todo", priority: "medium", createdBy: demoUser.id },
      { workspaceId: demoWorkspace.id, title: "创建第一条决策记录", status: "in_progress", priority: "low", createdBy: demoUser.id },
    ],
    skipDuplicates: true,
  });

  console.log("Seed 数据已创建");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
```

### 3.2 Seed 隔离

- **开发环境**：`npm run db:seed` 可执行
- **生产环境**：脚本内 `NODE_ENV === "production"` 保护，拒绝执行

---

## 第4章 多环境管理

### 4.1 环境变量

| 文件 | 环境 | DATABASE_UL |
|------|------|-------------|
| `.env.local` | 本地开发 | `postgresql://postgres:xxx@localhost:5432/corps_dev` |
| `.env.staging` | 预发布 | CloudBase Staging 实例 |
| `.env.production` | 生产 | CloudBase Production 实例 |

### 4.2 安全规则

- **严禁**将密码/连接串硬编码在代码中
- **严禁**将 `.env` 文件提交到 Git
- `.env.local.example` 仅提供模板，不含真实密码
- 生产环境连接串由 CloudBase 密钥管理服务注入

---

## 第5章 RLS 迁移注意事项

### 5.1 权威来源与激活

- **表结构权威 = `web/prisma/schema.prisma`**；`db/schema.sql` 是它的部署伴生文件，
  额外承载 Prisma 不管的部分：运行时角色、RLS 策略、引擎授权。两者禁止各自演化。
- 开发环境以表主/超级用户连接时 PostgreSQL **绕过 RLS**（本地便利，属预期）。
- 生产激活步骤见 `db/schema.sql` 头部 ACTIVATION 一节：
  创建非表主角色 `corps_app`（NOINHERIT、无 BYPASSRLS）→ 执行 schema.sql →
  应用 `DATABASE_URL` 改连 `corps_app`。只有这条链路上 AC-04 的引擎层保证才生效。
- 认证流逃逸口约定（事务级 GUC `app.auth_op`，由 `lib/auth.ts` 的
  `runWithAuthOp()` 注入）：`login` / `provision` / `webhook` 三种白名单操作。

### 5.2 新增租户表

每新增一张业务表，必须同步：

1. 在 `web/prisma/schema.prisma` 添加模型，含 `workspaceId String @db.Uuid`
2. 在 `db/schema.sql` 补 DDL + `ALTER TABLE xxx ENABLE ROW LEVEL SECURITY;`
3. 创建策略：`CREATE POLICY p_xxx_rls ON xxx USING (workspace_id = current_setting('app.workspace_id', true)::uuid);`
4. 授权给 `corps_app`：`GRANT SELECT, INSERT, UPDATE, DELETE ON xxx TO corps_app;`

### 5.3 角色不变原则

- `corps_app` 永不授予 BYPASSRLS / SUPERUSER / 表的 OWNERSHIP
- 迁移与 DDL 变更仅由 `app_migrator` 角色执行