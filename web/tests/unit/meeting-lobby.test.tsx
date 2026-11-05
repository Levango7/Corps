// @vitest-environment jsdom
/**
 * MeetingLobby 覆盖边界说明
 *
 * 组件本体只做三件事：标题区渲染、deviceError 气泡、joining 后换成"加入中"。
 * 设备检测/预览全部由 `@livekit/components-react` 的 <PreJoin> 承担，其内部会调用
 * navigator.mediaDevices.getUserMedia / Room.getLocalDevices —— jsdom 没有这些实现，
 * 真实 PreJoin 在测试环境里必然抛错，因此这里把 PreJoin 换成最小桩：
 *   - 桩把收到的 props 渲染成可断言的 DOM（username 默认值、joinLabel 等），
 *     并暴露 onSubmit / onError 两个按钮，用来驱动组件的两条回调分支。
 * 据此实测覆盖：props 透传、onSubmit→joining+onJoin、onError→错误气泡，
 * 以及 onCancel 的按钮点击。未覆盖（需真机/浏览器）：真实设备枚举、轨道预览、
 * usePersistentUserChoices 的 localStorage 持久化（属 LiveKit SDK 行为，非本组件逻辑）。
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ api: vi.fn(), apiList: vi.fn() }));

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
vi.mock("@/lib/api", () => ({ api: mocks.api, apiList: mocks.apiList }));

// PreJoin 最小桩：把 props 落成可断言的 DOM，并提供触发 onSubmit / onError 的入口
vi.mock("@livekit/components-react", () => ({
  PreJoin: (props: {
    defaults?: { username?: string; audioEnabled?: boolean; videoEnabled?: boolean };
    onSubmit?: (values: unknown) => void;
    onError?: (error: Error) => void;
    joinLabel?: string;
    micLabel?: string;
    camLabel?: string;
    userLabel?: string;
    className?: string;
  }) => (
    <div
      data-testid="prejoin"
      data-username={props.defaults?.username ?? ""}
      data-audio={String(props.defaults?.audioEnabled)}
      data-video={String(props.defaults?.videoEnabled)}
      data-mic={props.micLabel}
      data-cam={props.camLabel}
      data-user={props.userLabel}
      className={props.className}
    >
      <button
        type="button"
        onClick={() => props.onSubmit?.({ username: props.defaults?.username ?? "" })}
      >
        {props.joinLabel}
      </button>
      <button type="button" onClick={() => props.onError?.(new Error("麦克风被占用"))}>
        trigger-prejoin-error
      </button>
    </div>
  ),
  // MeetingLobby 只用到 PreJoin；其余导出给同目录其它组件测试兜底
  LocalUserChoices: undefined,
}));

import { MeetingLobby } from "@/components/meetings/MeetingLobby";

beforeEach(() => {
  mocks.api.mockReset();
  mocks.apiList.mockReset();
});
afterEach(() => cleanup());

describe("MeetingLobby", () => {
  it("渲染会议标题、副标题与设备检测区标题", () => {
    render(<MeetingLobby meetingTitle="产品评审会" onJoin={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("产品评审会");
    expect(screen.getByText("meetings.room:lobbySubtitle")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "meetings.room:testDevices",
    );
    expect(screen.getByTestId("prejoin")).toBeInTheDocument();
  });

  it("底部提示与返回按钮文案走 meetings.room ns", () => {
    render(<MeetingLobby meetingTitle="X" onJoin={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText("meetings.room:lobbyHint")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "meetings.room:leave" })).toBeInTheDocument();
  });

  it("点击返回按钮调用 onCancel", () => {
    const onCancel = vi.fn();
    render(<MeetingLobby meetingTitle="X" onJoin={vi.fn()} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole("button", { name: "meetings.room:leave" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("currentUserName 透传给 PreJoin 的 defaults.username；未传时为空串", () => {
    const { unmount } = render(
      <MeetingLobby meetingTitle="X" currentUserName="张三" onJoin={vi.fn()} onCancel={vi.fn()} />,
    );
    const prejoin = screen.getByTestId("prejoin");
    expect(prejoin.getAttribute("data-username")).toBe("张三");
    expect(prejoin.getAttribute("data-audio")).toBe("true");
    expect(prejoin.getAttribute("data-video")).toBe("true");
    unmount();

    render(<MeetingLobby meetingTitle="X" onJoin={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByTestId("prejoin").getAttribute("data-username")).toBe("");
  });

  it("PreJoin 的标签文案全部来自 meetings.room ns", () => {
    render(<MeetingLobby meetingTitle="X" onJoin={vi.fn()} onCancel={vi.fn()} />);
    const prejoin = screen.getByTestId("prejoin");

    expect(prejoin.getAttribute("data-mic")).toBe("meetings.room:micOn");
    expect(prejoin.getAttribute("data-cam")).toBe("meetings.room:cameraOn");
    expect(prejoin.getAttribute("data-user")).toBe("meetings.room:username");
    expect(screen.getByRole("button", { name: "meetings.room:joinNow" })).toBeInTheDocument();
  });

  it("PreJoin 提交：调用 onJoin，并把设备区换成 joining 加载态（PreJoin 卸载）", () => {
    const onJoin = vi.fn();
    render(<MeetingLobby meetingTitle="X" onJoin={onJoin} onCancel={vi.fn()} />);

    expect(screen.queryByText("meetings.room:joining")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "meetings.room:joinNow" }));

    expect(onJoin).toHaveBeenCalledTimes(1);
    expect(screen.getByText("meetings.room:joining")).toBeInTheDocument();
    expect(screen.queryByTestId("prejoin")).toBeNull();
  });

  it("PreJoin 报错：显示设备错误气泡（e.message），且不触发 onJoin", () => {
    const onJoin = vi.fn();
    render(<MeetingLobby meetingTitle="X" onJoin={onJoin} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "trigger-prejoin-error" }));

    expect(screen.getByText("麦克风被占用")).toBeInTheDocument();
    expect(onJoin).not.toHaveBeenCalled();
    // 报错后仍停留在设备选择态，用户可重试
    expect(screen.getByTestId("prejoin")).toBeInTheDocument();
    expect(screen.queryByText("meetings.room:joining")).toBeNull();
  });

  it("报错后再提交：错误气泡保留，但状态切到 joining", () => {
    render(<MeetingLobby meetingTitle="X" onJoin={vi.fn()} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "trigger-prejoin-error" }));
    expect(screen.getByText("麦克风被占用")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "meetings.room:joinNow" }));
    // deviceError 未在提交时清空，气泡依旧可见（源码行为）
    expect(screen.getByText("麦克风被占用")).toBeInTheDocument();
    expect(screen.getByText("meetings.room:joining")).toBeInTheDocument();
  });

  it("组件自身不发任何 API 请求（join 由父组件在 onJoin 里做）", () => {
    const onJoin = vi.fn();
    render(<MeetingLobby meetingTitle="X" onJoin={onJoin} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "meetings.room:joinNow" }));
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.apiList).not.toHaveBeenCalled();
  });

  it("标题按传入值原样渲染（不做翻译/截断）", () => {
    render(
      <MeetingLobby
        meetingTitle="  跨部门联席会议 — Q3 复盘  "
        onJoin={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "  跨部门联席会议 — Q3 复盘  ",
    );
  });

  it("重复提交是幂等的（onJoin 每次点击各触发一次，状态不会自愈）", () => {
    const onJoin = vi.fn();
    render(<MeetingLobby meetingTitle="X" onJoin={onJoin} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "meetings.room:joinNow" }));
    // 提交后 PreJoin 已卸载，按钮不存在 → 无法二次提交
    expect(screen.queryByRole("button", { name: "meetings.room:joinNow" })).toBeNull();
    expect(onJoin).toHaveBeenCalledTimes(1);
  });
});
