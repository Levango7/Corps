# e2e —— 浏览器级测试约定

本目录是三层测试的最外层（`tests/` 之上）：**真实浏览器 + 生产构建**。本文件只讲
"怎么跑、哪些红是设计、新用例该守什么"，不重复 `docs/` 里的测试体系说明。

## 三层与各自的运行面

| 层 | 位置 | 本地跑 | CI job |
| --- | --- | --- | --- |
| 单元 | `web/tests/unit/` | `npx vitest run tests/unit` | Test / Unit Coverage Ratchet |
| 集成（真 HTTP） | `web/tests/integration/` | dev/生产 server + `TEST_BASE_URL`（见下） | Test（生产构建腿） |
| E2E（本目录） | `web/e2e/*.spec.ts` | `npx playwright test`（需目标 server） | E2E (production build) |

## 本地跑 E2E 的正确姿势

```bash
# 1) 起目标 server（dev 即可；CI 用的是生产构建）
cd web && RATE_LIMIT_DISABLED=1 npx next dev -p 3000   # 端口别用 3000 时见下

# 2) 指路（默认 http://localhost:3000）
PLAYWRIGHT_BASE_URL=http://localhost:3000 RATE_LIMIT_DISABLED=1 npx playwright test

# 单文件
npx playwright test e2e/logout-cache.spec.ts
```

- **`RATE_LIMIT_DISABLED=1` 必带**：套件批量注册会打爆限流窗口，得到假红。
- **本机 3000 常被别的服务占**（Grafana 等容器会绑 `127.0.0.1:3000`，而 Node 的
  `localhost` 解析可能命中它）——换端口 + `PLAYWRIGHT_BASE_URL` 显式指路，别怀疑用例。

## 三类"看着红、其实是设计"的用例

1. **`ui-visual.spec.ts`（视觉回归）——CI-only，本地整文件 skip。**
   基线只在 CI 环境生成与比对：本仓用系统字体栈，Windows 本地与 Ubuntu CI 的字形
   宽度不同，跨平台像素比对必然假红。改基线走 `--update-snapshots` 流程（见该文件头注释）。
2. **`logout-cache.spec.ts`（SW 缓存行为）——只在生产构建下有效。**
   Service Worker 仅在生产模式注册；`next dev` 下 "SW 未注册" 是**前提不成立**，
   不是回归。本地要跑它：`next build && next start` 再对生产 server 跑。
3. **依赖真实时间的用例**在本机高负载时会抖（如进程池计时类在单元层）——
   CI runner 是干净环境，**以 CI 为准**。

## 新用例约定

- **注册/登录一律用 `helpers.ts` 的 `registerAndLogin` / `uniqueEmail`**：
  邮箱必须每用例现取（共享常量会让第二次注册撞 409）；工作区名若要参与截图/断言，
  用固定值（时间戳名会渲染进页面头部，每轮必 diff）。
- **等待水合**：`waitForURL(/\/w\//)` 之后不代表 UI 可用；等一个稳定元素
  （如顶栏搜索按钮）再断言/截图。
- **选择器**：`role`/`aria-label` 优先；`[role="dialog"]` 类要收窄（dev 模式下
  Next 错误浮层也是 dialog，宽松选择器会 strict 违规）。App Router 中
  **`_` 前缀目录是私有不参与路由**——临时调试 route 别起这个名字。
- **懒加载资源**（如 dynamic import 的 CommandPalette）首开等待放宽到 20s，
  dev 模式首次编译可能十几秒。

## 门禁"先红后修"的落地方式（2026-10-13 实证教训）

给未来 bug 预先落**判据**（TDD 式先红后修）是值得鼓励的，但**不要直接红在 main**：
某个故意红的用例会占住 E2E 这个必需检查，**冻结全仓所有 PR 的合并**（并且连带让
GHCR 镜像停发——发布链也断），本日实测被卡了数小时。

正确姿势（任选其一）：

- 同一 PR 内：判据带 `test.fixme(条件, "…")` 或 `test.skip` + 注释里的 issue/任务
  编号落地，修复 PR 里解除 skip——红只红在修复分支上；
- 或判据与修复放同一个 PR（大改动拆小步，但每步 main 保持全绿）。

已有先例：`ui-visual.spec.ts` 的 CI-only skip、以及 2026-10-13 的
`fixed-overlay-portal.spec.ts`（反面案例：门禁先红着落 main，合并全面冻结）。
