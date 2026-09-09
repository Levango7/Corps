"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { useTranslations } from "next-intl";

type ToastType = "success" | "error" | "info" | "warning";

interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  toast: (type: ToastType, message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let _id = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const tToast = useTranslations("toast");
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((type: ToastType, message: string) => {
    const id = ++_id;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      <div
        className="fixed bottom-4 right-4 pb-safe z-[var(--z-toast)] flex flex-col gap-2 pointer-events-none"
        aria-live="polite"
        aria-label={tToast("regionLabel")}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="fade-in pointer-events-auto flex items-start gap-3 max-w-sm px-4 py-3 rounded-[var(--radius-lg)] shadow-[var(--elev-lg)] border cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
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
            role="alert"
          >
            <span className="text-[length:var(--text-sm)] flex-1">{t.message}</span>
            <button
              className="shrink-0 opacity-60 hover:opacity-100 transition-opacity text-[length:var(--text-xs)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] rounded-[var(--radius-sm)]"
              onClick={(e) => {
                e.stopPropagation();
                remove(t.id);
              }}
              aria-label={tToast("close")}
            >
              &#x2715;
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
