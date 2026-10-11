import crypto from "node:crypto";
import Stripe from "stripe";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * 三通道 webhook 验签（PaymentProvider.parseWebhook）单元测试。
 *
 * 覆盖什么：
 *  - Stripe（stripe-provider.ts）：HMAC 验签 + checkout.session.completed 归一化
 *  - 支付宝（alipay-provider.ts）：RSA2（SHA256withRSA）验签 + passback_params 解析
 *  - 微信（wechat-provider.ts）：RSA-SHA256 回调验签（生产分支）+
 *    AES-256-GCM resource 解密 + attach 解析；另覆盖 HMAC 回退分支
 *
 * 不覆盖什么（以及为什么）：
 *  - 微信 HMAC-SHA256 回退之外的请求签名（buildAuthHeader / signRequest）：
 *    那是出站路径，本文件只测入站验签。
 *  - Stripe 的 customer.subscription.updated / invoice.* 归一化映射：
 *    映射逻辑无密钥参与，且无资金状态写入（subscription.synced 只同步），
 *    风险权重低于验签本身；若后续要补，属归一化单测而非验签单测。
 *  - 任何网络往返：所有密钥本地生成，签名本地计算，不拨外网。
 *
 * 为什么这样设计（关键取舍）：
 *  验签是支付路径上唯一"错了也不会立刻炸"的环节——验签被跳过/写弱时，
 *  合法流量照常通过，只有伪造流量也能通过时才暴露，而那时已经是资金事件。
 *  所以本文件**不 mock 任何验签函数**：签名全部用真实密钥经 node:crypto /
 *  stripe SDK 计算，负向用例全部走真实校验失败。mock 掉 crypto.verify 的
 *  测试只能证明"调用了函数"，证明不了"验签有效"。
 *
 *  另注：支付宝/微信的载荷构造并没有高到不可及（各是一次 RSA 签名 /
 *  一次 AES-GCM 加密），因此没有走"只测 Stripe"的降级路线，三通道全覆盖。
 */

// ─── 环境变量管理（provider 在模块顶层读 env，必须 import 前设置） ───

const STRIPE_KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_ID",
  "STRIPE_PRICE_ID_YEARLY",
] as const;
const ALIPAY_KEYS = ["ALIPAY_APP_ID", "ALIPAY_PRIVATE_KEY", "ALIPAY_PUBLIC_KEY"] as const;
const WECHAT_KEYS = [
  "WECHAT_APP_ID",
  "WECHAT_MCH_ID",
  "WECHAT_API_KEY",
  "WECHAT_CERT_SERIAL_NO",
  "WECHAT_PRIVATE_KEY_PEM",
  "WECHAT_PLATFORM_PUBLIC_KEY_PEM",
] as const;
const ALL_KEYS = [...STRIPE_KEYS, ...ALIPAY_KEYS, ...WECHAT_KEYS];

/** 文件加载时的环境快照：每个用例后恢复，防止污染同进程其他文件 */
const ENV_SNAPSHOT: Record<string, string | undefined> = {};
for (const key of ALL_KEYS) ENV_SNAPSHOT[key] = process.env[key];

/** 只动 keys 列表里的变量：未指定的键一律删除（模拟"未配置"） */
function applyEnv(env: Record<string, string | undefined>, keys: readonly string[]): void {
  for (const key of keys) {
    const value = env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeEach(() => {
  // 验签失败路径会 console.error/warn，静音避免污染测试输出（不断言它们）
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of ALL_KEYS) {
    const value = ENV_SNAPSHOT[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/**
 * 加载 StripeProvider。resetModules 后重新 import，provider 才会读到本轮 env。
 * 错误类必须从**同一轮**模块注册表取：resetModules 会重新求值 types.ts，
 * 静态 import 的错误类与新加载的 provider 抛出的类不是同一个 identity，
 * instanceof 会假阴性。
 */
async function loadStripeProvider(env: Record<string, string | undefined>) {
  vi.resetModules();
  applyEnv(env, STRIPE_KEYS);
  const mod = await import("@/lib/payments/stripe-provider");
  const types = await import("@/lib/payments/types");
  return {
    provider: new mod.StripeProvider(),
    PaymentWebhookError: types.PaymentWebhookError,
    PaymentProviderError: types.PaymentProviderError,
  };
}

async function loadAlipayProvider(env: Record<string, string | undefined>) {
  vi.resetModules();
  applyEnv(env, ALIPAY_KEYS);
  const mod = await import("@/lib/payments/alipay-provider");
  const types = await import("@/lib/payments/types");
  return {
    provider: new mod.AlipayPageProvider(),
    PaymentWebhookError: types.PaymentWebhookError,
    PaymentProviderError: types.PaymentProviderError,
  };
}

async function loadWechatProvider(env: Record<string, string | undefined>) {
  vi.resetModules();
  applyEnv(env, WECHAT_KEYS);
  const mod = await import("@/lib/payments/wechat-provider");
  const types = await import("@/lib/payments/types");
  return {
    provider: new mod.WeChatPayNativeProvider(),
    PaymentWebhookError: types.PaymentWebhookError,
    PaymentProviderError: types.PaymentProviderError,
  };
}

const NO_ERROR = Symbol("capture-error-no-error");

/** 捕获异步错误；未抛错时返回 NO_ERROR 哨兵（不能用 undefined，会与抛 undefined 混淆） */
async function captureError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return NO_ERROR;
  } catch (err) {
    return err;
  }
}

/** 本地生成 RSA 密钥对（PKCS8 私钥 / SPKI 公钥，均为 PEM 字符串） */
function makeRsaKeyPair(): { privateKey: string; publicKey: string } {
  return crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
}

// ─── Stripe ───

const STRIPE_WEBHOOK_SECRET = "whsec_unit_test_secret_0123456789abcdef";

function stripeCheckoutPayload(options: { mode?: string; withMetadata?: boolean } = {}): string {
  const mode = options.mode ?? "subscription";
  const withMetadata = options.withMetadata ?? true;
  return JSON.stringify({
    id: "evt_stripe_checkout_1",
    object: "event",
    api_version: "2026-08-26.dahlia",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_1",
        object: "checkout.session",
        mode,
        customer: "cus_test_1",
        subscription: "sub_test_1",
        ...(withMetadata
          ? { metadata: { workspaceId: "ws_stripe_1", seats: "5", period: "monthly" } }
          : {}),
      },
    },
  });
}

/** 用 stripe SDK 自带的测试头生成器算真签名（v22 仍导出该 API） */
function signStripePayload(payload: string, secret = STRIPE_WEBHOOK_SECRET): string {
  return Stripe.webhooks.generateTestHeaderString({ payload, secret });
}

describe("StripeProvider.parseWebhook · 验签与归一化", () => {
  it("合法签名被接受，且归一化为 UnifiedBillingEvent（字段映射逐个断言）", async () => {
    // 防的回归：验签通过但归一化映射错位——seats 读成 quantity、
    // subscription 写成 session.id、period 丢失——任何一种都会让
    // 订阅按错误席位数/错误周期激活，且验签层完全看不出来。
    const payload = stripeCheckoutPayload();
    const sig = signStripePayload(payload);
    const { provider } = await loadStripeProvider({
      STRIPE_SECRET_KEY: "sk_test_unit_dummy",
      STRIPE_WEBHOOK_SECRET: STRIPE_WEBHOOK_SECRET,
    });

    const event = await provider.parseWebhook(payload, { "stripe-signature": sig });

    expect(event).toEqual({
      type: "checkout.completed",
      providerEventId: "evt_stripe_checkout_1",
      workspaceId: "ws_stripe_1",
      providerCustomerId: "cus_test_1",
      providerOrderId: "sub_test_1",
      seats: 5,
      period: "monthly",
    });
  });

  it("payload 改一个字节 → 拒收（PaymentWebhookError）", async () => {
    // 防的回归：验签被"临时"跳过（try/catch 吞掉、或只校验 header 存在）。
    // 这是本文件的核心红线：改签内容必须失败，否则任何人都能伪造
    // checkout.session.completed 给任意工作区开订阅。
    const payload = stripeCheckoutPayload();
    const sig = signStripePayload(payload);
    const tampered = payload.replace('"seats":"5"', '"seats":"6"');
    expect(tampered).not.toBe(payload); // 防替换静默失效（源串不存在时 replace 原样返回）

    const { provider, PaymentWebhookError } = await loadStripeProvider({
      STRIPE_SECRET_KEY: "sk_test_unit_dummy",
      STRIPE_WEBHOOK_SECRET: STRIPE_WEBHOOK_SECRET,
    });

    const err = await captureError(() =>
      provider.parseWebhook(tampered, { "stripe-signature": sig }),
    );
    expect(err).toBeInstanceOf(PaymentWebhookError);
  });

  it("签名尾部改一个字符 → 拒收", async () => {
    // 防的回归：与上一条互补——payload 没动但签名被截断/篡改
    // （重放攻击的常见形态：抓包改签）。
    const payload = stripeCheckoutPayload();
    const sig = signStripePayload(payload);
    const tamperedSig = `${sig.slice(0, -1)}${sig.slice(-1) === "a" ? "b" : "a"}`;
    expect(tamperedSig).not.toBe(sig);

    const { provider, PaymentWebhookError } = await loadStripeProvider({
      STRIPE_SECRET_KEY: "sk_test_unit_dummy",
      STRIPE_WEBHOOK_SECRET: STRIPE_WEBHOOK_SECRET,
    });

    const err = await captureError(() =>
      provider.parseWebhook(payload, { "stripe-signature": tamperedSig }),
    );
    expect(err).toBeInstanceOf(PaymentWebhookError);
  });

  it("用另一个 secret 签名 → 拒收（密钥不匹配）", async () => {
    // 防的回归：secret 轮换后旧 secret 仍被接受 / 硬编码了测试 secret。
    // 多密钥并存期（轮换窗口）这是唯一能发现"认错钥匙"的测试。
    const payload = stripeCheckoutPayload();
    const sig = signStripePayload(payload, "whsec_rotated_old_secret_fedcba9876543210");

    const { provider, PaymentWebhookError } = await loadStripeProvider({
      STRIPE_SECRET_KEY: "sk_test_unit_dummy",
      STRIPE_WEBHOOK_SECRET: STRIPE_WEBHOOK_SECRET,
    });

    const err = await captureError(() =>
      provider.parseWebhook(payload, { "stripe-signature": sig }),
    );
    expect(err).toBeInstanceOf(PaymentWebhookError);
  });

  it("缺 stripe-signature header → 拒收（不等同于验签失败，同样必须拒）", async () => {
    // 防的回归：header 缺失被当成"无签名豁免"放行。
    // 路由层 headers.get() 取不到时传的是 {}，本用例对齐真实调用形态。
    const { provider, PaymentWebhookError } = await loadStripeProvider({
      STRIPE_SECRET_KEY: "sk_test_unit_dummy",
      STRIPE_WEBHOOK_SECRET: STRIPE_WEBHOOK_SECRET,
    });

    const err = await captureError(() => provider.parseWebhook(stripeCheckoutPayload(), {}));
    expect(err).toBeInstanceOf(PaymentWebhookError);
  });

  it("STRIPE_WEBHOOK_SECRET 未配置 → not_configured（路由层据此 500 拒收）", async () => {
    // 防的回归：secret 缺失时静默放行（"没配就不验"）——部署漏配一个环境变量
    // 就等于把 webhook 验证整个关掉，且没有任何报错。路由层依赖 code 区分
    // 400（验签失败）/ 500（未配置），所以这里连 code 一起钉死。
    const { provider, PaymentProviderError } = await loadStripeProvider({
      STRIPE_SECRET_KEY: "sk_test_unit_dummy",
    });

    const err = await captureError(() =>
      provider.parseWebhook(stripeCheckoutPayload(), { "stripe-signature": "t=1,v1=x" }),
    );
    expect(err).toBeInstanceOf(PaymentProviderError);
    expect((err as { code?: string }).code).toBe("not_configured");
  });

  it("mode=payment 的一次性 checkout session → 返回 null（忽略，不激活）", async () => {
    // 防的回归（行为保全清单第 6 条）：mode 检查被删 → 一次性支付被当成
    // 订阅激活，工作区被按"订阅"升级但通道侧根本没有周期订阅，
    // 到期不降级、续费不同步，财务口径直接错乱。
    const payload = stripeCheckoutPayload({ mode: "payment" });
    const sig = signStripePayload(payload);
    const { provider } = await loadStripeProvider({
      STRIPE_SECRET_KEY: "sk_test_unit_dummy",
      STRIPE_WEBHOOK_SECRET: STRIPE_WEBHOOK_SECRET,
    });

    const event = await provider.parseWebhook(payload, { "stripe-signature": sig });

    expect(event).toBeNull();
  });

  it("subscription 模式但缺 workspaceId metadata → 返回 null（拒绝无主激活）", async () => {
    // 防的回归：metadata 缺失时用占位 wid 继续落库 → 订阅挂到不存在的工作区。
    // 注意本用例签名是合法的：防的是"验签通过后跳过业务必填校验"这类半吊子修复。
    const payload = stripeCheckoutPayload({ withMetadata: false });
    const sig = signStripePayload(payload);
    const { provider } = await loadStripeProvider({
      STRIPE_SECRET_KEY: "sk_test_unit_dummy",
      STRIPE_WEBHOOK_SECRET: STRIPE_WEBHOOK_SECRET,
    });

    const event = await provider.parseWebhook(payload, { "stripe-signature": sig });

    expect(event).toBeNull();
  });
});

// ─── 支付宝 ───

const ALIPAY_APP_ID = "2021000111112222";

/** 对齐 alipay-provider 的 buildSignContent：非空参数按 key 字典序拼接（不含 sign/sign_type） */
function alipaySignContent(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((k) => k !== "sign" && k !== "sign_type" && params[k] !== undefined && params[k] !== "")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
}

function rsa2SignBase64(data: string, privateKeyPem: string): string {
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(data, "utf8");
  return signer.sign(privateKeyPem, "base64");
}

function makeAlipayParams(): Record<string, string> {
  return {
    app_id: ALIPAY_APP_ID,
    notify_id: "notify_alipay_1",
    out_trade_no: "corps_1700000000_abcdef",
    trade_status: "TRADE_SUCCESS",
    total_amount: "29.90",
    buyer_user_id: "2088102112223333",
    passback_params: encodeURIComponent("ws_alipay_1|3|yearly"),
    sign_type: "RSA2",
  };
}

describe("AlipayPageProvider.parseWebhook · RSA2 验签", () => {
  it("合法 RSA2 签名被接受，passback_params 正确还原业务上下文", async () => {
    // 防的回归：验签算法从 RSA2 退成 MD5/RSA（支付宝旧接口）/ 验签被跳过；
    // 以及 passback_params 解析错位（seats/period 取错字段 → 错误席位数激活）。
    const { privateKey, publicKey } = makeRsaKeyPair();
    const { provider } = await loadAlipayProvider({
      ALIPAY_APP_ID,
      ALIPAY_PRIVATE_KEY: privateKey,
      ALIPAY_PUBLIC_KEY: publicKey,
    });

    const params = makeAlipayParams();
    const signed = { ...params, sign: rsa2SignBase64(alipaySignContent(params), privateKey) };
    const rawBody = new URLSearchParams(signed).toString();

    const event = await provider.parseWebhook(rawBody, {});

    expect(event).toEqual({
      type: "checkout.completed",
      providerEventId: "notify_alipay_1",
      workspaceId: "ws_alipay_1",
      providerCustomerId: "2088102112223333",
      providerOrderId: "corps_1700000000_abcdef",
      seats: 3,
      period: "yearly",
    });
  });

  it("签名后篡改金额 → 拒收（PaymentWebhookError）", async () => {
    // 防的回归：只验"签名存在"不验"签名有效"。金额是回调里最诱人的篡改点
    // （改 total_amount 不影响我们落库，但说明验签形同虚设）。
    const { privateKey, publicKey } = makeRsaKeyPair();
    const { provider, PaymentWebhookError } = await loadAlipayProvider({
      ALIPAY_APP_ID,
      ALIPAY_PRIVATE_KEY: privateKey,
      ALIPAY_PUBLIC_KEY: publicKey,
    });

    const params = makeAlipayParams();
    const signed = { ...params, sign: rsa2SignBase64(alipaySignContent(params), privateKey) };
    const tampered = new URLSearchParams({ ...signed, total_amount: "0.01" }).toString();

    const err = await captureError(() => provider.parseWebhook(tampered, {}));
    expect(err).toBeInstanceOf(PaymentWebhookError);
  });

  it("缺 sign 参数 → 拒收", async () => {
    // 防的回归：sign/sign_type 缺失被当成"无需验签"放行。
    const { privateKey, publicKey } = makeRsaKeyPair();
    const { provider, PaymentWebhookError } = await loadAlipayProvider({
      ALIPAY_APP_ID,
      ALIPAY_PRIVATE_KEY: privateKey,
      ALIPAY_PUBLIC_KEY: publicKey,
    });

    const err = await captureError(() =>
      provider.parseWebhook(new URLSearchParams(makeAlipayParams()).toString(), {}),
    );
    expect(err).toBeInstanceOf(PaymentWebhookError);
  });

  it("ALIPAY_PUBLIC_KEY 未配置 → not_configured（拒绝无公钥验签）", async () => {
    // 防的回归：公钥缺失时跳过验签直接信任报文。部署漏配 = 验签关闭，
    // 与 Stripe secret 缺失同理，必须显式失败。
    const { privateKey } = makeRsaKeyPair();
    const { provider, PaymentProviderError } = await loadAlipayProvider({
      ALIPAY_APP_ID,
      ALIPAY_PRIVATE_KEY: privateKey,
    });

    const err = await captureError(() =>
      provider.parseWebhook(new URLSearchParams(makeAlipayParams()).toString(), {}),
    );
    expect(err).toBeInstanceOf(PaymentProviderError);
    expect((err as { code?: string }).code).toBe("not_configured");
  });

  it("非成功交易状态（WAIT_BUYER_PAY）→ 返回 null（不激活）", async () => {
    // 防的回归：trade_status 检查被删 → 未支付/关闭的订单也激活订阅。
    // 签名合法，防的是"验签通过后跳过状态校验"。
    const { privateKey, publicKey } = makeRsaKeyPair();
    const { provider } = await loadAlipayProvider({
      ALIPAY_APP_ID,
      ALIPAY_PRIVATE_KEY: privateKey,
      ALIPAY_PUBLIC_KEY: publicKey,
    });

    const params = { ...makeAlipayParams(), trade_status: "WAIT_BUYER_PAY" };
    const signed = { ...params, sign: rsa2SignBase64(alipaySignContent(params), privateKey) };

    const event = await provider.parseWebhook(new URLSearchParams(signed).toString(), {});

    expect(event).toBeNull();
  });
});

// ─── 微信 ───

const WECHAT_MCH_ID = "1600000000";
/** APIv3 密钥必须恰好 32 字节（AES-256-GCM 密钥长度硬约束） */
const WECHAT_API_KEY = "0123456789abcdef0123456789abcdef";
/** GCM 推荐 12 字节 IV */
const WECHAT_RESOURCE_NONCE = "abcdefghijkl";
const WECHAT_AAD = "transaction";

function encryptWechatResource(plaintext: string): string {
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    Buffer.from(WECHAT_API_KEY, "utf8"),
    Buffer.from(WECHAT_RESOURCE_NONCE, "utf8"),
  );
  cipher.setAAD(Buffer.from(WECHAT_AAD, "utf8"));
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([encrypted, cipher.getAuthTag()]).toString("base64");
}

function makeWechatEnvelope(options: { tradeState?: string; eventType?: string } = {}) {
  const payResult = {
    out_trade_no: "corps_wx_1700000000_112233",
    transaction_id: "4200000001",
    trade_state: options.tradeState ?? "SUCCESS",
    mchid: WECHAT_MCH_ID,
    attach: "ws_wechat_1|2|yearly",
  };
  return JSON.stringify({
    id: "evt_wechat_1",
    create_time: "2026-01-01T00:00:00+08:00",
    event_type: options.eventType ?? "pay.success",
    resource_type: "encrypt-resource",
    resource: {
      original_type: "transaction",
      algorithm: "AEAD_AES_256_GCM",
      ciphertext: encryptWechatResource(JSON.stringify(payResult)),
      nonce: WECHAT_RESOURCE_NONCE,
      associated_data: WECHAT_AAD,
    },
  });
}

/** 微信 V3 回调签名串：timestamp\nnonce\nbody\n */
function wechatSignString(rawBody: string, timestamp: string, nonce: string): string {
  return `${timestamp}\n${nonce}\n${rawBody}\n`;
}

function rsaSignWechat(data: string, privateKeyPem: string): string {
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(data, "utf8");
  return signer.sign(privateKeyPem, "base64");
}

function hmacSignWechat(data: string): string {
  return crypto.createHmac("sha256", WECHAT_API_KEY).update(data, "utf8").digest("base64");
}

const WECHAT_TIMESTAMP = "1767225600";
const WECHAT_HEADER_NONCE = "header-nonce-unit-1";

describe("WeChatPayNativeProvider.parseWebhook · RSA 验签 + AES-256-GCM 解密", () => {
  it("合法 RSA-SHA256 签名 + 可解密 resource → 归一化为 checkout.completed", async () => {
    // 防的回归：① 回调验签从 RSA 退成 HMAC 或被跳过；② AES-GCM 解密参数
    // （key/nonce/aad）错位导致永远解不开；③ attach 解析错位。
    // 这是微信通道的资金入口：扫码成功后唯一定向激活的路径。
    const { privateKey, publicKey } = makeRsaKeyPair();
    const { provider } = await loadWechatProvider({
      WECHAT_APP_ID: "wx1111111111",
      WECHAT_MCH_ID,
      WECHAT_API_KEY,
      WECHAT_CERT_SERIAL_NO: "serial_unit_1",
      WECHAT_PLATFORM_PUBLIC_KEY_PEM: publicKey,
    });

    const rawBody = makeWechatEnvelope();
    const signature = rsaSignWechat(
      wechatSignString(rawBody, WECHAT_TIMESTAMP, WECHAT_HEADER_NONCE),
      privateKey,
    );

    const event = await provider.parseWebhook(rawBody, {
      "wechatpay-timestamp": WECHAT_TIMESTAMP,
      "wechatpay-nonce": WECHAT_HEADER_NONCE,
      "wechatpay-signature": signature,
    });

    expect(event).toEqual({
      type: "checkout.completed",
      providerEventId: "evt_wechat_1",
      workspaceId: "ws_wechat_1",
      providerCustomerId: WECHAT_MCH_ID,
      providerOrderId: "corps_wx_1700000000_112233",
      seats: 2,
      period: "yearly",
    });
  });

  it("签名用另一把私钥 → 拒收（PaymentWebhookError）", async () => {
    // 防的回归：验签只解析不校验 / 公钥写死。伪造回调 = 免费开订阅。
    const { publicKey } = makeRsaKeyPair();
    const { privateKey: attackerKey } = makeRsaKeyPair();
    const { provider, PaymentWebhookError } = await loadWechatProvider({
      WECHAT_APP_ID: "wx1111111111",
      WECHAT_MCH_ID,
      WECHAT_API_KEY,
      WECHAT_CERT_SERIAL_NO: "serial_unit_1",
      WECHAT_PLATFORM_PUBLIC_KEY_PEM: publicKey,
    });

    const rawBody = makeWechatEnvelope();
    const signature = rsaSignWechat(
      wechatSignString(rawBody, WECHAT_TIMESTAMP, WECHAT_HEADER_NONCE),
      attackerKey,
    );

    const err = await captureError(() =>
      provider.parseWebhook(rawBody, {
        "wechatpay-timestamp": WECHAT_TIMESTAMP,
        "wechatpay-nonce": WECHAT_HEADER_NONCE,
        "wechatpay-signature": signature,
      }),
    );
    expect(err).toBeInstanceOf(PaymentWebhookError);
  });

  it("缺验签三件套任一 header → 拒收", async () => {
    // 防的回归：header 缺失被当成"免验签通道"。微信 V3 三件套
    // （timestamp/nonce/signature）缺一即拒，与 Stripe 缺 header 同构。
    const { publicKey } = makeRsaKeyPair();
    const { provider, PaymentWebhookError } = await loadWechatProvider({
      WECHAT_APP_ID: "wx1111111111",
      WECHAT_MCH_ID,
      WECHAT_API_KEY,
      WECHAT_CERT_SERIAL_NO: "serial_unit_1",
      WECHAT_PLATFORM_PUBLIC_KEY_PEM: publicKey,
    });

    const err = await captureError(() =>
      provider.parseWebhook(makeWechatEnvelope(), {
        "wechatpay-timestamp": WECHAT_TIMESTAMP,
        "wechatpay-nonce": WECHAT_HEADER_NONCE,
        // 缺 wechatpay-signature
      }),
    );
    expect(err).toBeInstanceOf(PaymentWebhookError);
  });

  it("签名合法但 ciphertext 被篡改 → 拒收（GCM 认证失败）", async () => {
    // 防的回归：解密失败被 try/catch 吞成"跳过该事件"放行 200。
    // 注意本用例对**篡改后**的 body 重新签名——隔离出解密层失败，
    // 证明拒收不是因为验签，而是 GCM authTag 真的在起作用。
    const { privateKey, publicKey } = makeRsaKeyPair();
    const { provider, PaymentWebhookError } = await loadWechatProvider({
      WECHAT_APP_ID: "wx1111111111",
      WECHAT_MCH_ID,
      WECHAT_API_KEY,
      WECHAT_CERT_SERIAL_NO: "serial_unit_1",
      WECHAT_PLATFORM_PUBLIC_KEY_PEM: publicKey,
    });

    const envelope = JSON.parse(makeWechatEnvelope()) as {
      resource: { ciphertext: string };
    };
    const chars = envelope.resource.ciphertext.split("");
    chars[0] = chars[0] === "A" ? "B" : "A";
    envelope.resource.ciphertext = chars.join("");
    const tamperedBody = JSON.stringify(envelope);
    const signature = rsaSignWechat(
      wechatSignString(tamperedBody, WECHAT_TIMESTAMP, WECHAT_HEADER_NONCE),
      privateKey,
    );

    const err = await captureError(() =>
      provider.parseWebhook(tamperedBody, {
        "wechatpay-timestamp": WECHAT_TIMESTAMP,
        "wechatpay-nonce": WECHAT_HEADER_NONCE,
        "wechatpay-signature": signature,
      }),
    );
    expect(err).toBeInstanceOf(PaymentWebhookError);
  });

  it("非 SUCCESS 交易状态 → 返回 null（不激活）", async () => {
    // 防的回归：trade_state 检查被删 → 关闭/退款的订单也激活订阅。
    const { privateKey, publicKey } = makeRsaKeyPair();
    const { provider } = await loadWechatProvider({
      WECHAT_APP_ID: "wx1111111111",
      WECHAT_MCH_ID,
      WECHAT_API_KEY,
      WECHAT_CERT_SERIAL_NO: "serial_unit_1",
      WECHAT_PLATFORM_PUBLIC_KEY_PEM: publicKey,
    });

    const rawBody = makeWechatEnvelope({ tradeState: "CLOSED" });
    const signature = rsaSignWechat(
      wechatSignString(rawBody, WECHAT_TIMESTAMP, WECHAT_HEADER_NONCE),
      privateKey,
    );

    const event = await provider.parseWebhook(rawBody, {
      "wechatpay-timestamp": WECHAT_TIMESTAMP,
      "wechatpay-nonce": WECHAT_HEADER_NONCE,
      "wechatpay-signature": signature,
    });

    expect(event).toBeNull();
  });

  it("非支付成功事件类型 → 返回 null（退款等通知不触发激活）", async () => {
    // 防的回归：event_type 白名单被删 → 退款通知也走进激活分支。
    // 该分支在解密之前，载荷无需真实加密内容。
    const { privateKey, publicKey } = makeRsaKeyPair();
    const { provider } = await loadWechatProvider({
      WECHAT_APP_ID: "wx1111111111",
      WECHAT_MCH_ID,
      WECHAT_API_KEY,
      WECHAT_CERT_SERIAL_NO: "serial_unit_1",
      WECHAT_PLATFORM_PUBLIC_KEY_PEM: publicKey,
    });

    const rawBody = makeWechatEnvelope({ eventType: "refund.success" });
    const signature = rsaSignWechat(
      wechatSignString(rawBody, WECHAT_TIMESTAMP, WECHAT_HEADER_NONCE),
      privateKey,
    );

    const event = await provider.parseWebhook(rawBody, {
      "wechatpay-timestamp": WECHAT_TIMESTAMP,
      "wechatpay-nonce": WECHAT_HEADER_NONCE,
      "wechatpay-signature": signature,
    });

    expect(event).toBeNull();
  });

  it("HMAC 回退分支（未配平台公钥的沙箱路径）：合法 HMAC 签名被接受", async () => {
    // 防的回归：HMAC 回退被误删导致沙箱/联调环境全拒；或被反向"修成"
    // 生产也可回退（verifyCallback 里 NODE_ENV=production 时直接抛错拒收，
    // 那条 production 红线不在本单测覆盖——它依赖 NODE_ENV 判定）。
    const { provider } = await loadWechatProvider({
      WECHAT_APP_ID: "wx1111111111",
      WECHAT_MCH_ID,
      WECHAT_API_KEY,
      WECHAT_CERT_SERIAL_NO: "serial_unit_1",
    });

    const rawBody = makeWechatEnvelope();
    const signature = hmacSignWechat(
      wechatSignString(rawBody, WECHAT_TIMESTAMP, WECHAT_HEADER_NONCE),
    );

    const event = await provider.parseWebhook(rawBody, {
      "wechatpay-timestamp": WECHAT_TIMESTAMP,
      "wechatpay-nonce": WECHAT_HEADER_NONCE,
      "wechatpay-signature": signature,
    });

    expect(event).toEqual(
      expect.objectContaining({ type: "checkout.completed", workspaceId: "ws_wechat_1" }),
    );
  });

  it("微信配置不完整 → not_configured（拒收而非放行）", async () => {
    // 防的回归：requireConfig 被绕过 → 未配置商户号时用占位值继续处理。
    const { provider, PaymentProviderError } = await loadWechatProvider({
      WECHAT_MCH_ID,
      WECHAT_API_KEY,
      WECHAT_CERT_SERIAL_NO: "serial_unit_1",
      // 缺 WECHAT_APP_ID
    });

    const err = await captureError(() =>
      provider.parseWebhook(makeWechatEnvelope(), {
        "wechatpay-timestamp": WECHAT_TIMESTAMP,
        "wechatpay-nonce": WECHAT_HEADER_NONCE,
        "wechatpay-signature": "x",
      }),
    );
    expect(err).toBeInstanceOf(PaymentProviderError);
    expect((err as { code?: string }).code).toBe("not_configured");
  });
});
