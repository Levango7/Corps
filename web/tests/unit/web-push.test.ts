// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Web Push 封装契约（lib/web-push.ts）：
 *  - VAPID 配置惰性一次性（缺密钥时不调库、sendPush 返回 ok:false 而不是抛）
 *  - 410 Gone 判定：推送服务已删订阅 → gone:true（调用方据此删 DB 记录）
 *  - 失败不抛异常（cron 场景由调用方决定后续）
 *
 * 注意：模块在 import 时读取 VAPID_* 环境变量——每个用例先 stubEnv + resetModules
 * 再动态 import，拿到干净模块态（configured 缓存也是模块级）。
 */
const h = vi.hoisted(() => ({
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: h.setVapidDetails,
    sendNotification: h.sendNotification,
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: h.warn, info: vi.fn(), error: vi.fn() },
}));

const SUB = {
  endpoint: "https://push.example.com/abc",
  keys: { p256dh: "p", auth: "a" },
};

async function loadModule(env: Record<string, string> = {}) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return await import("@/lib/web-push");
}

beforeEach(() => {
  h.setVapidDetails.mockReset();
  h.sendNotification.mockReset();
  h.warn.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getVapidPublicKey", () => {
  it("返回环境变量里的公钥（未配置则空串）", async () => {
    const m1 = await loadModule({ VAPID_PUBLIC_KEY: "pub-key-123" });
    expect(m1.getVapidPublicKey()).toBe("pub-key-123");
    const m2 = await loadModule({});
    expect(m2.getVapidPublicKey()).toBe("");
  });
});

describe("sendPush", () => {
  it("成功：调 sendNotification（payload JSON + TTL 86400），返回 ok:true", async () => {
    h.sendNotification.mockResolvedValue({ statusCode: 201 });
    const m = await loadModule({
      VAPID_PUBLIC_KEY: "pub",
      VAPID_PRIVATE_KEY: "priv",
      VAPID_SUBJECT: "mailto:ops@corps.app",
    });
    const res = await m.sendPush(SUB, { title: "t", body: "b", url: "/x" });
    expect(res).toEqual({ ok: true });
    expect(h.setVapidDetails).toHaveBeenCalledWith("mailto:ops@corps.app", "pub", "priv");
    const [sentSub, payload, opts] = h.sendNotification.mock.calls[0];
    expect(sentSub).toEqual(SUB);
    expect(JSON.parse(payload)).toEqual({ title: "t", body: "b", url: "/x" });
    expect(opts).toEqual({ TTL: 86400 });
  });

  it("VAPID 未配置：返回 ok:false、不调库、不抛（ensureVapid 抛错被吞）", async () => {
    const m = await loadModule({ VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "" });
    const res = await m.sendPush(SUB, { title: "t", body: "b" });
    expect(res.ok).toBe(false);
    expect(res.gone).toBeFalsy();
    expect(h.sendNotification).not.toHaveBeenCalled();
    expect(h.warn).toHaveBeenCalled();
  });

  it("410 Gone：返回 gone:true（调用方应删除订阅记录）", async () => {
    h.sendNotification.mockRejectedValue(
      Object.assign(new Error("subscription gone"), { statusCode: 410 }),
    );
    const m = await loadModule({ VAPID_PUBLIC_KEY: "p", VAPID_PRIVATE_KEY: "s" });
    const res = await m.sendPush(SUB, { title: "t", body: "b" });
    expect(res).toEqual({ ok: false, gone: true });
    expect(h.warn).toHaveBeenCalledWith(
      "[web-push] sendPush failed",
      expect.objectContaining({ gone: true, statusCode: 410 }),
    );
  });

  it("其他错误（500）：ok:false 且 gone 非 true", async () => {
    h.sendNotification.mockRejectedValue(Object.assign(new Error("boom"), { statusCode: 500 }));
    const m = await loadModule({ VAPID_PUBLIC_KEY: "p", VAPID_PRIVATE_KEY: "s" });
    const res = await m.sendPush(SUB, { title: "t", body: "b" });
    expect(res.ok).toBe(false);
    expect(res.gone).toBe(false);
  });

  it("VAPID 配置只做一次（第二次发送不再调 setVapidDetails）", async () => {
    h.sendNotification.mockResolvedValue({ statusCode: 201 });
    const m = await loadModule({ VAPID_PUBLIC_KEY: "p", VAPID_PRIVATE_KEY: "s" });
    await m.sendPush(SUB, { title: "1", body: "b" });
    await m.sendPush(SUB, { title: "2", body: "b" });
    expect(h.setVapidDetails).toHaveBeenCalledTimes(1);
    expect(h.sendNotification).toHaveBeenCalledTimes(2);
  });
});
