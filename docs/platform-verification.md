# 多端验证地图与 Android 真机清单

> 2026-09-08 定稿。约束：**开发与测试环境只有 Windows + Android 真机**。
> 其余平台（iOS/macOS）无硬件无模拟器条件（iOS 模拟器需 macOS，苹果许可
> 禁止非苹果硬件），采用"代码级防御 + webkit 引擎近似"策略兜底。

## 平台矩阵（当前约束下的最优解）

| 平台         | 验证手段                                              | 覆盖度 | 说明                                                     |
| ------------ | ----------------------------------------------------- | ------ | -------------------------------------------------------- |
| Windows 桌面 | 本地 Playwright chromium（54/54 基线）+ 人眼          | 高     | 主开发环境                                               |
| Linux 生产   | CI E2E job（每次 push 全量跑）                        | 高     | 无需本地重复                                             |
| Android 真机 | **本文档清单**（USB + chrome://inspect）              | 高     | 唯一真实触控/软键盘/系统行为档                           |
| 鸿蒙         | DevEco Studio Windows 版模拟器（未来可选）            | 中     | 鸿蒙 4+ 浏览器内核为 Chromium 系，Android 档结论大体适用 |
| Firefox      | 本地 Playwright firefox（已并入 layout-audit 三引擎） | 高     | 已在 54/54 基线内                                        |
| Safari/iOS   | webkit 档近似（54/54）+ **代码级 iOS 防御层**         | 中     | 无真机时的极限；发版前如有条件可用云真机抽查             |

## iOS 代码级防御层（已实施，见 globals.css / [locale]/layout.tsx）

无 iOS 真机条件下，把 webkit 近似不到的 iOS 特有坑在代码层堵死：

1. `viewport-fit=cover` + `interactive-widget=resizes-content`（layout.tsx
   的 `viewport` export——Next.js 正道，勿手写 meta）
2. `overscroll-behavior: none`——阻断橡皮筋滚动链
3. 输入控件 `@media (max-width: 767px)` 最小 16px——iOS 聚焦自动放大防御
   （不禁缩放，保可访问性）
4. `-webkit-tap-highlight-color: transparent`
5. `.pt-safe/.pb-safe/.px-safe` 工具类（`env(safe-area-inset-*)`）——已挂
   Toast、批量工具栏、任务版本历史底弹三处底部固定元素
6. 移动弹窗用 `100dvh`（任务版本历史已是；新写移动端 UI 沿用）

## Android 真机验证清单

**环境准备**（一次）：

1. 手机开发者选项 → 打开 USB 调试 → USB 连电脑
2. Windows Chrome 打开 `chrome://inspect/#devices`，勾选 Discover USB devices
3. 电脑与手机连同一 Wi-Fi；Windows 防火墙放行 3000/3090 端口入站
4. dev server 用局域网 IP 启动（不能用 localhost——手机访问不到）：
   ```bash
   # 查本机 IPv4：ipconfig → 192.168.x.x
   cd web
   # .env.local 的 DATABASE_URL 临时指向 localhost:15432（见响应式配方记忆）
   set HOSTNAME=0.0.0.0 && npx next dev -p 3000
   ```
5. 手机 Chrome 访问 `http://<电脑IP>:3000`（Next 的 HMR/CSP 对局域网 IP
   同样生效；如被拦检查 CORS_ORIGINS）

**逐项清单**（约 20 分钟；每项用 chrome://inspect 的 Inspect 实时看
console 报错）：

注册与登录：

- [ ] 注册表单：软键盘弹出不遮挡"创建并进入"按钮（interactive-widget 生效）
- [ ] 输入框聚焦时页面不自动放大（16px 防御生效）
- [ ] 密码管理器自动填充正常（Android 的 autofill）

核心页面（概览/看板/决策/文档/通知/设置）：

- [ ] 各页无横向溢出（可左右滑动的橡皮筋无异常拉伸）
- [ ] 看板拖拽任务换列（真实触控）——Playwright 永远近似不了的手势
- [ ] 移动抽屉侧栏：开合顺滑、打开时背景不滚动（overscroll 防御）
- [ ] 长按任务卡不误触文本选择（user-select 防御）
- [ ] 通知 tab 切换（All/Unread/@我/分配给我）

任务详情与编辑器（v0.6 重点）：

- [ ] 聊天 SSE：手机锁屏 30s 再解锁，消息仍实时到达（心跳保活验证）
- [ ] 软键盘弹出时消息输入框可见（resizes-content 生效）
- [ ] Mermaid 思维导图：图表下拉插入 → 真机渲染成图（非代码块）
- [ ] 分屏预览窄屏自动堆叠（lg 以下单列）
- [ ] Ctrl 快捷键不适用触屏——确认工具栏按钮路径完整可用

多端并发（v0.6 SSE 上限的真实验证）：

- [ ] 手机 + 电脑 Chrome + 电脑 Edge 同时登同一账号进同一任务聊天
- [ ] 三端互发消息实时同步
- [ ] 开第 6 个标签页 → 收到 429"并发连接过多"（上限 5 的验证）

深色与系统行为：

- [ ] 系统深色模式切换 → 应用主题跟随（刷新后生效，v1 限制已知）
- [ ] 转屏（横竖屏）布局不错乱
- [ ] 返回手势（左侧滑）→ 浏览器历史返回而非退出应用

性能与弱网：

- [ ] 4G 弱网下首屏可容忍（Chrome DevTools 手机侧无 throttle，用真实网络）
- [ ] 长列表滚动（看板多任务）无掉帧感

**产出**：每项 PASS/FAIL + 截图（手机截图即可）；FAIL 项按
`web/scripts/README.md` 的响应式配方复现修复，修复后三引擎 layout-audit
回归（54/54 基线不得破）。

## 云矩阵（2026-09-08 增补：三平台全云化）

> 仓库 public 的决定性红利：**GitHub Actions macOS runner 对公开仓库免费**
> （预装 Xcode），Ubuntu runner 支持 KVM——三平台里两个全自动云化，
> 唯鸿蒙因华为生态封闭只能半自动。

### iOS（object-c 档）——macOS 云 runner，全自动

`.github/workflows/mobile-matrix.yml` 的 `ios-safari` job：

- `runs-on: macos-latest`（免费、预装 Xcode；未来做 React Native/原生
  iOS 构建也在这台 runner 上 `xcodebuild`）
- 跑 `layout-audit.mjs` 的 **webkit 档**（`AUDIT_ENGINES=webkit`）——
  macOS 上 WebKit 就是**真 Safari 引擎**，不再是 Windows 本地的"近似"。
  webkit 档从 54/54 里的三引擎之一，升级为真机级验证
- macOS runner 不支持 service container，PG 用 `ikalnytskyi/postgresql-action`
- 触发：手动（workflow_dispatch）+ 每周一 04:00 UTC 定时回归

### Android——Ubuntu 云模拟器，全自动

同 workflow 的 `android-chrome` job：

- `ubuntu-latest` + KVM（打开 /dev/kvm group 权限——GitHub 给 Ubuntu
  runner 透传 KVM，这是本地 Docker 给不了的）
- `reactivecircus/android-emulator-runner` 起 API 34 x86_64 模拟器
  （google_apis 镜像含**系统 Chrome**）
- `scripts/android-device-smoke.mjs`：Playwright `_android` API 驱动模拟器
  内真实 Chrome（等价 USB + chrome://inspect 的云版本）——注册→工作区→
  四页溢出检测→未捕获 JS 异常→截图 artifact（shots-android/）
- 模拟器经 `10.0.2.2`（AOSP 对宿主 loopback 的固定别名）访问 dev server

### HarmonyOS——无公共 CI 云，半自动

华为生态封闭是客观约束：DevEco 模拟器要嵌套虚拟化（云 CI 不给 KVM 套娃），
ArkTS 工具链没有 macOS/Linux 云镜像。分两层处置：

- **引擎层（可自动，已覆盖）**：HarmonyOS NEXT 的 ArkWeb 内核是 Chromium
  系——渲染/布局结论由现有 chromium 档（本地 + CI E2E）大体覆盖
- **真机层（手动，唯一路径）**：华为云远程真机（`developer.huawei.com` →
  云真机，免费额度按次计）——浏览器打开远端鸿蒙设备，输入局域网可达的
  部署地址（staging 或内网穿透）人工过一遍软键盘/返回手势/多任务三项
  华为定制差异。需要华为开发者账号实名（一次性）

### 触发与节奏

```bash
# 手动触发（push 后首次建议立即跑一次验证流水线本身）
gh workflow run "Mobile Matrix (Cloud)"    # 或网页 Actions 页面点 Run

# 定时：每周一 04:00 UTC（北京 12:00）双 job 回归
```

失败处理：iOS 挂了→按 layout-audit 报告的 file:line 修复后本地 webkit 档
复现；Android 挂了→下载 shots-android artifact 看截图，本地 Android 真机
（platform-verification.md 清单）复现修复。两个 job 都不阻塞主 CI
（ci.yml 不依赖 mobile-matrix），移动端回归是独立低频档。
