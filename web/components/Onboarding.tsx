"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Plus, UserPlus, X, ArrowRight } from "lucide-react";

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

/**
 * Onboarding 引导流程（AC-07: 15分钟内完成"创建首个任务并指派"）
 *
 * 三步引导：
 * 1. 欢迎来到 corps
 * 2. 创建首个任务
 * 3. 邀请团队成员
 *
 * 可跳过；完成后 localStorage 标记不再显示。
 */
export default function Onboarding({
  wid,
  taskCount,
  memberCount: _memberCount,
  onDismiss,
}: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const completed = localStorage.getItem(STORAGE_KEY) === "true";
    if (!completed && taskCount === 0) {
      setVisible(true);
    }
  }, [taskCount]);

  function complete() {
    localStorage.setItem(STORAGE_KEY, "true");
    setVisible(false);
    onDismiss();
  }

  function skip() {
    localStorage.setItem(STORAGE_KEY, "true");
    setVisible(false);
    onDismiss();
  }

  function next() {
    if (step < 2) {
      setStep((s) => s + 1);
    } else {
      complete();
    }
  }

  if (!visible) return null;

  const effectiveStep = taskCount > 0 && step === 1 ? 2 : step;

  const steps = [
    {
      title: "欢迎来到 corps",
      subtitle: "60 秒完成首个任务，开始你的团队协作",
      icon: CheckCircle2,
      content: (
        <div className="space-y-3">
          <p className="text-[length:var(--text-base)] text-[var(--fg-2)]">
            corps 是面向 5-30 人中小团队的轻量协作工具。
          </p>
          <p className="text-[length:var(--text-base)] text-[var(--fg-2)]">
            <strong className="text-[var(--fg)] font-[var(--weight-medium)]">核心闭环</strong>
            ：讨论结论自动落位成任务与决策记录——不再手动搬运。
          </p>
          <div className="mt-4 p-3 bg-[var(--surface-2)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--muted)]">
            不为用不上的功能付费——免费层 ≤10 人，¥59/人/月 起步档。
          </div>
        </div>
      ),
      action: { label: "开始", href: null as string | null },
    },
    {
      title: "创建首个任务",
      subtitle: "把手里最紧的事放进看板",
      icon: Plus,
      content: (
        <div className="space-y-3">
          <p className="text-[length:var(--text-base)] text-[var(--fg-2)]">
            在看板上创建一条任务，填写标题、负责人、截止日期。
          </p>
          <p className="text-[length:var(--text-base)] text-[var(--fg-2)]">
            拖拽任务卡可改变状态（待办 → 进行中 → 已完成）。
          </p>
        </div>
      ),
      action: { label: "去看板", href: `/w/${wid}/board` },
    },
    {
      title: "邀请团队成员",
      subtitle: "协作从邀请开始",
      icon: UserPlus,
      content: (
        <div className="space-y-3">
          <p className="text-[length:var(--text-base)] text-[var(--fg-2)]">
            邀请同事加入工作区，分配 Owner/Admin/Member 角色。
          </p>
          <p className="text-[length:var(--text-base)] text-[var(--fg-2)]">
            <strong className="text-[var(--fg)] font-[var(--weight-medium)]">注意</strong>
            ：邀请前对方需先在 corps 注册账号。
          </p>
        </div>
      ),
      action: { label: "去成员页", href: `/w/${wid}/members` },
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
              引导 · {effectiveStep + 1} / 3
            </span>
          </div>
          <button
            onClick={skip}
            className="p-1.5 rounded-[var(--radius-md)] text-[var(--meta)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
            aria-label="跳过引导"
          >
            <X size={16} />
          </button>
        </div>

        {/* 内容 */}
        <div className="px-6 py-6">
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
          {[0, 1, 2].map((i) => (
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
          <button
            onClick={skip}
            className="text-[length:var(--text-sm)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
          >
            跳过
          </button>
          <button
            onClick={handleAction}
            className="flex items-center gap-2 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] transition-colors duration-[var(--motion-base)]"
          >
            {current.action.label}
            <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
