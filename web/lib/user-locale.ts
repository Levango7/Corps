import { prisma } from "@/lib/prisma";
import { normalizeEmailLocale, type EmailLocale } from "@/lib/email-messages";

/**
 * 按收件人读取邮件语言。
 *
 * 为什么单开一个文件：这是本仓唯一"从库里读 User.locale 决定邮件语言"的入口，
 * 放在 web/lib/email.ts 里会让那个模块在 import 时就构造 PrismaClient——
 * 而 tests/unit/email*.test.ts 只测渲染与日志，白白拉起一个数据库连接池。
 *
 * 判定级联（与 team-lead 定的规则一致，改动请连规则一起改）：
 *   1. 收件人有 User 行 → 用该收件人的 User.locale（唯一正确信号）
 *   2. 收件人没有 User 行 → 回退调用方的 locale（典型是 invite：被邀请人还没注册）
 *   3. 都没有 → "zh"
 * 这里只负责第 1 步与第 3 步；第 2 步由调用方（如 lib/auth.ts 的 Better Auth
 * 回调、members/invite 路由）自己传 fallback。
 *
 * 查询失败（DB 不可达、行已被删）一律回退 fallback 而不是抛出：邮件是"尽力而为"
 * 通道，语言取不到只是退回默认语言，不该把发信或业务流程一起拖死。
 */
export async function resolveUserEmailLocale(
  userId: string | null | undefined,
  fallback: EmailLocale = "zh",
): Promise<EmailLocale> {
  if (!userId) return fallback;
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { locale: true },
    });
    if (!user) return fallback;
    return normalizeEmailLocale(user.locale);
  } catch (error) {
    console.error("[user-locale] 读取 User.locale 失败，回退默认语言:", error);
    return fallback;
  }
}
