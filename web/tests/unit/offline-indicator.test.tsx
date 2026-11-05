// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

/**
 * OfflineIndicator 契约（components/sync/OfflineIndicator.tsx，default 导出）：
 *  1. 常态在线（未收到 offline）→ 不渲染
 *  2. 状态转 offline → role=status 离线横幅（t("offlineBanner")）＋ WifiOff 图标
 *  3. 从离线恢复（syncing/synced/error）→ 恢复横幅（t("onlineRestored")）＋ Wifi 图标，
 *     3s 后自动隐藏
 *  4. 从未离线过时收到在线状态 → 保持隐藏（不显示恢复横幅）
 *  5. 恢复横幅期间再次离线 → 回到离线横幅并清除隐藏定时器
 *  6. 卸载时解除订阅并清理定时器
 */

const mocks = vi.hoisted(() => {
  const statusListeners: ((s: string, lastSync: number | null) => void)[] = [];
  return {
    statusListeners,
    offStatus: vi.fn(),
    getPendingCount: vi.fn(() => Promise.resolve(0)),
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
vi.mock("@/lib/sync/sync-manager", () => ({
  getSyncManager: mocks.getSyncManager,
}));

import OfflineIndicator from "@/components/sync/OfflineIndicator";

function installManager() {
  mocks.getSyncManager.mockReturnValue({
    onStatusChange: (cb: (s: string, lastSync: number | null) => void) => {
      mocks.statusListeners.push(cb);
      return mocks.offStatus;
    },
    onPendingChange: () => vi.fn(),
    getPendingCount: mocks.getPendingCount,
    syncNow: mocks.syncNow,
  });
}

/** 触发最近一次注册的状态回调（组件内 useEffect 注册） */
async function emitStatus(status: string, lastSync: number | null = null) {
  await act(async () => {
    mocks.statusListeners.forEach((cb) => cb(status, lastSync));
  });
}

beforeEach(() => {
  mocks.statusListeners.length = 0;
  mocks.offStatus.mockReset();
  mocks.getSyncManager.mockReset();
  installManager();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("OfflineIndicator", () => {
  it("常态在线 → 不渲染任何横幅", () => {
    const { container } = render(<OfflineIndicator workspaceId="ws-o1" />);
    expect(container.firstChild).toBeNull();
  });

  it("进入离线 → role=status 显示离线横幅与 WifiOff 图标", async () => {
    const { container } = render(<OfflineIndicator workspaceId="ws-o1" />);
    await emitStatus("offline");

    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("sync:offlineBanner");
    expect(banner.getAttribute("aria-live")).toBe("polite");
    expect(container.querySelector("svg.lucide-wifi-off")).toBeTruthy();
    expect(container.querySelector("svg.lucide-wifi")).toBeNull();
  });

  it("从离线恢复 → 恢复横幅与 Wifi 图标，3s 后自动隐藏", async () => {
    vi.useFakeTimers();
    const { container } = render(<OfflineIndicator workspaceId="ws-o1" />);
    await emitStatus("offline");
    await emitStatus("syncing");

    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("sync:onlineRestored");
    expect(container.querySelector("svg.lucide-wifi")).toBeTruthy();
    expect(container.querySelector("svg.lucide-wifi-off")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2999);
    });
    expect(screen.queryByRole("status")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.queryByRole("status")).toBeFalsy();
  });

  it("从未离线过时收到 synced/syncing → 保持隐藏（不出恢复横幅）", async () => {
    render(<OfflineIndicator workspaceId="ws-o1" />);
    await emitStatus("syncing");
    expect(screen.queryByRole("status")).toBeFalsy();
    await emitStatus("synced");
    expect(screen.queryByRole("status")).toBeFalsy();
  });

  it("恢复横幅显示中再次离线 → 立即回到离线横幅", async () => {
    render(<OfflineIndicator workspaceId="ws-o1" />);
    await emitStatus("offline");
    await emitStatus("synced");
    expect(screen.getByRole("status")).toHaveTextContent("sync:onlineRestored");

    await emitStatus("offline");
    expect(screen.getByRole("status")).toHaveTextContent("sync:offlineBanner");
  });

  it("离线后 synced 同样视为恢复（三种在线状态一致）", async () => {
    render(<OfflineIndicator workspaceId="ws-o1" />);
    await emitStatus("offline");
    await emitStatus("error");
    expect(screen.getByRole("status")).toHaveTextContent("sync:onlineRestored");
  });

  it("卸载时解除订阅并清理定时器", async () => {
    vi.useFakeTimers();
    const { unmount } = render(<OfflineIndicator workspaceId="ws-o1" />);
    await emitStatus("offline");
    await emitStatus("syncing");
    expect(screen.getByRole("status")).toBeInTheDocument();

    unmount();
    expect(mocks.offStatus).toHaveBeenCalledTimes(1);
    // 定时器已清：推进 3s 不应再报 setState on unmounted
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.queryByRole("status")).toBeFalsy();
  });

  it("按 workspaceId 取 sync manager（初始一次）", () => {
    render(<OfflineIndicator workspaceId="ws-o9" />);
    expect(mocks.getSyncManager).toHaveBeenCalledWith("ws-o9");
    expect(mocks.getSyncManager).toHaveBeenCalledTimes(1);
  });
});
