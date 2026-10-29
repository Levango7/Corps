// @vitest-environment node
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  getPaymentProvider,
  getPaymentProviderSafe,
  __resetPaymentProviderForTests,
  StripeProvider,
  WeChatPayNativeProvider,
  AlipayPageProvider,
} from "@/lib/payments/index";

/**
 * 支付通道注册表（lib/payments/index.ts）的契约测试。
 *
 * 注册表是多通道支付（stripe / wechatpay-native / alipay-page）的唯一入口，
 * 两个出口的语义差是行为契约而非实现细节：
 *  - getPaymentProvider：fail fast，未知通道/非法配置直接抛错——
 *    防止拼写错误静默落到错误通道（例如把 alipay-page 写成 alipay）。
 *  - getPaymentProviderSafe：status 路由用，配置不就绪返回 null——
 *    前端据此隐藏升级入口，**不能**因支付未配置而把状态接口打挂。
 * 另外单例缓存是进程级共享状态，每个用例必须重置，否则用例间互相污染。
 */

const ORIG_PAYMENT_PROVIDER = process.env.PAYMENT_PROVIDER;

beforeEach(() => {
  __resetPaymentProviderForTests();
  delete process.env.PAYMENT_PROVIDER;
});

afterEach(() => {
  if (ORIG_PAYMENT_PROVIDER === undefined) delete process.env.PAYMENT_PROVIDER;
  else process.env.PAYMENT_PROVIDER = ORIG_PAYMENT_PROVIDER;
});

describe("getPaymentProvider 默认与显式通道", () => {
  it("缺省落 stripe", () => {
    expect(getPaymentProvider()).toBeInstanceOf(StripeProvider);
  });

  it("显式指定三种已注册通道", () => {
    expect(getPaymentProvider("stripe")).toBeInstanceOf(StripeProvider);
    expect(getPaymentProvider("wechatpay-native")).toBeInstanceOf(WeChatPayNativeProvider);
    expect(getPaymentProvider("alipay-page")).toBeInstanceOf(AlipayPageProvider);
  });

  it("同一通道复用同一实例（进程级单例缓存）", () => {
    const a = getPaymentProvider("alipay-page");
    const b = getPaymentProvider("alipay-page");
    expect(a).toBe(b);
  });

  it("__resetPaymentProviderForTests 清空缓存后取到新实例", () => {
    const a = getPaymentProvider("alipay-page");
    __resetPaymentProviderForTests();
    const b = getPaymentProvider("alipay-page");
    expect(a).not.toBe(b);
  });

  it("未知通道 fail fast，且错误信息列出已注册通道防拼写错误", () => {
    expect(() => getPaymentProvider("alipay" as never)).toThrow(/未知支付通道/);
    try {
      getPaymentProvider("alipay" as never);
    } catch (e) {
      expect((e as Error).message).toContain("alipay-page");
    }
  });
});

describe("readConfiguredProviderId 环境变量解析", () => {
  it("PAYMENT_PROVIDER 合法值覆盖默认通道", () => {
    process.env.PAYMENT_PROVIDER = "wechatpay-native";
    expect(getPaymentProvider()).toBeInstanceOf(WeChatPayNativeProvider);
  });

  it("PAYMENT_PROVIDER 非法值抛错且错误信息回显原值", () => {
    process.env.PAYMENT_PROVIDER = "paypal";
    expect(() => getPaymentProvider()).toThrow(/PAYMENT_PROVIDER 配置非法.*paypal/);
  });

  it("PAYMENT_PROVIDER 仅空白时回落默认通道", () => {
    process.env.PAYMENT_PROVIDER = "   ";
    expect(getPaymentProvider()).toBeInstanceOf(StripeProvider);
  });
});

describe("getPaymentProviderSafe 宽松出口", () => {
  it("未知通道时返回 null 而非抛错", () => {
    expect(getPaymentProviderSafe("nope" as never)).toBeNull();
  });

  it("通道构造成功但未配置（缺 secret/价格）时返回 null", () => {
    // 测试环境无 STRIPE_SECRET_KEY / STRIPE_PRICE_ID：isConfigured=false
    // 对应 status 路由的 stripeReady=false 分支（前端隐藏升级入口）
    expect(getPaymentProviderSafe("stripe")).toBeNull();
  });

  it("通道就绪时 Safe 出口返回实例", async () => {
    // stripe-provider 在模块级捕获 secret/价格，须在重新求值前 stub 环境
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_provider_safe");
    vi.stubEnv("STRIPE_PRICE_ID", "price_test_provider_safe");
    vi.resetModules();
    const mod = await import("@/lib/payments/index");
    try {
      expect(mod.getPaymentProviderSafe("stripe")).toBeInstanceOf(
        (await import("@/lib/payments/index")).StripeProvider,
      );
    } finally {
      vi.unstubAllEnvs();
      mod.__resetPaymentProviderForTests();
      vi.resetModules();
      // 恢复未配置环境的模块实例，避免污染同文件后续导入
      await import("@/lib/payments/index");
    }
  });
});
