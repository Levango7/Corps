# 发布就绪度快照（2026-10-17 实测）

> 性质：**一次性快照**。每条数字都带现测命令与时点，下次引用前请重跑——本仓已有两次
> "文档里的进度型数字过期"的事故（`docs/audit/SMOKE-MONITOR-TARGET-2026-10-17.md` §7.2 收了写权限那组）。
> 复现环境：worktree `F:/Nexus/corps-reverify-1017`，`origin/main = fdc35b32`（12:16 fetch），本机 Windows + Git Bash。
> GitHub 侧数字取 12:14–12:45 的 API 实测；期间 `git fetch` 出现过连续 3 次抖动（见 §7）。

## 1. 一句话结论

主干 CI 的 12 条 required 全绿、`main` 自 v0.7.2 起已积 329 个提交 16 天没切版本，
而**切版本身会连带一条删数据的迁移**；同时三条"对外可达"的线现在都不成立
（定时监控没有可用目标、Vercel 每个提交都红、桌面/移动端把别人的域名当生产站点）。
⇒ 我这条代码线上没有待修项；剩下的是四个 owner 决策，每个都给了可执行的下一步。

## 2. 版本状态：主干超前发布版 329 个提交

```bash
git rev-list --count v0.7.2..origin/main              # 329（12:20 实测）
git log -1 --format=%ad --date=short v0.7.2            # 2026-10-01
gh api repos/Levango7/Corps/releases/latest \
  --jq '.tag_name + " " + .published_at + " assets=" + (.assets|length|tostring)'
# v0.7.2 2026-09-30T21:24:50Z assets=0
```

三处版本字段现在的值（**双端漂移 2 个 minor**，切版要一次对齐）：

| 位置 | 值 |
| --- | --- |
| `web/package.json:3` | `0.7.2` |
| `desktop/package.json:3` | `0.6.0` |
| `desktop/src-tauri/tauri.conf.json` 的 `version` | `0.6.0` |
| 最新 tag | `v0.7.2`（release 无产物，`assets=0`） |

`CHANGELOG.md` 的 `[Unreleased]` 段：243 行 / 21 条 bullet / 7 个 `###` 分块，
但分块种类只有 5 种（`Fixed` 出现 2 次、`Added` 出现 2 次）——并行追加时没合块。
**没有任何门禁解析 CHANGELOG**：`grep -rl CHANGELOG scripts/*.py .github/workflows/*.yml` 零命中，
所以这种重复只有人在切版时才看得见。

## 3. 切版会连带 4 条迁移，其中一条删数据

```bash
git diff --name-only v0.7.2..origin/main -- web/prisma/migrations | grep migration.sql
```

| 迁移 | 行数 | 性质 |
| --- | --- | --- |
| `20261001000000_relax_account_issuer` | 7 | 放宽约束 |
| `20261001000001_add_share_access_logs_workspace_id` | 23 | 加列 + 回填 |
| `20261003000000_widen_share_password` | 6 | 加宽列 |
| `20261007000000_dedup_task_conversations` | **103** | **含 `DELETE FROM conversations c`（该文件第 91 行）** + `CREATE UNIQUE INDEX` |

去重那条自己头部就把角色约束写死了（值得照抄给执行人）：以 `corps_app`（`NOBYPASSRLS`）跑时，
FORCE RLS 会让本文件的 SELECT/UPDATE/DELETE **全部看见 0 行**——去重静默 no-op，
然后 `CREATE UNIQUE INDEX` 以 `must be owner of table conversations` 报错终止。
⇒ 必须用表属主 / 具备 `BYPASSRLS` 的连接执行；"纯 DML 迁移在这种角色下会 0 行生效却判成功"
是本仓所有数据迁移共同的坑。

结论：**切下一个版本 = 一次带删数据迁移的生产变更**。按既有规矩这类操作要 owner 点头，
我没有执行、也没有打 tag。

## 4. 定时 Smoke：判据修好了，目标仍然不存在

PR #113 改的是"目标失效时怎么说"，不是"有没有目标"。现状：

```bash
gh api repos/Levango7/Corps/actions/variables --jq '.variables[] | .name + " = " + .value'
# SMOKE_TARGET_URL = https://andale-variance-instructor-draw.trycloudflare.com   ← 临时隧道，已失效
gh api "repos/Levango7/Corps/actions/workflows/smoke.yml/runs?per_page=3" \
  --jq '.workflow_runs[] | .created_at + " | " + .conclusion'
# 2026-10-17T00:37:43Z failure / 2026-10-16T22:19:04Z failure / 2026-10-16T19:45:13Z failure
```

我把仓里能找到的"生产地址"候选都实测了一遍，**没有一个能用**：

| 候选 | 实测（`curl -sS -o /dev/null -w '%{http_code}'`，15s 超时） | 判定 |
| --- | --- | --- |
| `https://corps.com/` | 200，`<title>Corps ontwerpers \| home</title>`（荷兰设计事务所站点） | **不是本应用** |
| `https://corps.com/api/health` | **404** | 本应用的 health 在 `web/app/api/health/route.ts:12`，此处 404 印证上一条 |
| `https://releases.corps.com/desktop/latest.json` | curl 退出码 6（DNS 就没解析） | 主机不存在 |
| `https://corps.vercel.app/api/health` | 15s 超时 | **本机不可达 ≠ 站点不存在**：`docs/DEPLOY-VERCEL.md:90` 已实测 `*.vercel.app` 在本机是 SNI/TCP 级阻断，绕不过；此项只能由 owner 在别的网络验 |

⇒ 出路只有两条，都归 owner：①给一个稳定的已部署 URL 填进 `SMOKE_TARGET_URL`；
②把 schedule 关掉（`config-check` 会替我们盯着"URL 缺失或指向临时隧道"，现在会直接判红并说明原因，
不会再让人误读成"生产挂了"）。

## 5. Vercel：每个提交都红，而且这条红在常规视图里看不见

**先记方法**：`GET /commits/{sha}/check-runs` 里只有 `Vercel Preview Comments`（success），
它**不在这条 API 上**——Vercel 走的是 legacy commit status：

```bash
gh api repos/Levango7/Corps/commits/fdc35b32/status \
  --jq '.statuses[] | .context + " " + .state + " | " + .target_url'
# Vercel failure | https://vercel.com/levango7s-projects/corps/8e5cFBZKX9BA14L4nCzUo2NSr1TG
```

⇒ 只看 check-runs 判"CI 全绿"会漏掉它。反过来，它是**非 required**
（`/branches/main/protection/required_status_checks` 的 12 条 context 里没有 Vercel，12:20 实测），
所以不锁合并，只是每个 PR 页常年挂红叉、且没有 preview 可用。

时间线（沿 `main` 往回逐条查 status，命令见附录）：
第一个红是 `1c6f878c`（2026-10-14），其后 **47 个 main 提交 100% failure**；
再往前 `01006723` **完全没有 Vercel status** ⇒ 这个集成是 10-14 才开始上报的，**至今没有成功过一次**。

我在本机否证掉的两条猜测（都留了实验输出，避免下一个人重复试）：

1. **pnpm 版本三处不一致**——不成立：`web/package.json:5` = `pnpm@11.22.0`、
   `web/vercel.json` 的 install/build/dev 三条命令都钉 `pnpm@11.22.0`、`web/Dockerfile` 走 `corepack enable pnpm`。
2. **Vercel 构建时 `NODE_ENV=production` 导致 pnpm 跳过 devDependencies，于是 `prisma generate`/`tsc` 找不到**——
   本机直接实验否证：在干净临时目录里放 `dependencies: is-odd` + `devDependencies: is-even`，
   跑 `NODE_ENV=production npx --yes pnpm@11.22.0 install --ignore-scripts` ⇒ `node_modules/is-even` **PRESENT**，
   且 `pnpm config get production` 返回 `undefined`。pnpm 11 不靠 `NODE_ENV` 推断 prod 模式。

与"代码构建"无关的最强旁证：CI 的 Build job 在 Linux 上跑的是同一组命令
（`pnpm install --frozen-lockfile --ignore-scripts` → `npx prisma generate` → `pnpm run build`）且**绿**。
而 `docs/DEPLOY-VERCEL.md:55` 记 2026-10-03 用 **CLI 路径**部署成功过（首页 `302 → /en/auth/login`、
`<title>corps · Team`）⇒ "Git 集成触发的构建"与"CLI 部署"是两条路，别互相推断。

剩下的候选原因都在 Vercel 项目侧（Root Directory 是否为 `web`、Production/Preview 的变量值、区域 `sin1`、套餐），
本机 `~/.vercel` 不存在 ⇒ **我没有 Vercel 凭据，拿不到构建日志**。owner 侧一条命令就能定位：

```bash
npx vercel inspect dpl_8e5cFBZKX9BA14L4nCzUo2NSr1TG --logs   # 取自 status 描述里的原文
```

## 6. 桌面/移动端把 `corps.com` 写成生产站点，而它属于别人

`https://corps.com` 实际服务的是一个荷兰设计事务所（§4 实测），但仓里 8 处把它当生产地址：

| 位置 | 用途 |
| --- | --- |
| `.github/workflows/mobile-build.yml:17,19,24` | `CORPS_WEB_URL` 的默认值 |
| `desktop/src-tauri/tauri.ios.conf.json:7` | WebView 壳的 `url` |
| `desktop/src-tauri/tauri.android.conf.json:7` | 同上 |
| `desktop/harmonyos/entry/src/main/ets/pages/Index.ets:9` | `const CORPS_URL` |
| `desktop/scripts/prepare-mobile.mjs:22` | 缺省回退值 |
| `desktop/src-tauri/src/lib.rs:6` | 架构注释 |
| `desktop/src-tauri/tauri.conf.json:49` | **updater endpoints 指向 `https://releases.corps.com/...`，而该主机不解析** |
| `desktop/README.md:256,275` | 文档照抄同一端点 |

后果定性要克制，别写成"供应链被劫持"：Tauri updater 校验签名，域名易主也推不动未签更新；
真实后果是**自动更新结构性不可用**（DNS 层就失败）+ **iOS/Android 壳加载的是第三方站点**。

影响面：这**不是**"正在伤害用户"的缺陷——`tauri-build.yml` 与 `mobile-build.yml` 最近一次成功都是
2026-09-30T20:57:42Z，最新 release `v0.7.2` 的 `assets=0`（§2），产物没发出去。
它属"下一次发桌面/移动包必炸"。

我没有改这些配置：**正确的域名是 owner 的信息**，猜一个域名写进壳配置比留着不改更糟。

## 7. 顺带核到的两处工具行为（都不是本 PR 引入）

1. `scripts/check_coordination_claims.py` 的 `list` 在**取不到活态表时打印 `CLAIM_STORE_MISSING` 却 `return 0`**
   （`cmd_list`，第 492–498 行）。⇒ 用退出码判断"有没有人占用这些路径"的脚本，会把"取不到"读成"没人占用"。
   实测：12:36 连续 3 次 `list` 因 `git fetch` 抖动全部报红、rc 均为 0；12:38 网络恢复后同一条命令 rc=0 且列出 2 条认领。
   CI 侧用的无参校验是 fail-closed 的，所以这条只影响人/脚本使用 `list` 的方式。
2. GitHub API 与 `git fetch` 在这台机器上都会**间歇性抖动**（本次会话各遇到一次）。
   判"某 sha 全绿/全红"必须带时点，且红要先重跑一次再说。

## 8. ADR-013 复核：判据仍成立，数字漂了

```bash
cd web
grep -rn "ChatPanel" app --include="*.tsx" | grep -v "TaskChatPanel\|AiChatPanel"   # 实测：无输出
grep -rn 'from "\./chat/\|from "\.\./chat/' app components --include="*.tsx" \
  | grep -v "^components/ChatPanel.tsx"                                             # 实测：无输出
wc -l components/ChatPanel.tsx components/chat/*                                    # 实测：8 文件 / 2109 行
```

旧聊天树依然零挂载（ADR 的决策仍然成立），但 ADR 正文写的"7 个文件 / 2,101 行"对不上它自己给的命令：
现在多出的是 `components/chat/ChatHeaderClient.tsx`（72 行），由 `e988af5c`（**2026-09-20**）加入，
而 ADR 落笔是 `5b8a73e4`（**2026-10-06**）——**这个数在写下的当天就是错的**，因为写的人没跑那条 `wc`。
台账 #28（把任务侧消息能力并到 `TaskChatPanel` → `ChatWindow`、并裁决
`GET /v1/workspaces/{wid}/tasks/{id}/messages/search` 的归属）至今未动。

## 9. 待 owner 拍板的四件事（按性价比排序）

| # | 事项 | 我能做的 | 需要的输入 |
| --- | --- | --- | --- |
| 1 | `SMOKE_TARGET_URL`：填稳定 URL 还是关 schedule | 已把误读成本做好（PR #113） | 一个可达的部署地址，或一句"关掉" |
| 2 | 切不切版本；若切，去重迁移（删数据）在生产何时、由哪个角色执行 | 已把 4 条迁移与角色坑数清楚 | 拍板 + 属主连接串的执行授权 |
| 3 | Vercel 恒红：先跑 `vercel inspect --logs` 定位，再决定修还是断开集成 | 已排除两条猜测、给出判据 | Vercel 凭据（本机无 `~/.vercel`） |
| 4 | 真实生产域名（桌面/移动壳与 updater 现在指向别人的 `corps.com` 与不存在的 `releases.corps.com`） | 已列全 8 处引用点 | 域名本身 + 归属确认 |

另有两条不欠 owner 输入、纯粹欠工时的：#28（ADR-013 的整合本体）、
#29（`web/e2e/` 仍有 **17 处 `describe.serial`、分布在 13 个 spec 文件**，单条失败会连带 "did not run"；
现测命令 `grep -rn describe.serial web/e2e | wc -l`）。

## 10. 本次快照对应的 CI 事实

PR #113 头 `748d20db`（12:40 实测）：12 条 required **全绿**
（`Lint / Test / Test (hardened RLS mode) / E2E (production build) / Build / RLS Coverage Check /
Schema Drift Check / API Contract Check / Permission Gate Coverage / Security Audit /
Unit Coverage Ratchet / Quality Baseline Burndown`），
`Publish image (GHCR)` 与 `Macroscope - Correctness Check` 按设计 skipped；
`Vercel Preview Comments` success，`Vercel` status failure（§5）。
该 run 排队约 14 分钟才开始（12:14 push → 约 12:30 起跑），是 runner 积压，不是本仓配置问题。

## 附：沿 main 回溯 Vercel status 的命令

```bash
git log --format=%h -60 origin/main | while read h; do
  s=$(gh api "repos/Levango7/Corps/commits/$h/status" \
      --jq '[(.statuses[]? | select(.context=="Vercel") | .state)]
            | if length==0 then "no-vercel-status" else .[0] end')
  echo "$h $s"
done   # 实测：1c6f878c 起连续 failure，前一条 01006723 为 no-vercel-status
```
