/**
 * 语言切换按钮 · components/LanguageSwitcher.tsx
 *
 * 依据：ADR-008 方案 A §3.1「全局导航与外壳」
 *
 * 设计：
 *  - 在顶栏放置一个 zh/en 切换按钮
 *  - 切换时通过 next-intl 的 useRouter 切换 locale（自动处理 as-needed 前缀）
 *  - 当前 locale 高亮
 *  - 图标：Lucide Languages（统一图标库，禁 emoji）
 *
 * 关联：
 *  - web/lib/i18n-navigation.ts（locale 感知的 useRouter）
 *  - web/lib/i18n.ts（locales + localeNames）
 */

import { getTranslations } from "next-intl/server";
import { LanguageSwitcherClient } from "./LanguageSwitcherClient";

export async function LanguageSwitcher() {
  const t = await getTranslations("languageSwitcher");

  return <LanguageSwitcherClient ariaLabel={t("ariaLabel")} />;
}
