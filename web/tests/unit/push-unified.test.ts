// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * 跨平台统一推送契约（lib/push/unified.ts）：
 *  - 环境变量未配置 → 各平台**静默跳过**（warn + 不发请求、不抛）——推送是尽力而为通道，
 *    配置缺失不得阻断业务流程（AI 推送调度/通知下发）
 *  - FCM（Legacy）：Authorization: key=...；**200 但 body 含 error 也要抛**（InvalidRegistration 等）
 *  - APNs：provider JWT 走 ES256 + 10 分钟有效期 + kid；priv key 的 \n 转义要还原；
 *    头 apns-topic/apns-priority:10；URL 带 device token
 *  - 华为 Push Kit：两步流程（OAuth2 client_credentials → messages:send）；
 *    缺 access_token 抛、非 2xx 抛、**code 非 "0" 抛**
 *  - sendPushBatch：单个 target 失败不中断（allSettled），汇总 console.error（不抛）
 *  - sendPushToUser：以目标用户身份 withGuc 查 PushToken（RLS 无 cron 逃生口）；无 token 跳过
 */
const h = vi.hoisted(() => ({
  jwtSign: vi.fn(),
  withGucQuery: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("jsonwebtoken", () => ({ default: { sign: h.jwtSign } }));
vi.mock("@/lib/auth", () => ({
  withGuc: vi.fn(async (_guc: unknown, fn: (tx: unknown) => unknown) =>
    fn({ pushToken: { findMany: h.withGucQuery } }),
  ),
}));

import { sendPush, sendPushBatch, sendPushToUser } from "@/lib/push/unified";

const fetchMock = vi.fn();
const okJson = (body: unknown = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const FCM_ENV = { FIREBASE_SERVER_KEY: "fcm-server-key-fixture" };
const APNS_ENV = {
  APNS_TEAM_ID: "TEAM123",
  APNS_KEY_ID: "KEY456",
  APNS_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nMOCK\\n-----END PRIVATE KEY-----",
  APNS_BUNDLE_ID: "app.corps.test",
};
const HW_ENV = { HUAWEI_APP_ID: "hw-app", HUAWEI_APP_SECRET: "hw-secret-fixture" };

const ALL_ENV_KEYS = [...Object.keys(FCM_ENV), ...Object.keys(APNS_ENV), ...Object.keys(HW_ENV)];

beforeEach(() => {
  fetchMock.mockReset();
  h.jwtSign.mockReset();
  h.jwtSign.mockReturnValue("provider.jwt.token");
  h.withGucQuery.mockReset();
  h.warn.mockReset();
  h.error.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  for (const k of ALL_ENV_KEYS) vi.stubEnv(k, "");
  vi.spyOn(console, "warn").mockImplementation(h.warn);
  vi.spyOn(console, "error").mockImplementation(h.error);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("未配置：静默跳过（不阻断业务流程）", () => {
  it("android 无 FIREBASE_SERVER_KEY：warn + 不发请求", async () => {
    await expect(
      sendPush({ platform: "android", token: "t1", userId: "u" }, { title: "a", body: "b" }),
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.warn).toHaveBeenCalledWith(expect.stringContaining("FIREBASE_SERVER_KEY 未配置"));
  });

  it("ios 缺任一 APNs 变量：warn + 不发请求、不签 JWT", async () => {
    vi.stubEnv("APNS_TEAM_ID", "T");
    await sendPush({ platform: "ios", token: "t", userId: "u" }, { title: "a", body: "b" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.jwtSign).not.toHaveBeenCalled();
    expect(h.warn).toHaveBeenCalledWith(expect.stringContaining("APNs"));
  });

  it("harmonyos 缺变量：warn + 不发请求", async () => {
    await sendPush({ platform: "harmonyos", token: "t", userId: "u" }, { title: "a", body: "b" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("未知平台：warn 跳过", async () => {
    await sendPush(
      { platform: "windows" as never, token: "t", userId: "u" },
      { title: "a", body: "b" },
    );
    expect(h.warn).toHaveBeenCalledWith(expect.stringContaining("未知平台"));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("FCM（Android Legacy API）", () => {
  beforeEach(() => {
    for (const [k, v] of Object.entries(FCM_ENV)) vi.stubEnv(k, v);
  });

  it("请求形态：key= 头 + high 优先级 + notification/data", async () => {
    fetchMock.mockResolvedValue(okJson({ success: 1 }));
    await sendPush(
      { platform: "android", token: "dev-token", userId: "u" },
      { title: "标题", body: "正文", badge: 3, data: { route: "/tasks" } },
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://fcm.googleapis.com/fcm/send");
    const req = init as RequestInit;
    expect(req.method).toBe("POST");
    expect((req.headers as Record<string, string>).Authorization).toBe(
      "key=fcm-server-key-fixture",
    );
    const body = JSON.parse(String(req.body));
    expect(body).toMatchObject({
      to: "dev-token",
      priority: "high",
      notification: { title: "标题", body: "正文", badge: 3 },
      data: { route: "/tasks" },
    });
  });

  it("非 2xx：抛含状态码与响应文本", async () => {
    fetchMock.mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    await expect(
      sendPush({ platform: "android", token: "t", userId: "u" }, { title: "a", body: "b" }),
    ).rejects.toThrow(/FCM 推送失败 \(401\): Unauthorized/);
  });

  it("HTTP 200 但 body 含 error（InvalidRegistration）：同样抛", async () => {
    fetchMock.mockResolvedValue(okJson({ error: "InvalidRegistration" }));
    await expect(
      sendPush({ platform: "android", token: "t", userId: "u" }, { title: "a", body: "b" }),
    ).rejects.toThrow(/FCM 推送失败: InvalidRegistration/);
  });
});

describe("APNs（iOS Provider API）", () => {
  beforeEach(() => {
    for (const [k, v] of Object.entries(APNS_ENV)) vi.stubEnv(k, v);
  });

  it("provider JWT：ES256 + 10m + issuer/kid；私钥 \\n 还原；头与 URL 正确", async () => {
    fetchMock.mockResolvedValue(okJson());
    await sendPush(
      { platform: "ios", token: "device-tok", userId: "u" },
      { title: "T", body: "B", badge: 5 },
    );
    // JWT 参数
    const [claims, key, opts] = h.jwtSign.mock.calls[0];
    expect(claims).toEqual({});
    expect(key).toContain("\n"); // 转义已还原
    expect(key).not.toContain("\\n");
    expect(opts).toMatchObject({
      algorithm: "ES256",
      expiresIn: "10m",
      issuer: "TEAM123",
      header: { alg: "ES256", kid: "KEY456", typ: "JWT" },
    });
    // 请求形态
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.push.apple.com/3/device/device-tok");
    const req = init as RequestInit;
    const headers = req.headers as Record<string, string>;
    expect(headers.Authorization).toBe("bearer provider.jwt.token");
    expect(headers["apns-topic"]).toBe("app.corps.test");
    expect(headers["apns-priority"]).toBe("10");
    const body = JSON.parse(String(req.body));
    expect(body.aps).toEqual({ alert: { title: "T", body: "B" }, badge: 5 });
  });

  it("无 badge 时不带 badge 字段；非 2xx 抛", async () => {
    fetchMock.mockResolvedValueOnce(okJson());
    await sendPush({ platform: "ios", token: "t", userId: "u" }, { title: "a", body: "b" });
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.aps).toEqual({ alert: { title: "a", body: "b" } });

    fetchMock.mockResolvedValueOnce(new Response("BadDeviceToken", { status: 400 }));
    await expect(
      sendPush({ platform: "ios", token: "t", userId: "u" }, { title: "a", body: "b" }),
    ).rejects.toThrow(/APNs 推送失败 \(400\): BadDeviceToken/);
  });
});

describe("华为 Push Kit（HarmonyOS）", () => {
  beforeEach(() => {
    for (const [k, v] of Object.entries(HW_ENV)) vi.stubEnv(k, v);
  });

  it("两步流程：OAuth2 client_credentials → messages:send（Bearer + code 0 通过）", async () => {
    fetchMock
      .mockResolvedValueOnce(okJson({ access_token: "hw-access" }))
      .mockResolvedValueOnce(okJson({ code: "0", msg: "Success" }));
    await sendPush(
      { platform: "harmonyos", token: "hw-tok", userId: "u" },
      { title: "T", body: "B", badge: 2, data: { k: "v" } },
    );
    // 第 1 步：OAuth
    const [oauthUrl, oauthInit] = fetchMock.mock.calls[0];
    expect(String(oauthUrl)).toBe("https://oauth-api.cloud.huawei.com/oauth2/v3/token");
    const oauthBody = new URLSearchParams(String((oauthInit as RequestInit).body));
    expect(oauthBody.get("grant_type")).toBe("client_credentials");
    expect(oauthBody.get("client_id")).toBe("hw-app");
    // 第 2 步：发送
    const [pushUrl, pushInit] = fetchMock.mock.calls[1];
    expect(String(pushUrl)).toBe("https://push-api.cloud.huawei.com/v1/hw-app/messages:send");
    const pushReq = pushInit as RequestInit;
    expect((pushReq.headers as Record<string, string>).Authorization).toBe("Bearer hw-access");
    const msg = JSON.parse(String(pushReq.body));
    expect(msg.message.token).toEqual(["hw-tok"]);
    expect(msg.message.data).toBe(JSON.stringify({ k: "v" }));
    expect(msg.message.android.notification.badge).toEqual({ addNum: 2 });
  });

  it("OAuth 未返回 access_token：抛；发送非 2xx：抛；code 非 0：抛", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ code: "x" }));
    await expect(
      sendPush({ platform: "harmonyos", token: "t", userId: "u" }, { title: "a", body: "b" }),
    ).rejects.toThrow(/缺少 access_token/);

    fetchMock
      .mockResolvedValueOnce(okJson({ access_token: "at" }))
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }));
    await expect(
      sendPush({ platform: "harmonyos", token: "t", userId: "u" }, { title: "a", body: "b" }),
    ).rejects.toThrow(/华为 Push Kit 推送失败 \(429\): rate limited/);

    fetchMock
      .mockResolvedValueOnce(okJson({ access_token: "at" }))
      .mockResolvedValueOnce(okJson({ code: "80000000", msg: "invalid token" }));
    await expect(
      sendPush({ platform: "harmonyos", token: "t", userId: "u" }, { title: "a", body: "b" }),
    ).rejects.toThrow(/华为 Push Kit 推送失败: invalid token/);
  });
});

describe("sendPushBatch：单点失败不中断", () => {
  it("空数组：直接返回", async () => {
    await expect(sendPushBatch([], { title: "a", body: "b" })).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("一个失败其余照发；汇总 console.error 但不抛（尽力而为通道）", async () => {
    for (const [k, v] of Object.entries(FCM_ENV)) vi.stubEnv(k, v);
    fetchMock
      .mockResolvedValueOnce(new Response("boom", { status: 500 })) // 第 1 个失败
      .mockResolvedValueOnce(okJson({ success: 1 })); // 第 2 个成功
    await expect(
      sendPushBatch(
        [
          { platform: "android", token: "bad-token-12345678", userId: "u" },
          { platform: "android", token: "good-token", userId: "u" },
        ],
        { title: "a", body: "b" },
      ),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(h.error).toHaveBeenCalledWith(
      "[push/batch] 部分推送失败:",
      expect.arrayContaining([expect.stringContaining("bad-tok")]),
    );
  });

  it("未配置平台在批量中按跳过错处理（不产生失败记录）", async () => {
    // 全部环境变量为空：三个 target 都静默跳过 → 无 error 汇总
    await sendPushBatch(
      [
        { platform: "android", token: "t1", userId: "u" },
        { platform: "ios", token: "t2", userId: "u" },
      ],
      { title: "a", body: "b" },
    );
    expect(h.error).not.toHaveBeenCalled();
  });
});

describe("sendPushToUser：按用户查 token 批量下发", () => {
  it("以目标用户身份 withGuc 查 PushToken；无 token 时 warn 跳过", async () => {
    h.withGucQuery.mockResolvedValueOnce([]);
    await sendPushToUser("user-1", { title: "a", body: "b" });
    expect(h.withGucQuery).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      select: { platform: true, token: true },
    });
    expect(h.warn).toHaveBeenCalledWith(expect.stringContaining("无已注册推送 token"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("多设备跨平台：逐台分发（android 走 FCM、ios 缺配置跳过）", async () => {
    for (const [k, v] of Object.entries(FCM_ENV)) vi.stubEnv(k, v);
    h.withGucQuery.mockResolvedValueOnce([
      { platform: "android", token: "a-tok" },
      { platform: "ios", token: "i-tok" },
    ]);
    await sendPushToUser("user-1", { title: "a", body: "b" });
    // 只有 android 真正发出请求（ios 缺 APNs 配置静默跳过）
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("fcm.googleapis.com");
  });
});
