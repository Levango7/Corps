import { Logo } from "@/components/Logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
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

      {/* 品牌标志 */}
      <div className="relative mb-10">
        <a href="/" className="inline-flex items-center gap-3" aria-label="corps">
          <Logo size={44} />
          <span className="text-[length:var(--text-2xl)] font-[var(--weight-semibold)] text-[var(--fg)] tracking-[-0.01em]">
            corps
          </span>
        </a>
        <p className="mt-2 text-[length:var(--text-sm)] text-[var(--muted)] max-w-[24ch]">
          面向中小团队的轻量协作 SaaS
        </p>
      </div>

      {/* 表单卡片容器 */}
      <div className="relative w-full max-w-sm">{children}</div>
    </div>
  );
}