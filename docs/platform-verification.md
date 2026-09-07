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

## 升级路径（约束变化时）

- **有 Mac**：iOS 模拟器 + Safari 真机调试（防御层的 env() / dvh / 橡皮筋
  全部可实测，防御条目逐项打勾）
- **有预算**：BrowserStack/App Live 云真机——iOS/旧 Android 碎片档一次覆盖
- **鸿蒙重点验证**：DevEco 模拟器（Windows 可跑）里跑 Web 版，重点看
  软键盘与返回手势——这两处华为定制与原生 Android 差异最大
