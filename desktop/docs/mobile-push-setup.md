# 移动端推送通知集成指南

## 架构概述

Corps 移动端采用 WebView → 远程服务器架构。推送通知需要原生层配合：

```
服务器 → 推送服务 → 设备原生层 → WebView → 前端通知处理
```

## Android（FCM - Firebase Cloud Messaging）

### 前置条件
- Firebase 项目（免费）
- `google-services.json` 配置文件

### 集成步骤

1. **创建 Firebase 项目**
   - 访问 [Firebase Console](https://console.firebase.google.com/)
   - 创建项目 → 添加 Android 应用 → 包名 `com.corps.desktop`
   - 下载 `google-services.json` → 放入 `src-tauri/gen/android/app/`

2. **修改 build.gradle**
   ```gradle
   // app/build.gradle
   apply plugin: 'com.google.gms.google-services'
   dependencies {
       implementation 'com.google.firebase:firebase-messaging:24.0.0'
   }
   ```

3. **创建 FirebaseMessagingService**
   ```kotlin
   // app/src/main/java/com/corps/desktop/FcmService.kt
   class FcmService : FirebaseMessagingService() {
       override fun onMessageReceived(remoteMessage: RemoteMessage) {
           // 通知 WebView
           val payload = remoteMessage.data.toString()
           // 通过 Tauri 事件发送到 WebView
       }
       override fun onNewToken(token: String) {
           // 注册 token 到 Corps 服务器
       }
   }
   ```

4. **CI 配置**
   - 将 `google-services.json` 作为 GitHub Secret 存储
   - 在 `mobile-build.yml` 中注入：
     ```yaml
     - name: Inject Firebase config
       run: |
         echo "${{ secrets.GOOGLE_SERVICES_JSON }}" \
           > desktop/src-tauri/gen/android/app/google-services.json
     ```

## iOS（APNs - Apple Push Notification service）

### 前置条件
- Apple Developer 账号（$99/年）
- APNs 推送证书或 Auth Key

### 集成步骤

1. **配置推送能力**
   - Xcode → App → Signing & Capabilities → + Push Notifications

2. **注册 Device Token**
   ```swift
   // AppDelegate.swift
   func application(_ application: UIApplication,
                    didRegisterForRemoteNotificationsWithDeviceToken token: Data) {
       // 发送 token 到 Corps 服务器
   }
   ```

3. **CI 配置**
   - 当前为 debug 构建（无签名），推送通知需要 release 签名
   - 获取 Apple Developer 账号后配置 CI 签名

## HarmonyOS（华为推送 Push Kit）

### 前置条件
- 华为开发者账号
- AGConnect-services.json 配置文件

### 集成步骤

1. **配置 Push Kit**
   - AppGallery Connect → 我的项目 → 推送服务 → 开通
   - 下载 `agconnect-services.json` → 放入 `entry/`

2. **修改 oh-package.json5**
   ```json5
   {
     "dependencies": {
       "@kit.PushKit": "file:./libs/pushkit.aar"
     }
   }
   ```

3. **注册 Push Token**
   ```typescript
   // EntryAbility.ets
   import { pushService } from '@kit.PushKit';
   
   async function registerPush() {
       const token = await pushService.getToken();
       // 发送 token 到 Corps 服务器
   }
   ```

## 服务器端（统一推送接口）

 Corps 后端需要实现统一推送接口：

```typescript
// web/lib/push/unified.ts
interface PushTarget {
  platform: 'android' | 'ios' | 'harmonyos';
  token: string;
  userId: string;
}

async function sendPush(target: PushTarget, payload: PushPayload): Promise<void> {
  switch (target.platform) {
    case 'android': return sendFCM(target.token, payload);
    case 'ios': return sendAPNs(target.token, payload);
    case 'harmonyos': return sendHuaweiPush(target.token, payload);
  }
}
```

## 当前状态

| 平台 | 状态 | 阻塞项 |
|------|------|--------|
| Android (FCM) | ❌ 未集成 | 需 Firebase 项目 + google-services.json |
| iOS (APNs) | ❌ 未集成 | 需 Apple Developer 账号 ($99/年) |
| HarmonyOS (Push Kit) | ❌ 未集成 | 需华为开发者账号 |

## 优先级建议

1. **Android FCM** — Firebase 免费，可立即开始
2. **HarmonyOS Push Kit** — 华为开发者账号免费注册
3. **iOS APNs** — 需 Apple Developer 账号，可延后