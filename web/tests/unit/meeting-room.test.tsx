// @vitest-environment jsdom
/**
 * MeetingRoom 覆盖边界说明
 *
 * 本组件是 LiveKit 的薄封装：真实信令、WebRTC 协商、getUserMedia 采集、轨道发布
 * 全在 <LiveKitRoom>/<VideoConference> 与 livekit-client 内部完成。jsdom 没有
 * RTCPeerConnection / WebSocket / navigator.mediaDevices / 媒体轨道，因此这里把
 * `@livekit/components-react` 换成最小桩：LiveKitRoom 只把 token/serverUrl 落成
 * data-*（真机由此发起连接），VideoConference / RoomAudioRenderer 占位，
 * useParticipants / useLocalParticipant / useDataChannel 返回固定快照。
 *
 * ✅ 源码行为（2026-11-07 修复 joining 死锁后）
 *   join 成功后 state 推进为 "connecting"，主界面（LiveKitRoom）挂载并自行连接，
 *   onConnected 到达后翻 "connected" 并启动通话计时——互等死锁解除。
 *   用例「join 成功 → lk-room 渲染且凭据透传」钉住该修复（防回归）。
 *   仍未覆盖（后续可扩展）：onDisconnected / onError、重连（rejoin + 30s 超时）、
 *   通话计时推进、录制条、举手、主持人转移——分支已有 DOM 可达入口，但涉及
 *   计时器与桩回调编排，留待专门批次。
 *
 * 未覆盖（需真机/浏览器）：RTCPeerConnection 协商、轨道采集与渲染、LiveKit 信令。
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  apiList: vi.fn(),
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() },
}));

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
vi.mock("@/lib/api", async () => {
  // ApiError 保留真实实现（组件用 instanceof + status/code 判定 503），只替换 api/apiList
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { api: mocks.api, apiList: mocks.apiList, ApiError: actual.ApiError };
});
vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useParams: () => ({}),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@livekit/components-react", async () => {
  const React = await import("react");
  type RoomProps = { token?: string; serverUrl?: string; children?: React.ReactNode };
  /**
   * 只见 token/serverUrl 的占位房间：真机在此发起 RTCPeerConnection 协商。
   * 若源码修复了 joining 死锁，组件会渲染出 lk-room，用例即可断言凭据透传。
   */
  const LiveKitRoom = (props: RoomProps) =>
    React.createElement(
      "div",
      { "data-testid": "lk-room", "data-token": props.token, "data-url": props.serverUrl },
      props.children,
    );
  const VideoConference = () => React.createElement("div", { "data-testid": "lk-video" });
  const RoomAudioRenderer = () => React.createElement("div", { "data-testid": "lk-audio" });
  // 以下 hooks 只有在 LiveKitRoom 渲染后才被调用；先给空实现避免 import 期缺失
  const useParticipants = () => [];
  const useLocalParticipant = () => ({
    localParticipant: { identity: "u1", name: "我", metadata: "{}", setMetadata: vi.fn() },
  });
  const useDataChannel = () => ({ send: vi.fn(), message: undefined });
  return {
    LiveKitRoom,
    VideoConference,
    RoomAudioRenderer,
    useParticipants,
    useLocalParticipant,
    useDataChannel,
  };
});

import { MeetingRoom } from "@/components/meetings/MeetingRoom";

const JOIN_OK = { token: "jwt-token-1", url: "wss://lk.example.com", roomName: "room-1" };
const LEAVE_URL = "/api/v1/workspaces/w1/meetings/m1/leave";

/** 默认桩：join 成功 + 自己是创建者（host） */
function stubHappyPath() {
  mocks.api.mockImplementation((path: string, opts?: RequestInit) => {
    if (path.endsWith("/join") && opts?.method === "POST") return Promise.resolve(JOIN_OK);
    if (path === "/api/v1/users/me") return Promise.resolve({ id: "u1" });
    if (path.endsWith("/leave")) return Promise.resolve({});
    if (path.includes("/conversations/")) return Promise.resolve({});
    return Promise.resolve({ createdBy: "u1", participants: [] });
  });
}

/** 等首屏三个请求落地（join + users/me + 详情） */
async function waitReady() {
  await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(3));
  await act(async () => {
    await Promise.resolve();
  });
}

let sendBeacon: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mocks.api.mockReset();
  mocks.apiList.mockReset();
  mocks.router.push.mockReset();
  sendBeacon = vi.fn(() => true);
  Object.defineProperty(navigator, "sendBeacon", { value: sendBeacon, configurable: true });
});
afterEach(() => cleanup());

describe("MeetingRoom · 挂载请求与入口态", () => {
  it("首调是 POST join（精确 URL、不带 body），随后并行拉 users/me 与会议详情（裸 GET）", async () => {
    stubHappyPath();
    render(<MeetingRoom workspaceId="w7" meetingId="m7" />);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(3));

    expect(mocks.api.mock.calls.map((c) => c[0])).toEqual([
      "/api/v1/workspaces/w7/meetings/m7/join",
      "/api/v1/users/me",
      "/api/v1/workspaces/w7/meetings/m7",
    ]);
    expect((mocks.api.mock.calls[0][1] as RequestInit).method).toBe("POST");
    expect((mocks.api.mock.calls[0][1] as RequestInit).body).toBeUndefined();
    expect(mocks.api.mock.calls[2][1]).toBeUndefined();
  });

  it("挂载即 joining 态：role=status + 加入中，无 VideoConference/音频渲染", () => {
    mocks.api.mockImplementation(() => new Promise(() => {}));
    render(<MeetingRoom workspaceId="w1" meetingId="m1" />);

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("meetings.room:joining")).toBeInTheDocument();
    expect(screen.queryByTestId("lk-video")).toBeNull();
    expect(screen.queryByTestId("lk-audio")).toBeNull();
  });

  it("会议详情失败不阻塞：无 alert，仍停在 joining", async () => {
    mocks.api.mockImplementation((path: string, opts?: RequestInit) => {
      if (path.endsWith("/join") && opts?.method === "POST") return Promise.resolve(JOIN_OK);
      if (path === "/api/v1/users/me") return Promise.resolve({ id: "u1" });
      return Promise.reject(new Error("detail down"));
    });
    render(<MeetingRoom workspaceId="w1" meetingId="m1" />);
    await waitReady();

    expect(screen.queryByRole("alert")).toBeNull();
    // join 成功已翻 connecting（死锁修复后）：详情失败不阻塞，房间照常渲染
    expect(screen.queryByText("meetings.room:joining")).toBeNull();
    expect(screen.getByTestId("lk-room")).toBeInTheDocument();
  });

  it("重渲染不重复 join（joinedRef 防重）", async () => {
    stubHappyPath();
    const view = render(<MeetingRoom workspaceId="w1" meetingId="m1" />);
    await waitReady();
    view.rerender(<MeetingRoom workspaceId="w1" meetingId="m1" />);

    expect(mocks.api.mock.calls.filter((c) => String(c[0]).endsWith("/join")).length).toBe(1);
  });

  it("join 成功 → 退出 joining，LiveKitRoom 渲染且 token/serverUrl 透传（2026-11-07 死锁修复回归）", async () => {
    stubHappyPath();
    render(<MeetingRoom workspaceId="w1" meetingId="m1" />);
    await waitReady();

    // 全屏加入中页已被主界面取代，房间挂载并拿到凭据
    expect(screen.queryByText("meetings.room:joining")).toBeNull();
    const room = screen.getByTestId("lk-room");
    expect(room.getAttribute("data-token")).toBe("jwt-token-1");
    expect(room.getAttribute("data-url")).toBe("wss://lk.example.com");
  });
});

describe("MeetingRoom · join 失败分支", () => {
  it("非 503：alert 显示 connectionFailed + 后端 e.message，且不再拉用户/详情", async () => {
    const { ApiError } = await import("@/lib/api");
    mocks.api.mockImplementation((path: string) => {
      if (path.endsWith("/join")) return Promise.reject(new ApiError("meetingFull", 409, 409));
      return Promise.resolve({});
    });
    render(<MeetingRoom workspaceId="w1" meetingId="m1" />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("meetings.room:connectionFailed");
    expect(alert).toHaveTextContent("meetingFull");
    expect(alert).not.toHaveTextContent("meetings.room:serviceUnavailable");
    expect(mocks.api.mock.calls.length).toBe(1);
  });

  it("非 Error 拒绝：回退到 connectionFailed 文案（标题 + 详情两处）", async () => {
    mocks.api.mockImplementation(() => Promise.reject("plain-string"));
    render(<MeetingRoom workspaceId="w1" meetingId="m1" />);

    await screen.findByRole("alert");
    expect(screen.getAllByText("meetings.room:connectionFailed").length).toBe(2);
  });

  it("503（status 或 code 任一命中）：serviceUnavailable 分支，不显示后端原文", async () => {
    const { ApiError } = await import("@/lib/api");
    mocks.api.mockImplementation((path: string) => {
      if (path.endsWith("/join")) return Promise.reject(new ApiError("服务器内部错误", 503, 500));
      return Promise.resolve({});
    });
    const first = render(<MeetingRoom workspaceId="w1" meetingId="m1" />);
    let alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("meetings.room:serviceUnavailable");
    expect(alert).toHaveTextContent("meetings.room:serviceUnavailableHint");
    expect(alert).not.toHaveTextContent("服务器内部错误");
    expect(alert).not.toHaveTextContent("meetings.room:connectionFailed");
    first.unmount();

    mocks.api.mockReset();
    mocks.api.mockImplementation((path: string) => {
      if (path.endsWith("/join")) return Promise.reject(new ApiError("oops", 500, 503));
      return Promise.resolve({});
    });
    render(<MeetingRoom workspaceId="w1" meetingId="m1" />);
    alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("meetings.room:serviceUnavailable");
    expect(alert).not.toHaveTextContent("oops");
  });
});

describe("MeetingRoom · 离开与页面生命周期", () => {
  it("错误态点离开：POST leave + onLeave + 跳回 IM 列表，重复点击只发一次", async () => {
    const { ApiError } = await import("@/lib/api");
    const onLeave = vi.fn();
    mocks.api.mockImplementation((path: string) => {
      if (path.endsWith("/join")) return Promise.reject(new ApiError("boom", 500, 500));
      return Promise.resolve({});
    });
    render(<MeetingRoom workspaceId="w1" meetingId="m1" onLeave={onLeave} />);

    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "meetings.room:leave" }));
    await waitFor(() => expect(onLeave).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "meetings.room:leave" }));
    await act(async () => {
      await Promise.resolve();
    });
    const leaves = mocks.api.mock.calls.filter((c) => String(c[0]).endsWith("/leave"));
    expect(leaves.length).toBe(1);
    expect(leaves[0][0]).toBe(LEAVE_URL);
    expect((leaves[0][1] as RequestInit).method).toBe("POST");
    expect(mocks.router.push).toHaveBeenCalledWith("/w/w1/im");
  });

  it("带 conversationId 离开：额外 POST call_ended 消息并跳回该会话", async () => {
    const { ApiError } = await import("@/lib/api");
    mocks.api.mockImplementation((path: string) => {
      if (path.endsWith("/join")) return Promise.reject(new ApiError("boom", 500, 500));
      return Promise.resolve({});
    });
    render(<MeetingRoom workspaceId="w1" meetingId="m1" conversationId="c9" />);

    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "meetings.room:leave" }));

    await waitFor(() =>
      expect(
        mocks.api.mock.calls.some(
          (c) => c[0] === "/api/v1/workspaces/w1/conversations/c9/messages",
        ),
      ).toBe(true),
    );
    const msg = mocks.api.mock.calls.find((c) => String(c[0]).includes("/conversations/"))!;
    expect((msg[1] as RequestInit).method).toBe("POST");
    expect(JSON.parse((msg[1] as RequestInit).body as string)).toEqual({
      type: "call_ended",
      body: "",
    });
    expect(mocks.router.push).toHaveBeenCalledWith("/w/w1/im/c9");
  });

  it("pagehide：sendBeacon 发 leave + call_ended Blob；二次事件与卸载都不重复上报", async () => {
    stubHappyPath();
    const view = render(<MeetingRoom workspaceId="w1" meetingId="m1" conversationId="c3" />);
    await waitReady();

    window.dispatchEvent(new Event("pagehide"));
    expect(sendBeacon).toHaveBeenCalledTimes(2);
    expect(sendBeacon.mock.calls[0][0]).toBe(LEAVE_URL);
    expect(sendBeacon.mock.calls[1][0]).toBe("/api/v1/workspaces/w1/conversations/c3/messages");
    const blob = sendBeacon.mock.calls[1][1] as Blob;
    expect(blob.type).toBe("application/json");
    expect(await blob.text()).toBe(JSON.stringify({ type: "call_ended", body: "" }));

    sendBeacon.mockClear();
    window.dispatchEvent(new Event("beforeunload"));
    expect(sendBeacon).not.toHaveBeenCalled();

    view.unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.api.mock.calls.some((c) => String(c[0]).endsWith("/leave"))).toBe(false);
  });

  it("无 conversationId 时 beforeunload 只发一个 beacon（无第二个参数）", async () => {
    stubHappyPath();
    render(<MeetingRoom workspaceId="w1" meetingId="m1" />);
    await waitReady();

    window.dispatchEvent(new Event("beforeunload"));
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon.mock.calls[0][0]).toBe(LEAVE_URL);
    expect(sendBeacon.mock.calls[0].length).toBe(1);
  });

  it("未触发 beacon 时卸载：POST leave 一次，失败不抛错", async () => {
    mocks.api.mockImplementation((path: string, opts?: RequestInit) => {
      if (path.endsWith("/join") && opts?.method === "POST") return Promise.resolve(JOIN_OK);
      if (path.endsWith("/leave")) return Promise.reject(new Error("network down"));
      if (path === "/api/v1/users/me") return Promise.resolve({ id: "u1" });
      return Promise.resolve({ createdBy: "u1", participants: [] });
    });
    const view = render(<MeetingRoom workspaceId="w1" meetingId="m1" />);
    await waitReady();

    expect(() => view.unmount()).not.toThrow();
    await act(async () => {
      await Promise.resolve();
    });
    const leaves = mocks.api.mock.calls.filter((c) => String(c[0]).endsWith("/leave"));
    expect(leaves.length).toBe(1);
    expect((leaves[0][1] as RequestInit).method).toBe("POST");
  });
});
