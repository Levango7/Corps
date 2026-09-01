import { Logo } from "@/components/Logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center bg-[var(--bg)] p-4 overflow-hidden">
      {/* 背景装饰 */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute -top-48 -right-48 w-96 h-96 rounded-full bg-[var(--accent)] opacity-[0.07] blur-3xl" />
        <div className="absolute -bottom-32 -left-32 w-80 h-80 rounded-full bg-[var(--accent)] opacity-[0.06] blur-3xl" />
        <div className="absolute top-1/4 left-1/3 w-64 h-64 rounded-full bg-[var(--accent)] opacity-[0.05] blur-2xl" />
      </div>

      {/* 品牌标志 */}
      <div className="mb-8">
        <a href="/" className="inline-flex items-center gap-2">
          <Logo size={28} />
        </a>
      </div>
      <div className="relative w-full max-w-sm">{children}</div>
    </div>
  );
}
