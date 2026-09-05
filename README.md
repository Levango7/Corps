# corps — 讨论结论自动落位成任务

面向 **5–30 人中小团队**的轻量协作 SaaS：以工作区任务看板为锚点，让每一次讨论的结论自动固化为**决策记录**（版本留痕、双向回链任务）——"为什么这么定"永远可查，不再散落在聊天记录里。

> 15 分钟上手 · 中英双语 · 免费版 10 人全功能

---

## 为什么是 corps

小团队的日常：会上结论都说清了，会后还得有人手动把结论搬进任务工具，搬着搬着"为什么这么定"就再也找不到了。约 1/4 的任务因为这个流程断裂而超期。

corps 把这个断点补上：

| 能力 | 说明 |
|---|---|
| **决策记录** | 每条任务可携带"为什么这么定"——markdown + Mermaid 图表（流程图/时序图/思维导图），版本留痕，双向回链 |
| **子任务 + 阻塞** | 大任务拆子任务，父任务看板卡自动显示 done/total 进度条；被依赖卡住的任务标红写原因 |
| **文档中心** | 团队公约 / 新人手册沉淀（与决策正交），支持**公开只读分享链接**——发给客户、外包不用拉进工作区 |
| **任务内轻沟通 IM** | 附件上传、实时推送、已读回执；附件点击直接预览（图片放大 / PDF 内嵌） |
| **一键导出 PDF** | 任务决策记录与文档导出为排版良好的 PDF（打印 CSS 方案，深色主题自动浅色输出） |
| **Markdown 工具栏 + 模板库** | 粗体/表格/代码块一键插入；三个决策模板（方案对比 / 事故复盘 / 立项决议） |
| **中英双语** | 全站 UI 完整双语，`/en` 前缀路由 + 一键切换 |

**全部 Free 可用（21 项）** · Pro ¥29.9/人/月解锁无限席位、附件 50MB、每周任务摘要邮件。

## 工程上的硬承诺

- **数据库引擎级租户隔离**：19 张业务表全部 FORCE ROW LEVEL SECURITY，跨工作区请求在 PostgreSQL 层被直接拦截——不靠应用代码自觉
- **CI 七道关卡**：lint / 安全审计 / 单测 / **加固模式回归**（以最小权限角色 + RLS 激活跑全量集成测试）/ 生产构建 / 浏览器 E2E / 镜像发布——每个 commit 都过
- **可复现的部署**：镜像发布到 GHCR，`docker compose up -d` 一键起全栈（app + PostgreSQL + Redis + cron 调度器）

## 快速开始（自部署）

```bash
# 1. 准备 .env（参考 .env.example，必填项见 docs/runbook-deploy.md）
cp .env.example .env

# 2. 拉取官方镜像并启动全栈
docker pull ghcr.io/levango7/corps:latest
docker compose up -d

# 3. 健康检查
curl http://localhost:3000/api/health
```

本地开发：

```bash
cd web
pnpm install
cp .env.local.example .env.local   # 修改密码
npx prisma generate && npx prisma migrate dev
pnpm dev                           # http://localhost:3000
```

## 技术栈

Next.js 16（App Router / Turbopack）· React 19 · Tailwind CSS 4 · Prisma 6 · PostgreSQL 18（RLS）· Better Auth · next-intl · mermaid · Stripe / 微信 / 支付宝三通道

## 仓库结构

```
web/          # Next.js 应用（app/ + components/ + lib/ + prisma/）
db/           # rls-activate.sql（加固模式一键激活）
docs/         # ADR 决策记录 / runbook / 市场与定价文档
design/       # 设计系统（design-tokens.css 双主题）
e2e/          # Playwright 浏览器级测试（58 项）
.github/      # CI 七关卡 workflow
```

## 链接

- **在线体验**：部署中（v0.4.0 已发布）
- **变更日志**：[CHANGELOG.md](./CHANGELOG.md)
- **部署手册**：[docs/runbook-deploy.md](./docs/runbook-deploy.md)
- **镜像**：`docker pull ghcr.io/levango7/corps:0.4.0`
- **定价**：内置定价页（Free 21 项 / Pro ¥29.9）

---

*个人开发者长期项目 · 安全问题请通过 GitHub Security Advisories 报告*
