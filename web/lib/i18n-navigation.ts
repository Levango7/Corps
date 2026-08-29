/**
 * next-intl navigation 工具 · lib/i18n-navigation.ts
 *
 * 暴露 locale 感知的 Link / redirect / usePathname / useRouter，
 * 组件中应使用这些替代 next/link 与 next/navigation 的同名导出，
 * 以自动处理 locale 前缀（as-needed 策略下默认 zh 不带前缀）。
 *
 * 依据：ADR-008 方案 A；next-intl 4.x App Router 推荐结构。
 */

import { createNavigation } from "next-intl/navigation";
import { routing } from "./i18n-routing";

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
