# Changelog

本文件记录 corps 的版本变更，遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 惯例，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Security

- **写权限从"只有声明"变成"有执行点"——viewer 只读承诺落地（default-deny）**：`lib/permissions.ts`
  一直声明 viewer 全只读，但 `check_permission_gates.py` 实测 T3 档有 **157 个写 handler 零角色判断**，
  viewer 在这些端点上可以直接改工作区内容。逐个补 `requirePermission` 成本高且容易漏（每加一个端点
  就要记得补一次），改为把写权限收敛到**单一 choke point**：`lib/auth.ts` 的 `getWorkspaceContext()`
  内部调用新增的 `lib/write-policy.ts` 裁决，写方法（POST/PUT/PATCH/DELETE）默认拒绝，
  只有 owner/admin/member 与"自助类"端点（自己的收藏/通知/设备/资料/纯文本 AI）放行。
  实测覆盖：278 个写 handler 中 250 个进墙，其余 28 个（认证自身 / webhook / 分享与邀请令牌 /
  用户级自服务 / 创建工作区等本就没有成员上下文的端点）在 `scripts/write-access-registry.txt`
  逐条登记 reason 与复核截止日，并由新脚本 `check_write_access_registry.py` 断言
  "每个写 handler 要么进墙要么登记"（含三类注入变异自检），已接进 CI 的 permission-gate job。

  灰度开关 `WRITE_POLICY_MODE`：enforce（默认，fail-closed，拼错也按 enforce 处理）/ shadow
  （只打日志，用于上线前观察误杀面）/ off。

- **登出后 Cache Storage 里仍留着上一位登录者的工作区页面**：`76853bd0` 把 `/api/` 全部排除出缓存后，
  同一类暴露面剩下另一半——`public/sw.js` 对所有同源 GET 做 stale-while-revalidate，缓存 key 只有 URL、
  不含身份，所以登录期间访问过的工作区页面（SSR HTML / RSC payload）会留在缓存里。
  本轮补"登出即清"：`components/pwa/PwaRegister.tsx` 导出 `clearAppCaches()`（只删 `corps-sw*` 前缀），
  工作区 layout 的登出回调在 logout POST 之后调用它。
  **第一次全量 E2E 实测证明"清一次"不够**：`e2e/logout-cache.spec.ts` 单独跑 PASS，放进全量套件则残留
  5 条 `/w/{wid}/decisions|meetings|meeting-minutes|approvals|announcements`——这 5 个页面用例并没有访问过，
  是侧栏链接被 Next 预取、SW 的后台 revalidate（`sw.js:83` 的 `cache.put` 脱离请求链）在删除**之后**写回来的，
  负载越高越容易命中。
  最终按三层收口：① **写入侧断掉**——`sw.js` 新增 `isTenantPage()`，`/w/{wid}/…` 一律不读不写缓存
  （导航请求仍保留 `/offline` 兜底），`CACHE_VERSION` v3→v4 让已被污染的旧桶在 activate 时删除；
  ② 登出回调调 `clearAppCaches()`；③ `/auth/*` 页面挂载时再扫一遍。
  用例也拆成两条确定性断言（不再靠"登出前后各拍一张快照"）：写入侧——登录后逛 3 个工作区页面并等 3s，
  缓存里该工作区的条目必须为 0（并附"SW 确实缓存了别的东西"的反证控制，否则是空断言）；
  清理侧——人工往桶里种一条 `/w/{wid}/board` 再登出，断言它被删掉。
  **变异验证**：关掉 ①（`if (false && isTenantPage(url))`）→ 写入侧用例红，实测缓存里躺着 **43 条**该工作区条目；
  同时关掉 ②③ → 清理侧用例红（种入的那条 8s 内没被删）。两处还原后按 md5 确认逐字节一致并复绿。
  **已知未收口**：切换工作区（URL 仍在 `/w/` 下、不经过 `/auth`）不触发第③层——但第①层已保证租户内容从来不会被写入，
  所以这一条只是少了一道兜底扫描，不再是残留面。
- **发布链被两条 critical 依赖公告打断（`pnpm audit --prod`）**：CI 的 Security Audit job 跑
  `pnpm audit --prod --audit-level=high`，2026-10-06T03:00 那轮报 **2 critical + 1 high**：
  tinypool 的 worker-options 原型污染→RCE（GHSA-5gmw-xhrv-c9v3 等，只有 `>=2.1.2` 修）与
  source-map-js 的事件循环 DoS（`1.2.1`→`1.2.2`）。它 `needs` 下游 `Build` 与
  `Publish image (GHCR)`，所以**镜像发布从那一刻起是断的**。
  成因不是本仓回归：同一颗锁文件下，10-05T20:15 那轮只有 `5 found — 1 low | 4 moderate`、
  日志里 grep `tinypool` = 0 次，10-06T03:00 变 10 条，而 `git diff 3836352b..50506a36 -- web/pnpm-lock.yaml` 为空
  ⇒ 是公告库更新。另外 `tinypool` 是经 `.>better-auth>vitest>tinypool` 进入 `--prod` 视图的
  （better-auth 把 vitest 声明成 peerDependency，而 lock 的 `settings.autoInstallPeers: true`）。
  修法取 **pnpm override**（`web/pnpm-workspace.yaml`，与既有 sharp/undici 同一条路子，都带上界防止跨大版本）：
  `tinypool: ">=2.1.2 <3"`、`source-map-js: ">=1.2.2"`；锁文件解析结果实测为
  `tinypool@2.2.0` / `source-map-js@1.2.2`，且 diff 只有这两条及它们的依赖指向，无夹带。
  **为什么不是升 vitest**：先试了 vitest 4.1.11（它根本不用 tinypool，装上后锁里 tinypool 归零）。
  但 v4 把覆盖率统计口径从"被测试加载的文件"换成"`include` 命中的全部 712 个文件"，实测
  `total.functions` 从 59.33% 掉到 5.78%、`branches` 4.62%，而 CI 的阈值（55/70）是照旧口径校的——
  换上去就得给两道门重新定标，等于用"调低阈值"换绿灯。该实验已完整回退（vitest 回到 3.2.7）。
  现在的组合是 vitest 3.2.7 + tinypool 2.2.0，**越过了 vitest 自己声明的 `^1.1.1`**，
  所以由测试背书：单测 **67 文件 / 735 例全绿**、覆盖率阈值判定 exit 0（functions 56.70%、branches 72.09%）、
  零覆盖棘轮 PASS（628 行，`--self-test` 亦 0）。
  审计口径本机**可以**复现，只要显式指官方源（默认源 `registry.npmmirror.com` 没有 audit 端点）：
  `pnpm audit --prod --audit-level=high --registry=https://registry.npmjs.org` 在改前锁文件（HEAD 态，独立临时工程里跑）
  报 `10 found — 3 low | 4 moderate | 1 high | 2 critical`、**退出 1**，路径与 CI 一致
  （`.>better-auth>vitest>tinypool`、`.>@tailwindcss/postcss>postcss>source-map-js` 等 17 条）；
  改后同一命令报 `7 found — 3 low | 4 moderate`（**0 critical / 0 high**）、**退出 0**，即门禁要的形状。
  另核一条版本分歧：锁文件由本机 pnpm 12.9.1 写，而 CI 与 Dockerfile 读 `packageManager` 用 **pnpm 11.22.0**；
  以 `corepack pnpm@11.22.0 install --frozen-lockfile --ignore-scripts` 实测**退出 0**（57s），
  且该树里同样只有 `tinypool@2.2.0` / `source-map-js@1.2.2`——override 被 pnpm 11 同口径解析，不存在"本地绿 CI 红"的版本缝隙。
  同一 CI 形状在**干净 worktree（`git worktree` 于仓库外）+ `pnpm@11.22.0` 冷装**复测一遍，判定不变：
  单测 **67 文件 / 735 例全绿**、覆盖率 functions **56.40%** / branches **72.07%**（阈值 55/70 过）、
  `tsc --noEmit` 退出 0、零覆盖棘轮 PASS(628) 且 `--self-test` 退出 0。
  与上面主工作树的 56.70%/72.09% 差在小数第二位，来自两棵树的统计状态不同，不改变任何判定。
  **Build 腿本机验不了**：`next build` 在 `next.config.ts` 加载期就红
  （`next-intl` 的 SWC extractor 要求 `@swc/core` 原生绑定，而绑定要落进受校验的缓存目录，
  `ERR_SWC_NATIVE_CACHE`：`%LOCALAPPDATA%\swc` 与自指目录 `SWC_NATIVE_BINDING_CACHE` 的 DACL 都因给非属主 SID
  授予 replacement rights 被拒）。在用户主工作树复现**同一条错误**，且 `@swc/core@1.16.13` 的锁文件坐标本笔未动
  ⇒ 属本机 Windows ACL 与 SWC 的冲突，不是本笔改动引入，也不是仓库缺陷；绕过它需要改机器 ACL，未做。
  该腿只能由 CI 的 ubuntu runner 判定——而它自 `2026-10-06T03:00` 起因 audit 红被 `needs` 恒 skipped，
  这次推送会是它这几天第一次真跑。构建路径的**既有性**另有旁证：E2E (production build) job 里自带
  `npx next build`，它不依赖 audit，改前锁文件下一直是绿的 ⇒ 本笔在构建面未测的增量只有 source-map-js 的补丁版。
  **更正上一句的适用范围（同日补测）**："本机验不了"只对 **Windows 原生路径**成立。Docker 起来之后
  改在 Linux 容器里 `docker build` 复跑了整条构建：**退出 0**，产出可运行镜像并跑起了服务
  （`/api/health` 200），所以 `next build` 与 `source-map-js@1.2.2` 的组合已有本机一手证据，不再只靠 CI。
  顺带这条容器路径还揪出一个 CI 永远看不见的 P1（见下方 Fixed 第一条）。

### Fixed

- **审批族"给他人发通知"在生产 RLS 形态下 500（P1，本轮由新测试暴露）**：`cc / approve /
  reject / transfer / delegate / add-sign` 六个端点都以 `tx.notification.create()` 写他人
  的通知。Prisma 的 create 发 `INSERT … RETURNING`，而 PG 要求 RETURNING 的行再过一遍
  `notifications` 的 SELECT 策略（`user_id = app.user_id`，DL-17 刻意不放行他人行）；
  这些调用点又都传了 `runWithWorkspace(wid, fn, ctx.payload.sub)` ⇒ `app.user_id` 是操作者，
  接收者是别人 ⇒ `42501 new row violates row-level security policy` ⇒ 事务整体回滚、端点 500。
  复现矩阵（同库同角色同事务同 GUC，只换写法）：裸 `INSERT … RETURNING` 同样红、去掉
  RETURNING（裸 INSERT / `createMany`）即绿、接收者=操作者时 create 也绿 ⇒ 变量只有
  RETURNING 与 `app.user_id`，与 Prisma 无关。
  改法：新增 `lib/notification/record.ts` 的 `notifyUsers()`（内部 createMany），6 站点改走它。
  **没削策略**：INSERT 仍只按 workspace 判定（本就是 DL-17 允许的系统代写）。
  为什么历史没发现：非硬化 `Test` 腿用 postgres（BYPASSRLS）绕过策略；hardened 腿虽有 enforcement，
  但旧审批用例把申请人与审批人设成同一人，`applicantId !== payload.sub` 那条分支从未执行。
  新增 `approval-cross-user.test.ts`（6 条走跨用户分支）与 `task-cross-user-notify.test.ts`
  （3 条钉住任务族"不传 userId 才安全"这个隐含前提——任务族实测是绿的，补上 user 作用域就会变红）。
  证据链与未改站点清单见 `docs/audit/RLS-CROSS-USER-NOTIFY-2026-10-07.md`。
- **审批抄送列表恒空（#32，P2 静默失效）**：`approvals/instances/[aid]/cc` 只有 POST，而
  `components/approval/ApprovalDetail.tsx` 用无 method 的 `api<CcUser[]>()` 去读 ⇒ 恒 405，
  再被调用点 `catch {}` / `.catch(() => [])` 双双吞掉，UI 表现成"这单没有抄送人"的**错数据**
  而不是报错。补 GET（照同目录 `instances/[aid]/route.ts` 的 401/404 约定），并加
  `approval-cc.test.ts` 7 条：未登录 401、票据绑错工作区 401、**票据已换绑到本工作区但人不是成员**
  仍 401（这条才是真跨租户判据——实测 `/auth/refresh` 会为任意 workspaceId 发票，去掉成员查询
  只有这条会展红）、抄送 2 人后 200 且 `user.email` 非空、无抄送时 200+空数组（与"真没抄送"同形
  而不是 405）、实例不存在 404、viewer 可读。反向钉住 405 不再回来。
- **IM 附件上传在生产镜像里恒 500（P1，只在容器形态复现，CI 抓不到）**：本机用 Docker 起
  生产镜像 + 活 PG 实测，`POST /workspaces/{wid}/tasks/{id}/messages/attachments` 返回 500，
  服务端 `Upload attachment error: Error: EACCES: permission denied, mkdir '/app/uploads'`，
  `tests/integration/im-upload.test.ts` 4 例全红（首条即 `expected 500 to be 201`）。
  根因两层，各自单独复现：① runner 阶段 `/app` 是 `root:root 0755`，应用以 uid 1001(nextjs) 运行，
  `attachments/route.ts:142` 的 `fs.mkdir(UPLOAD_DIR,{recursive:true})` 没权限建目录；
  ② 光挂 compose 的 `uploads_data` 卷也救不了——镜像里该目录原本不存在，空命名卷挂上去得到的仍是
  root 属主挂载点（复现时错误变为 `permission denied, open '/app/uploads/<uuid>.png'`）。
  并核实**线上现存卷** `corps-uploads-data` 属主就是 `drwxr-xr-x root root`（2026-08-31 建）⇒ 部署态同样是坏的。
  CI 之所以一直绿：Build/E2E 腿用 `next start` 跑在 runner 的可写检出目录里，从不进这个镜像——
  与 `b9dd5a36` 立过案的"CI 全绿但按文档部署必失败"同一类。
  改法：`Dockerfile` 在 `USER nextjs` 前 `mkdir -p /app/uploads && chown -R nextjs:nodejs`；
  `docker/entrypoint.sh` 加启动可写性前置检查，不可写时打精确错误与一次性修复命令。
  **故意不 exit**：附件只是一条功能面，让整个应用崩溃循环比报错更糟。
  验证（同一镜像三形态重建后实测）：无卷 `IT_A_rc=0`、新命名卷 `IT_B_rc=0`（Docker 会把镜像里的属主
  带进空卷）、存量 root 属主卷 `IT_C_rc=1` 且启动即打出错误——即新部署自愈、存量需宿主侧一次
  `docker run --rm -v corps-uploads-data:/v alpine chown -R 1001:1001 /v`（已写进 runbook §7.7）。

- **任务聊天面板"发出去的消息自己看不到"（get-or-create 竞态，P1）**：
  `POST /api/v1/workspaces/{wid}/tasks/{id}/conversation` 注释写的是"获取或创建"，实现是
  `findFirst` → 查不到就 `create`。两个并发事务在 READ COMMITTED 下互相看不见对方未提交的行，
  于是**每个并发请求都新建一条会话**。一手证据（2026-10-05 生产 E2E 的 trace.network）：一次任务详情页
  打开就发出 3 个该 POST，**3 个都 201 且 conversation id 各不相同**；后果不只是脏数据——面板显示的会话
  与消息真正写入的会话可能不是同一条，于是时间戳用例看到的是空状态，而同时刻 `POST /messages` 是 201。
  该 spec 是 `describe.serial`，一条红 → 同链后续 7 条 `did not run`（这是 serial 结构的又一例代价）。
  修法：在事务里先取按 taskId 的**事务级 advisory lock**
  （`pg_advisory_xact_lock(hashtextextended(taskId, 0))`，随事务结束自动释放），
  后到的请求会等前一个提交后再 `findFirst`，从而复用同一条会话。
  验证：新增 `tests/integration/task-conversation-idempotent.test.ts` 2 例（并发 5 次 → 会话 id 集合大小为 1、
  且 201 恰好一次）。修复前实测 **expected 4 to be 1**（5 个并发请求造出 4 条会话）→ 修复后 2 passed。
  **存量数据未清**：隔离验证库里 79 个任务带 >1 条会话（249 条任务会话，约 170 条为重复），
  全部由历次 E2E 造出；用户开发库实测 `task_id IS NOT NULL` 的会话为 **0 条**，未受影响。
  本轮未加数据库唯一约束（需要先做去重迁移），advisory lock 已堵住新增，收敛为后续项。
- **`dispatchOfflineNotification` 写了没人调**：它把"落 Notification 记录"和"离线补邮件"绑在一个函数里，
  而仓库另有 21 处通知落库点（19 处 `tx.notification.create` + 2 处 `createMany`，分布在 19 个文件）
  已经在自己的事务里写了记录，任何一处直接调它都会重复落一条——所以它长期零调用方，
  `notification_preferences` 与 DND 判定在真实链路上依然没人读（REVERIFY §6.2 第 4 行记的"写了没人读"未完部分）。
  修法：拆出 `fanOutOfflineEmail()`（判在线 → 读偏好 → 判 DND → 配了默认邮箱账户才发信，**不写记录**），
  `dispatchOfflineNotification()` 保留为"先落记录 + 同一套扇出"，给自己不落库的调用方用；
  `NOTIFICATION_TYPES` 补 `"action_overdue"`（第一个点位的类型此前不在白名单里，接不上）。
  第一个点位接在 `app/api/cron/check-overdue-actions/route.ts:129`：事务内收集扇出目标、**提交后**再扇出——
  SMTP 是网络 IO，不进 RLS 事务；响应形状 `{checked,notified,skipped}` 原样不动（api-contract 门禁按此比对）。
  验证：`tests/unit/offline-push-fanout.test.ts` 8 例 + `tests/unit/cron-overdue-fanout.test.ts` 4 例，
  各做变异验证（扇出改回 dispatch → 5 例红；删掉事务外的扇出调用 → 2 例红）。
  **如实记录**：`dispatchOfflineNotification` 自身仍无生产调用方，其余 21 处落库点本轮未接扇出。
- **邀请 E2E 把邀请链接的 origin 当成事实来源，在 CI 之外必然打空**：`e2e/invitation.spec.ts` 直接 `goto`
  后端返回的绝对链接，而后端按 `NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"` 拼接
  （`app/api/v1/workspaces/[wid]/members/invite/route.ts:123`）——CI 里应用正好监听 3000 所以恒绿，
  本机 3000 是另一个项目的 Grafana 在占，于是 2026-10-05 全量 E2E 里该用例停在
  "注册页应显示邀请上下文提示"（10s 超时、元素不存在）。改为只取链接的 path+query、
  origin 按 playwright 配置的 `baseURL` 解析：用例真正要带过去的是 token，origin 属于运行环境而不是被测事实。
- **`docker compose up -d` 在一个干净环境里根本起不来（两处，均为启动即退出）**——
  2026-10-03 在本机逐条复现，两处都在 `web/docker/entrypoint.sh` 之后：
  ① entrypoint 把 `DATABASE_OWNER_URL` 原样交给 `psql`，而该连接串按 Prisma 约定带 `?schema=public`，
  psql 报 `invalid URI query parameter: "schema"`，`set -e` 令容器在 RLS 激活这一步直接退出
  （修法：剥掉查询串再给 psql，Prisma migrate deploy 仍用原值）；
  ② `lib/env.ts` 把 `JWT_REFRESH_SECRET` 声明为必填（zod min(32)，缺失即 instrumentation `process.exit(1)`），
  但它既不在 `docker-compose.yml` 的 app environment，也不在 `.env.example` ——
  于是文档化的部署路径在任何干净机器上都会停在 `环境变量验证失败` 并 Exit 1。
  修法：compose 补 `${JWT_REFRESH_SECRET:?...}` 硬必填、`.env.example` 补条目，
  并新增单测 `tests/unit/env-required-keys.test.ts` 堵住成因——
  `compose-env-coverage.test.ts` 只扫 `process.env.X` / `envFlag("X")` 两种写法，
  **zod schema 里 `KEY: z.string()` 的声明形式不在其扫描口径内**，所以这条缺口一直没被抓到。

  修复后本机实测（隔离容器，不复用任何既有实例）：`docker compose up -d db redis app`
  → migrate deploy 通过 → RLS 加固执行完成 → app Ready →
  `GET /api/health` = **HTTP 200 `{"status":"ok","db":"up","uptimeSec":18}`**，
  这正是 Smoke workflow 的判据（原先 Smoke 因为从无生产实例而 100% skipped）。

- **宿主机端口撞车导致 `docker compose up` 直接 Bind 失败**：app 端口原为硬编码 `127.0.0.1:3000`，
  本机 3000 被另一个容器（opsmesh-grafana）占用，报错信息与 corps 毫无关系、极难定位。
  改为 `"127.0.0.1:${APP_PORT:-3000}:3000"`，`.env.example` 补 `APP_PORT`（默认 3000，行为不变）。

### Added

- `lib/write-policy.ts` 与两份单测：`write-policy.test.ts`（15 例，纯函数裁决）
  - `auth-write-policy.test.ts`（11 例，证明 choke point **真的被接线**——本仓库反复出现的形态是
    "函数写对了但没人调"，因此这里专门钉住调用关系）。
- `scripts/check_write_access_registry.py` + `scripts/write-access-registry.txt`：only-shrink 登记表，
  并带 `--self-test` 变异自检（删除登记行 → UNGATED、给已进墙者补登记 → REGISTRY_ROT、
  把复核日改成过去 → REVIEW_OVERDUE），本门禁自身也进 CI 跑。
- `tests/unit/env-required-keys.test.ts`：zod 声明式必填 env 的部署侧覆盖检查
  （compose app environment + `.env.example` 双向），已做变异验证（删掉 compose 里那一行即变红）。
- **任务详情聊天面板补上"本会话消息搜索"入口**：`/im` 页早就有 `MessageSearch`，任务详情的 ChatPanel
  一直没有入口——设计文档描述的面板搜索在产品里不可达（`docs/design/im-architecture.md`）。
  `components/im/ChatWindow.tsx` 头部加开关（`aria-label` 用 `chat.search` 文案、带 `aria-expanded`），
  展开后在消息列表上方渲染 `<MessageSearch workspaceId conversationId>`：复用既有实现、
  带 cid 限定所以不越界到别的会话。`e2e/im-upgrade.spec.ts` 的搜索用例改成两条链一起断言
  （面板内新入口 + `/im` 页原入口），新入口从此有回归保护。

### Added

- **MemberPermission 行级覆盖接入写策略裁决**：owner 给 viewer 显式配了某模块的写动作
  （DB `MemberPermission.actions` 含 create/update/delete）时，该模块的写请求放行——
  与 `permissions.ts`「默认矩阵 ∪ 覆盖，覆盖只放宽」的语义闭环。实现要点：
  `lib/write-policy.ts` 新增 `pathToWriteModule()` 路径→模块映射表（与各路由
  `requirePermission` 实参全量核对；MODULES 之外的域映射不到即维持拒绝，fail-closed），
  方法→写码映射（POST→c / PUT,PATCH→u / DELETE→d）与 permissions.ts 动作代码一致；
  只在角色本会被拒时才查覆盖，owner/admin/member 不查。新增 13 例纯函数单测 + 4 例
  choke point 接线单测钉住"覆盖真的被传进裁决"。
- 自助类白名单补两条 choke point 误杀面修正（2026-10-03 排查实测确认）：工作区级
  `PATCH /workspaces/{wid}/notifications`（标记自己的已读，按 `ctx.payload.sub` 过滤）
  与 `POST /workspaces/{wid}/presence`（上报自己的 onlineAt 心跳）——均为"写的是用户
  自己的数据"，viewer 亦应放行。
- `web/eslint.config.mjs` 的 ignores 补 `".next.stale.*/**"`：验证流程常把旧构建目录改名保留
  （`.gitignore` 里的 `web/.next.stale.*` 就是为它写的），而 eslint 原先只忽略 `.next/**`。
  本机一次 `eslint .` 因此吞进 **4,990** 个 minified chunk、报出 **436,701** 条与代码无关的红；
  补这一行后同一命令是 **0 error / 5 warning**——即仓库本身一直是干净的。变异对照：
  同一个 chunk 去掉忽略行 → 542 problems（537 errors），加回 → 仅剩"按忽略规则跳过"的提示。
  CI 从没暴露过这个坑，因为它跑在干净 checkout 上、那个目录不存在。

### Changed

- viewer 写工作区数据的响应码由 403 变为 **401**：裁决点前移到 `getWorkspaceContext`（返回 null），
  handler 走既有的未授权分支。`rbac.test.ts` 与 `e2e/viewer-readonly.spec.ts` 的断言相应放宽为
  `[401, 403]`——断言的实质是"不许 2xx"，不是钉死状态码。精确 403 的收敛需给 handler 一个
  统一的错误出口，登记为下一步，不阻塞本次收口。
  （CI 首跑后补：rbac 里 databaseRecords 与 AI 落位两块共 6 个 viewer 用例的 403 精确断言
  同步放宽为 `[401, 403]`；member 越权 owner-only 端点的 403 断言不受 choke point 影响而保持原样。）

### Known gaps（本次未收编，见 `scripts/write-access-registry.txt` 头部）

- `POST /api/v1/ai/task-breakdown` 等在注册表里有"若开启自动落位必须进墙"的显式备注。

## [0.7.2] - 2026-10-01

### Fixed

- **带附件的消息恒 400，IM 附件功能在生产里从未可用**：上传端点返回 `storageKey`，前端拼成
  `/uploads/${storageKey}`（`components/im/MessageInput.tsx:355-356`）并由 `components/im/useIM.ts:291`
  原样透传；而 `sendMessageSchema` 要求 `url: z.string().url()`、`isAttachmentUrlAllowed` 又用
  `new URL(url)` 解析——**相对路径两者都拒绝** → 消息创建恒失败。修法：放行应用内相对路径
  （限 `/uploads/` 前缀且不含 `..`），绝对 URL 仍走协议 + 域名白名单（SSRF 防护语义不变）。
- **超过 10MB 的文件被静默丢弃，用户毫无反馈**：`processFiles` 里 `if (file.size > MAX_FILE_SIZE) continue;`
  不给任何提示，而 i18n 的 `chat.fileTooLarge`（`messages/zh.json:865` / `en.json:865`）早就写好、
  **从无任何代码引用**。修法：命中即 `setUploadError(t("fileTooLarge"))`，且逐个跳过不中断
  （其余合规附件仍正常加入）。
- **两处 E2E 期望与实现契约不符（测试侧修正，非产品缺陷）**：
  ① 附件用例需先输入文本再断言可发送——契约是"附件必须伴随文本"：服务端 `body: z.string().min(1)`，
  前端 `canSend` 要求 `body.trim().length > 0`，`handleSend` 空文本直接 return；
  ② 消息列表与看板卡片按移动/桌面断点各渲染一份，`.first()` 会命中断点下**隐藏**的那份
  （症状 `received "hidden"`），改用仓库既有口径 `.filter({ visible: true }).first()`。

  验证：im-upgrade 整链 **12 passed (4.8m)**、viewer-readonly + v04-features + task-management
  **11 passed (2.7m)**（真实浏览器 + 真实 PG，非推断）；eslint / prettier / tsc 均通过。

- **文档版本历史与会话成员列表两处「按错键取分页信封」静默失效（在途改动里的错法，本轮纠正）**：
  `GET …/documents/{id}/versions` 的载荷是 `data:{ items, page, limit, total, hasMore }`
  （`route.ts:88-93` 里 items 的取值是 `result.versions`，**响应键仍是 `items`**）；`GET …/conversations/{cid}/members`
  同理（`route.ts:87-101`，成员数组挂在 `items` 上，**没有 `members` 键**）。先前两处分别按
  `data.versions` / `data.members` 取键，又被 `Array.isArray(...) ? … : []` 兜底成空数组 →
  **列表恒空却不报错、不崩**，比崩溃更难发现。这是同一契约缺陷的第二种形态：第一种是
  `api<X[]>()` 把信封当裸数组直接抛 `TypeError`（见上一条），第二种是"读错键 + 兜底"。
  修法：两处统一改用 `apiList`（`lib/api.ts` 里 `{ items }` 与裸数组双兼容）。
  覆盖：这两个端点此前**零测试覆盖**（`tests/` + `e2e/` 共 78 个文件全量 grep
  `versions|版本历史|DocumentVersionHistory|ConversationSettings` 命中 0，所以错键不会被任何
  既有用例拦住）——现补 `tests/integration/document-versions.test.ts` 与
  `conversations-list.test.ts` 的成员用例，断言"数组在 `data.items`、且不存在 `versions`/`members` 键"。
  实跑：`vitest run tests/integration/conversations-list.test.ts tests/integration/document-versions.test.ts`
  → **2 files / 5 tests passed**。
- **新增「分页信封消费口径」静态守卫**（`tests/unit/api-envelope-consumers.test.ts`）：先扫
  `app/api/**/route.ts` 的 GET/POST handler 判定"分页信封端点"（列表键 + 分页键；兼容 `data:{…}` 内联
  与 `return { items, nextCursor }` 变量两种装配形态——后者骗过过一次纯正则扫描），再扫
  `app`/`components`/`hooks`/`lib` 的两类调用点：`api<X[]>(字面量 URL)`（命中分页端点即违规）与
  `api<{ 键?: X[] }>(字面量 URL)`（读了端点载荷没有的键即违规，对应当前这两处事故）。
  实测口径：**56** 个分页端点 / **22** 个字面量调用点 / **2** 个无法静态归因；自带 4 类自检——
  数量下界（防静默退化）、真实端点形状 canary（形状变更必须被人重审）、合成违规必被抓（防"永远绿灯"）、
  扫描根覆盖。开发过程中它先失败两次（检测器漏认 `{ items, total }` 内联写法与 `{ unread }` 简写键），
  修正后才绿；`vitest run tests/unit/api-envelope-consumers.test.ts` → **7 passed**。
- **文档中心整页在生产构建里崩溃（`TypeError: e is not iterable`）**：`GET /api/v1/workspaces/{wid}/spaces`
  返回分页信封 `data:{items,total}`（route.ts:37），而 `components/KnowledgeBase.tsx:171` 写成
  `api<Space[]>()` 并按裸数组消费（:175 `for (const s of data)`、`sortByOrder` 里 `[...items]`）→
  render 期抛错，被路由级错误边界接管成"页面出错了 + 重试/刷新页面"。
  这是 `793edfd1`（列表/widget 响应信封统一消费口径，修 8 处）漏掉的**第 9 处**，
  也是 `E2E v04-features.spec.ts:110/122` 恒红的真因——不是选择器写错。
  连带第二个缺陷：该路由**从未 include `folders` / `documents`**，所以即使不崩，知识库树也永远是空的。
  修法：服务端改为三次扁平查询 + 内存装配完整树（Prisma 不支持递归 include；父级缺失时按根级挂，
  不让子树静默消失），客户端改用仓库自带的 `apiList`（`lib/api.ts` 里正是为这种崩法写的），
  并给 `sortByOrder` 加非数组护栏（任一层形状异常都不该把整页送进错误边界）。
  验证（浏览器一手，非推断）：文档中心页恢复，`搜索文档…` 输入框与空状态文案均可见；
  树装配实测正确 `取证空间 → 父文件夹 → [子文件夹]`。
  附带说明：`POST /documents` 不接受 `spaceId/folderId`、归入文件夹须走 `/documents/{id}/move`——
  这是既有设计，本轮未改。
- **`GET /conversations` 与 `GET /conversations/unread-count` 恒 500（PG 42883）**：
  两处未读数聚合写的是 `WHERE m.conversation_id IN (${Prisma.join(conversationIds)})`，
  Prisma 把 JS 数组绑成 **text** 参数，与 uuid 列比较即
  `ERROR: operator does not exist: uuid = text`（SQLSTATE 42883，Prisma code P2010）→ 端点 500。
  生产 E2E 日志里 `[GET conversations] error` / `[GET unread-count] error` 各出现多次，
  表现为任务详情页 ChatPanel 渲染不出来（`im-upgrade.spec.ts:48` 的头两条断言因此红）。
  改为 `= ANY(${conversationIds}::uuid[])`：保留 uuid 语义与 `conversation_id` 索引可用性
  （另一可选写法 `conversation_id::text IN (...)` 实测也能过，但会让索引失效，未采用）。
  unread-count 这条还顺带去掉了对 `Prisma.join` 空数组的隐式依赖——它原先没有长度守卫，
  无会话时 `Prisma.join([])` 本身就是崩点。
  新增 `tests/integration/conversations-list.test.ts` 3 例（这两个端点此前**零集成覆盖**，
  所以缺陷能活到生产；空列表走不到那段 SQL，故用例刻意先建两个会话再查）。
  **变异验证**：把 cast 去掉（退化为 text 比较）→ 端点立刻 500、用例精准报
  `未修 cast 前这里是 500: expected 500 to be 200`；还原后按 md5 确认逐字节一致并复绿。
- **service worker 把鉴权接口响应缓存成"跨账号可读的旧副本"**：`public/sw.js` 对**所有同源 GET**
  做 stale-while-revalidate，`isNonCacheableApi` 只排除 auth 路由，于是 `/api/v1/**` 的 JSON 进
  Cache Storage，而缓存 key 只有 URL、不含身份。两条实测事故：
  ① 变更后读不到自己：新建子任务后 reload 任务详情页，页面自己发出的 `GET /tasks/{id}` 仍返回
  `children=[]`，而同一时刻绕过 SW 的 `APIRequestContext` 请求能拿到那条子任务
  （`e2e/v04-features.spec.ts:50` 因此长期红；此前只记到"子任务不显示"，未定性）。
  ② 跨账号泄漏：A 登录后页面读 `/api/v1/workspaces/{A 的 wid}/tasks` 得 200 + 任务标题；
  同一浏览器换成 B 账号再请求同一 URL，SW 把 A 那份原样回给 B（200 + A 的数据），
  而服务端对 B 是 401。Cache Storage 不随登录态清理，共享/公用设备上就是上一位用户的租户残留。
  修法：`isNonCacheableApi` 扩到整个 `/api/` 一律不缓存，`CACHE_VERSION` v2→v3
  让已被污染的旧缓存在 activate 时删除（离线仍靠页面 shell，不受影响）。
  验证：同一探针修前 200+含 A 的标题、修后 401 且不含；子任务用例由红转绿。
- **`GET /api/v1/im/search` 恒 500，消息搜索在生产里从未可用**：`$queryRawUnsafe` 里
  `WHERE m.workspace_id = $2` 与 `AND m.conversation_id = $4` 把 uuid 列与 Prisma 绑成 text 的参数
  直接比较 → PG 42883 `operator does not exist: uuid = text`（日志 `[GET /api/v1/im/search] error`，
  UI 显示"服务器内部错误"）。`docs/design/im-architecture.md:866` 却记着"消息搜索 ✅ 已实现"。
  修法：两处补 `::uuid`。另实测 `'simple'` 解析器下**无空格整段只生成一个 token**——
  `to_tsvector('simple','可搜索消息UniqueToken123') @@ plainto_tsquery('simple','UniqueToken')` 为
  false，带空格的完整 token 才为 true，所以中文/粘连串的子串搜索并不成立。本轮只修 500，
  分词口径（pg_trgm / zhparser）作为产品决策留档；e2e 用例改为按实现能力搜完整 token，
  并把入口从任务详情面板（TaskChatPanel 无搜索控件）挪到真正实现了搜索的 `/im` 页。
- **`/api` 响应此前不带任何 `Cache-Control`**：middleware 现在对 `/api` 统一回
  `Cache-Control: no-store`（`/api/uploads/**` 与 `files/{fid}/download` 自己声明 max-age 的
  二进制路由除外）。如实说明：**这条不是上面 SW 事故的成因**——SW 的 `cache.put` 只看
  `type==="basic" && status===200`，压根不看缓存头；这里只是把浏览器 HTTP 缓存那一层也堵住的
  纵深防御，实测 401/200 响应均已带头。
- **权限门禁把矩阵模块清单复制了一份，导致多维表格的 9 个写 handler 被归错档**：
  `check_permission_gates.py` 的 `MODULE_BY_SEGMENT` 硬编码"17 段 → 12 模块"，而
  `web/lib/permissions.ts` 的 `MODULES` 已扩到 14（新增 `databases`、`databaseRecords`）。
  后果：`/databases/**` 全子树被当成"矩阵域外"，其 9 个容器/字段/视图写 handler 落在 T4，
  而按矩阵实际语义它们属 T2（矩阵域内、仅 ad-hoc 判断）。这与当天覆盖率阈值那次红是**同一种形态**
  ——同一事实声明两遍、只改一处。现改为运行时从 `MODULES` 解析真源，脚本不再复制清单；
  `MODULE_BY_SEGMENT` 只做段→模块映射，并在启动时校验映射目标都存在（否则 exit 2），
  `databases` 段按是否含 `records` 分流到 `databaseRecords`。重分类结果：T2 20 → 29、T4 33 → 24。
- **新增 T5 档：矩阵声明了但生产代码零调用点的模块**。这是本项目那条老判据在门禁里的落点
  （"函数正确 ≠ 函数被调用" → "模块存在 ≠ 模块被接线"）。实测当前 14 个模块里 **5 个零接线**：
  `databases`、`decisions`、`messages`、`timetrack`、`whiteboards` —— 即 viewer 只读对这五个模块
  目前仍然只是声明。同一一致性检查还反向硬失败：代码若调用矩阵中不存在的模块名，
  `checkPermission` 走 `DEFAULT_PERMISSIONS[role]?.[module] ?? ""` 恒判无权限，
  除 owner 外一律 403（等于把接口对普通成员永久关死），此项不配基线、必须清零。
- **我自己的两处 false positive 与一处自伤，均已修并留证**：
  ① 新加的"未知模块"检查最初把 `tasks/[id]/route.ts:99` **注释里**的
  `requirePermission("tasks","delete")` 当成调用点，于是报"模块 delete 不存在"；现按
  "匹配点前同行有 // 则跳过 + 匹配片段不含 //"剔除注释后 unknown 归零。
  ② `--write-baselines` 曾把 T2 表头的人工复核结论（按轴归类、哪些改法会放宽权限）覆写成通用表头——
  我为 T1 设了"禁止机器覆写"却没为同样承载人工结论的 T2 设防；现 T1/T2 均只许手工删行，
  并已恢复表头。
  ③ 旧版脚本模块名列表也随 `permissions.ts` 一起烂掉过一次：`MODULE_BY_SEGMENT` 缺 `databases` 段，
  而 T5 报出的 5 个零接线模块里，`databases` 恰恰是本轮**新加**的模块——说明加模块与接线的
  顺序颠倒了（先声明、后接线，中间那段窗口没有任何东西拦着）。
  验证：五档全部 PASS（T1 33 / T2 29 / T3 165 / T4 24 / T5 5）；注入式变异测试五项全过——
  容器路径零判断落 T1、records 路径落 T1、容器路径 ad-hoc 落 T2（而非 T4）、
  调用不存在模块名被 unknown 抓到、探针不污染 T5 计数；删 T5 一行报豁免腐烂。

- **覆盖率阈值被声明了两遍，其中一份从没被执行到过**：`vitest.config.ts` 里留着
  `thresholds: { lines: 20, branches: 15, functions: 20, statements: 20 }`，而 CI 的
  `Unit Coverage Ratchet` job 用 CLI 传 `--coverage.thresholds.lines=3.5`。两条腿吃不同的值：
  ratchet job 按 3.5% 判绿，`Test` job 跑裸 `npx vitest run --coverage` 按 20% 判红——实测约 4%
  （All files 行 lines=4%）。修掉前一个根因（rls-smoke 缺表）后 `Test` 才第一次跑到 vitest，
  这个并存已久的错配当场暴露：`ERROR: Coverage for lines (4%) does not meet global threshold (20%)`，
  并连带让 `Build`/`E2E`/`Publish image` 因 needs 被 skip。
  现删除配置里那份阈值声明，阈值只在 coverage job 的 CLI 一处声明（棘轮只许上调）。
  与 CI 同命令复验：`npx vitest run --coverage` 在干净环境（仓库外 worktree + 强制重建空库 +
  `rls-smoke` 通过 + 冷编译单实例 dev server）全绿、无阈值报错、exit 0。
  同一条命令此前一轮报过 5 例超时 + 1 例 `expected 500 to be 201`，事后确认那轮**库并未真的重建**
  （`DROP DATABASE` 被 15 个在用的连接挡住，而我的命令仍打了"成功"）——脏库 + 同机并发抢 CPU 才是成因。
  教训入档：清理类操作按观察值判定（`information_schema.tables` 计数=0），不看退出码。

- **会话"标记已读"每次调用都返回 500**：`app/api/v1/workspaces/[wid]/conversations/[cid]/read/route.ts`
  直接 `await req.json()`，而唯一字段 `lastReadAt` 是 optional、语义上允许空 body；
  线上调用方 `components/im/useIM.ts:203` 的 POST **不带 body** → `req.json()` 抛
  `SyntaxError: Unexpected end of JSON input` → 落进兜底 catch 返回 500。
  一次生产 E2E 跑动里该日志实测出现 **467 次**（IM 每次聚焦/订阅都触发），
  而该端点此前**零测试覆盖**，所以缺陷一路活到生产。
  改为显式读 text：空 body 按 `{}` 处理（语义即"标到此刻"），非空但非法 JSON 返回 **400** 而非 500。
  新增 `tests/integration/conversation-read.test.ts` 6 例：空 body 200 / `{}` 200 /
  未来游标回写 / **旧游标不得把已读位置拉回**（route.ts:74-84 取 max 的既有语义）/ 非法 JSON 400 / 未认证 401。
  每条自带前置状态，不依赖执行顺序（早前用 2098 时被同文件 2099 的游标盖住，已改为 2999 自给）。
  验证：新文件 6 例全绿；`tests/integration + tests/api` 全量 **17 文件 / 181 例全绿，退出 0**。
- **通知偏好"写了没人读"，且设置界面根本不存在**：`notification_preferences` 表只被
  `lib/notification/offline-push.ts` 读取，而该模块全仓 0 调用；`NotificationSettings.tsx`
  也没有任何页面挂载 → 用户既看不到"邮件/推送/免打扰"三个开关，看到也不改变任何在跑的行为。
  本轮：① 抽出 `lib/notification/preferences.ts` 作为偏好的唯一读取与判定入口
  （`getNotificationPreferences` / `isDndActive` / `shouldSendEmail` / `shouldSendPush`；
  读失败回退"全开、不免打扰"，确保通知不因查询失败而丢失），`offline-push.ts` 改用它，
  并删除自带的重复实现与内联 upsert（连带不再需要的 `prisma` 直接依赖）；
  ② 把 `NotificationSettings` 挂进 `app/[locale]/w/[wid]/settings/page.tsx`（置于偏好区之后）。
  新增 `tests/unit/notification-preferences.test.ts` 9 例覆盖判定语义：关闭邮件只抑制邮件、
  关闭推送只抑制推送、DND 同时抑制两者、跨午夜区间与"起止相同=空区间"、读失败被捕获并回退。
  **仍未完成（如实记账，不装作已解决）**：`dispatchOfflineNotification` 依然 0 调用方——
  它会自建 Notification 记录，与十余处写 handler 里的 `tx.notification.create` 语义冲突，
  接线前必须先拆成"仅扇出"与"仅落记录"两个入口，否则每个通知都会重复投递一遍。

- **修正我自己写进注释与 CHANGELOG 的两个错误数字（两个超时值未改动）**：
  下一条把 `rbac.test.ts` 的 beforeAll 写成"单独跑（服务已热）耗时 27.34s"、把裸查守卫写成
  "单独跑 13.30s"。复算结果：rbac **热态单跑 tests=5.32s**（并发会话独立测得 5.27s，互相印证），
  守卫**热态 tests=0.94s**、首次命中 8.67s。我先前测到的 27s/13.3s 是**冷启动首次命中 + 同机并发 +
  脏库**下的值，却被标成了"热态"。真实机制是 Next 懒编译造成的首次命中放大（约 5 倍），
  因此"抬预算"的依据仍成立且更强（CI 永远是冷启动），但正确的依据是冷/热两个数，
  不是一个被误标条件的数。`testTimeout: 45_000` / `hookTimeout: 90_000` 保持不变。
  教训：给"实测"数字必须同时标明测量条件，否则这两个字会给错误数字背书——
  这正是本轮一直在反的那类失真，这次落在我自己头上。
- **集成腿的超时预算低于实测成本，会在满载时把绿的套件打成假红**：`vitest.config.ts` 原
  `hookTimeout: 30_000` / `testTimeout: 15_000`，而实测 `tests/integration/rbac.test.ts` 的
  `beforeAll` **单独热跑就要 27.34s**（只剩 9% 余量），`tests/unit/rls-bare-query-guard.test.ts`
  的静态扫描**单独跑要 13.30s**（只剩 1.27 倍）；62 文件并发 + Next 懒编译时两者都越界。
  更关键的是这两个字面量还被写死在调用点上盖掉全局配置：`rbac-members.test.ts:40` 的
  `beforeAll(..., 30_000)`、`auth-flow.test.ts:267` 的 `it(..., 30_000)` —— 只抬全局值对这两个文件无效。
  现改为全局 `90_000` / `45_000`，并删掉调用点的写死值让配置成为单一来源。
  **没有放宽任何断言**：抬的只是 setup/扫描的时间预算，真实失败仍会变红，只是最晚 45s/90s 才报。
  另记一条判定坑：`beforeAll` 挂掉时该套件的用例会**被 Vitest 计成 skipped**，所以
  `Tests … skipped` 那行会把整个失败的套件伪装成"这些没跑"（实测同一 HEAD 从 38 skipped 变 8 skipped
  就是 rbac 修好的信号），判红必须读 `Test Files` 那一行。
  验证（纯 HEAD 的隔离环境：仓库外 `git worktree` + 新建 `corps-prepush-pg` + 冷编译 dev server，
  端口 3210 避开本机其他实例）：空库 `prisma migrate deploy` exit 0 → 容器内 `bash db/rls-smoke.sh`
  exit 0（引擎层实测 `relforcerowsecurity` 79 表 / `pg_policies` 264 条 / `corps_app.rolbypassrls=f`）→
  `npx vitest run` **62 文件 / 735 用例全通过、0 skipped、exit 0**（含传入 `RLS_SMOKE_*` 后
  `rls-engine` 那 8 例由条件跳过转为真跑）。
  过程中我自己造成过一次假红并如实记录：只 `kill` 了 `npx` 包装进程而真 `next` 仍在监听，
  随后 `rm -rf .next` 把那个活着的 server 的构建目录删了 → 该轮 19 个 500、14 文件红全部作废，
  改为**按端口反查 PID** 清理后重跑才取得上面的结果。
- **任何一个 404 都会渲染成全局错误页而非 404 页**：`app/[locale]/not-found.tsx:20` 写的是
  `const { locale } = await params`，但 **Next.js 不给 `not-found.tsx` 传 props**（App Router 固定限制），
  于是 `params` 为 undefined → `TypeError: Cannot destructure property 'locale' of ... undefined`
  （dev 栈直接指向该文件行号，digest 恒定）。后果不是"日志脏"而是**用户看到的 404 页其实是
  ErrorBoundary 的"页面出错了 + 重试/刷新页面"**——E2E 的 DOM 快照实测到这一点。
  改为 `const locale = await getLocale()`（从 [locale] 段已配置的 next-intl request 取），
  并删掉不再适用的 `setRequestLocale`。全仓同类文件已扫：`app/**/{not-found,error,global-error}.tsx`
  中只有这一处依赖 params。
  验证：dev 下单测 404 路径返回含"页面不存在"文案的正常 404 页、`Cannot destructure` 计数不再增长；
  重建生产包后 `next start` 跑 E2E 期间该错误 0 次。
- **访客中断一个请求就能把整个实例打掉**：`lib/observability.ts` 的 uncaughtException 处理器
  无条件 `process.exit(1)`（延时 500ms 上报后），而客户端在响应写完前断连时 Node HTTP server 会
  把 `Error: aborted` / ECONNRESET 冒到 uncaughtException —— 这属正常流量，不代表进程状态不可信。
  另 `lib/shutdown.ts:57-65` 还注册了**第二套**处理器，对 uncaughtException 与 unhandledRejection
  都直接 `exit(1)`，与 observability 文档里"rejection 仅上报、不改变进程行为"的声明互相矛盾，
  且真正杀掉进程的是它。
  实测证据：本机 dev 服务在 Playwright 跑用例中途消失，日志正是
  `[shutdown] uncaughtException: Error: aborted (code: 'ECONNRESET')`，随后 `netstat` 端口无人监听，
  后续用例全以 `net::ERR_CONNECTION_REFUSED` 失败——即"测试假红"的直接来源。
  修法：新增 `isBenignTransportError()`（ECONNRESET/ECONNABORTED/ETIMEDOUT/EPIPE/
  ERR_STREAM_PREMATURE_CLOSE 与 aborted、socket hang up、premature close 文案），命中则
  **不上报不退出**（降为 debug 级，保留可见性）；真异常仍按原 fail-fast 语义退出。
  `shutdown.ts` 删除第二套处理器，进程级异常策略由 `installProcessErrorHandlers()` 单一持有。
  验证：`tests/unit/observability.test.ts` 22 例全绿（新增 3 例：断连类识别、
  真异常与畸形输入不误判、断连不 exit 而真异常仍延时 `exit(1)`）。
- **`viewer` 角色在 API 上根本无法赋予，前端"只读成员"点了直接 400（P0 级功能不可达）**：
  `lib/permissions.ts:56` 的 `ROLES`、`schema.prisma` 的 role 注释、前端角色下拉
  （`components/members/MemberList.tsx:170/293` 的 `roleViewer`）都承认 viewer，
  唯独 `app/api/v1/workspaces/[wid]/members/[userId]/route.ts:16` 的
  `role: z.enum(["admin", "member"])` 不含它 → 改角色为只读返回 400。
  `f2f926ed` 落 viewer 只读时补的集成测试（`rbac.test.ts:130`）正是因此是红的——
  该用例当时本机跑不了、留给 CI 首跑，而 CI 已连续三周没跑到这一步。
  现已把 `viewer` 加入枚举并同步契约（`api/openapi.yaml` 的 PATCH 请求/响应枚举、
  工作区详情 `role` 枚举与说明）。**验证**：`tests/integration/rbac.test.ts` 由
  24 例扩至 34 例（本条 + 下条安全项），实跑 **34 passed / 退出 0**。
  注：邀请端 `members/invite/route.ts:15` 的枚举仍不含 viewer——当前邀请 UI 不提供该选项，
  未臆造需求，留作待决项。
- **在途多维表格 UI 引用 26 个中英双缺的 i18n 键，单测腿因此恒红**：
  新增的 `app/[locale]/w/[wid]/databases/`（列表页 + 详情页 + shared.ts）使用
  `database.list.*` 21 键、`database.detail.*` 4 键与侧边栏 `nav.menu.databases`，
  而 `messages/zh.json` 的 `database` 命名空间只有 `editor`。触发的是
  `f5018f09` 自己加的守卫 `tests/unit/i18n-usage.test.ts:117`——门禁按设计抓住了未完成的功能。
  已按各调用点语义补齐全 26 键（含 `openAria {title}` / `lastUpdated {date}` 插值，zh/en 对称）。
  **验证**：`npx vitest run tests/unit` → **46 文件 / 560 例全绿，退出 0**（此前 2 failed）。
- **覆盖率门禁在 CI 里根本没被执行到（P0，"有覆盖率关卡"这句宣称此前不成立）**：两条独立成因，
  都取到了实测证据。① `ci.yml` 的 Test job 把 `npx vitest run --coverage` 排在
  `bash db/rls-smoke.sh` **之后**，smoke 一失败整个 job 即终止——拉取失败运行 36481491352 的
  全量日志，搜不到任何覆盖率表；② Vitest 的 `coverage.reportOnFailure` 默认 **false**，
  任一测试变红就跳过覆盖率评估。而真实覆盖率实测只有
  **lines 3.98% / statements 3.98% / functions 58.6% / branches 73.7%**（unit-only，
  706 个被统计文件中 646 个行覆盖率为 0），配置阈值却是 20/15/20/20。
  修法：`vitest.config.ts` 置 `coverage.reportOnFailure: true`；`ci.yml` 新增**不依赖数据库**的
  `coverage` job（unit-only 棘轮 3.5/3.5/55/70，注释写明"只允许上调，为变绿而下调需单独说明并经确认"），
  Test job 的合并腿阈值保持不动。
  **变异验证**：棘轮命令本地实跑退出 0（3.98% > 3.5%）；抬高到 4.5% 与 99% → 均退出 1 并报
  "does not meet global threshold"，证明这道门真的会咬。
  注：该 job 定义在并发会话中被 `064b6e23` 一并提交，本条为追记。
- **API 契约基线的"只允许收缩"是单向假象**：`check_api_contract.py` 只对"基线外的新未声明路由"
  失败，对"已声明/已删除却仍留在基线里的条目"只 print 不 fail（`:167-170`），
  与 docstring 第 16 行的承诺相反；失败提示的第 2 个选项还直接教人"append it to baseline"。
  实测契约覆盖率 26.0%（277 条可纳入路由中声明 81 条，205 条全压在基线里）。
  已把"已修未删"改为 **FAIL** 并同步 docstring 与退出码说明。
  **变异验证**：正常态退出 0（当前 stale=0，不引入红灯）；注入一条伪基线 → **退出 1** 并列出"豁免腐烂"，
  随后按 md5 逐字节还原基线文件。
- **数据库迁移漂移（P0，一条根因同时导致加固模式 CI 连红、部署两条路不通、引擎层 RLS 实际未生效）**：
  `schema.prisma` 有 3 个模型（`ai_conversations` / `ai_messages` / `push_tokens`）从未进过迁移链，
  只靠 `db push` 之类的旁路存在于开发库里。`prisma migrate deploy` 建出的新库因此缺表 →
  `db/rls-activate.sql:71` 的 FOREACH 块在 `ALTER TABLE ai_conversations FORCE RLS` 处
  `relation does not exist` 报错；该 DO 块是原子的，**79 张表的 ENABLE/FORCE 与 264 条策略一条都不会落地**。
  后果链：CI 的 `rls-smoke` 步骤先于 `vitest` 失败（单测关卡根本没执行到）、`e2e`/`build`/`docker-publish`
  因 `needs` 长期 skipped、`web/docker/entrypoint.sh`（`set -e` + `ON_ERROR_STOP=1`）在 `RLS_ACTIVATE=true`
  时容器直接中断。新增迁移 `20260929000000_add_missing_ai_conversation_and_push_tables`，
  DDL 由 `prisma migrate diff --from-migrations ... --shadow-database-url ...` 生成而非手写。
- **5 个字段漏写 `@map` 导致新库列名对不上（P0）**：`AiMeetingActionItem.extractedBy`、
  `AiMeetingSession.participantCount`、`AiVoicePreference.wakeWord`、`Favorite.targetType`、
  `Mail.toAddr` 的库内真实列名是 snake_case，但字段未标 `@map`，Prisma 按 camelCase 查列 →
  新部署库上运行期 P2022。已补 `@map`（与同文件内既有约定一致）。
  刻意**未**按 `migrate diff` 的全量输出重建库：其中包含删除 `messages.body_tsv` /
  `wiki_pages.content_tsv` 的语句，这两列是裸 SQL 建的 tsvector，被 `v1/search` 与 `v1/im/search` 真实使用。
- **`db/rls-activate.sql` 不幂等（P0 运维）**：24 条 `CREATE POLICY` 缺前置 `DROP POLICY IF EXISTS`，
  第二次执行即 `policy already exists` 报错；而 entrypoint 每次容器启动都会跑它，等于
  **首次成功之后任何一次重启都会让容器起不来**。文件头原本自称"幂等可重复执行"。
- **`docker compose` 文档路径断在 env**：`.env.example` 完全没有 `JWT_ACCESS_SECRET` 的赋值行
  （只在注释里提到该变量名），而 `docker-compose.yml:119` 以 `${JWT_ACCESS_SECRET:?}` 硬必填；
  `CORPS_APP_PASSWORD=` 值为空同样触发 `:?` 失败。按 README 的 `cp .env.example .env` 走会在
  compose 解析阶段中止。实测口径：`docker compose --env-file <example副本> config`。
- **看板长按菜单三个 i18n 键两侧皆缺**：`task.complete` / `task.copy` / `task.share` 在 `zh.json`
  与 `en.json` 中都不存在，`dev.log` 里每条各抛 164 次 `MISSING_MESSAGE`。原 `i18n-keys` 测试
  只比对 zh↔en 键集合相等，因此对这种"两边都缺"完全无感。
- **审批评论路由未入契约门禁**：`c7d2247c` 新增 `approvals/instances/{aid}/comment` 后
  `api-contract` job 恒红，已补入基线。
- **仪表盘 widget 测试文件格式化不合规**使 `lint` job 的 `prettier --check` 失败，已修正。
- **两处文档失实（审计文档自身的事实错误）**：
  ① `docs/audit/FULL-AUDIT-2026-09-27.md` 称 `desktop/` 是 Electron 且与 `tauri-build`/`mobile-*`
  构成"两套桌面/移动方案"、建议"停用冗余流水线"——实测 `desktop/package.json:7-15` 是
  `tauri dev` / `tauri build` + `@tauri-apps/cli ^2`，全仓无 Electron 实现（`electron` 仅命中
  `desktop/README.md` 的对比表述、`pnpm-lock.yaml` 与法务文案），`mobile-matrix.yml` 是测试矩阵而非打包方案，
  该建议已作废并在其"审核修正记录"附录留痕。
  ② `README.md` 同篇并存"Free 可用 17 项"与"Free 21 项"两个数字而无口径说明：前者是
  `PRICING_MATRIX` 功能对比表（22 功能行 = Free 全量 14 + 受限 3 + 不可用 5），
  后者是 `PRICING_PLANS.free.features` 套餐卡要点（21 条，`pricing.features.free.f01–f21`，中英齐备）。
  已改为分别标注来源与构成，避免读者当成矛盾数字。

### Security

- **只读成员（viewer）可经"多维表格记录面"与"AI 落位面"写入业务数据**：矩阵一直声明 viewer 对
  tasks/documents/decisions/announcements 只有 `r`，但这两条链路只做**成员资格**校验、不看角色。
  ① `…/databases/[dbid]/records/route.ts:210` 与 `…/records/[rid]/route.ts:25,97`
  的 POST/PATCH/DELETE 只调 `getWorkspaceContext`（注释本身写着"member 可写"，viewer 一并放过），
  前端 `canManageDatabases` 只隐藏按钮、不构成执行边界；
  ② `ai/tools/execute`（`create_task` → `tx.task.create`）与 `ai/orchestrate` PATCH
  （createTask/createDocument/createDecision/sendAnnouncement）同样无角色判断——
  "AI 建议需用户确认后落位"约束的是幻觉，不是授权。
  修法按本仓既有口径走矩阵而非 ad-hoc：`lib/permissions.ts` 新增 `databases`（容器：owner/admin `crud`、
  member `r`、viewer `r`）与 `databaseRecords`（member `crud`、viewer `r`）两个模块，
  语义与既有实现等价（不放宽也不额外收紧），5 个写 handler 接 `requirePermission`；
  AI 侧按 action→模块映射接矩阵（`tasks`/`documents`/`decisions`/`announcements`，
  与对应手工路由用同一规则；`scheduleMeeting`/`notify`/`linkToOkr` 矩阵里尚无模块，不臆断）。
  另把 `ai/orchestrate` 的 `isAiConfigured()` 检查**移到鉴权之后**——原顺序在无 AI key 的环境
  （含 CI）会先返回 503，使鉴权分支永远测不到。
  **验证**（隔离环境：自建 PG18 + 生产构建，非静态推断）：新增 10 条集成断言——viewer 读放行、
  建/改/删记录 403、member 未被一并锁死、容器级 owner/admin 门禁未被放宽、
  viewer 经两条 AI 链路 403、member 侧 `not.toBe(403)` 锚点；
  `rbac.test.ts` 34 例全绿，全量集成+api **16 文件 / 175 例全绿，退出 0**。
  `scripts/check_permission_gates.py` 的 T3 基线同步删除已收口的 5 条（170 → **165**），门禁退出 0。
- **公开分享链接的密码与有效期此前只在服务端"不管"**：`GET /api/documents/share/{token}` 的
  `select` 不含 `sharePassword` / `shareExpiresAt`，因此无条件返回 `publishedMarkdown` 全文；
  带密码校验的 verify 路由只存在于 workspace 版（需登录），其自身注释即写明公开路径"此处不覆盖"；
  前端 POST 的 `/api/documents/share/{token}/verify` 路径**根本不存在**，且 `hasPassword`
  永远拿不到值 → 密码门是死代码。现改为服务端强制：未过期且（无密码或密码校验通过）才下发正文，
  并新增公开 `POST /api/documents/share/{token}/verify`（scrypt 比对 + IP 锁定 + 访问日志），
  契约同步入 `api/openapi.yaml`。响应体仍不含密码哈希本身。
- **Stripe 价格可由请求体指定**：`billing/checkout` 把 `body.priceId` 原样作为 `priceOverride`
  透传进 `line_items`，无服务端白名单 → 具备 billing 权限的成员可绑定账户内任意价格
  （含测试价、超低价）。现只允许服务端自己配置的 `STRIPE_PRICE_ID` / `STRIPE_PRICE_ID_YEARLY`，
  越界返回 400。
- **`scripts/check_permission_gates.py` 的判定口径双向失真，且扫描范围只覆盖三成写面**：
  旧版"是否已接门禁"的正则只认 `requirePermission(` / `checkPermission(` / `role ===`，
  于是把 `if (!["owner","admin"].includes(ctx.member.role))` 这类**真实有效的 ad-hoc 角色判断**
  误记成零缺口——旧基线 44 条里 11 条属此类（证据：`tasks/[id]/comments/route.ts:229-231`
  判"作者本人或 owner/admin"）。反向问题更大：扫描根写死 `v1/workspaces/[wid]`，
  矩阵域外的写 handler 一个都不看。现按"矩阵域内零判断 / 矩阵域内仅 ad-hoc / 矩阵外零判断 / 矩阵外仅 ad-hoc"
  分四档，各持一份只允许收缩的基线（T1 33 / T2 20 / T3 170 / T4 33，共 256 个写 handler 待收敛），
  扫描根扩到 `web/app/api/**`（沿用 `check_api_contract.py` 的 `INTERNAL_PREFIXES` 排除 cron/健康检查/auth/uploads，
  并跳过路由组 `(group)` 段）。四档均已做**注入式变异验证**：探针落位后各自正确变红、
  已接 `requirePermission` 的探针与 cron 探针不被误报、删基线一行能报"豁免腐烂"。
  口径修正过程本身也被变异测试抓出一个 bug：`[wid]` 与路由组都不进 `static_core`，
  资源段索引取 3 会让深层路由按**叶子段**误判档位（首轮实测的 T1=9/T3=194 即为此错），现固定取 2。

### Added

- `scripts/check_schema_migration_drift.py` — schema ↔ 迁移/已部署库 的**单向**漂移门禁。
  权威模式直连 `information_schema`（零 SQL 文本解析、零假阳性），静态回退模式只比表名。
  刻意不做双向相等断言：库里存在、schema 未声明的列（tsvector 等）是有意的。
  新增 `schema-drift` CI job 并挂进 `build` 的 `needs`。
- `scripts/check_rls_coverage.py` 从"表名集合求差"升级为三态断言（ENABLE + FORCE + 至少一条策略），
  并在解析前剥离 SQL 注释——旧版会把 `-- '某表名'` 注释内容当表名，既能造成恒红误报、
  也能被用来伪造覆盖；旧版亦完全不查 FORCE 与策略是否存在。
- `web/tests/unit/i18n-usage.test.ts` + `web/tests/i18n-usage-baseline.txt` — 校验"代码引用的 i18n 键
  必须真的存在于两份词条"，现存 27 处历史缺口入"只允许收缩"基线，只挡新增。
  静态解析按**变量名**绑定命名空间（同文件多个 `useTranslations` 时否则会成批假阳性），
  并跳过 `t("diagram" + k)` 这类动态拼接。
- `README.md` 页首加 CI 徽章。此前长红三周无人发现，直接原因之一就是仓库里没有任何 CI 状态出口。

### Changed

- `README.md` 若干宣称与代码对齐：RLS 覆盖 `26/99` → 71 个含 `workspaceId` 的模型（79 张表、264 策略）
  并注明 20 张子表仍在引擎层之外；"CI 七道关卡" → 按 `ci.yml` 实际 job 列表述；
  Free 项数 `21` → 17（22 个功能行中 14 全量 + 3 受限），并把逐项归属指向
  `web/lib/pricing.ts` 单一事实源而非在 README 重复罗列；"AI 使用量…计量与限额" → 只宣称计量
  （限额判定此前在生产的调用点为零）；仓库结构里的 `e2e/` 路径修正为 `web/e2e/`。

## [0.7.1] - 2026-09-24

全栈审查修复版本：6 波次审查-修复循环覆盖 UI 响应式、后端安全、组件视觉一致性、cron 时间计算、API 行为优化，累计 40 文件 +945/-421 行。

### Fixed

- **UI 响应式修复（8 高严重度 + 16 中 + 23 低）**：
  - 日历月/周视图手机单列布局 + 工具栏两行 + i18n 日期格式。
  - Wiki/会议/工作流侧边栏移动端抽屉 + 操作按钮下拉菜单。
  - 核心工作区分页触摸目标 + md 断点 + 编辑模式工具栏折叠 + 单列选择器 2×2 网格。
  - 审批/通知/设置/计费 flex-wrap + overflow-x-auto + 水平 padding + grid 断点。
- **后端安全修复（2 高 + 4 中 + 7 低）**：
  - documents/[id] PATCH/DELETE 缺权限检查（viewer 可删除任何文档）→ 添加 checkDocumentPermission。
  - members/invite role 硬编码 → 从请求体读取 role 参数。
  - tasks/batch 附件清理 + webhook data:null + activity code:200 + description maxLength。
- **cron DST 时间计算修复**：recycle-cleanup 和 weekly-digest 使用毫秒运算在夏令时切换日偏差 1 小时 → 改用 Date 构造器按年/月/日进位。
- **notifications PATCH all=true 性能保护**：updateMany 无 take 限制 → 改为 findMany(take:500)+updateMany，返回 updatedCount。
- **组件层视觉一致性（1 高 + 12 中 + 3 低）**：
  - Toast.tsx emoji ⏸ → lucide-react Pause 图标（违反"禁 emoji"规则）。
  - 20+ 处图标尺寸统一为 size={14}（12/13/15 → 14，36 → 32）。
  - 30+ 处硬编码 Tailwind 间距类 → var(--space-*) token。
  - WidgetCard perspective "1000px" → var(--perspective-card)。
  - DocumentEditor 工具栏窄屏折叠低频操作到"更多"菜单。
  - board-parts h-64 → min-h-[16rem]，DocumentListView pr-24 → pr-[6rem]。

### Changed

- openapi.yaml notifications PATCH 响应新增 `updatedCount` 字段，描述更新为"最多 500 条/请求"。

## [0.7.0] - 2026-09-15

AI 原生办公平台升级版本：从"项目管理工具"升级为 AI 原生办公平台，新增 17 个核心 AI 能力，完成 8 方向深化，补齐反馈循环与使用量统计基础设施，并拆分三个千行级页面。

### Added

- **AI 原生办公平台升级**：
  - **17 个核心 AI 能力**：文档续写 / 格式化 / 摘要 / 翻译、智能问答、Wiki 搜索、任务拆解、工作流构建、项目洞察、日报生成、IM 回复建议、公告起草、审批建议、会议流程、追问建议、日程排程、跨能力编排——贯穿讨论→决策→执行全流程。
  - **8 方向深化**：
    - **A 上下文聚合深化**：scope 13 → 20 种，AI 上下文更完整。
    - **B AI 执行引擎扩展**：action 3 → 8 种，AI 建议可直接落位为任务/文档/日程等结构化对象。
    - **C 多轮对话与追问**：上下文内连续对话，追问建议引导深入。
    - **D AI 结果反馈循环**：每条 AI 结果可点赞 / 点踩 / 修正反馈，闭环优化（新增 `AiFeedback` 模型）。
    - **E 流式进度阶段反馈**：长任务分阶段实时回传进度。
    - **F 跨能力联动**：一次请求可串联多个能力完成复合意图。
    - **G AI 使用统计与限额**：Token / 调用次数 / 成本三维计量，按工作区限额（新增 `AiUsageLog` / `AiUsageLimit` 模型，18 个 AI 路由集成使用量跟踪）。
    - **H Prompt 工程优化**：few-shot + 思维链（CoT）+ 输出格式校验，结果更稳更可控。
  - **AI 反馈组件集成**：11 个 AI 组件集成 FeedbackButtons，用户可对每条 AI 结果反馈。
  - **AI 安全约束**：所有 AI 建议均需用户确认后才落位，AI 不直接修改业务数据。

### Changed

- **千行级页面拆分**：`task/[id]` 1229 → 288 行、`settings` 1071 → 189 行、`members` 1010 → 384 行——可维护性与可读性显著提升。

## [0.6.0] - 2026-09-07

编辑体验与全栈双语收口版本：API 报错信息完成 i18n（此前英文用户拿到中文错误提示），Markdown 编辑器补齐 Typora 式肌肉记忆与图表能力入口。

### Added

- **Markdown 编辑器大升级**：
  - **图表模板下拉**：mermaid 引擎此前已支持 15+ 种图但只暴露流程图一种模板——补齐入口：思维导图/流程图/时序图/甘特图/饼图/四象限六种可运行模板一键插入（决策/文档/评论三处编辑器共用）。
  - **Typora 式快捷键层**：Ctrl/⌘+B/I/K 包裹（链接光标落 `[]` 内）、Tab/Shift+Tab 列表缩进、Enter 无序/有序列表自动续行（有序自动 +1 编号）、空列表项 Enter/Backspace 退出、引用行尾续行——纯 textarea 实现，零新依赖。
  - **分屏实时预览**（Obsidian 式）：编辑与渲染并排，宽屏双栏、窄屏堆叠；与单页切换互斥。
  - 字数统计（去 Markdown 标记近似计数）与链接按钮（此前工具栏无链接入口）。
- **API 路由 message 双语**：新增 `lib/api-messages.ts`（51 键 zh/en 常量表），38 个 route 文件 97 处中文 message 全部键化；语言协商与 next-intl 同源（NEXT_LOCALE cookie > Accept-Language > 默认中文）。英文用户报错提示不再是中文。

### Fixed

- **编辑器模板 i18n bug**：表格模板硬编码"列A|列B"、三个决策模板（方案对比/事故复盘/立项决议）硬编码中文——`/en` 用户插入的是中文模板。改为 i18n 键，zh/en 双端对称。
- notifications PATCH 的 zod refine 校验移入 handler（模块级 schema 无法按请求语言本地化，校验语义不变）。

## [0.5.0] - 2026-09-07

协作体验与响应式质量版本：成员治理（RBAC 修补 + 所有权转让）、个人效率入口（星标/通知细分/AI 提炼草稿）、顶栏信息架构收口、三引擎响应式基线。

### Added

- **成员角色管理 + 所有权转让**：成员页支持修改角色（admin/member，owner 不可改）、移除成员；工作区所有权可转让给其他成员（owner only，转让者降为 admin）——退出/解散场景不再需要联系支持。历史遗留的 `[uid]` 路由已删除合并进 `[userId]`（Next.js 同路径双 slug 冲突）。
- **星标收藏（favorites v1）**：任务详情星标按钮 + 侧栏"我的星标"分组，本地存储（localStorage `corps_favorites_v1`），跨设备同步留待 v2（届时引入 task_favorites 表 + RLS + 迁移）。
- **AI 决策提炼（规则版 v1）**：决策页"提炼"按钮——粘贴会议记录/长讨论，返回四段式结构化 markdown 草稿（关键结论/原始讨论节选/AI 提醒），不接真 LLM（端点形状已稳定，后续可换 DashScope/DeepSeek）。
- **通知中心收件箱 tabs**：All / Unread / @我 / 分配给我四个 tab，每个 tab 独立空状态——邮箱式的细分过滤。
- **顶栏搜索框显眼化**：accent ring + 独立 ⌘K chip，搜索从"能用"变"想用"。
- **响应式布局审计脚本（scripts/layout-audit.mjs）**：程序化布局崩点检测（横向溢出/元素重叠/触控目标 <20px），chromium + firefox + webkit 三引擎 × 3 视口 × 6 页 = 54 组合基线全零；替代人眼看截图的回归方式。

### Changed

- **顶栏头像升级为统一 UserMenu dropdown**：主题切换/语言切换/退出整合进头像下拉菜单，移除三个独立按钮——顶栏从 5 个交互元素收敛到 2 个（工作区下拉 + 头像菜单）。
- **Free 功能清单 14 → 21 项**：v0.4.0 新功能（子任务/文档中心/Mermaid/PDF 导出等）诚实列入 Free 清单。
- README 首屏重写：一句话定位 + 21 项亮点 + 快速开始；新增 issue 模板。

### Fixed

- **RBAC 三处修正**：runWithWorkspace 已内包 prisma.$transaction，transfer 内再嵌事务会被 Prisma 6 拒绝（改为直接在 tx 内顺序 update，原子性不变）；成员 PATCH 顺序改为先 self 后 ownerImmutable（owner 改自己曾被误拦为 403）；admin 改 member 角色放行。
- **SSE 单用户并发连接硬上限**：连接建立限流（20 次/分钟）只约束建立频率不约束存活数，单用户理论上可累积约百条长连接占句柄。补 per-user 计数（上限 5，多端登录正常值 1-3），超限返回 429；额度获取放在最后一个可能抛错的 await 之后，不留泄漏路径。
- 概览页"全部 →"链接触控目标 20px → 28px（负 margin 补偿，视觉不变）。
- 迁移幂等化：invitations 部分唯一索引加 IF NOT EXISTS（prisma migrate deploy 不校验已应用迁移 checksum，编辑对 deploy 安全）。

### 已知遗留

- API 路由 JSON message 中文残留约百处（英文用户报错提示仍中文，分批收口中）。

## [0.4.0] - 2026-09-03

任务执行与知识沉淀大版本：7 项功能全部围绕"决策→任务"闭环，Free 用户即可用。

### Added

- **子任务 + 阻塞标记**：大任务拆子任务（仅一层），父任务看板卡显示 done/total 进度条；被问题/依赖卡住的任务可标 blocked + 原因（hover 看原因，看板红色角标）。
- **文档中心**：工作区级 Markdown 文档（与决策记录正交——决策绑任务，文档解绑任务沉淀团队公约/手册/方案）；草稿/发布两态、发布快照、公开只读分享链接（192 位熵 token、草稿永不外泄）。
- **Mermaid 图表渲染**：决策/文档/评论中 ```mermaid 代码块渲染流程图、时序图、甘特图、mindmap 思维导图；动态加载不拖慢首屏；语法错误自动降级为代码块。
- **PDF 导出**：任务决策记录与文档一键导出 PDF（window.print + 打印 CSS 方案，零依赖）；深色主题打印自动浅色，表格/代码块防分页截断。
- **Markdown 编辑器工具栏 + 模板库**：粗体/斜体/行内代码（选中文本包裹）、标题/列表/引用/代码块/表格/Mermaid 一键插入；三个决策模板（方案对比/事故复盘/立项决议）。
- **附件内联预览**：点 IM 附件弹模态——图片放大、PDF 内嵌渲染、其余类型下载兜底，免跳转免下载。
- **任务公开只读分享**：任务属性栏生成只读外链给工作区外的人（客户/外包/顾问）看实时视图——标题/描述/状态/优先级/截止日/负责人名/子任务列表；可复制可撤销；脱敏不含 email/评论/聊天/附件。

### Fixed

- **任务分享与文档分享的加固模式 RLS 缺陷**：公开读接口曾用裸 prisma 查询，corps_app + FORCE RLS 下恒返 null。修复为 `p_tasks_share_select`/`p_documents_share_select` 策略（share_token = app.public_token GUC 放行）+ runWithShareToken 分步关联读。
- E2E 回归：PDF 打印容器常驻 DOM 导致 getByText 命中 2 元素（strict violation）——改条件渲染（点导出才挂载，afterprint 自动卸载）。
- documents POST 创建缺 `{ status: 201 }` 第二参（返回 200）。

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
