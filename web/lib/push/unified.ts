/**
 * 跨平台统一推送接口（Android FCM / iOS APNs / HarmonyOS Push Kit）
 *
 * 设计目标：
 *  - 三平台原生 App 推送收口到单一入口（sendPush / sendPushBatch / sendPushToUser）
 *  - 与浏览器 Web Push（lib/web-push.ts + PushSubscription 表）正交，互不依赖
 *  - 环境变量未配置时静默跳过（console.warn），不抛错——推送是尽力而为通道，
 *    不应因配置缺失阻断业务流程（如 AI 推送调度、通知下发）
 *  - 单次发送失败不中断批量，汇总错误到 console.error 便于运维排查
 *
 * 环境变量：
 *  - FCM：FIREBASE_SERVER_KEY（Firebase 项目 > Cloud Messaging > Server Key）
 *  - APNs：APNS_TEAM_ID / APNS_KEY_ID / APNS_PRIVATE_KEY / APNS_BUNDLE_ID
 *  - HarmonyOS：HUAWEI_APP_ID / HUAWEI_APP_SECRET
 *
 * 来源经验：
 *  - 2026-09-16-nextjs-workspace-resource-crud-fullstack-extension-checklist
 *    （Prisma 直接调用 + apiMsg 错误处理模式）
 */

import jwt from "jsonwebtoken";
import { prisma } from "@/lib/prisma";

// ─── 类型定义 ───────────────────────────────────────────────

/** 推送平台标识 */
export type PushPlatform = "android" | "ios" | "harmonyos";

/** 单个推送目标（平台 + 设备 token + 用户 ID） */
export interface PushTarget {
  platform: PushPlatform;
  token: string;
  userId: string;
}

/** 推送消息载荷 */
export interface PushPayload {
  /** 通知标题 */
  title: string;
  /** 通知正文 */
  body: string;
  /** 自定义数据（键值对，透传到客户端） */
  data?: Record<string, string>;
  /** 角标数（iOS / Android 通知栏未读计数，可选） */
  badge?: number;
}

// ─── 平台发送函数 ───────────────────────────────────────────

/**
 * Android FCM 推送（Legacy HTTP API）
 *
 * 使用 FIREBASE_SERVER_KEY 调用 fcm.googleapis.com/fcm/send。
 * Legacy API 足够当前需求且配置最简（仅需 server key）；
 * 后续如需 HTTP v1 API（OAuth2 access token）可在此切换。
 */
async function sendFCM(token: string, payload: PushPayload): Promise<void> {
  const serverKey = process.env.FIREBASE_SERVER_KEY;
  if (!serverKey) {
    console.warn("[push/FCM] FIREBASE_SERVER_KEY 未配置，跳过 Android 推送");
    return;
  }

  const message = {
    to: token,
    notification: {
      title: payload.title,
      body: payload.body,
      badge: payload.badge,
    },
    data: payload.data ?? {},
    // high priority 确保即时送达（FCM 默认 normal 可能延迟）
    priority: "high",
  };

  const resp = await fetch("https://fcm.googleapis.com/fcm/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `key=${serverKey}`,
    },
    body: JSON.stringify(message),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`FCM 推送失败 (${resp.status}): ${text}`);
  }

  // FCM 返回 200 但 body 可能含 error（如 InvalidRegistration）
  const result = (await resp.json()) as { error?: string };
  if (result.error) {
    throw new Error(`FCM 推送失败: ${result.error}`);
  }
}

/**
 * iOS APNs 推送（HTTP/2 Provider API）
 *
 * 使用 APNS_TEAM_ID + APNS_KEY_ID + APNS_PRIVATE_KEY 生成 provider JWT，
 * 调用 api.push.apple.com/3/device/{deviceToken}。
 *
 * 注意：Node.js 原生 fetch（undici）在 v20+ 支持 HTTP/2，
 * 但 APNs 强制 HTTP/2。若运行时 fetch 不支持 HTTP/2，
 * 需引入 http2 包装器。当前实现用 fetch 直发，依赖运行时 HTTP/2 支持。
 */
async function sendAPNs(token: string, payload: PushPayload): Promise<void> {
  const teamId = process.env.APNS_TEAM_ID;
  const keyId = process.env.APNS_KEY_ID;
  const privateKeyEnv = process.env.APNS_PRIVATE_KEY;
  const bundleId = process.env.APNS_BUNDLE_ID;

  if (!teamId || !keyId || !privateKeyEnv || !bundleId) {
    console.warn(
      "[push/APNs] APNS_TEAM_ID/APNS_KEY_ID/APNS_PRIVATE_KEY/APNS_BUNDLE_ID 未完整配置，跳过 iOS 推送",
    );
    return;
  }

  // 生成 provider JWT（ES256 算法，10 分钟有效期——APNs 上限 1 小时）
  // private key 需转为 PEM 格式（环境变量中 \n 转义需还原）
  const privateKey = privateKeyEnv.replace(/\\n/g, "\n");
  const providerToken = jwt.sign({}, privateKey, {
    algorithm: "ES256",
    expiresIn: "10m",
    issuer: teamId,
    header: { alg: "ES256", kid: keyId, typ: "JWT" },
  });

  // APNs 通知载荷（aps 命名空间）
  const aps: Record<string, unknown> = {
    alert: { title: payload.title, body: payload.body },
  };
  if (payload.badge !== undefined) {
    aps.badge = payload.badge;
  }

  const body = JSON.stringify({
    aps,
    ...payload.data,
  });

  const resp = await fetch(`https://api.push.apple.com/3/device/${token}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `bearer ${providerToken}`,
      "apns-topic": bundleId,
      // 立即投递（10 = immediate，5 = power considerations）
      "apns-priority": "10",
    },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`APNs 推送失败 (${resp.status}): ${text}`);
  }
}

/**
 * HarmonyOS Push Kit 推送（华为推送服务）
 *
 * 流程：
 *  1. 用 HUAWEI_APP_ID + HUAWEI_APP_SECRET 获取 OAuth2 access_token
 *  2. 调用 Push Kit API 发送消息
 *
 * access_token 有效期 1 小时，此处每次发送都获取新 token（简单实现，
 * 后续可缓存到内存 + 过期前刷新，减少 OAuth 调用）。
 */
async function sendHuaweiPush(token: string, payload: PushPayload): Promise<void> {
  const appId = process.env.HUAWEI_APP_ID;
  const appSecret = process.env.HUAWEI_APP_SECRET;

  if (!appId || !appSecret) {
    console.warn(
      "[push/Huawei] HUAWEI_APP_ID/HUAWEI_APP_SECRET 未配置，跳过 HarmonyOS 推送",
    );
    return;
  }

  // 1) 获取 access_token
  const tokenResp = await fetch("https://oauth-api.cloud.huawei.com/oauth2/v3/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: appId,
      client_secret: appSecret,
    }),
  });

  if (!tokenResp.ok) {
    const text = await tokenResp.text();
    throw new Error(`华为 OAuth 获取 token 失败 (${tokenResp.status}): ${text}`);
  }

  const tokenResult = (await tokenResp.json()) as { access_token?: string };
  const accessToken = tokenResult.access_token;
  if (!accessToken) {
    throw new Error("华为 OAuth 返回缺少 access_token");
  }

  // 2) 发送推送消息
  // Push Kit 消息体：notification 为通知栏消息，data 为透传数据
  const message = {
    message: {
      token: [token],
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: payload.data ? JSON.stringify(payload.data) : undefined,
      android: {
        notification: {
          priority: 2, // 高优先级
          ...(payload.badge !== undefined ? { badge: { addNum: payload.badge } } : {}),
        },
      },
    },
  };

  const pushResp = await fetch(`https://push-api.cloud.huawei.com/v1/${appId}/messages:send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(message),
  });

  if (!pushResp.ok) {
    const text = await pushResp.text();
    throw new Error(`华为 Push Kit 推送失败 (${pushResp.status}): ${text}`);
  }

  const pushResult = (await pushResp.json()) as { code?: string; msg?: string };
  // Push Kit 成功响应 code 为 "0"
  if (pushResult.code && pushResult.code !== "0") {
    throw new Error(`华为 Push Kit 推送失败: ${pushResult.msg ?? pushResult.code}`);
  }
}

// ─── 统一入口 ───────────────────────────────────────────────

/**
 * 按 target.platform 分发到对应平台发送函数。
 * 未配置环境变量时各平台函数内部静默跳过（不抛错）。
 */
export async function sendPush(target: PushTarget, payload: PushPayload): Promise<void> {
  switch (target.platform) {
    case "android":
      await sendFCM(target.token, payload);
      break;
    case "ios":
      await sendAPNs(target.token, payload);
      break;
    case "harmonyos":
      await sendHuaweiPush(target.token, payload);
      break;
    default:
      console.warn(`[push] 未知平台: ${(target as { platform: string }).platform}，跳过`);
  }
}

/**
 * 批量推送：对多个 target 并发发送同一 payload。
 *
 * 单个 target 失败不中断整体（记录到 errors），全部完成后若存在失败则
 * 抛出聚合错误——调用方可 catch 后记录日志，不影响其他业务流程。
 * 推送是尽力而为通道，部分失败属正常（如设备卸载后 token 失效）。
 */
export async function sendPushBatch(
  targets: PushTarget[],
  payload: PushPayload,
): Promise<void> {
  if (targets.length === 0) return;

  const results = await Promise.allSettled(
    targets.map((target) => sendPush(target, payload)),
  );

  const errors: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "rejected") {
      const target = targets[i];
      errors.push(
        `[${target.platform}/${target.token.slice(0, 8)}…] ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
      );
    }
  }

  if (errors.length > 0) {
    console.error("[push/batch] 部分推送失败:", errors);
  }
}

/**
 * 按 userId 发送推送：查库获取该用户所有设备的 PushToken，批量下发。
 *
 * 用户可能有多台设备（手机 + 平板）且跨平台（Android + iOS），全部遍历发送。
 * PushToken 表通过 userId 索引快速查找。不经过 RLS 事务（推送是用户级
 * 全局数据，不绑定工作区），直接用 prisma 查询。
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<void> {
  const tokens = await prisma.pushToken.findMany({
    where: { userId },
    select: { platform: true, token: true },
  });

  if (tokens.length === 0) {
    console.warn(`[push/user] 用户 ${userId} 无已注册推送 token，跳过`);
    return;
  }

  const targets: PushTarget[] = tokens.map((t) => ({
    platform: t.platform as PushPlatform,
    token: t.token,
    userId,
  }));

  await sendPushBatch(targets, payload);
}