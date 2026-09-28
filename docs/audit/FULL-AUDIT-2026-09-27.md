# corps 全面审核报告（2026-09-27）

> 审核方式：**只读**全量扫描（git 索引 + 源码精读），未改动任何代码。
> 所有结论均附「文件:行号」证据。审核基线：`main @ d1ce552d`

---

## 一、项目画像

| 维度 | 数据 |
|---|---|
| 代码规模 | **861** 个 TS/TSX 文件（`web/` 940 个被跟踪文件） |
| API 路由 | **286** 个 route handler |
| 页面 | **53** 个 page |
| 测试 | **48** 个 `.test.ts` 文件（42 unit + 14 integration 中含 1 api；另 9 个为 setup/helpers），**770** 个用例 |
| 技术栈 | Next.js **16.3.3** · React **19.2.8** · Prisma **6.15.0** · PostgreSQL · better-auth **1.7.2** · zod **3.25.76** · ioredis · next-intl 4.14 |
| 架构形态 | monorepo（`web` + `desktop`）+ Docker/GHCR 发布 |
| 质量工具 | ESLint · Prettier · tsc --noEmit · Vitest · Playwright · pnpm audit |

---

## 二、八维度评分总览

| # | 维度 | 评分 | 一句话结论 |
|---|---|---|---|
| 1 | 安全 | **9.0** | RLS 达企业级（NOBYPASSRLS + FORCE），传输层防线齐全 |
| 2 | 数据层 | **9.0** | Prisma + 原生 RLS 双层，且有 CI 防漏表门禁 |
| 3 | API 层 | **7.5** | 校验与封装规范，但 OpenAPI 契约严重滞后 |
| 4 | 代码质量 | **9.0** | TODO 3 / FIXME 0 / `as any` 1，纪律性极强 |
| 5 | 测试 | **8.0** | 关键路径有集成测试，但路由级覆盖不足 |
| 6 | CI/CD | **9.0** | 8 个 job 含 RLS 覆盖率门禁 + 真实浏览器 E2E |
| 7 | 可观测性 | **5.0** | **最大短板**：无 Sentry/APM，仅自建 logger |
| 8 | 文档 | **9.5** | 8 个 ADR + 渗透测试 + runbook + 编码规范 |

**综合：8.4 / 10** — 工程成熟度显著高于同类 MVP 项目。

---

## 三、逐维度详细分析

### 1. 安全（9.0）✅ 最强项

**RLS 加固（企业级，`db/rls-activate.sql`）**

| 措施 | 证据 |
|---|---|
| 运行时角色 `NOBYPASSRLS` | `rls-activate.sql:28` — `CREATE ROLE corps_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS` |
| 全租户表 `ENABLE + FORCE RLS` | `rls-activate.sql:43-71` — DO 块循环 `EXECUTE format('ALTER TABLE %I ENABLE/FORCE ROW LEVEL SECURITY', t)`，覆盖 **约 80 张租户表** |
| 策略数 | **264** 个 `CREATE POLICY` |
| 未来表自动授权 | `rls-activate.sql:36-39` — `ALTER DEFAULT PRIVILEGES`，修复"快照式 GRANT 缺陷" |
| 身份域豁免有据 | `rls-activate.sql:42` — users/sessions/accounts/verifications 因 Better Auth 托管、无租户键而豁免（**有显式说明，非疏漏**） |
| 信任模型 | `rls-activate.sql:14-24` + **ADR-006** — GUC（`app.auth_op`/`user_id`/`workspace_id`/`public_token`）仅服务端 `withGuc` 白名单可设；`op` 枚举 login/provision/webhook/invite/seat/cron/calendar 逐一定义 |

> 评级依据：`FORCE RLS` 堵住表 owner 旁路 + 独立受限角色 + 默认权限继承，三者叠加属**生产级**加固；多数项目只做到 `ENABLE RLS`。

**传输与应用层防线（`web/middleware.ts`）**

- **CSRF**：`middleware.ts:26-53` — 写方法校验 `Origin`/`Host` 同源；非生产才放行 `localhost:3000`（`:42-48` 注释说明生产放开的危害）
- **CORS**：`middleware.ts:63-72` — 未配置 `CORS_ORIGINS` 时不回任何 ACAO（fail-closed）
- **CSP**：`middleware.ts:137-150` — per-request nonce（Web Crypto，Edge 兼容），生产移除 `unsafe-inline`
- **HSTS**：`middleware.ts:152-156` — `max-age=63072000; includeSubDomains`
- **Cookie**：`access_token` 配 `SameSite=Lax`，与 CSRF 形成双层防线

**供应链与密钥**

- `.env` 已 gitignore 且**未被跟踪**（`git ls-files .env` 为空，已验证）
- CI `audit` job：`pnpm audit --prod --audit-level=high`，high/critical **阻断** CI
- `pnpm-workspace.yaml:11-13` — `overrides: sharp >=0.35.4` 修 GHSA-rgj7-g3m4-5g8c
- 渗透测试闭环：`PENTEST-PLAN.md` → `PENTEST-REPORT-Phase1.md` → `PENTEST-VERIFICATION-Phase1.md`

---

### 2. 数据层（9.0）✅

- **双保险**：Prisma 管理 schema/迁移 + 原生 SQL 声明 RLS（Prisma 不支持 RLS，此组合正确）
- **防漏表回归门禁**：CI `rls-coverage` job（`ci.yml:41-47`）跑 `scripts/check_rls_coverage.py`，扫描 `schema.prisma` 中含 `workspaceId` 的模型与 `rls-activate.sql` 表名列表求差集，**差集非空即 CI 失败**
- 迁移规范：`docs/standards/DB-MIGRATION-GUIDE.md`
- 索引优化参考：`db/jsonb-gin-index-reference.sql`；RLS 冒烟：`db/rls-smoke.sh`
- 测试：`tests/integration/rls-engine.test.ts`（引擎级）+ `tests/unit/rls-bare-query-guard.test.ts`（**裸查询守卫**，防绕过 RLS 封装）

> 评级依据：不仅有 RLS，还建立了**三层防回归机制**（CI 差集门禁 + 裸查询守卫 + 引擎级集成测试）。

---

### 3. API 层（7.5）⚠️ 有真实缺口

**做得好**

- zod 覆盖 **226** 个文件，校验普遍
- 统一响应信封 `{ code, data, message }`（`api/openapi.yaml:8`）
- 限流模块独立：`lib/rate-limit.ts`、`lib/share-rate-limit.ts`、`lib/ai/usage-limit.ts`，AI 路由普遍接入
- 规范文档：`docs/standards/API-DESIGN-GUIDE.md`

**🔴 真实缺口：OpenAPI 契约漂移**

- `api/openapi.yaml:13` 自称：*"This contract currently defines **66 paths**"*，且 *"the **single contract** for frontend and backend"*
- 实际声明 path 数：**80**（描述中的 66 已过期）
- 实际路由数：**286**
- **覆盖率 80/286 ≈ 28%**，即 **206 个路由未纳入契约**

影响：契约不再是 "single contract"；前端/第三方无法据契约对接；破坏性变更无法被检测。
建议：① 修正 description 数字；② 明确 OpenAPI 定位（全量 or 仅公开 API）；③ 若定位全量，补齐或用脚本从路由生成骨架。

---

### 4. 代码质量（9.0）✅

| 指标 | 实测 | 评价 |
|---|---|---|
| TODO | **3** | 极低 |
| FIXME / HACK | **0 / 0** | 无 |
| `as any` | **1** | 类型纪律极强 |
| `eslint-disable` | 60（分散，单文件 2-3） | 合理，非滥用 |
| `dangerouslySetInnerHTML` | 9 | 需核查消毒（见第四节） |

3 处 TODO 明细（`git grep`）：

1. `web/app/[locale]/pricing/page.tsx:527` — 法务页，**已修复**，注释留存说明
2. `web/components/approval/ApprovalDetail.tsx:731` — 评论功能 → **已实现**：`POST /approvals/instances/[aid]/comment` + 详情页既有对话框（`c7d2247`）
3. `web/components/board-parts.tsx:191` — QuickAction 占位 → **已实现**（`4471180f` + 本次提交）：完成/复制/分享/删除四项接入真实 API；副作用已抽到 `web/lib/task-quick-actions.ts`（依赖可注入），看板页只做接线（复用拖拽的乐观更新与 `load()` 刷新）；配套 `lib/clipboard.ts` 提供安全上下文降级；单测 16 例覆盖全部动作分支。原「归档」项因 `Task.status` 枚举无 `archived`、schema 亦无软删除字段而移除，不留无实效按钮

---

### 5. 测试（8.0）⚠️

**做得好**

- 770 个用例 / 57 文件；集成测试覆盖关键业务：auth、workspace、tasks、subtasks、rbac、documents、invitations、notifications、search、im-upload、task-share、rls-engine
- E2E：Playwright 打**生产构建** server（`ci.yml:327-333`），`trace=retain-on-failure`，失败自动上传产物
- 加固态专项 job：`test-hardened`

**缺口**

- **286 个路由 vs 14 个集成测试文件** — 路由级覆盖密度不足，多数端点无针对性测试
- 近期 E2E 提交显示曾用变通手段修测试：`90645fa9`（移除 `page.evaluate`/`force:true`，方向正确）→ `7b4aec5e`（普通 click 替代）→ `d1ce552d`（**URL 导航替代 UserMenu + skip ChatPanel**）
- **静态守卫自身缺陷（本次已修，教训：红灯长期无人处理 = 守卫名存实亡）**
  - `rls-bare-query-guard.test.ts` 的 RLS 清单是**手工常量（20 表）**，而 `rls-activate.sql` 已覆盖 79 表 → **59 张表（含全部 ai_*/approval_*/document_* 等）的裸查无人看守**
  - 同文件的漂移检查按逗号裸切 `ARRAY[...]`，把其中的 SQL 注释（`-- ── 55 张补齐…`）当成表名，自 `dd828ee4` 起**恒红**
  - 现已改为双向派生：表清单取 SQL 引号内标识符，模型名以 `schema.prisma` 的 `@@map` 为准（`meeting_minutes`→`MeetingMinutes`、`time_entries`→`TimeEntry` 这类非机械命名不再漏检）。覆盖 20 → **79 模型**，扫描零违规
  - `NewTaskDialog` 提交按钮曾把 `loading`（成员/标签/里程碑三个**可选**列表）作为门禁：请求悬挂时创建按钮**永久禁用**（三个请求均无超时）。已改为只依赖标题与提交态；加载中就绪状态改由 `aria-busy` 暴露（`e2e/helpers.ts` 显式等待替代原先"靠禁用按钮制造时序"），31 例单测全绿（含"悬挂请求不锁死提交"回归锚点）

---

### 6. CI/CD（9.0）✅

8 个 job（`.github/workflows/ci.yml`）+ 5 个额外工作流：

| Job | 作用 | 亮点 |
|---|---|---|
| `lint` | eslint + prettier --check + `tsc --noEmit` | 显式类型检查（:36） |
| `rls-coverage` | RLS 漏表检测 | ★ 防回归核心 |
| `audit` | `pnpm audit --prod --audit-level=high` | 失败打印完整 advisory（:75-81） |
| `test` / `test-hardened` | PG 18 service 容器 | 真实数据库测试 |
| `e2e` | Playwright 打生产构建 | 补"水合与交互"盲区 |
| `build` | `needs: [lint, test, audit]` | 门禁串联 |
| `docker-publish` | GHCR，tag: branch/semver/major.minor/sha/latest | `type=raw,value=latest` 有注释说明坑 |

其他工作流：`deploy-pages`、`mobile-build`、`mobile-matrix`、`smoke`、`tauri-build`；依赖更新：`dependabot.yml`。

**观察**：`desktop/`（Electron，51 文件）与 `tauri-build`/`mobile-*` 工作流**并存**，存在两套桌面/移动方案，建议明确主次（见第四节）。

---

### 7. 可观测性（5.0）🔴 **最大短板**

| 工具 | 命中文件数 |
|---|---|
| Sentry | **0** |
| Datadog | **0** |
| OpenTelemetry | 1 |
| pino / winston | 1 / 1 |
| 自建 `logger` | 29 |

- 生产环境**无错误追踪 / APM / 告警**
- 有 `docs/runbook-monitoring.md`，但**缺少实际监控工具链支撑** → 文档与实现不匹配
- 后果：线上 500、慢查询、AI 调用失败**无法主动发现**，只能等用户报告；RLS 拒绝（403）异常突增亦无法感知

---

### 8. 文档（9.5）✅ 标杆级

| 类别 | 内容 |
|---|---|
| ADR | **8** 份：001 多租户隔离 · 002 技术栈 · 003 计费 · 004 BetterAuth · 005 Stripe · **006 RLS 机制与 op 信任模型** · 008 国际化 · 009 v2 可评估 |
| 安全 | `SECURITY-AUDIT.md` · `PENTEST-PLAN/REPORT/VERIFICATION` |
| 运维 | `runbook-deploy.md` · `runbook-monitoring.md` |
| 规范 | `API-DESIGN-GUIDE.md` · `CODING-STANDARDS.md` · `DB-MIGRATION-GUIDE.md` |
| 设计 | 9 份（IM 架构、LiveKit、审批权限、支付重构、tri-line 评审等） |
| 市场 | 5 份（定位/定价/路线图/上线文案） |
| 审计 | `SPEC-vs-IMPL-AUDIT.md` · `client-component-audit.md` · `platform-verification.md` |

> 唯一小瑕：`api/openapi.yaml:13` 的 path 数字过期（66 vs 实际 80）。

---

## 四、查漏补缺清单（按优先级）

### 🔴 P0 — 真实缺口，建议优先处理

| # | 缺口 | 证据 | 影响 | 建议动作 |
|---|---|---|---|---|
| 1 | **无可观测性/错误追踪** | Sentry/Datadog 命中 **0** 文件；仅自建 logger（29 文件） | 线上故障**被动发现**，MTTR 不可控；安全事件无感知 | 接入 Sentry（或等效），前端 + Route Handler + Prisma 错误统一上报；对 `/api/health` 加外部探活 |
| 2 | **OpenAPI 契约漂移** | `openapi.yaml:13` 称 "single contract / 66 paths"，实际声明 80、路由 **286** | 覆盖仅 28%；前端/第三方无法据契约开发；破坏性变更无检测 | ① 先修数字；② 明确契约范围；③ 加"路由 vs 契约"一致性校验脚本进 CI |

#### 落地进展（2026-09-27 更新）

| # | 状态 | 交付物 | 验证 |
|---|---|---|---|
| 1 | ✅ **已落地** | `web/lib/observability.ts`（零依赖上报层：Sentry Envelope API + 告警 webhook）、`instrumentation.ts` 进程级异常捕获、`global-error.tsx` 前端上报、compose/env 同步 | 新增 **19** 个单测全绿；`tsc --noEmit` + `eslint` 通过；`compose-env-coverage` 门禁通过 |
| 2 | ✅ **已落地** | `scripts/check_api_contract.py` + `api-contract-baseline.txt`（基线快照 + 防恶化）、CI `api-contract` job、修正 openapi.yaml 失真描述 | 正向 PASS；**注入临时路由负向验证正确 FAIL** 并列出漂移路径 |

> 设计取舍（#1）：未引入 `@sentry/nextjs` —— 其携带 rollup 等 14 个直接依赖，与 `lib/logger.ts` 明示的"零依赖、避免 bundle 膨胀"方针冲突；改用 Sentry 公开的 Envelope HTTP API 直传，能力等价且零新增依赖。
> 设计取舍（#2）：未强制一次性补齐 204 个未声明路由（工程量与收益不匹配），改用**基线只允许收缩**的防恶化策略 —— 新路由必须同步契约或显式入基线，阻止漂移继续扩大。

### 🟠 P1 — 重要，建议排期

| # | 缺口 | 证据 | 影响 | 建议动作 |
|---|---|---|---|---|
| 3 | **路由级测试密度不足** | 286 路由 vs 14 集成测试文件 | 大量端点无回归保护，改动易引入静默破坏 | 对高危端点（auth/payment/invite/document-share）优先补集成测试 |
| 4 | E2E 覆盖面 vs 路由规模 | E2E **58 个用例 / 9 个 spec**（auth·billing·calendar·i18n·im-upgrade·invitation·smoke·task-management·v04-features），**实测零 skip** | 仅覆盖核心流程，长尾功能无浏览器级验证 | 随功能增长补充，优先支付/邀请/权限等高风险链路 |
| 5 | ~~**两处功能半成品**~~ → **已修复** | `ApprovalDetail.tsx` 评论已实现（`c7d2247`）、`board-parts.tsx` QuickAction 已接入真实 API（`4471180f`），副作用抽至 `lib/task-quick-actions.ts` 并加 16 例单测 | ~~用户可点但无实效~~ 体验断点已消除，且关键分支有回归保护 | 无遗留；「归档」需后端先补 `archived` 状态或软删除字段再评估 |
| 6 | **监控文档与实现不匹配** | 有 `runbook-monitoring.md`，但无监控工具 | Runbook 无法执行，事故时手忙脚乱 | 落地工具后回填 Runbook 真实步骤，或先精简为"待建设" |

### 🟡 P2 — 工程卫生，可择机处理

| # | 事项 | 证据 | 建议 |
|---|---|---|---|
| 7 | `dangerouslySetInnerHTML` 9 处待核查 | `git grep` 计数 | 逐一确认上游有消毒（DOMPurify/自建 sanitize）；如需可加 lint 规则限制新增 |
| 8 | 桌面/移动方案并存 | `desktop/`（Electron）+ `tauri-build`/`mobile-*` 工作流 | 明确主次，停用冗余流水线以省 CI 分钟数 |
| 9 | `eslint-disable` 60 处 | 分散于组件（单文件 2-3） | 抽查是否集中在 `react-hooks/exhaustive-deps`；若是，考虑重构依赖而非禁用 |
| 10 | 工作区日志残留 | `dev*.log`、`e.log`、`p*.log`、`rbac.log` 等（**已被 `.gitignore:69` 的 `*.log` 忽略**，仅占磁盘） | 定期清理即可，非配置缺陷 |
| 11 | **`docs/audit/` 忽略规则与既有文件冲突** | `.gitignore:73` 忽略 `docs/audit/`，但 `docs/audit/SPEC-vs-IMPL-AUDIT.md` **仍在库中跟踪** | 规则生效前已提交的文件成"孤儿"（删除后无法重新加入）。建议：明确 audit 是否入库——若要入库则移除忽略规则（可改为 `docs/audit/*.tmp` 等精细规则）；若不入库，将 SPEC-vs-IMPL-AUDIT.md 移出至 `docs/standards/` 或 `docs/spec/` |

#### P1/P2 落地进展（2026-09-27 更新）

| # | 状态 | 处置 |
|---|---|---|
| 4 | ✅ 已核实（**推翻原结论**） | 实测 E2E **零 skip**（58 用例 / 9 spec），原"skip 黑洞"判断有误，见附录修正记录 |
| 5 | ⏸ 未处理 | 两处半成品属**功能开发**，非"易修项"范畴，需产品决策 |
| 6 | ✅ **已修复** | `runbook-monitoring.md` 修正 4 处：§2 移除已下线的 CloudBase、§3 改为远端上报入口、§4 更新为已实现的上报层、集成用例数口径（18 → 14 文件/140 用例） |
| 7 | ✅ **已核实（非缺陷）** | 9 处 grep 命中中 **6 处为注释、3 处为真实使用且均为模块级硬编码常量（零用户输入）**；已修正 `csp.ts` 中"代码库无 dangerouslySetInnerHTML"的失实表述，并标注 nonce 传播为"待实测验证项"（不据推测动代码） |
| 8 | ⏸ 未处理 | Electron + Tauri/mobile 双方案**并存需产品决策**，非纯技术可决 |
| 9 | ✅ **已审计** | 60 处分布：`exhaustive-deps` 23、`no-img-element` 26、文件级禁用 3、`no-console` 4、`any` 2、其他 2。文件级禁用 3 处（`web/scripts/*.mjs`）**已补写理由**；其余 44 处为常规局部禁用，无需处置 |
| 10 | ✅ 说明性澄清 | 实测已被 `.gitignore:69` 的 `*.log` 覆盖，仅占磁盘、不污染仓库，原"加入 .gitignore"的建议作废 |
| 11 | ✅ **已修复** | `.gitignore` 改为只忽略 `*.tmp.md`/`*.draft.md`/`tmp/`（依据：`docs/security/` 下渗透报告均入库的既有做法），孤儿状态消除，本报告得以入库 |

---

## 五、值得肯定（不必重复投入）

这些已达高水准，**不建议为"优化"而重构**：

1. **RLS 加固体系** — `NOBYPASSRLS` 角色 + `FORCE RLS` + `ALTER DEFAULT PRIVILEGES` + 264 策略 + ADR-006 信任模型。这是本项目**最硬的技术资产**。
2. **三层 RLS 防回归** — CI 差集门禁 + 裸查询守卫测试 + 引擎级集成测试。
3. **middleware 安全基线** — CSRF 同源校验 + CORS fail-closed + CSP nonce + HSTS，且每条都有注释解释取舍（如"生产放行 localhost:3000 会给本机其他应用留 CSRF 通道"）。
4. **代码纪律** — 861 个文件的代码库中 `as any` 仅 1 处、FIXME/HACK 为 0。
5. **CI/CD 门禁设计** — 8 job 并行、门禁串联（`build` needs lint/test/audit）、E2E 打生产构建并保留失败产物。
6. **文档密度** — 8 个 ADR + 渗透测试三段闭环 + 3 份规范 + runbook，且文档**与代码同步**（如 ADR-006 对应 `rls-activate.sql` 实现）。

---

## 六、结论

corps 是一个**工程成熟度 8.4/10** 的项目：安全与数据层达到生产级，CI 门禁与文档体系属标杆水平，代码纪律极强。

**真正的短板只有两个**：

1. **可观测性缺失（P0）** — 这是唯一"架构级"缺口。所有防护做得再好，看不见线上发生什么，就等于闭眼开车。**建议作为下一阶段第一优先**。
2. **契约与测试的覆盖深度（P0/P1）** — OpenAPI 仅 28% 覆盖、286 路由仅 14 个集成测试文件，随着功能增长会持续累积风险。

其余均为工程卫生项，不影响生产可用性。

> 本次审核为**只读**，未改动任何代码。如需针对上述 P0/P1 逐项落地，可在后续会话中按优先级执行。

---

## 附录：审核修正记录

审核完成后复核发现以下结论需修正，已在上文同步更新，特此留痕以保证报告可信度：

| 原结论 | 修正后 | 原因 |
|---|---|---|
| "E2E 存在 skip 黑洞（`d1ce552d` skip ChatPanel）" | **E2E 实测零 skip**，58 个用例 / 9 spec，ChatPanel 测试存在于 `web/e2e/im-upgrade.spec.ts`（"任务详情页渲染 ChatPanel…"） | 初判依据为 commit message 措辞（"skip ChatPanel测试"），经 `git grep` 全量核验 E2E 目录**无任何 `skip`**；该 commit 实际做的是"用 API 调用替代不可靠 UI 交互"，属合理工程手段 |
| "根目录日志文件堆积，建议加入 .gitignore" | 日志**已被 `.gitignore:69` 的 `*.log` 覆盖** | 未先读 `.gitignore` 全文即下判断；实际仅占本地磁盘，非配置缺陷 |
| "57 个测试文件" | **48 个 `.test.ts`**（另 9 个 setup/helpers） | 首次统计含非测试文件，精确 glob 后修正 |

**教训**：commit message 的措辞不等于代码事实，必须以源码为准。


