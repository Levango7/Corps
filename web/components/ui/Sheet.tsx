"use client";

import { Dialog, type DialogProps } from "./Dialog";
import { cn } from "./cn";

/**
 * Sheet —— 贴边抽屉。刻意**复用 Dialog** 而不是再写一套模态：
 * 焦点圈闭、Esc、语义、portal 挂载点这四件事已经在 Dialog 里做对了，
 * 复制一份只会让两者慢慢分叉（本仓库刚因为两套聊天实现付过一次代价）。
 *
 * 与 Dialog 的差异只有布局：面板满高、贴左/贴右、无圆角。
 */
export interface SheetProps extends Omit<DialogProps, "align" | "panelClassName"> {
  side?: "right" | "left";
}

export function Sheet({ side = "right", ...rest }: SheetProps) {
  return (
    <Dialog
      {...rest}
      align="right"
      panelClassName={cn(
        "h-full max-h-full w-full max-w-sm rounded-none shadow-lg overflow-y-auto",
        // 遮罩是 justify-end：把面板推回左边靠 mr-auto，而不是再复制一套定位
        side === "left" && "mr-auto",
      )}
    />
  );
}
