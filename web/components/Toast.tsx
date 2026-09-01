"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

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
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none"
        aria-live="polite"
        aria-label="Notifications"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="fade-in pointer-events-auto flex items-start gap-3 max-w-sm px-4 py-3 rounded-lg shadow-lg border cursor-pointer"
            style={{
              background: t.type === "success" ? "#f0fdf4"
                : t.type === "error" ? "#fef2f2"
                : t.type === "warning" ? "#fffbeb"
                : "#ffffff",
              borderColor: "#e5e7eb",
              color: t.type === "success" ? "#166534"
                : t.type === "error" ? "#991b1b"
                : t.type === "warning" ? "#92400e"
                : "#111827",
            }}
            onClick={() => remove(t.id)}
            role="alert"
          >
            <span className="text-sm flex-1">{t.message}</span>
            <button
              className="shrink-0 opacity-60 hover:opacity-100 transition-opacity text-xs"
              onClick={(e) => { e.stopPropagation(); remove(t.id); }}
              aria-label="Close"
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
