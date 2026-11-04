// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: mocks.api, ApiError: class ApiError extends Error {} }));

import { RemoteViewer } from "@/components/remote-control/RemoteViewer";

const DELETE_PATH = "/api/v1/remote-control/sess-1?workspaceId=ws-1";

type StateCb = (state: "connecting" | "connected" | "disconnected" | "failed" | "closed") => void;

interface SessionStub {
  state: string;
  onRemoteStream: ReturnType<typeof vi.fn>;
  onStateChange: ReturnType<typeof vi.fn>;
  sendInputEvent: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  emitStream: (stream: MediaStream) => void;
  emitState: (state: Parameters<StateCb>[0]) => void;
}

function makeSession(state = "connecting"): SessionStub {
  const streamCbs: Array<(s: MediaStream) => void> = [];
  const stateCbs: StateCb[] = [];
  return {
    state,
    onRemoteStream: vi.fn((cb: (s: MediaStream) => void) => {
      streamCbs.push(cb);
      return vi.fn();
    }),
    onStateChange: vi.fn((cb: StateCb) => {
      stateCbs.push(cb);
      return vi.fn();
    }),
    sendInputEvent: vi.fn(),
    close: vi.fn(),
    emitStream: (stream) => streamCbs.forEach((cb) => cb(stream)),
    emitState: (next) => stateCbs.forEach((cb) => cb(next)),
  };
}

function renderViewer(session: SessionStub, onEnd = vi.fn()) {
  const utils = render(
    <RemoteViewer
      sessionId="sess-1"
      workspaceId="ws-1"
      role="controller"
      session={session as never}
      onEnd={onEnd}
    />,
  );
  return { ...utils, session, onEnd };
}

/** 视频区取整：左 100 / 上 50 / 宽 200 / 高 100，便于断言归一化坐标 */
function stubVideoRect(container: HTMLElement) {
  const video = container.querySelector("video") as HTMLVideoElement;
  video.getBoundingClientRect = () =>
    ({
      left: 100,
      top: 50,
      width: 200,
      height: 100,
      right: 300,
      bottom: 150,
      x: 100,
      y: 50,
      toJSON: () => ({}),
    }) as DOMRect;
  return video;
}

beforeAll(() => {
  // jsdom 未实现媒体播放：组件在流到达时会调 play().catch(...)
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    writable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
});

beforeEach(() => {
  // restoreAllMocks 会把上面的 vi.fn() 还原成「返回 undefined」，之后 .catch 会炸 —— 每个用例重建
  (HTMLMediaElement.prototype.play as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
    undefined,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RemoteViewer", () => {
  it("连接中：状态栏 connecting、连接遮罩、无流提示不渲染", () => {
    mocks.api.mockImplementation(async () => ({}));
    const { container } = renderViewer(makeSession("connecting"));

    expect(screen.getByText("remoteControl:youAreControlling")).toBeInTheDocument();
    // 状态栏与连接遮罩各一处
    expect(screen.getAllByText("remoteControl:connecting")).toHaveLength(2);
    expect(screen.queryByText("remoteControl:screenShare")).not.toBeInTheDocument();
    expect(container.querySelector("video")).toHaveStyle({ display: "none" });
  });

  it("已连接：状态点 + 底部输入提示栏 + 无流提示", async () => {
    mocks.api.mockImplementation(async () => ({}));
    const session = makeSession("connecting");
    renderViewer(session);

    await act(async () => {
      session.emitState("connected");
    });
    expect(screen.getByText("remoteControl:connected")).toBeInTheDocument();
    expect(screen.getByText(/remoteControl:inputControl/)).toBeInTheDocument();
    expect(screen.getByText("remoteControl:screenShare")).toBeInTheDocument();
  });

  it("断开与失败：错误遮罩出现且带结束按钮", async () => {
    mocks.api.mockImplementation(async () => ({}));
    const session = makeSession("connecting");
    const { unmount } = renderViewer(session);

    await act(async () => {
      session.emitState("disconnected");
    });
    // 状态栏与错误遮罩各一处
    expect(screen.getAllByText("remoteControl:disconnected")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "remoteControl:end" })).toHaveLength(2);
    unmount();

    const failing = makeSession("connecting");
    renderViewer(failing);
    await act(async () => {
      failing.emitState("failed");
    });
    expect(screen.getAllByText("remoteControl:failed").length).toBeGreaterThanOrEqual(1);
  });

  it("远程流到达：video 显示、srcObject 绑定并自动播放", async () => {
    mocks.api.mockImplementation(async () => ({}));
    const session = makeSession("connecting");
    const { container } = renderViewer(session);
    const video = stubVideoRect(container);
    const stream = { id: "stream-1" } as unknown as MediaStream;

    await act(async () => {
      session.emitStream(stream);
    });

    expect(video.srcObject).toBe(stream);
    expect(video).toHaveStyle({ display: "block" });
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it("鼠标移动/按下/抬起/双击/滚轮按真实形状发送（归一化坐标 + 按钮映射）", async () => {
    mocks.api.mockImplementation(async () => ({}));
    const session = makeSession("connected");
    const { container } = renderViewer(session);
    const video = stubVideoRect(container);

    fireEvent.mouseMove(video, { clientX: 150, clientY: 75 });
    fireEvent.mouseDown(video, { clientX: 300, clientY: 150, button: 2 });
    fireEvent.mouseUp(video, { clientX: 100, clientY: 50, button: 1 });
    fireEvent.doubleClick(video, { clientX: 200, clientY: 100, button: 0 });
    fireEvent.wheel(video, { clientX: 150, clientY: 75, deltaY: 120 });

    expect(session.sendInputEvent.mock.calls.map((c) => c[0])).toEqual([
      { type: "mouse-move", x: 0.25, y: 0.25 },
      { type: "mouse-click", x: 1, y: 1, button: "right", action: "down" },
      { type: "mouse-click", x: 0, y: 0, button: "middle", action: "up" },
      { type: "mouse-click", x: 0.5, y: 0.5, button: "left", action: "double" },
      { type: "mouse-scroll", x: 0.25, y: 0.25, deltaY: 120 },
    ]);
  });

  it("键盘事件：方向键阻止默认行为并带修饰键发送", async () => {
    mocks.api.mockImplementation(async () => ({}));
    const session = makeSession("connected");
    const { container } = renderViewer(session);
    const root = container.firstElementChild as HTMLElement;

    const event = new KeyboardEvent("keydown", {
      key: "ArrowUp",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(root, event);

    expect(event.defaultPrevented).toBe(true);
    expect(session.sendInputEvent).toHaveBeenCalledWith({
      type: "key-press",
      key: "ArrowUp",
      action: "down",
      modifiers: { ctrl: true, shift: false, alt: false, meta: false },
    });

    fireEvent.keyUp(root, { key: "a", shiftKey: true });
    expect(session.sendInputEvent).toHaveBeenLastCalledWith({
      type: "key-press",
      key: "a",
      action: "up",
      modifiers: { ctrl: false, shift: true, alt: false, meta: false },
    });
  });

  it("未连接状态下不发送任何输入事件", () => {
    mocks.api.mockImplementation(async () => ({}));
    const session = makeSession("connecting");
    const { container } = renderViewer(session);
    const video = stubVideoRect(container);

    fireEvent.mouseMove(video, { clientX: 150, clientY: 75 });
    fireEvent.mouseDown(video, { clientX: 150, clientY: 75 });
    fireEvent.wheel(video, { clientX: 150, clientY: 75, deltaY: 10 });
    fireEvent.keyDown(container.firstElementChild as HTMLElement, { key: "a" });

    expect(session.sendInputEvent).not.toHaveBeenCalled();
  });

  it("结束会话：关闭连接 + DELETE + onEnd；删除失败也照样回调", async () => {
    mocks.api.mockImplementation(async () => ({}));
    const first = renderViewer(makeSession("connected"));
    fireEvent.click(screen.getAllByRole("button", { name: "remoteControl:end" })[0]);
    await waitFor(() => expect(first.onEnd).toHaveBeenCalledTimes(1));
    expect(first.session.close).toHaveBeenCalledTimes(1);
    expect(mocks.api).toHaveBeenCalledWith(DELETE_PATH, { method: "DELETE" });
    first.unmount();

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.api.mockImplementation(async () => {
      throw new Error("end-boom");
    });
    const second = renderViewer(makeSession("connected"));
    fireEvent.click(screen.getAllByRole("button", { name: "remoteControl:end" })[0]);
    await waitFor(() => expect(second.onEnd).toHaveBeenCalledTimes(1));
    expect(errSpy).toHaveBeenCalled();
  });

  it("全屏切换：进入与退出分别调用 requestFullscreen / exitFullscreen", async () => {
    mocks.api.mockImplementation(async () => ({}));
    const requestFullscreen = vi.fn(async () => {});
    const exitFullscreen = vi.fn(async () => {});
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      writable: true,
      value: requestFullscreen,
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      writable: true,
      value: exitFullscreen,
    });

    const { container } = renderViewer(makeSession("connected"));
    fireEvent.click(screen.getByTitle("remoteControl:fullscreen"));
    await waitFor(() => expect(requestFullscreen).toHaveBeenCalledTimes(1));

    // 模拟浏览器进入全屏
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => container.firstElementChild,
    });
    fireEvent(document, new Event("fullscreenchange"));
    expect(screen.getByTitle("remoteControl:fullscreen").querySelector("svg")).toHaveClass(
      "lucide-minimize-2",
    );

    fireEvent.click(screen.getByTitle("remoteControl:fullscreen"));
    await waitFor(() => expect(exitFullscreen).toHaveBeenCalledTimes(1));
  });
});
