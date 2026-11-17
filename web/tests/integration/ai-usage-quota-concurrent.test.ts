import { describe, it, expect, beforeAll } from "vitest";

/**
 * AI 日配额边界：真并发 + 真 DB（lib/ai/usage-limit.ts + usage-tracker.ts）。
 *
 * 既有覆盖的缺口：
 *  - tests/unit/ai-usage-limit.test.ts:429-479 的 P2002 竞态是 mock tx 层；
 *  - 日 limit 竞态（同文件 mocked aggregate）也是单元级。
 * 本文件把判定（assertAiUsageQuota）与记账（recordAiUsage）放到**真实 PostgreSQL**
 * 上并发执行，验证配额聚合在并发写入下不丢不重、边界判定（>=）在真数据上成立。
 *
 * 为什么调 lib 函数而不是走 HTTP：
 *  - 配额判定/记账全部收敛在 lib 层（withUsageTracking 只是包装 assert + record）；
 *    AI 路由走 HTTP 需要 DEEPSEEK_API_KEY 且会真的发起模型调用，CI 无密钥，
 *    通过配额的请求会 503/失败，把"配额语义"和"上游可用性"搅在一起；
 *  - 以"真并发、真 DB"为准，lib 直调比 HTTP 更稳（runWithWorkspace 注入 GUC
 *    的真实事务路径也在被测范围内）。
 *
 * 为什么断言"恰好 N 个成功"是确定性的：
 *  占位操作 = assertAiUsageQuota + await recordAiUsage（检查先于自身写入）。
 *  N 个并发占位、日调用限额恰好 N：任一占位检查时，已提交的写至多 N-1 条
 *  （自己的写尚未发生），aggregate 读已提交快照 → count < N 必然成立 → 全放行。
 *  第二波并发检查发生在全部写提交之后 → count >= N → 全部拒绝。
 *  注意实现本身"检查与写入不构成原子占用"（usage-limit.ts 文件头注释已声明
 *  高并发下允许轻微超发）——本测试不碰那个非确定方向，只钉死上述两个确定方向。
 */

// 集成测试两套 CI 环境变量口径：coverage/e2e 腿给 DATABASE_URL（超级用户），
// 专项 integration 腿给 RLS_SMOKE_OWNER_URL（同为 OWNER 直连，超级用户绕过 RLS）。
// 必须在首次 import "@/lib/prisma"（构造时解析连接串）之前落位。
const DB_URL = process.env.DATABASE_URL ?? process.env.RLS_SMOKE_OWNER_URL;
if (DB_URL && !process.env.DATABASE_URL) process.env.DATABASE_URL = DB_URL;
const describeDb = DB_URL ? describe : describe.skip;

import { BASE, registerUser } from "../helpers";

const DAILY_CALL_LIMIT = 4;
const WAVE2_REQUESTS = 6;

let userId: string;
let wid: string;

/** 占位操作：配额断言 + 真实记账（awaited，见文件头"为什么确定性"）。 */
async function occupyOne(ownerId: string, workspaceId: string): Promise<void> {
  const { assertAiUsageQuota } = await import("@/lib/ai/usage-limit");
  const { recordAiUsage } = await import("@/lib/ai/usage-tracker");
  await assertAiUsageQuota(ownerId, workspaceId);
  await recordAiUsage({
    workspaceId,
    userId: ownerId,
    capability: "quota-concurrency-probe",
    model: "deepseek-chat",
    inputTokens: 10,
    outputTokens: 10,
    durationMs: 1,
    success: true,
  });
}

describeDb("AI 日调用配额（真并发 + 真 DB）", () => {
  beforeAll(async () => {
    // 真 DB 需要真实的 user/workspace 行（ai_usage_logs 双外键）；走既有 HTTP 注册。
    const u = await registerUser({ prefix: "quota-conc", workspaceName: "配额并发工作区" });
    userId = u.user.id;
    wid = u.workspace.id;
    expect(BASE, "集成测试需要 dev server").toContain("http");

    const { prisma } = await import("@/lib/prisma");
    // 用户级日调用限额 = DAILY_CALL_LIMIT（ai_usage_limits 是 FORCE RLS 表；
    // 测试进程用 OWNER 直连，超级用户绕过 RLS，见 rls-engine.test.ts 同款口径）。
    await prisma.aiUsageLimit.create({
      data: { workspaceId: wid, userId, dailyCallLimit: DAILY_CALL_LIMIT },
    });
  });

  it(`并发 ${DAILY_CALL_LIMIT} 个占位恰好全部成功，且并发写入不丢不重`, async () => {
    const results = await Promise.allSettled(
      Array.from({ length: DAILY_CALL_LIMIT }, () => occupyOne(userId, wid)),
    );
    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
      // 失败原因直接暴露，避免只留一个模糊的"应为空"
      throw new Error(
        `占位失败: ${String((failures[0] as PromiseRejectedResult).reason?.message ?? failures[0])}`,
      );
    }
    expect(failures.length, "边界内（检查时 count<限额）的并发占位必须全部放行").toBe(0);

    const { prisma } = await import("@/lib/prisma");
    const logged = await prisma.aiUsageLog.count({
      where: { workspaceId: wid, userId },
    });
    expect(logged, "并发记账必须精确等于占位数（不丢也不重）").toBe(DAILY_CALL_LIMIT);
  });

  it(`配额打满后并发 ${WAVE2_REQUESTS} 个请求全部拒绝，reason 指向日调用限额`, async () => {
    const { assertAiUsageQuota, AiQuotaExceededError } = await import("@/lib/ai/usage-limit");

    const results = await Promise.allSettled(
      Array.from({ length: WAVE2_REQUESTS }, () => assertAiUsageQuota(userId, wid)),
    );

    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected.length, "已达限额后每个并发请求都必须被拦截").toBe(WAVE2_REQUESTS);
    for (const r of rejected) {
      expect(r.reason, "拒绝必须以 AiQuotaExceededError 形态抛出").toBeInstanceOf(
        AiQuotaExceededError,
      );
      expect((r.reason as InstanceType<typeof AiQuotaExceededError>).reason).toBe(
        "Daily call limit exceeded",
      );
      expect((r.reason as InstanceType<typeof AiQuotaExceededError>).usagePercent).toBe(1);
    }
  });

  it("超限错误经 aiQuotaExceededResponse 映射为 429 标准错误信封", async () => {
    const { assertAiUsageQuota, AiQuotaExceededError } = await import("@/lib/ai/usage-limit");
    const { aiQuotaExceededResponse } = await import("@/lib/ai/shared");
    const { NextRequest } = await import("next/server");
    const { API_MESSAGES } = await import("@/lib/api-messages");

    const err = await assertAiUsageQuota(userId, wid).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiQuotaExceededError);

    const req = new NextRequest("http://localhost:3000/api/v1/ai/usage/probe");
    const res = aiQuotaExceededResponse(req, err);
    expect(res, "AiQuotaExceededError 必须命中 429 映射（返回 null = 映射丢失）").not.toBeNull();
    expect(res!.status).toBe(429);

    const body = (await res!.json()) as {
      code: number;
      message?: string;
      data?: { reason?: string; usagePercent?: number | null };
    };
    expect(Object.keys(body).sort()).toEqual(["code", "data", "message"]);
    expect(body.code).toBe(429);
    expect(body.data?.reason).toBe("Daily call limit exceeded");
    expect(body.data?.usagePercent).toBe(1);
    // message 必须来自 api-messages 的 aiQuotaExceeded 键（非 route 本地硬编码）。
    // 无语言头时 apiLocale 的默认语种不做假设——两语种值都接受。
    expect(body.message, "message 必须取自 aiQuotaExceeded 键").toEqual(
      expect.stringMatching(
        new RegExp(
          `^(${[API_MESSAGES.aiQuotaExceeded.zh, API_MESSAGES.aiQuotaExceeded.en]
            .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("|")})$`,
        ),
      ),
    );
  });
});
