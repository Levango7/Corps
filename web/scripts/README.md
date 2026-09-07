# 响应式验证工具

两个脚本用于本地响应式布局验证（需 dev server 跑在 `localhost:3000`，DB 在 `localhost:15432`）。

## scripts/responsive-shots.mjs

三档视口（PC 1440 / iPad 768 / iPhone 390）截图到 `web/shots/`：
登录页、概览、看板、通知、设置，移动端追加抽屉侧栏。同时输出各页横向溢出检测。

```bash
cd web && node scripts/responsive-shots.mjs
```

## scripts/layout-audit.mjs

程序化布局崩点审计（不依赖人眼看截图），三引擎 × 三档视口 × 6 页面：

- 引擎：chromium + **firefox** + **webkit**（Safari 近似——无 Mac/iPhone 设备时的日常替代；
  注意只近似渲染，不覆盖真机触摸/安全区/滚动回弹，发布前仍需云真机过一遍）
- 检查：横向溢出（元素超出视口且不在滚动容器内）、可交互元素重叠
  （button/link/input 两两相交）、触控目标过小（高度 < 20px）

```bash
cd web && npx playwright install webkit firefox   # 首次需装 WebKit/Firefox
cd web && node scripts/layout-audit.mjs
```

2026-09-07 基线：54/54（chromium + firefox + webkit × 3 视口 × 6 页）零 issue；
此前双引擎基线 36/36 同样全零。唯一修复项为概览页"全部 →"链接触控区
20px → 28px（py-1 -my-1 补偿负 margin）。

### 已知坑

1. **`page.evaluate("<string>")` 字符串形式在此 Playwright 版本返回 undefined**，
   必须函数形式传源码（脚本内已处理）。
2. **WebKit 下 `fill()` 对 React 受控 `type=text` 输入框不触发 onChange**——
   值填不进 state，原生校验拦截表单提交。审计脚本已改用
   `pressSequentially`（逐字符按键）双引擎通用。这是测试工具兼容问题，
   不是产品 bug（真实 WebKit 浏览器键盘输入正常）。
3. 注册后立即 goto 其他页在 WebKit 下偶发认证竞态（401 兜底跳登录），
   审计脚本在登录后加了 networkidle + 1.5s 缓冲。
4. **Firefox 默认 locale 是 en-US**——页面按语言协商渲染成英文，中文选择器
   （"创建并进入" 等）全落空，表象为注册环节 click 超时。Chromium/WebKit
   在本机会继承系统中文所以没暴露。脚本已在 `newContext` 显式
   `locale: "zh-CN"` 钉死三引擎行为一致。
