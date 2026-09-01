"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle2, Plus, UserPlus, X, ArrowRight, ArrowLeft, PartyPopper } from "lucide-react";

interface OnboardingProps {
  wid: string;
  /** 当前工作区的任务数（用于判断是否已完成引导） */
  taskCount: number;
  /** 当前工作区的成员数 */
  memberCount: number;
  /** 完成或跳过时回调 */
  onDismiss: () => void;
}

const STORAGE_KEY = "corps_onboarding_completed";
const TOTAL_STEPS = 4;

/**
 * Onboarding 引导流程（AC-07: 15分钟内完成"创建首个任务并指派"）
 *
 * 四步引导：
 * 1. 欢迎来到 corps
 * 2. 创建首个任务
 * 3. 邀请团队成员
 * 4. 完成恭喜
 *
 * 支持：跳过 / 返回上一步 / 步骤间过渡动画 / 进度指示器。
 * 完成后 localStorage 标记不再显示。
 */
export default function Onboarding({
  wid,
  taskCount,
  memberCount: _memberCount,
  onDismiss,
}: OnboardingProps) {
  const t = useTranslations("onboarding");
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  // 展开态：仅当用户点击小气泡后才显示完整模态卡片,默认只显示小气泡
  const [expanded, setExpanded] = useState(false);
  const [animDirection, setAnimDirection] = useState<"forward" | "backward">("forward");
  const router = useRouter();

  useEffect(() => {
    const completed = localStorage.getItem(STORAGE_KEY) === "true";
    if (!completed && taskCount === 0) {
      setVisible(true);
    }
  }, [taskCount]);

  function dismissForever() {
    localStorage.setItem(STORAGE_KEY, "true");
    setVisible(false);
    setExpanded(false);
    onDismiss();
  }

  function complete() {
    localStorage.setItem(STORAGE_KEY, "true");
    setVisible(false);
    setExpanded(false);
    onDismiss();
  }

  function skip() {
    localStorage.setItem(STORAGE_KEY, "true");
    setVisible(false);
    onDismiss();
  }

  function next() {
    setAnimDirection("forward");
    if (step < TOTAL_STEPS - 1) {
      setStep((s) => s + 1);
    } else {
      complete();
    }
  }

  function back() {
    setAnimDirection("backward");
    if (step > 0) {
      setStep((s) => s - 1);
    }
  }

function BubbleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.5v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11" r="0.9" fill="currentColor" />
    </svg>
  );
}

  if (!visible) return null;

  // 折叠态:右下角小气泡,不挡视图,用户点开才进入模态引导
  if (!expanded) {
    return (
      <div className="fixed bottom-4 right-4 z-40">
        <button
          onClick={() => setExpanded(true)}
          className="btn-press flex items-center gap-2 h-9 pl-3 pr-4 rounded-full bg-[var(--accent)] text-[var(--on-accent)] shadow-[var(--elev-md)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-[var(--focus-ring)]"
          aria-label={t("openGuide")}
        >
          <BubbleIcon />
          <span className="text-[length:var(--text-sm)] font-[var(--weight-medium)]">
            {t("step1.title")}
          </span>
          <span className="ml-1 text-[length:var(--text-xs)] opacity-80">
            1/4
          </span>
        </button>
      </div>
    );
  }

  // 若用户已创建任务，跳过"创建首个任务"步（step 1 → step 2）
  const effectiveStep = taskCount > 0 && step === 1 ? 2 : step;

  interface StepConfig {
    title: string;
    subtitle: string;
    icon: typeof CheckCircle2;
    content: ReactNode;
    action: { label: string; href: string | null };
    /** 是否允许返回上一步 */
    canBack: boolean;
  }

  const steps: StepConfig[] = [
    {
      title: t("step1.title"),
      subtitle: t("step1.subtitle"),
      icon: CheckCircle2,
      content: (
        <div className="space-y-3">
          <p className="text-[length:var(--text-base)] text-[var(--fg-2)]">{t("step1.desc1")}</p>
          <p className="text-[length:var(--text-base)] text-[var(--fg-2)]">
            <strong className="text-[var(--fg)] font-[var(--weight-medium)]">
              {t("step1.desc2Highlight")}
            </strong>
            {t("step1.desc2")}
          </p>
          <div className="mt-4 p-3 bg-[var(--surface-2)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--muted)]">
            {t("step1.tip")}
          </div>
        </div>
      ),
      action: { label: t("step1.cta"), href: null },
      canBack: false,
    },
    {
      title: t("step2.title"),
      subtitle: t("step2.subtitle"),
      icon: Plus,
      content: (
        <div className="space-y-3">
          <p className="text-[length:var(--text-base)] text-[var(--fg-2)]">{t("step2.desc1")}</p>
          <p className="text-[length:var(--text-base)] text-[var(--fg-2)]">{t("step2.desc2")}</p>
        </div>
      ),
      action: { label: t("step2.cta"), href: `/w/${wid}/board` },
      canBack: true,
    },
    {
      title: t("step3.title"),
      subtitle: t("step3.subtitle"),
      icon: UserPlus,
      content: (
        <div className="space-y-3">
          <p className="text-[length:var(--text-base)] text-[var(--fg-2)]">{t("step3.desc1")}</p>
          <p className="text-[length:var(--text-base)] text-[var(--fg-2)]">
            <strong className="text-[var(--fg)] font-[var(--weight-medium)]">
              {t("step3.desc2Highlight")}
            </strong>
            {t("step3.desc2")}
          </p>
        </div>
      ),
      action: { label: t("step3.cta"), href: `/w/${wid}/members` },
      canBack: true,
    },
    {
      title: t("step4.title"),
      subtitle: t("step4.subtitle"),
      icon: PartyPopper,
      content: (
        <div className="space-y-3">
          <p className="text-[length:var(--text-base)] text-[var(--fg-2)]">{t("step4.desc1")}</p>
          <p className="text-[length:var(--text-base)] text-[var(--fg-2)]">{t("step4.desc2")}</p>
        </div>
      ),
      action: { label: t("step4.cta"), href: `/w/${wid}/board` },
      canBack: true,
    },
  ];

  const current = steps[effectiveStep];
  const Icon = current.icon;

  function handleAction() {
    if (current.action.href) {
      router.push(current.action.href);
    }
    next();
  }

  // 过渡动画：根据方向选择 key 与动画类
  const animKey = `step-${effectiveStep}`;
  const animClass =
    animDirection === "forward"
      ? "animate-[onboarding-slide-in_0.3s_ease-out]"
      : "animate-[onboarding-slide-in-back_0.3s_ease-out]";

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center px-4"
      style={{ background: "var(--overlay)" }}
    >
      <div className="w-full max-w-[480px] bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-xl)] shadow-[var(--elev-lg)] overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 h-14 border-b border-[var(--border-soft)]">
          <div className="flex items-center gap-2">
            <Icon size={20} className="text-[var(--accent)]" />
            <span className="text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--muted)]">
              {t("badge", { current: effectiveStep + 1, total: TOTAL_STEPS })}
            </span>
          </div>
          <button
            onClick={() => setExpanded(false)}
            className="p-1.5 rounded-[var(--radius-md)] text-[var(--meta)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
            aria-label={t("skipAria")}
          >
            <X size={16} />
          </button>
        </div>

        {/* 内容（带过渡动画） */}
        <div key={animKey} className={`px-6 py-6 ${animClass}`}>
          <h2 className="text-[length:var(--text-xl)] font-[var(--weight-semibold)] text-[var(--fg)] tracking-[-0.01em]">
            {current.title}
          </h2>
          <p className="mt-1 text-[length:var(--text-sm)] text-[var(--muted)]">
            {current.subtitle}
          </p>
          <div className="mt-5">{current.content}</div>
        </div>

        {/* 进度指示器 */}
        <div className="flex items-center justify-center gap-1.5 px-6 pb-4">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-[var(--motion-base)] ${
                i === effectiveStep
                  ? "w-6 bg-[var(--accent)]"
                  : i < effectiveStep
                    ? "w-1.5 bg-[var(--accent)]"
                    : "w-1.5 bg-[var(--border)]"
              }`}
            />
          ))}
        </div>

        {/* 底部操作 */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border-soft)] bg-[var(--surface-2)]">
          <div className="flex items-center gap-3">
            {current.canBack && effectiveStep > 0 && (
              <button
                onClick={back}
                className="flex items-center gap-1.5 text-[length:var(--text-sm)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
              >
                <ArrowLeft size={15} />
                {t("back")}
              </button>
            )}
            {(!current.canBack || effectiveStep === 0) && (
              <button
                onClick={skip}
                className="text-[length:var(--text-sm)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
              >
                {t("skip")}
              </button>
            )}
          </div>
          <button
            onClick={handleAction}
            className="btn-press flex items-center gap-2 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] transition-colors duration-[var(--motion-base)]"
          >
            {current.action.label}
            <ArrowRight size={15} />
          </button>
        </div>
      </div>

      {/* 关键帧动画定义（内联，避免依赖全局 CSS） */}
      <style jsx global>{`
        @keyframes onboarding-slide-in {
          from {
            opacity: 0;
            transform: translateX(24px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        @keyframes onboarding-slide-in-back {
          from {
            opacity: 0;
            transform: translateX(-24px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
      `}</style>
    </div>
  );
}
