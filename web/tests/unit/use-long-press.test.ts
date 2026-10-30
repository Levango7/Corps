// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useLongPress } from "@/lib/use-long-press";

/**
 * useLongPress 契约（lib/use-long-press.ts）：
 *  - onPointerDown 启动计时，到期回调收到 **按下时坐标**（duration 内移动指针不改变坐标）
 *  - 提前松手（up）/移出（leave）/取消（cancel）都取消计时，不触发
 *  - onContextMenu：preventDefault（屏蔽原生菜单）+ 立即触发（移动端长按等效）
 *  - **卸载即清计时器**（防止 callback 在已卸载组件上调用 setState）
 *  - 自定义 delay 生效
 *
 * 事件对象只需 clientX/clientY（hook 不读其他字段），用最小对象即可。
 */
const evt = (x: number, y: number) => ({ clientX: x, clientY: y }) as React.PointerEvent;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("基本触发", () => {
  it("按住 500ms（默认）：回调收到按下时坐标", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb));
    act(() => result.current.onPointerDown(evt(10, 20)));
    expect(cb).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ x: 10, y: 20 });
  });

  it("未满 delay 不触发", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb, 500));
    act(() => result.current.onPointerDown(evt(1, 2)));
    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(cb).not.toHaveBeenCalled();
  });

  it("自定义 delay 生效", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb, 200));
    act(() => result.current.onPointerDown(evt(3, 4)));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(cb).toHaveBeenCalledWith({ x: 3, y: 4 });
  });

  it("坐标取按下时刻：期间指针移动不影响回调坐标（hook 不做 move 追踪）", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb));
    act(() => result.current.onPointerDown(evt(5, 6)));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(cb).toHaveBeenCalledWith({ x: 5, y: 6 });
  });
});

describe("取消路径", () => {
  it("onPointerUp 提前松手：不触发", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb));
    act(() => result.current.onPointerDown(evt(1, 1)));
    act(() => result.current.onPointerUp());
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(cb).not.toHaveBeenCalled();
  });

  it("onPointerLeave / onPointerCancel 同样取消", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb));
    act(() => result.current.onPointerDown(evt(1, 1)));
    act(() => result.current.onPointerLeave());
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(cb).not.toHaveBeenCalled();

    act(() => result.current.onPointerDown(evt(2, 2)));
    act(() => result.current.onPointerCancel());
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(cb).not.toHaveBeenCalled();
  });

  it("重复 down 重置计时（以最后一次为准）", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb));
    act(() => result.current.onPointerDown(evt(1, 1)));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    act(() => result.current.onPointerDown(evt(9, 9))); // 重按
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(cb).not.toHaveBeenCalled(); // 距第一次已 600ms，但计时已重置
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ x: 9, y: 9 });
  });
});

describe("contextmenu（移动端长按等效）", () => {
  it("阻止默认菜单并立即回调（不等 delay）", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb));
    const preventDefault = vi.fn();
    act(() =>
      result.current.onContextMenu({ ...evt(7, 8), preventDefault } as unknown as React.MouseEvent),
    );
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ x: 7, y: 8 });
  });
});

describe("生命周期", () => {
  it("卸载即清计时器：之后推进时间不触发回调（防已卸载组件 setState）", () => {
    const cb = vi.fn();
    const { result, unmount } = renderHook(() => useLongPress(cb));
    act(() => result.current.onPointerDown(evt(1, 1)));
    unmount();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(cb).not.toHaveBeenCalled();
  });

  it("返回面完整：五个事件处理器都是函数", () => {
    const { result } = renderHook(() => useLongPress(vi.fn()));
    for (const k of [
      "onPointerDown",
      "onPointerUp",
      "onPointerLeave",
      "onPointerCancel",
      "onContextMenu",
    ] as const) {
      expect(typeof result.current[k]).toBe("function");
    }
  });
});
