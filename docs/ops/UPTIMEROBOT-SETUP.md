# UptimeRobot 配置清单（owner 动作）

- 用途：落地 #50 的外部分钟级拨测（按 2026-11-12 裁决）。
- 责任：注册、配置告警联系人是 owner 动作；工程侧不代注册第三方服务。
- 当前目标：`https://corps-five.vercel.app/api/health`
- 免费档能力（2026-11-27 核对）：50 monitors、5 分钟间隔、Keyword monitor、3 个月数据保留。以 UptimeRobot 当前页面为准。

## 1. 注册

1. 打开 UptimeRobot 注册页，创建免费账户。
2. 完成后先停留在仪表盘，不急着加 monitor。

## 2. 配置告警联系人

1. 进入 `Settings → Alert Contacts`。
2. 至少添加一个 owner 可达的告警方式（邮箱；可选 webhook/IM）。
3. 记录告警联系人名称，后续 monitor 选择它。

## 3. 创建 monitor

1. 进入 `Add New Monitor`。
2. 逐项填写：

| 字段 | 值 |
|---|---|
| Monitor Type | `Keyword`（若界面无独立 Keyword，则选 `HTTP(s)` 并勾选关键字断言） |
| Friendly Name | `Corps /api/health` |
| URL | `https://corps-five.vercel.app/api/health` |
| Monitor Interval | `5 minutes` |
| Keyword | `"db":"up"` |
| Keyword 触发条件 | alert when keyword is **not** found |
| Alert Contacts | 选择第 2 步创建的联系人 |

3. 保存。

## 4. 验收

1. 等待至少 2 个检查周期（约 10 分钟）。
2. 仪表盘显示 `Up`，且最近一次响应包含 `"db":"up"`。
3. 触发一次测试告警（若 UI 提供），确认联系人能收到。
4. 若界面只允许 HTTP status 断言、不允许关键字断言：
   - 退化为只校验 HTTP 200；
   - 在 `docs/runbook-monitoring.md` §4.3 标注“db=up 断言缺口”，不要假装已校验数据库可达。

## 5. 口径约束

- 这是 5 分钟级拨测，不是 1 分钟级；`docs/SLI-internal-definition.md` 的“分钟级”缺口按 5 分钟档满足。
- 它不替代容器 HEALTHCHECK、部署脚本本地健康检查或 GitHub Smoke。
- 它不构成对外 SLO；`docs/ROADMAP-2026Q4.md` §5 负面清单仍有效。
- 免费档数据保留 3 个月；更长期趋势需付费档或自建 Prometheus。

## 6. 完成后

1. 在 `docs/runbook-monitoring.md` §4.3 记录 monitor 名称与告警联系人类型（不要记录密钥）。
2. 回写本清单状态为“已配置”，并销任务 #102。
3. 若目标实例更换，改这里与 UptimeRobot monitor 的 URL，不要写死到代码或 CI。
