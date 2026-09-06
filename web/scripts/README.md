# 响应式验证工具

两个脚本用于本地响应式布局验证（需 dev server 跑在 `localhost:3000`，DB 在 `localhost:15432`）。

## scripts/responsive-shots.mjs

三档视口（PC 1440 / iPad 768 / iPhone 390）截图到 `web/shots/`：
登录页、概览、看板、通知、设置，移动端追加抽屉侧栏。同时输出各页横向溢出检测。

```bash
cd web && node scripts/responsive-shots.mjs
```

## scripts/layout-audit.mjs

程序化布局崩点审计（不依赖人眼看截图），三档视口 × 6 页面：

- 横向溢出（元素超出视口且不在滚动容器内）
- 可交互元素重叠（button/link/input 两两相交）
- 触控目标过小（高度 < 20px 的 button/a）

输出每页 issue 列表。已知坑：`page.evaluate("<string>")` 字符串形式在此
Playwright 版本返回 undefined，必须用函数形式传源码（脚本内已处理）。

```bash
cd web && node scripts/layout-audit.mjs
```

2026-09-07 基线：18/18 页面组合 0 溢出 0 重叠；唯一修复项为概览页
"全部 →" 链接触控区 20px → 28px（py-1 -my-1 补偿负 margin）。
