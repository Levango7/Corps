import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * 邮件按收件人语言渲染（P0-6 B 类清偿）的回归测试。
 *
 * 这份测试存在的理由不是凑覆盖率，而是钉死本 PR 的**两条真实失效模式**：
 *
 *   1. **文案表退化成单语**：`EMAIL_MESSAGES` 的 en 列如果直接抄 zh（或反过来），
 *      类型系统完全看不出来——两侧都是 string。产物依旧能渲染，只是英文用户
 *      收到中文邮件。所以这里断言两侧非空且不相等。
 *   2. **占位符两侧不对齐**：zh 写了 {task}、en 忘了写，那么英文版里那个值根本
 *      不会出现（emailMsg 只替换模板里存在的占位符），而渲染不会报错。所以断言
 *      两侧的 {占位符} 集合逐键相同。
 *
 * 在此之上再做**端到端分叉**：同一封邮件换个 locale，产出的 subject/HTML 必须
 * 真的不同，且 A 语言产物里不得出现 B 语言的文案。只断言"两种语言都出现过"是
 * 空转的——把 locale 参数整个忽略掉、两路都渲染同一种语言，那条断言照样绿。
 */

import {
  EMAIL_MESSAGES,
  emailMsg,
  normalizeEmailLocale,
  emailHtmlLang,
  emailDateLocale,
  type EmailMsgKey,
} from "@/lib/email-messages";
import { renderPushEmailHtml } from "@/lib/ai/push-email";
import { sendInviteEmail, sendTaskAssignedEmail } from "@/lib/email";

const KEYS = Object.keys(EMAIL_MESSAGES) as EmailMsgKey[];

/**
 * 键 → 两侧文案的扁平视图。
 *
 * 为什么要把 zh/en 显式放宽成 string：EMAIL_MESSAGES 是 `as const`，两侧都是互不
 * 重叠的字面量联合类型，直接写 `zh === en` 会被 TS2367 判成"无意义的比较"而编译
 * 失败。但"两侧会不会相等"恰恰是本文件要守的事（漏翻的确定特征就是相等），所以
 * 必须放宽后再比，而不是把这条断言删掉。
 */
const PAIRS: { key: EmailMsgKey; zh: string; en: string }[] = KEYS.map((key) => {
  const entry = EMAIL_MESSAGES[key];
  return { key, zh: entry.zh as string, en: entry.en as string };
});

/** 抽出文案里的 {占位符} 名字（去重后排序，便于集合比较） */
function placeholdersOf(template: string): string[] {
  const names = new Set<string>();
  for (const m of template.matchAll(/\{(\w+)\}/g)) names.add(m[1]);
  return [...names].sort();
}

describe("EMAIL_MESSAGES —— 双语文案表的完备性", () => {
  it("键集合非空（防止提取逻辑失效后所有断言空转）", () => {
    expect(KEYS.length).toBeGreaterThan(30);
  });

  it("每个键的 zh / en 两侧都是非空字符串", () => {
    for (const { key, zh, en } of PAIRS) {
      expect(typeof zh, `${key}.zh 不是字符串`).toBe("string");
      expect(typeof en, `${key}.en 不是字符串`).toBe("string");
      expect(zh.trim(), `${key}.zh 为空`).not.toBe("");
      expect(en.trim(), `${key}.en 为空`).not.toBe("");
    }
  });

  it("没有任何键的 zh 与 en 完全相同（en 列抄了中文 = 英文用户收到中文）", () => {
    // 刻意做成"不相等"而不是"看起来像英文"：后者要靠语言检测，脆且不可靠；
    // 而"两侧逐字相同"恰恰是复制粘贴漏翻的唯一确定特征。
    // 若将来某个值确实中英一致（如纯品牌名），请显式加白名单并写明理由，
    // 而不是放宽这条断言。
    const same = PAIRS.filter((p) => p.zh === p.en).map((p) => p.key);
    expect(same, `这些键的 en 与 zh 逐字相同，疑似漏翻：${same.join(", ")}`).toEqual([]);
  });

  it("每个键两侧的 {占位符} 集合完全一致（漏一个变量不报错，只静默丢失）", () => {
    const mismatched = PAIRS.filter(
      (p) => placeholdersOf(p.zh).join(",") !== placeholdersOf(p.en).join(","),
    ).map(
      (p) =>
        `${p.key}: zh=[${placeholdersOf(p.zh).join(",")}] en=[${placeholdersOf(p.en).join(",")}]`,
    );
    expect(mismatched, "占位符两侧不一致，其中一种语言会丢失该变量").toEqual([]);
  });
});

describe("emailMsg —— 取文案与填充占位符", () => {
  it("按 locale 取出对应语言的文案", () => {
    expect(emailMsg("ctaAcceptInvite", "zh")).toBe(EMAIL_MESSAGES.ctaAcceptInvite.zh);
    expect(emailMsg("ctaAcceptInvite", "en")).toBe(EMAIL_MESSAGES.ctaAcceptInvite.en);
  });

  it("传入 vars 时填充全部占位符", () => {
    const out = emailMsg("ctaAcceptInvite", "zh", { unused: "x" });
    // 该键无占位符，传了多余变量也不该改变结果
    expect(out).toBe(EMAIL_MESSAGES.ctaAcceptInvite.zh);
  });

  it("占位符按名字替换，且同名多次出现全部替换", () => {
    const out = emailMsg("dueReminderSubject", "en", { task: "Ship it" });
    expect(out).toContain("Ship it");
    expect(out).not.toContain("{task}");
  });

  it("调用方漏传某个占位符时原样保留 {name}，便于定位（而不是渲染成 undefined）", () => {
    const out = emailMsg("dueReminderSubject", "en", {});
    expect(out).toContain("{task}");
    expect(out).not.toContain("undefined");
  });
});

describe("normalizeEmailLocale —— 未知取值一律收敛为 zh", () => {
  it.each([
    ["en", "en"],
    ["zh", "zh"],
    ["fr", "zh"],
    ["EN", "zh"],
    ["", "zh"],
    [undefined, "zh"],
    [null, "zh"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeEmailLocale(input)).toBe(expected);
  });
});

describe("邮件语言相关的格式标签", () => {
  it("html lang：中文带地区（影响字形与断行），英文不带", () => {
    expect(emailHtmlLang("zh")).toBe("zh-CN");
    expect(emailHtmlLang("en")).toBe("en");
  });

  it("日期 locale：与正文同语言，避免英文邮件里夹中文日期", () => {
    expect(emailDateLocale("zh")).toBe("zh-CN");
    expect(emailDateLocale("en")).toBe("en-US");
    // 两个标签必须真的不同，否则日期不会被本地化——这条挡住"写死成一个值"
    expect(emailDateLocale("zh")).not.toBe(emailDateLocale("en"));
  });
});

describe("端到端分叉：AI 推送邮件", () => {
  const params = { title: "Release", summary: "Notes", workspaceUrl: "https://example.com/w" };

  it("同一封邮件换 locale，产物必须真的不同，且各自只含本语言的 CTA", () => {
    const zh = renderPushEmailHtml({ ...params, locale: "zh" });
    const en = renderPushEmailHtml({ ...params, locale: "en" });

    // 反空转：两路都必须真的产出了内容
    expect(zh.length).toBeGreaterThan(0);
    expect(en.length).toBeGreaterThan(0);

    expect(zh, "zh 与 en 产物完全相同，说明 locale 根本没被消费").not.toBe(en);

    const zhCta = emailMsg("pushCtaViewDetails", "zh");
    const enCta = emailMsg("pushCtaViewDetails", "en");
    expect(zh).toContain(zhCta);
    expect(en).toContain(enCta);
    // 关键：不是"各自含自己的"，而是"不含对方的"——否则两路都渲染两种语言也能过
    expect(zh, "zh 产物里出现了英文 CTA").not.toContain(enCta);
    expect(en, "en 产物里出现了中文 CTA").not.toContain(zhCta);
  });

  it("<html lang> 跟随收件人语言", () => {
    expect(renderPushEmailHtml({ ...params, locale: "zh" })).toContain('lang="zh-CN"');
    expect(renderPushEmailHtml({ ...params, locale: "en" })).toContain('lang="en"');
  });
});

describe("端到端分叉：事务邮件主模板（经 Resend 载荷捕获真实 HTML）", () => {
  const fetchMock = vi.fn();
  let logSpy: ReturnType<typeof vi.fn>;
  let errSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "info").mockImplementation(() => undefined) as unknown as ReturnType<
      typeof vi.fn
    >;
    errSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined) as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "email-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /** 取最近一次发往 Resend 的载荷 */
  function lastPayload(): { subject: string; html: string } {
    const call = fetchMock.mock.calls.at(-1) as [string, RequestInit] | undefined;
    expect(call, "没有发出任何邮件，捕获逻辑失效").toBeTruthy();
    return JSON.parse(call![1].body as string) as { subject: string; html: string };
  }

  it("邀请邮件：zh / en 的 subject 与正文都不同，且各自只含本语言文案", async () => {
    const base = {
      to: "invitee@example.com",
      workspaceName: "Acme Team",
      inviterName: "Alex",
      inviteUrl: "https://example.com/auth/signup?invite=t",
    };

    await sendInviteEmail({ ...base, locale: "zh" });
    const zh = lastPayload();

    await sendInviteEmail({ ...base, locale: "en" });
    const en = lastPayload();

    expect(zh.html.length).toBeGreaterThan(0);
    expect(en.html.length).toBeGreaterThan(0);
    expect(zh.subject).not.toBe(en.subject);
    expect(zh.html).not.toBe(en.html);

    const zhCta = emailMsg("ctaAcceptInvite", "zh");
    const enCta = emailMsg("ctaAcceptInvite", "en");
    expect(zh.html).toContain(zhCta);
    expect(en.html).toContain(enCta);
    expect(zh.html, "zh 邮件里出现了英文 CTA").not.toContain(enCta);
    expect(en.html, "en 邮件里出现了中文 CTA").not.toContain(zhCta);

    // 页脚同样要跟着语言走（它是所有事务邮件共用的外壳）
    expect(zh.html).toContain(emailMsg("shellFooter", "zh"));
    expect(en.html).toContain(emailMsg("shellFooter", "en"));
  });

  it("任务指派邮件：zh / en 分叉（这条覆盖另一条模板分支）", async () => {
    const base = {
      to: "assignee@example.com",
      assigneeName: "Sam",
      taskTitle: "Fix login",
      workspaceName: "Acme Team",
      assignerName: "Alex",
      taskUrl: "https://example.com/w/1/task/2",
    };

    await sendTaskAssignedEmail({ ...base, locale: "zh" });
    const zh = lastPayload();
    await sendTaskAssignedEmail({ ...base, locale: "en" });
    const en = lastPayload();

    expect(zh.subject).not.toBe(en.subject);
    const zhCta = emailMsg("ctaViewTask", "zh");
    const enCta = emailMsg("ctaViewTask", "en");
    expect(zh.html).toContain(zhCta);
    expect(en.html).toContain(enCta);
    expect(zh.html).not.toContain(enCta);
    expect(en.html).not.toContain(zhCta);
  });

  it("调用方没传 locale 时退回 zh（未接线调用点的兜底，不是静默发错语言的理由）", async () => {
    await sendInviteEmail({
      to: "invitee@example.com",
      workspaceName: "Acme Team",
      inviterName: "Alex",
    });
    const payload = lastPayload();
    expect(payload.html).toContain(emailMsg("shellFooter", "zh"));
  });
});
