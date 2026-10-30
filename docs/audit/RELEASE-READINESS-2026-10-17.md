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

> **2026-10-21 更新**：上面第三、四条已变化。Vercel 恒红的根因已用构建日志定位并在 main 修好
> （`overrides.next` 与 `dependencies.next` 冲突，见 §5.1），它**不再是 owner 决策项**；
> "对外可达"三条里现在只剩定时监控与真实域名两条。⇒ owner 决策从四个减到三个。

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

> **勘误（2026-10-21）**：上表第 4 行当时无法判定，现已从墙外网络实测补齐——
> `https://corps.vercel.app` **可达但不是本应用**：返回 HTTP 200 的
> `text/html` 静态页，`<title>Corps</title>`、
> `description: Web site created using create-react-app`（**别人的 create-react-app 站**），
> `/api/health` 不存在本项目的 JSON 响应。结论与前三行一致：**不是本应用**。
>
> 本项目在 Vercel 上的**稳定别名**是 `https://corps-five.vercel.app`
> （`vercel project ls` 的 "Latest Production URL"）；`vercel.app` 下形如
> `corps-<hash>-levango7s-projects.vercel.app` 的是**每次部署**的临时 URL，每次部署都变。
> 该别名已于 2026-10-21 配进 `SMOKE_TARGET_URL` 并实测通过：
> `{"code":200,"data":{"status":"ok","db":"up"}}`。

⇒ 出路只有两条，都归 owner：①给一个稳定的已部署 URL 填进 `SMOKE_TARGET_URL`；
②把 schedule 关掉（`config-check` 会替我们盯着"URL 缺失或指向临时隧道"，现在会直接判红并说明原因，
不会再让人误读成"生产挂了"）。

## 5. Vercel：每个提交都红，而且这条红在常规视图里看不见

> **本节的两条结论已于 2026-10-21 被 §5.1 推翻**（根因是 `overrides.next` 与 `dependencies.next`
> 冲突，main `dba802cb` 已修，main 起 Vercel 转绿）。下面的取证过程保留，因为它记录了两条
> 仍然成立的判据：Vercel 走 **legacy commit status** 而非 check-run（只看 check-runs 会漏），
> 以及它是**非 required**、不锁合并。

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
再往前 `01006723` **完全没有 Vercel status** ⇒ 这个集成是 10-14 才开始上报的，~~至今没有成功过一次~~
（**2026-10-21 作废**：`6755db21` 已 success，根因见 §5.1）。

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

~~剩下的候选原因都在 Vercel 项目侧（Root Directory 是否为 `web`、Production/Preview 的变量值、区域 `sin1`、套餐），
本机 `~/.vercel` 不存在 ⇒ **我没有 Vercel 凭据，拿不到构建日志**。owner 侧一条命令就能定位：~~

（**2026-10-21 作废**：凭据可用，日志已取到，根因在 `web/package.json` 的 override 冲突，不在 Vercel 项目侧。
取日志的命令与结论见 §5.1。当时查 `~/.vercel` 查不到就断定"没有凭据"，是**探针没自证目标**——
CLI 是仓里的 devDependency，凭据路径也由它自己管。）

```bash
npx vercel inspect dpl_8e5cFBZKX9BA14L4nCzUo2NSr1TG --logs   # 取自 status 描述里的原文
```

### 5.1 更正（2026-10-21 实测）：根因已定位，本节两条结论都被推翻

**推翻「至今没有成功过一次」**：main 的 `6755db21`（即 PR #136 的合并提交）Vercel status =
**success**（2026-10-20T11:18:45Z，"Deployment has completed"）——集成 10-14 上线以来的第一次绿。
PR #138 的 head `fd780f3c` 同样是 success。判据：
```bash
gh api repos/Levango7/Corps/commits/$(git rev-parse origin/main)/status \
  --jq '.statuses[] | .context + " " + .state + " | " + .description + " | " + .updated_at'
```

**推翻「我没有 Vercel 凭据，拿不到构建日志」**：这是**探针探错位置**的假阴性。我只查了 `~/.vercel`，
而 `vercel` CLI 本来就是 `web` 的 devDependency、凭据由 CLI 自管，实测可用（身份 `levango7`，rc=0）：
```bash
cd web && npx --no-install vercel whoami --non-interactive
cd web && npx --no-install vercel inspect dpl_<status 描述里的 id> --logs --non-interactive
```

**根因**（一条 install 错误，与 Vercel 项目配置无关）：
```
2026-10-20T16:11:55.708Z  npm error Override for next@16.4.2 conflicts with direct dependency
2026-10-20T16:11:55.743Z  Error: [BUILD_UTILS_SPAWN_1] Command "npx --yes pnpm@11.22.0 install
                          --frozen-lockfile --ignore-scripts" exited with 1
```
即 `web/package.json` 里 `overrides.next = 16.3.8` 与 `dependencies.next = 16.4.2` 打架——
正是 main 上 `dba802cb`（PR #136）删掉的那条 override。逐分支核对即可复现整个现象分布：
```bash
for b in main feat/closure-events docs/product-design-2026q4 refactor/module-registry \
         chore/p0-closeout-2026-10-20; do
  printf '%s ' "$b"; git show "origin/$b:web/package.json" |
    python -c "import json,sys; d=json.load(sys.stdin); print(d.get('overrides',{}).get('next'), d['dependencies']['next'])"
done
# main / feat-closure-events → None 16.4.2 → Vercel 绿
# 其余三条                    → 16.3.8 16.4.2 → Vercel 红
```

所以"每个提交都红"的正确表述是：**带旧 `overrides.next` 的分支都红，带上 #136 的分支就绿**。
§9 待办表里原来那条「先跑 `vercel inspect --logs` 定位，再决定修还是断开集成」**可以撤掉**：
既不需要改 Vercel 项目配置，也不需要断开集成，更不该把这条红当本仓的缺陷记账。

剩下的只是合并顺序问题：分支保护 `strict: true`，每个 PR 合并前本来就要 Update branch，
把 `dba802cb` 带进去 Vercel 自然转绿。另注：`docs/DEPLOY-VERCEL.md:55` 记的 2026-10-03 CLI 部署成功
与本条不矛盾——那是**同一条 override 冲突尚未出现**的时期，而且走的是 CLI 路径不是 Git 集成路径。

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

> **2026-10-21 已修（上表保留为当时的证据，不要再照它行动）**：8 处全部由 `e4da60f3`（PR #143）改掉。
> 修法不是"换一个写死的域名"（项目至今没有固定域名），而是**缺失时显式失败**：
> `desktop/scripts/prepare-mobile.mjs` 删掉 `|| 'https://corps.com'` 兜底，未设 `CORPS_WEB_URL` 直接 exit 1；
> iOS / Android / HarmonyOS 壳改哨兵值 `https://REPLACE_ME.invalid`（RFC 2606 保留 TLD，永不解析）；
> updater 的 `endpoints` 置空、改由构建期 `scripts/prepare-release.mjs` 从
> `CORPS_UPDATER_ENDPOINT` / `CORPS_UPDATER_PUBKEY` 注入（只设一个就 exit 1）。
> 现测：`git grep -n 'corps\.com' -- ':!docs/audit'` 零命中。仍欠 owner 的只剩"真实域名本身"。

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
`GET /v1/workspaces/{wid}/tasks/{id}/messages/search` 的归属）**已收口**：
旧树 8 文件 / 2,145 行由 PR #185 删除（ADR-013「执行记录」），三条重复消息搜索端点收敛为
`GET /v1/im/search` 一条并补齐中文子串语义（ADR-013 §7，2026-10-27）。
> 上述"7 文件 / 2,101 行 vs 实测 8 文件 / 2,109 行"的漂移记录保留原位：它是这条台账
> 当时未动的证据本身，也是「写文档的人没跑自己给的命令」的标本。

## 9. 待 owner 拍板的事（按性价比排序；原四件，第 3 件已自行闭合）

| # | 事项 | 我能做的 | 需要的输入 |
| --- | --- | --- | --- |
| 1 | `SMOKE_TARGET_URL`：填稳定 URL 还是关 schedule | 已把误读成本做好（PR #113） | 一个可达的部署地址，或一句"关掉" |
| 2 | 切不切版本；若切，去重迁移（删数据）在生产何时、由哪个角色执行 | 已把 4 条迁移与角色坑数清楚 | 拍板 + 属主连接串的执行授权 |
| 3 | ~~Vercel 恒红待定位~~ **已闭合（2026-10-21，见 §5.1）**：根因是 `overrides.next` 与 `dependencies.next` 冲突，main `dba802cb` 已修，main 与带该修复的 PR 都 success | 日志、逐分支对照、main 首次 success 均实测 | **不欠输入**：不动 Vercel 配置、不需断开集成，只需各 PR 合并前 Update branch |
| 4 | 真实生产域名 | **「指向别人站点」部分已收口（2026-10-21，`e4da60f3`，见 §6）**：8 处改成 fail-loud / 哨兵值，不会再把包指向第三方；<br>剩下的是**域名本身**——没有它就发不了桌面/移动包 | 域名 + 归属确认 |

另有两条不欠 owner 输入、纯粹欠工时的：#28（ADR-013 的整合本体）、
#29（**已收口 2026-10-25**：`describe.serial` 从 **16 组 / 15 个文件** 降到 **4 组 / 4 个文件**，
其余 12 组改成「每条用例自带账号夹具」。动机不是洁癖而是实测坑——改 tagline 那轮的视觉基线只报出
signup 漂移，login 被 serial 短路成 did not run，白等一整轮 CI 才看见第二条。保留的 4 组
（auth / invitation / smoke / v04-features 子任务链）顺序确实承重，每组头部写清了承重的那一条数据流。
现测命令：`grep -rh "^test\.describe\.serial" web/e2e/*.spec.ts | wc -l`。
⚠️ 这条命令必须带 `^test\.` 锚点：不带锚点会把「为什么这里不用 serial」的说明注释一起数进去
（同一棵树上前者 4、后者 9），与 `SMOKE-MONITOR-TARGET-2026-10-17.md:155` 记的是同一个坑）。

## 10. 本次快照对应的 CI 事实

PR #113 头 `748d20db`（12:40 实测）：12 条 required **全绿**
（`Lint / Test / Test (hardened RLS mode) / E2E (production build) / Build / RLS Coverage Check /
Schema Drift Check / API Contract Check / Permission Gate Coverage / Security Audit /
Unit Coverage Ratchet / Quality Baseline Burndown`），
`Publish image (GHCR)` 与 `Macroscope - Correctness Check` 按设计 skipped；
`Vercel Preview Comments` success，`Vercel` status failure（§5）。
（**2026-10-21 补**：那条 failure 属于 `748d20db` 这个**仍带旧 `overrides.next`** 的历史 head；
main `6755db21` 起已 success，见 §5.1。本节其余数字都是当时的快照，不随主干更新。）
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
