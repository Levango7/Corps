# iOS 临时测试指南（免 $99/年）

## 方案：CI 产出未签名 IPA + 本地 Sideloadly 签名

### 流程

```
GitHub Actions CI → 未签名 IPA → 下载到本地 → Sideloadly 签名 → 侧载到 iPhone
```

### 第一步：下载 IPA

1. GitHub Actions → Mobile Build 工作流 → 最新运行
2. Artifacts → `ios-unsigned-ipa` → 下载
3. 解压得到 `corps-desktop-unsigned.ipa`

### 第二步：安装 Sideloadly

1. 下载：https://sideloadly.io/
2. 安装到 Windows
3. 启动 Sideloadly

### 第三步：签名并安装

1. Sideloadly 中登录你的 Apple ID（日常用的就行，不需要 $99/年）
2. 拖入 `corps-desktop-unsigned.ipa`
3. 连接 iPhone（USB）
4. 点击 Start → 自动签名并安装

### 限制（免费 Apple ID）

| 限制 | 说明 |
|------|------|
| 签名有效期 | **7 天**（到期需重新签名） |
| 设备数量 | 最多 **3 台** |
| App ID 数量 | 最多 **3 个** |
| 上架 | ❌ 不能上 App Store / TestFlight |

### 自动刷新签名

7 天后 App 会闪退，需要重新签名：
1. 打开 Sideloadly
2. 拖入同一 IPA
3. 点 Start → 覆盖安装

或者用 **AltStore**（自动刷新）：
1. 安装 [AltStore](https://altstore.io/)
2. AltStore 会自动后台刷新签名
3. 需要电脑和手机在同一 WiFi

### 升级到正式签名

获取 Apple Developer Program ($99/年) 后：
1. 在 GitHub Secrets 配置：
   - `APPLE_DEVELOPMENT_TEAM` — Team ID
   - `APPLE_CERTIFICATE` — 导出的 .p12 证书（base64）
   - `APPLE_CERTIFICATE_PASSWORD` — .p12 密码
   - `APPLE_PROVISIONING_PROFILE` — Provisioning Profile（base64）
2. 修改 `mobile-build.yml`：
   - 移除 `continue-on-error: true`
   - 移除 `CODE_SIGNING_ALLOWED: "NO"`
   - 添加 `APPLE_DEVELOPMENT_TEAM` 环境变量
3. CI 将自动签名产出永久有效 IPA