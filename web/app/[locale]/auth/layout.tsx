import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/Logo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("auth");

  return (
    <div className="auth-bg relative min-h-screen flex flex-col items-center justify-center p-4 overflow-hidden">
      {/* 背景特效层 —— 细网格 + 光晕，纯装饰 aria-hidden */}
      <div className="absolute inset-0 pointer-events-none select-none" aria-hidden="true">
        {/* 细网格纹理（径向淡出，避免满屏压迫） */}
        <div className="auth-grid absolute inset-0" />
        {/* 右上主光晕（品牌靛蓝） */}
        <div className="absolute -top-40 -right-40 w-[34rem] h-[34rem] rounded-full bg-[var(--accent)] opacity-[0.09] blur-[120px]" />
        {/* 左下副光晕（天蓝） */}
        <div className="absolute -bottom-44 -left-44 w-[30rem] h-[30rem] rounded-full bg-[var(--shell-blue)] opacity-[0.16] blur-[100px]" />
        {/* 顶部中央柔光 */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[26rem] h-[26rem] rounded-full bg-[var(--surface)] opacity-[0.5] blur-[90px]" />
      </div>

      {/* 语言切换器 —— 右上角 */}
      <div className="absolute top-4 right-4 z-10">
        <LanguageSwitcher />
      </div>

      {/* 品牌标志 —— Logo 组件本身含 SVG + "corps" 文字,不要外层再包一个 corps */}
      <div className="relative mb-8 text-center">
        <a href="/" aria-label="corps" className="inline-flex">
          <Logo size={44} />
        </a>
        <p className="mt-2 text-[length:var(--text-sm)] text-[var(--muted)]">
          {t("tagline")}
        </p>
      </div>

      {/* 表单卡片容器 */}
      <div className="relative w-full max-w-sm">{children}</div>
    </div>
  );
}