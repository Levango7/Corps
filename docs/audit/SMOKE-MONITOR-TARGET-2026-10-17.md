# 定时 Smoke 长期红：门禁的目标已死，而红被写成"生产故障"

日期：2026-10-17。仓库 `Levango7/Corps`，基线 = `origin/main` = `fdc35b32`（2026-10-17T10:44:34+08:00）。
本文只讲一件事：**main 上 push CI 全绿，但 `Smoke` 工作流自 2026-10-13 起几乎每次定时都红**，
且红的原因不是生产故障，而是**监控目标配成了一个注定失效的临时隧道域名**。

## 1. 一手证据

取数命令（任何人可重跑）：

```bash
gh api "repos/Levango7/Corps/actions/runs?per_page=100&event=schedule" --paginate \
  --jq '[.workflow_runs[] | select(.name=="Smoke") | {t:.created_at,c:.conclusion}]'
gh run view 38987239703 --log-failed
```

按天统计的 `红/总`（`.invalid` 之外无过滤，仅 Smoke 的 schedule run）：

| 日期 | 红/总 | 日期 | 红/总 |
| --- | --- | --- | --- |
| 08-24 | 0/23 | 10-10 | 2/7 |
| 08-25 | 0/36 | 10-11 | 0/6 |
| 08-26 | 0/23 | 10-12 | 1/4 |
| 08-27~09-28 | 全段 0 红 | **10-13** | **5/6** |
| 10-03 | 2/6 | **10-14** | **5/6** |
| 10-08 | 1/5 | **10-15** | **7/8** |
| 10-09 | 1/5 | **10-16** | **6/7** |

即：**形状从"长期 0 红"在 10-13 翻成"几乎恒红"**，中途只有 10-16T05:18:58Z 一次成功。
10-03/10-08/10-09/10-10/10-12 的零星红是同一个目标时好时坏——它本来就随时会死。

失败现场（run `38987239703`，2026-10-17T00:37Z）：

```
env:
  TARGET: https://customized-ton-pet-region.trycloudflare.com
##[error]Process completed with exit code 6.
```

`curl` 退出码 **6 = 域名无法解析**。日志里没有 `HTTP …` 那行，也没有任何 `::error::smoke 失败：…`
文案——因为脚本以 `bash -e` 运行，`HTTP_CODE=$(curl …)` 一失败整步当场终止，
**现场只剩下一个裸退出码**。

## 2. 根因与定性

1. `SMOKE_TARGET_URL`（仓库 Actions Variable，非仓库文件）被设成了 `*.trycloudflare.com`。
   trycloudflare 免费隧道是**进程级临时域名**：`cloudflared` 一退出，域名就永久消失。
   这类目标不可能长期可用，监控挂在它上面等价于"挂在自己的开发会话上"。
   `loca.lt` / `ngrok-free.app` / `ngrok.io` 同属这一类。
2. 这个值**不在版本库里**（全仓 `grep -rn "trycloudflare"` = 0 命中，含 docs 与 workflows），
   所以只读代码看不到它坏了——这是"配置面腐烂看不见"的典型：CI 文件是好的，变量是坏的。
3. 工作流自己的两处判据都覆盖不到这种形态：
   - `config-check`（每日 01:00 UTC）只判 `-z`（空即红）。非空的死域名直接放行。
   - `smoke-test`（每 15 分钟）把它当"应用挂了"来报，失败指引写的是
     「先 curl 区分 db down 与 app down，再按 runbook-deploy.md §4 回滚 DB 或重启应用」——
     **对一个 DNS 都没解析出来的目标，这套处置是错的**，会把人引去重启一个其实健康的栈。
4. 于是 10-13 起每天 4~8 次红 + 每次一封告警邮件（GitHub 对 watch 用户的默认通知），
   把真正的故障信号淹掉。这条门目前的净效果是**负的**。

补一条口径修正：`docs/runbook-monitoring.md` 第 18 行写"未配置 `vars.SMOKE_TARGET_URL` 时整 job 跳过"，
这是 10-07 之前的形态；现况是 `config-check` 每日硬失败、`smoke-test` warning 跳过（见 `smoke.yml` 头注）。
另外该文档第 17 行写集成腿"14 文件 / 140 用例"，属进度型数字，已过期。

## 3. 改动（`.github/workflows/smoke.yml`）

设计原则：**绝不为省邮件把探测改成跳过**。目标不可达也可能是域名整体过期（=真故障），
把它读成健康就是 10-04 那次被否掉的假绿形态。所以只动两件事：

1. `config-check` 在"非空"之外，把 host 抽出来比对临时隧道域名清单
   （`trycloudflare.com` / `loca.lt` / `ngrok-free.app` / `ngrok.io`，含子域），命中即每日硬失败一次，
   文案写明"红的原因不是生产故障"。这样这类配置缺陷走的是**每日一次**的提醒通道，
   而不是每 15 分钟冒充一次生产故障。
2. `smoke-test` 接住 `curl` 的退出码再分类（6=DNS、7=连不上、28=超时），
   红仍然是红，但报出现场与"① 目标失效 / ② 真的不可达，按此顺序排除"。
   顺带把 `config-check` 里两处 `${{ vars.SMOKE_TARGET_URL }}` 直接插值改成 `env:` 传入——
   注入值里带引号/分号本可以改写这段脚本（`smoke-test` 早就是 env 形态，这里补齐同口径）。

## 4. 验证记录（本机，2026-10-17）

条件：Windows 10.0.26300 / Git Bash 5.2.37 / curl 8.17（退出码语义与 Linux 一致）/
shellcheck 在 `/e/dev-data/go/bin/shellcheck`。**本机没有真 jq**，载荷校验那两条腿是对着
一个"遇到未预期 filter 就硬退出 99"的替身跑的（替身自带正/负对照）——这条限制如实标出。
另注：`python` 的 `subprocess` 解析到的 `bash` 是另一个解释器且会吞掉 `$?` 与 env，
第一版 harness 因此产出过一批假失败，已改为整条在 Git Bash 内执行。

方法：从 `smoke.yml` **抽出两段真实 `run:` 脚本落盘**（不是抄一份），
按 GitHub 的形状 `bash --noprofile --norc -e -o pipefail` 执行，目标值用命令行前缀注入。

结果：**34 条断言全过，0 失败**（脚本 `/tmp/verify-smoke.sh`），覆盖

- 未配置 → 红且文案是"未配置"；隧道目标 → 红且文案是"临时隧道域名"（且断言输出非空，
  防空输出冒充阴性）；固定域名 / 带端口 / 带路径 → 绿且 host 抽对；ngrok 免费域名 → 红；
  注入形态的值不产生独立执行痕迹；
- 未配置探测 → 仍按原设计 warning 跳过（不新增假绿）；不可解析目标 → 红 + DNS 文案 +
  排除顺序 + **不**误报成 HTTP 码问题；
- 真 HTTP 桩三条腿：健康 → 绿并明确"通过"；`db=down` → 红且文案指向 db；
  `status=degraded` → 红且文案指向 status（"任意一条红"不算过，必须带对文案）。

两条变异对照（证明改动打在判定维度上，而不是恒红）：

| 变异 | 预期 | 实测 |
| --- | --- | --- |
| MUT-1 删掉 `case … esac` 整段隧道判据 | 隧道目标从红退回绿（说明这条闸确有射程），且正常域名仍绿（说明不是恒红） | 0 与 0 ✅ |
| MUT-2 关掉 `CURL_RC` 分类分支 | 仍判红（没有把红改成绿），但说不出 DNS 原因（说明分类分支在提供可解释性） | 1 且无 DNS 文案 ✅ |

`shellcheck -S warning` 对两段脚本均无发现。与 `shellcheck.yml` 的关系要说清：
该工作流的 `paths` 只过滤 `**.sh`，**不检查 workflow 里的 `run:` 块**，所以上面这条是加分项，
不是门禁要求。

## 5. 还剩一件事，且不是代码能代做的

`SMOKE_TARGET_URL` 现在指向一个已消失的隧道。恢复监控有两条路，都需要 owner 决定：

1. **有固定域名**（生产或 staging）：
   `gh variable set SMOKE_TARGET_URL --body https://你的域名` —— 之后本改动会让它继续每 15 分钟探测。
2. **暂时没有**：`gh variable delete SMOKE_TARGET_URL` —— 探测 warning 跳过，
   `config-check` 每日硬失败一次，诚实表达"当前没有线上监控"。

我**没有**替你设置或删除这个变量：它属于部署拓扑，猜一个域名只会把红换个样子，
而删掉它会顺手关掉你可能正在用的监控。

最后一条口径：本文所有 GitHub 侧数字取自 2026-10-17 上午的 API 实测。
期间 `gh api` 出现过一次连接超时（同一命令重跑即成功），所以引用"某 sha 全绿"必须带时点。

## 6. 顺带核过的两条既有门禁（不是本 PR 的改动，只是独立复核）

### 6.1 `pool_timeout ≥ auth.maxWait` 这条耦合断言真有射程

`lib/db-pool.ts` 声称这条跨文件耦合"由 `tests/unit/db-pool.test.ts` 的断言守着（用例直接读
auth.ts 源码抽 maxWait）"。静态读到确实是 `readFileSync(lib/auth.ts)` +
`/maxWait:\s*([\d_]+)/`，并且注释解释了为什么不会命中注释里的 `maxWait=2000ms` 写法。
运行时验证（本 worktree 独立 `pnpm install --frozen-lockfile --ignore-scripts` 后跑，
vitest 3.2.7，单跑该文件）：

| 跑法 | 结果 |
| --- | --- |
| 基线 | `Test Files 1 passed / Tests 15 passed`，rc=0 |
| MUT-A `DB_POOL_DEFAULTS.poolTimeoutSeconds` 10→5 | **7 failed**，红因正是"断言 6"那条 describe |
| MUT-B `auth.ts` 的 `{maxWait: 10_000}`→`{maxWait: 20_000}` | **1 failed**，红因同样是"断言 6" |
| 两处分别还原 | 回到 15 passed，rc=0 |

⇒ 这条断言不是"把两个常数各写一遍"的假绿门禁：改任一侧都会红，且红在正确的用例上。

方法论补一条我自己的坑：**"还原后 md5 一致"这种核对在 autocrlf 机器上会骗人**——
`sed -i` 往返后文件内容与 HEAD 归一化后一致（`git diff --stat` 为空、CR 计数与 HEAD 都是 0），
但 md5 与检出时的副本不同、`git status` 仍标 ` M`（stat 缓存 + CRLF 归一化的产物）。
判"是否恢复原状"要用 `git checkout -- <paths>` + `git status --porcelain` 为空，
不要拿 md5 当准，否则会得出"我改坏了"或"没改回来"的错误结论。

### 6.2 顺带确认的 e2e 接线

`ci.yml` 的 e2e job 跑 `npx playwright test --config playwright.config.ts`，**不带 spec 过滤**
⇒ `web/e2e/viewer-readonly.spec.ts` 确实在 CI 里被执行（不是我 10-07 那次"写完了但没人跑"）。
另：e2e 的真实目录是 `web/e2e/`（`testDir: "./e2e"` 相对 `web/`）——我先前拿仓库根 `e2e/`
去 grep 得到空结果，误判成"spec 已删 / `describe.serial` 已消"，实际 `describe.serial` 仍有 17 处。
教训：**判"某个东西已消失"之前，先证明搜索路径存在**。

## 7. 同一条 PR 上顺手收的两处（含我自己造成的一次红）

### 7.1 我让 PR #113 的 Lint 变红，根因是认领工具的写侧不校验读侧会判的东西

现象：PR #113 首跑 `Lint=fail`，红因不是我改的 workflow，而是
`check_coordination_claims.py CLAIM_MALFORMED 字段为空 ['意图']`——**那条坏认领是我写的**。
我执行 `claim --paths … --hours 3` 时漏了 `--intent`，工具里是
`_flag(argv, "--intent") or ""`，空串照样落盘并回显"已认领"；而 `parse_claims`
把空意图判 `CLAIM_MALFORMED`，CI 的 Lint job 因此红（Lint 门住 Build/E2E/发布）。
写侧放过、读侧才炸，坏状态在本地完全不可见——这是本仓反复出现的那一类：判据只活在一侧。

修法（`scripts/check_coordination_claims.py`）：claim 要求非空 `--intent`，缺失即 usage +
`exit 2`（与既有 `--hours` 的校验同形）；并给 `--self-test` 补一条
"段数够但意图为空 → CLAIM_MALFORMED"（原有 `six` 只覆盖少一段的形状，覆盖不到这种）。

验证（本机，不经管道取退出码——第一版我把 `| tail` 的退出码当成了工具的退出码）：
漏 `--intent` → 真实退出码 2 且**认领表里没有多出该行**（`list | grep -c guard-probe` = 0）；
`--self-test` 22 条（`--self-test 2>&1 | grep -c OK` = 22、`grep -c FAIL` = 0）含新用例全 OK；不带参数的校验（CI 用的就是它）→ PASS。

### 7.2 写权限 default-deny 的数字复算（#37）

门禁自报：`280 scanned / 252 covered / 28 registered`，PASS。
CHANGELOG 里那条 Security 记录写的是 `278 / 250 / 28` —— 数字过期（+2 个新端点进墙后没回写），
已改为现值并附现测命令。
独立复算分母：全仓写方法 export **285** 处（POST 156 / PATCH 68 / DELETE 58 / PUT 3），
门禁的 280 = 285 − 5 处按设计跳过的：

| 跳过项 | 数量 | 机制 | 复核结论 |
| --- | --- | --- | --- |
| `/api/[...path]` 的 POST/PATCH/PUT/DELETE | 4 | `INTERNAL_EXACT` | 该路由只返回 JSON 404，完全不碰库 ⇒ 跳过是对的 |
| `POST /api/cron/recycle-cleanup` | 1 | `INTERNAL_PREFIXES` 的 `/api/cron/` | 9 个 cron 端点各自有 `CRON_SECRET` Bearer；`secret` 未配置时返回 **500 而非放行**（fail-closed，逐个读到源码确认） |

另外查了两条会让人误信的形态：`多文件归一化到同一 (method, route)` 的塌键数 = **0**
（若存在，后写的会覆盖前者的 covered 值，把未覆盖的说成覆盖）；`check_p0_content.py` 的扫描范围
是 `web/**/*.{ts,tsx}` + 两个 css，**不含 docs**，所以本文件不受内容棘轮约束。

要说清的残余风险：前缀式跳过意味着**今后新加的 `/api/cron/*` 会自动隐身**，
这一层靠的是"cron 族每个端点自己写鉴权"的惯例，没有机械检查守着。
