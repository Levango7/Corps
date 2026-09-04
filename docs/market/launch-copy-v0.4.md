# corps v0.4.0 发版文案草稿

> 定位：面向 5-30 人中小团队的轻量协作 SaaS——"讨论结论自动落位成任务，不再手动搬运"
> 发版人视角：个人开发者，长期项目，Product Hunt + V2EX 双渠道首发
> 配合演示账号：owner-demo-mtneahjs@example.com / SeedDemo123!（Q4 大促筹备组，含完整演示数据）

---

## V2EX 版（分享创造节点，中文，标题 ≤ 20 字理想）

**标题：corps——讨论结论自动落位成任务的协作工具（免费开源栈）**

正文：

做了一个给小团队的协作 SaaS：corps。

起因是自己带项目时的一个老问题：讨论时结论都说清楚了，会后还得有人手动把结论搬进任务工具里，搬着搬着"为什么这么定"就散落在聊天记录里再也找不到了。有研究说约 1/4 的任务因为这个流程断裂超期——不研究也信。

corps 的核心就一件事：**把"讨论结论 → 决策记录 → 任务"做成一个闭环。**

- 任务看板 + **决策记录**（版本留痕、双向回链任务）——"为什么这么定"永远可查
- **子任务**拆分 + 完成度进度条自动汇总
- 阻塞标记：被卡住的任务标红写原因，站会一眼看到
- **文档中心**：团队公约 / 新人手册沉淀，支持公开只读分享链接（发给客户、外包不用拉进工作区）
- 决策里可以直接写 **mermaid** 画流程图、时序图，甚至思维导图
- 决策记录和文档都能**一键导出 PDF**
- 任务内轻沟通 IM（附件点击直接预览，图片放大 / PDF 内嵌）

技术上自己比较得意的几点：

- PostgreSQL **行级安全（RLS）** 做多租户隔离——跨工作区请求在数据库引擎层被拦截，不靠应用代码自觉
- 中英双语完整支持（不是翻译插件的半吊子）
- CI 七道关卡：lint / 安全审计 / 单测 / **加固模式 RLS 回归**（以最小权限角色连接跑全量集成测试）/ 生产构建 / 浏览器 E2E / 镜像发布

免费版 10 人以内全功能（21 项），Pro ¥29.9/人/月解锁无限席位和决策记录上限。

在线体验（已预置演示数据）：[地址]
代码：https://github.com/Levango7/Corps
自部署镜像：`docker pull ghcr.io/levango7/corps:0.4.0`（docker compose 一键起全栈）

欢迎拍砖，特别是"你们团队平时怎么记决策"这个话题。

---

## Product Hunt 版（英文，tagline ≤ 60 字符）

**Name**: corps
**Tagline**: Turn discussion conclusions into tasks—automatically
**Description**:

We built corps for small teams (5–30 people) drowning in a broken loop: decisions get made in meetings, then someone manually copies them into a task tool, and the "why" behind every task evaporates into chat history.

corps closes that loop:

✅ **Decision records** — every task carries its "why" with version history and bidirectional links
✅ **Subtasks** with automatic done/total progress bars on parent cards
✅ **Blockers** — flag stuck tasks with a reason; standup sees them instantly
✅ **Document center** — team handbooks & conventions, with public read-only share links (send to clients without adding seats)
✅ **Mermaid diagrams** — flowcharts, sequence diagrams, even mindmaps right inside decisions
✅ **One-click PDF export** for decisions and docs
✅ In-task chat with inline attachment preview (image lightbox / embedded PDF)

Engineering details we're proud of:
🔒 Multi-tenant isolation at the **database engine level** (PostgreSQL RLS) — cross-workspace requests are blocked by the database itself, not app code
🌍 Full Chinese/English bilingual UI
🧪 7-gate CI including a **hardened RLS regression suite** that runs the full integration suite as a least-privilege role

Free for teams up to 10 with everything above (21 features). Pro at ¥29.9/seat/month unlocks unlimited seats & decision history.

Self-host in one command: `docker pull ghcr.io/levango7/corps:0.4.0`

---

## 即刻/朋友圈短版（中文，< 150 字）

做了个叫 corps 的团队协作工具：讨论结论直接固化为决策记录，版本留痕、双向回链任务，"为什么这么定"永远可查。子任务进度自动汇总、被卡任务标红、文档中心支持公开分享、决策里能画 mermaid 流程图、一键导出 PDF。多租户隔离做在数据库引擎层（RLS），不是应用层自觉。免费 10 人全功能。在线体验已备好演示数据。

---

## 渠道备注（发帖前 checklist）

- [ ] 在线演示站点部署（当前仅 localhost——需要公网实例后发帖）
- [ ] 演示账号数据每次发帖前重置（避免别人改动）
- [ ] GHCR 0.4.0 镜像已 public（已验证）
- [ ] GitHub README 首屏加一句话定位 + 截图（当前 README 较工程向）
