// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";

/**
 * SyncStatus 契约（components/sync/SyncStatus.tsx，default 导出）：
 *  1. 初始 synced + 无 lastSync → 只显示 sync:synced，无相对时间
 *  2. 订阅状态：syncing/offline/error 各自图标与文案；syncing 时图标/按钮旋转
 *  3. pending 初始由 getPendingCount 拉取；>99 封顶 99+
 *  4. lastSync 相对时间：null→never、<60s→justNow、分/时/天
 *  5. 点同步按钮 → manager.syncNow()；syncing 时 disabled 不触发
 *  6. 卸载时解除两个订阅
 *  7. size=sm 用更小的行高类
 */

const mocks = vi.hoisted(() => {
  const statusListeners: ((s: string, lastSync: number | null) => void)[] = [];
  const pendingListeners: ((n: number) => void)[] = [];
  return {
    statusListeners,
    pendingListeners,
    offStatus: vi.fn(),
    offPending: vi.fn(),
    getPendingCount: vi.fn(),
    syncNow: vi.fn(),
    getSyncManager: vi.fn(),
  };
});

vi.mock("next-intl", () => {
  const cache = new Map<string, (key: string, vars?: Record<string, unknown>) => string>();
  const useTranslations = (ns: string) => {
    let fn = cache.get(ns);
    if (!fn) {
      const created = (key: string, vars?: Record<string, unknown>) =>
        vars ? `${ns}:${key}:${JSON.stringify(vars)}` : `${ns}:${key}`;
      cache.set(ns, created);
      fn = created;
    }
    return fn;
  };
  return { useTranslations };
});
vi.mock("@/lib/sync/sync-manager", () => ({ getSyncManager: mocks.getSyncManager }));

import SyncStatus from "@/components/sync/SyncStatus";

function installManager() {
  mocks.getSyncManager.mockReturnValue({
    onStatusChange: (cb: (s: string, lastSync: number | null) => void) => {
      mocks.statusListeners.push(cb);
      return mocks.offStatus;
    },
    onPendingChange: (cb: (n: number) => void) => {
      mocks.pendingListeners.push(cb);
      return mocks.offPending;
    },
    getPendingCount: mocks.getPendingCount,
    syncNow: mocks.syncNow,
  });
}

async function emitStatus(status: string, lastSync: number | null = null) {
  await act(async () => {
    mocks.statusListeners.forEach((cb) => cb(status, lastSync));
  });
}

async function emitPending(n: number) {
  await act(async () => {
    mocks.pendingListeners.forEach((cb) => cb(n));
  });
}

beforeEach(() => {
  mocks.statusListeners.length = 0;
  mocks.pendingListeners.length = 0;
  mocks.offStatus.mockReset();
  mocks.offPending.mockReset();
  mocks.getSyncManager.mockReset();
  mocks.getPendingCount.mockReset();
  mocks.getPendingCount.mockResolvedValue(0);
  mocks.syncNow.mockReset();
  installManager();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("SyncStatus", () => {
  it("初始 synced、无最后同步时间 → 仅状态文案", async () => {
    render(<SyncStatus workspaceId="ws-s1" />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-label", "sync:synced");
    expect(status).toHaveTextContent("sync:synced");
    // 无 lastSync 不渲染相对时间（never 也不该出现）
    expect(screen.queryByText(/sync:never/)).toBeFalsy();
    await waitFor(() => expect(mocks.getPendingCount).toHaveBeenCalledTimes(1));
  });

  it("syncing → label 与旋转图标；offline → CloudOff；error → AlertCircle", async () => {
    const { container } = render(<SyncStatus workspaceId="ws-s1" />);
    await emitStatus("syncing");
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "sync:syncing");
    expect(container.querySelector("svg.lucide-cloud")).toBeTruthy();
    expect(container.querySelector("svg.animate-spin")).toBeTruthy();

    await emitStatus("offline");
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "sync:offline");
    expect(container.querySelector("svg.lucide-cloud-off")).toBeTruthy();

    await emitStatus("error");
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "sync:error");
    expect(container.querySelector("svg.lucide-circle-alert")).toBeTruthy();
  });

  it("pending 初始拉取并渲染 badge；>99 封顶 99+", async () => {
    mocks.getPendingCount.mockResolvedValue(3);
    render(<SyncStatus workspaceId="ws-s1" />);

    await waitFor(() =>
      expect(screen.getByLabelText('sync:pending:{"count":3}')).toBeInTheDocument(),
    );
    expect(screen.getByText("3")).toBeInTheDocument();

    await emitPending(150);
    expect(screen.getByText("99+")).toBeInTheDocument();
    expect(screen.getByLabelText('sync:pending:{"count":150}')).toBeInTheDocument();
  });

  it("pending=0 不渲染 badge", async () => {
    render(<SyncStatus workspaceId="ws-s1" />);
    await emitPending(0);
    expect(screen.queryByLabelText(/sync:pending/)).toBeFalsy();
  });

  it("lastSync 相对时间：justNow / minutesAgo / hoursAgo / daysAgo", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
    const now = Date.now();

    render(<SyncStatus workspaceId="ws-s1" />);
    await emitStatus("synced", now - 5_000);
    expect(screen.getByText(/sync:justNow/)).toBeInTheDocument();

    await emitStatus("synced", now - 3 * 60_000);
    expect(screen.getByText(/sync:minutesAgo/)).toBeInTheDocument();

    await emitStatus("synced", now - 2 * 3_600_000);
    expect(screen.getByText(/sync:hoursAgo/)).toBeInTheDocument();

    await emitStatus("synced", now - 5 * 86_400_000);
    expect(screen.getByText(/sync:daysAgo/)).toBeInTheDocument();
  });

  it("lastSync=null → never", async () => {
    render(<SyncStatus workspaceId="ws-s1" />);
    await emitStatus("synced", null);
    expect(screen.queryByText(/sync:never/)).toBeFalsy();

    // 先有值再回到 null？源码只在 lastSync!==null 时渲染，never 分支仅在 formatRelativeTime 内
    // 这里固化现状：lastSync 为 null 时该分支不可达（见报告）
  });

  it("点同步按钮 → syncNow；syncing 时 disabled 且不触发", async () => {
    render(<SyncStatus workspaceId="ws-s1" />);
    await waitFor(() => expect(mocks.getPendingCount).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "sync:syncNow" }));
    expect(mocks.syncNow).toHaveBeenCalledTimes(1);

    await emitStatus("syncing");
    const btn = screen.getByRole("button", { name: "sync:syncNow" });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(mocks.syncNow).toHaveBeenCalledTimes(1);
  });

  it("卸载时解除 status/pending 两个订阅", () => {
    const { unmount } = render(<SyncStatus workspaceId="ws-s1" />);
    unmount();
    expect(mocks.offStatus).toHaveBeenCalledTimes(1);
    expect(mocks.offPending).toHaveBeenCalledTimes(1);
  });

  it("size=sm → h-7；默认 md → h-8", () => {
    const first = render(<SyncStatus workspaceId="ws-s1" />);
    expect(screen.getByRole("status").className).toContain("h-8");
    first.unmount();

    render(<SyncStatus workspaceId="ws-s1" size="sm" />);
    expect(screen.getByRole("status").className).toContain("h-7");
  });

  it("按 workspaceId 取 manager", () => {
    render(<SyncStatus workspaceId="ws-s7" />);
    expect(mocks.getSyncManager).toHaveBeenCalledWith("ws-s7");
  });
});
