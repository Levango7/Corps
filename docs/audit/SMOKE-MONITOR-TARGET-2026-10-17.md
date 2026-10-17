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
