import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Stripe API 版本必须被**显式钉住**，不能吃 SDK 默认值。
 *
 * 为什么要这条测试（而不是靠代码评审记住）：
 *
 * `stripe-provider.ts` 的构造函数里写了 `apiVersion: "2025-06-30.basil"`。
 * TS 类型 `StripeConfig.apiVersion` 是**单字面量**（本版 LatestApiVersion 就是这个值），
 * 所以升级 SDK 时改错版本会 tsc 失败——这一层已经拦住"改错"。
 *
 * 但拦不住"**删掉**"：删掉整行，tsc 照样通过，运行时静默回落到 SDK 默认值。
 * 而 SDK 默认值会随升级变化，于是"删掉一行"就等于"悄悄换掉生产请求头里的
 * Stripe-Version"，且只在上线后暴露。所以这里用 mock 捕获**构造参数本身**，
 * 断言该键存在——删掉即红。
 *
 * 换句话说，这是一条**能被变异证明的断言**：
 *   把 `apiVersion: "2025-06-30.basil",` 整行删掉 → 本用例失败。
 *   把它改成任意其它字符串            → tsc 失败（类型层）+ 本用例失败（值层）。
 *
 * ── 一条刻意不写的断言 ──────────────────────────────────────────
 * 直觉上会想再补一条 `expect(钉值).toBe(SDK.ApiVersion)`，但那是错的。
 * 钉版的全部意义就是让"钉值"可以合法地落后于 SDK 默认值：升级 SDK 时我们
 * 往往要**故意**留在旧 API 版本，直到有人逐条核对
 * https://stripe.com/docs/upgrades 的破坏性变更再追平。写成等式断言，升级就会以
 * "测试红了"的方式逼着人立刻追平——正好抹掉了这道护栏想保留的"显式决策"环节。
 *
 * 分工因此是：**类型层负责"该决策了"**（SDK 把 LatestApiVersion 改成另一个字面量时
 * tsc 先失败），**本文件负责"别把钉子悄悄拔掉"**。
 */

const captured = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("stripe", () => {
  // 只记录构造入参，不发任何网络请求
  class FakeStripe {
    constructor(_key: string, config: Record<string, unknown>) {
      captured.push(config);
    }
  }
  return { default: FakeStripe };
});

/** stripe-provider 的 client 是 private，测试里按结构取出 */
function clientOf(provider: unknown): unknown {
  return (provider as { client: unknown }).client;
}

async function loadProvider() {
  vi.resetModules();
  const mod = await import("@/lib/payments/stripe-provider");
  return mod.StripeProvider;
}

describe("StripeProvider · API 版本钉死", () => {
  beforeEach(() => {
    captured.length = 0;
    vi.resetModules();
  });

  it("构造 Stripe 时显式传入 apiVersion（删掉该行即红）", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy_for_assertion";
    const StripeProvider = await loadProvider();

    new StripeProvider();

    expect(captured).toHaveLength(1);
    // 关键断言：键必须"存在"。只断言值是不够的——
    // 删掉 apiVersion 后 SDK 默认值恰好也是这个值，值断言会误判为通过。
    expect(captured[0]).toHaveProperty("apiVersion");
    expect(captured[0].apiVersion).toBe("2025-06-30.basil");
  });

  it("没有 secret 时不构造客户端（分支未回归）", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const StripeProvider = await loadProvider();

    const provider = new StripeProvider();

    expect(clientOf(provider)).toBeNull();
    expect(captured).toHaveLength(0);
  });
});
