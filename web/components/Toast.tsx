"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";

type ToastType = "success" | "error" | "info" | "warning";

interface Toast {
  id: number;
  type: ToastType;
  message: string;
  createdAt: number;
}

interface ToastContextValue {
  toast: (type: ToastType, message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Toast 自动关闭时长（ms） */
const TOAST_DURATION = 3500;

let _id = 0;

/** 格式化相对时间：刚刚 / Xs */
function formatElapsed(elapsedMs: number): string {
  const s = Math.floor(elapsedMs / 1000);
  if (s < 1) return "刚刚";
  return `${s}s`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const tToast = useTranslations("toast");
  const [toasts, setToasts] = useState<Toast[]>([]);
  // 每个 toast 的自动关闭定时器
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  // 每个 toast 的剩余时间（暂停时记录）
  const remainingRef = useRef<Map<number, number>>(new Map());
  // 暂停的 toast id 集合
  const [pausedIds, setPausedIds] = useState<Set<number>>(new Set());
  // 当前时间戳，每秒更新用于动态显示相对时间
  const [now, setNow] = useState(() => Date.now());

  // 每秒 tick 更新动态时间显示
  useEffect(() => {
    if (toasts.length === 0) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [toasts.length]);

  // 清除指定 toast 的定时器
  const clearTimer = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  // 设置指定 toast 的定时器（用指定时长）
  const setTimer = useCallback(
    (id: number, duration: number) => {
      clearTimer(id);
      const timer = setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
        timersRef.current.delete(id);
        remainingRef.current.delete(id);
      }, duration);
      timersRef.current.set(id, timer);
    },
    [clearTimer],
  );

  const addToast = useCallback(
    (type: ToastType, message: string) => {
      const id = ++_id;
      const createdAt = Date.now();
      setToasts((prev) => [...prev, { id, type, message, createdAt }]);
      remainingRef.current.set(id, TOAST_DURATION);
      setTimer(id, TOAST_DURATION);
    },
    [setTimer],
  );

  const remove = useCallback(
    (id: number) => {
      clearTimer(id);
      remainingRef.current.delete(id);
      setPausedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setToasts((prev) => prev.filter((t) => t.id !== id));
    },
    [clearTimer],
  );

  // onMouseEnter：暂停自动关闭
  const handleMouseEnter = useCallback(
    (id: number, createdAt: number) => {
      clearTimer(id);
      const elapsed = Date.now() - createdAt;
      const remaining = Math.max(0, remainingRef.current.get(id) ?? TOAST_DURATION) - elapsed;
      remainingRef.current.set(id, remaining);
      setPausedIds((prev) => new Set(prev).add(id));
    },
    [clearTimer],
  );

  // onMouseLeave：恢复自动关闭
  const handleMouseLeave = useCallback(
    (id: number) => {
      const remaining = remainingRef.current.get(id) ?? TOAST_DURATION;
      setPausedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (remaining <= 0) {
        remove(id);
      } else {
        setTimer(id, remaining);
      }
    },
    [setTimer, remove],
  );

  // 组件卸载时清除所有定时器
  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
      timersRef.current.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      <div
        className="fixed bottom-4 right-4 pb-safe z-[var(--z-toast)] flex flex-col gap-2 pointer-events-none"
        aria-live="polite"
        aria-label={tToast("regionLabel")}
      >
        {toasts.map((t) => {
          const elapsed = now - t.createdAt;
          const isPaused = pausedIds.has(t.id);
          return (
            <div
              key={t.id}
              className="fade-in pointer-events-auto flex items-start gap-3 max-w-[calc(100vw-2rem)] px-4 py-3 rounded-[var(--radius-lg)] shadow-[var(--elev-lg)] border cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
              style={{
                background:
                  t.type === "success"
                    ? "var(--success-soft)"
                    : t.type === "error"
                      ? "var(--danger-soft)"
                      : t.type === "warning"
                        ? "var(--warn-soft)"
                        : "var(--surface)",
                borderColor: "var(--border)",
                color:
                  t.type === "success"
                    ? "var(--success)"
                    : t.type === "error"
                      ? "var(--danger)"
                      : t.type === "warning"
                        ? "var(--warn)"
                        : "var(--fg)",
              }}
              onClick={() => remove(t.id)}
              onMouseEnter={() => handleMouseEnter(t.id, t.createdAt)}
              onMouseLeave={() => handleMouseLeave(t.id)}
              role="alert"
            >
              <span className="text-[length:var(--text-sm)] flex-1">{t.message}</span>
              {/* 动态显示时间 */}
              <span
                className="shrink-0 text-[length:var(--text-xs)] opacity-60 tabular-nums self-center"
                aria-hidden="true"
              >
                {isPaused ? "⏸" : formatElapsed(elapsed)}
              </span>
              <button
                className="shrink-0 opacity-60 hover:opacity-100 transition-opacity text-[length:var(--text-xs)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] rounded-[var(--radius-sm)]"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(t.id);
                }}
                aria-label={tToast("close")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
