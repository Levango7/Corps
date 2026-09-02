# Changelog

本文件记录 corps 的版本变更，遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 惯例，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.3.0] - 2026-09-02

定价与功能包装再设计（v2 定价方案，用户 2026-09-02 拍板）。

### Changed

- **Pro 定价 ¥59 → ¥29.9/人/月、¥590 → ¥299/人/年**：国内锚点下重新定价（Teambition ¥25 / 飞书 ¥50），起步期渗透优先。年付维持"付 10 个月用 12 个月"结构。
- **Free 功能清单 7 → 14 项**：将已建成但未列出的能力诚实纳入（任务内 IM、日历连接、通知中心、标签/里程碑、批量操作、中英双语、深色模式、移动端响应式、降级不锁数据）——全部有代码支撑，非画饼。
- **Pro 清单 6 → 8 项**：无限席位提为首位卖点；新增附件扩容与每周任务摘要两个真实功能（见 Added）；基础邮件通知归回 Free（遵循"绝不偷偷降级免费功能"红线）。
- 定价页与对比表全量 i18n 化（pricing.features.* / pricing.matrix.* 翻译键，zh/en 双语渲染；此前对比表与功能清单仅中文）。

### Added

- **附件存储按套餐门控**：免费版单文件 10MB / Pro 50MB（attachments 路由按 active 订阅判定，免费超限提示升级路径）。
- **每周任务摘要邮件（Pro）**：`/api/cron/weekly-digest` 每周一 02:00 UTC 执行（北京时间周一 10:00），向 Pro 工作区每位成员发送其负责任务的逾期 + 未来 7 天到期摘要；corps-cron 调度容器内置计划表。
- 定价决策文档 `docs/market/pricing-redesign-v2.md`（ACCEPTED，含现状诊断、锚点论证、ROI 叙事与红线校验）。

## [0.2.1] - 2026-09-02

关键修复版本：解决 0.2.0 生产镜像全站无样式的问题。

### Fixed

- **生产构建全站样式缺失（0.2.0 最严重缺陷）**：`next build` 生产路径不自动接入 `@tailwindcss/postcss`（dev 会），导致镜像内 CSS 仅剩 ~6.5KB design-tokens 变量、所有 Tailwind 工具类缺失，UI 布局崩坏。补 `postcss.config.mjs` 显式接入后产物 CSS ~60KB（fecc6ca）。
- **生产构建登录页中英混排**：0.2.0 镜像打包时 i18n 提取尚未完成，登录表单 label 为"翻译 + 硬编码中文"残留（如 "Email密码"式混排）。0.2.1 打包自 i18n 收口后的完整源码（94ebdad）。
- **E2E 假阳性暴露并修复**：CSS 修复让 `md:hidden` 真正生效后，BoardView 移动/桌面双渲染中 `.first()` 命中隐藏移动副本的 7 处定位器失效——统一加 `filter({ visible: true })`（b8d4030）；登录导航超时 20s→30s 抗抖动。
- **entrypoint 生产兼容**：prisma 6 移除 `--url` 参数改环境变量注入；psql 缺失时降级告警而非启动失败（6a0c0bd）。
- **compose app 服务显式 ENTRYPOINT** 覆盖 0.2.0 镜像破损元数据（2f7a6ac 前后修复）。

### Added

- 完成上一批 UI 半成品接线：ClientLayout（Toast 容器 + 入场动画）挂载、顶栏 Logo 组件化、看板拖放目标高亮（2e7c808）。
- CI workflow_dispatch 手动触发、GitHub Pages 展示页配置（178a894/2d587dd）。

## [0.2.0] - 2026-08-31

首个对外发布版本。相对 0.1.0（内部开发版），聚焦三件事：双语国际化、商业化闭环（国内支付 + 筛选/视图 Pro 功能 + 账户删除）、安全加固收口。

### Added

- **中英双语界面**：全站 UI 文案接入 next-intl（zh/en 683 键级对称，`i18n-keys` 测试守护）；`/en` 前缀路由 + 语言切换器；时间格式化、状态/优先级/角色标签、邮件模板等随 locale 渲染。
- **国内支付通道**：微信 Native 扫码（二维码轮询确认）与支付宝网页支付接入，与 Stripe 并列可选；计费页支持月付/年付切换（年付 ¥590/席）。
- **任务筛选与自定义视图（Pro）**：后端 5 维筛选（状态/优先级/标签多选/指派人/关键词），筛选栏组件 + 保存视图（按用户隔离）+ Pro 门控 + `filter_applied`/`view_saved` 埋点。
- **账户删除**：设置页三步流程（展开 → 数据预览 → 邮箱确认），撤销 OAuth 授权、清理会话/账户、schema 级联删除；`runWithAuthOp("provision")` 逃生口 + 端到端 DB 实证。
- **数据埋点看板**：获客/激活漏斗、D1/D7/D30 留存、WAW 周活跃北极星指标（Asia/Shanghai 日界分桶），仅拥有者/管理员可见。
- **compose cron 调度容器**：`cron` 服务复用 app 镜像跑 busybox crond，定时调用 due-reminders（每日）与 cleanup-uploads（每周一），CRON_SECRET 鉴权 + CRON_TZ 时区可配。
- **CHANGELOG**（本文件）与版本号管理；CI 支持 `v*` tag 触发发版流水线。

### Security

- **RLS 全表收编**：chat_presences / message_reads / calendar_connections / task_calendar_events 四表纳入行级安全（19 张业务表全覆盖，FORCE RLS + corps_app 最小权限角色）。
- **防复发静态检查**：RLS 裸查询守卫（禁 `prisma.$queryRaw` 直查业务表，表清单同步）与 compose env 覆盖检查（代码 env 引用 ⊆ compose 透传），均已实证拦截力。
- **CI 加固模式回归**：test-hardened job 以 corps_app 角色连接 + FORCE RLS 激活后跑全量集成测试，与生产同构。

### Fixed

- IM 附件孤儿文件清理落地（cron 化，磁盘不再单调增长）。
- 日历同步在 RLS 加固模式下的跨工作区扫描修复（`calendar` op 逃生口）。
- E2E 回归：session cookie 名按 NODE_ENV 动态检测、Playwright 受控输入回滚、strict locator 违规等 CI 稳定性问题。
- i18n 键化系统性 bug：labelKey 曾带命名空间前缀导致 `tStatus("status.todo")` 查找 `status.status.todo`（生产会显示键名）。

### 遗留（下一版本）

- 法务文档（隐私政策/服务条款）已填入真实联系邮箱（winger35@163.com）并如实标注个人开发者运营；后续注册公司/个体主体后，需更新运营主体表述与增值税发票条款。

## [0.1.0] - 2026-08-24

内部开发版：多租户看板协作 MVP（任务/评论/决策记录/IM 聊天/成员/邀请）、Better Auth 认证、PostgreSQL RLS 租户隔离、Stripe 订阅、日历集成（Google/Outlook）、E2E/集成/单元测试基线与 CI 流水线。
