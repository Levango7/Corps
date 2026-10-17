// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import zh from "../../messages/zh.json";

/**
 * 「界面直接显示原始翻译 key」回归门禁
 *
 * 背景（2026-10-17，main 上两处并存）：
 *  1. CommandPalette 用 useTranslations("nav") 却把 titleKey 写成完整路径
 *     "nav.menu.overview"，next-intl 实际查找 nav.nav.menu.overview —— 首屏 8 个
 *     导航项全部显示 "nav.nav.menu.*" 原文；且同一绑定还用于 query 过滤，
 *     拿 key 字符串去匹配译文，导致 ⌘K 输入中英文都搜不到任何导航项。
 *  2. SemanticSearchPanel 的 SCOPE_LABEL_KEYS 引用 ai.semanticSearch.scope*，
 *     而词条里没有这组键 —— 4 个范围筛选按钮显示 "ai.semanticSearch.scopeMessages"。
 *
 * 为什么不用静态正则门禁：本仓存在多个同文件多翻译器的合法写法
 * （UserMenu 的 theme.* 走 tTheme、ConversationSettings 的 confirmDeleteGroup 走 tIm），
 * 「命名空间 + key」的静态推断会成批误报。改为真实渲染取值，零误报。
 *
 * 断言口径：渲染出的每个标签都必须等于 messages 里对应的真实译文；
 * 出现任何 key 形状的字符串（含 "nav." / "ai.semanticSearch."）即判红。
 */

vi.mock("@/lib/i18n-navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import CommandPalette from "@/components/CommandPalette";
import { SemanticSearchPanel } from "@/components/ai/SemanticSearchPanel";

function wrap(ui: React.ReactNode) {
  // jsdom 未实现 scrollIntoView（CommandPalette 的游标滚动会调用）
  Element.prototype.scrollIntoView = () => {};
  return render(
    <NextIntlClientProvider locale="zh" messages={zh}>
      {ui}
    </NextIntlClientProvider>,
  );
}

/** 取列表面板里所有条目按钮的可见文案（不含输入框/页脚） */
function itemTexts(container: HTMLElement): string[] {
  return [...container.querySelectorAll("ul li button")].map((b) => (b.textContent ?? "").trim());
}

describe("CommandPalette 导航项不显示原始 key", () => {
  const navLabels = new Set(Object.values(zh.nav.menu));

  it("首屏 8 个导航项渲染的是 nav.menu.* 的译文，不是 key", () => {
    const { container } = wrap(<CommandPalette wid="w1" onClose={() => {}} />);
    const texts = itemTexts(container);

    expect(texts.length).toBe(8);
    for (const text of texts) {
      expect(text, "界面出现了原始翻译 key").not.toContain(".");
      expect(navLabels, `"${text}" 不是 nav.menu.* 里的任何一条译文`).toContain(text);
    }
  });

  it("搜索过滤按译文匹配：输入中文能命中对应导航项", () => {
    // 修复前过滤用的是 key 字符串（nav.nav.menu.board），中文 query 必然 0 命中
    const { container } = wrap(<CommandPalette wid="w1" onClose={() => {}} />);
    const input = container.querySelector("input") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "看板" } });

    expect(itemTexts(container)).toContain("看板");
  });
});

describe("SemanticSearchPanel 范围标签不是原始 key", () => {
  it("4 个 scope 标签渲染为 scope* 的真实译文", () => {
    wrap(<SemanticSearchPanel wid="w1" />);
    const labels = [...document.querySelectorAll("label")].map((l) => (l.textContent ?? "").trim());

    expect(labels).toEqual([
      zh.ai.semanticSearch.scopeMessages,
      zh.ai.semanticSearch.scopeWikis,
      zh.ai.semanticSearch.scopeTodos,
      zh.ai.semanticSearch.scopeDecisions,
    ]);
    for (const label of labels) {
      expect(label, "界面出现了原始翻译 key").not.toContain("ai.semanticSearch");
    }
  });
});
