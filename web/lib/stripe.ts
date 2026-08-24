import Stripe from "stripe";

const secret = process.env.STRIPE_SECRET_KEY;

export const stripe: Stripe | null = secret
  ? new Stripe(secret, { appInfo: { name: "corps", version: "0.1.0" } })
  : null;

export function requireStripe(): Stripe {
  if (!stripe) {
    throw new Error("STRIPE_SECRET_KEY 未配置：请在环境变量中填入 Stripe 测试密钥");
  }
  return stripe;
}

export const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID;
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// free 档席位上限（与 Workspace.seatLimit 默认值保持一致；审计 F-11 订阅取消时回落到此档）
export const FREE_SEAT_LIMIT = 10;
