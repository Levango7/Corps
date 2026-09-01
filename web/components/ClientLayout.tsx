"use client";

import type { ReactNode } from "react";
import { ToastProvider } from "@/components/Toast";

export default function ClientLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <div className="page-enter">{children}</div>
    </ToastProvider>
  );
}
