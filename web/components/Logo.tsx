import type { FC } from "react";

interface LogoProps {
  withText?: boolean;
  size?: number;
  className?: string;
}

export const Logo: FC<LogoProps> = ({ withText = true, size = 24, className = "" }) => {
  const s = size;
  const m = s * 0.75;
  const o = m * 0.55;
  const r = m * 0.18;

  return (
    <span className={`inline-flex items-center gap-[var(--space-2)] ${className}`}>
      <svg
        width={s}
        height={s}
        viewBox={`0 0 ${s} ${s}`}
        fill="none"
        aria-label="corps"
        role="img"
        style={{ flexShrink: 0 }}
      >
        <rect x={0} y={s - m} width={m} height={m} rx={r} fill="var(--accent)" />
        <rect x={o} y={s - m - o} width={m} height={m} rx={r} fill="var(--accent)" opacity={0.65} />
        <rect
          x={o * 1.8}
          y={s - m - o * 2}
          width={m}
          height={m}
          rx={r}
          fill="var(--accent)"
          opacity={0.35}
        />
      </svg>
      {withText && (
        <span className="font-[var(--weight-semibold)] text-[length:var(--text-md)] text-[var(--fg)] tracking-[-0.01em]">
          corps
        </span>
      )}
    </span>
  );
};
