"use client";

/**
 * WebRTC 远程控制连接管理 · lib/webrtc/peer-connection.ts
 *
 * ─── 架构 ─────────────────────────────────────────────────────
 * 远程控制 = 屏幕共享（视频轨道）+ 输入事件传输（DataChannel）
 *
 *  被控方（Bob）                        控制方（Alice）
 *    │                                     │
 *    │── getDisplayMedia() ─→ 本地屏幕流   │
 *    │── addTrack(screenVideo) ─→          │
 *    │── createOffer() ──────────────────→ │ (通过信令)
 *    │                                     │── setRemoteDescription(offer)
 *    │←────── createAnswer() ──────────────│
 *    │── setRemoteDescription(answer)      │
 *    │                                     │
 *    │←════════ video track ═══════════════│ (ontrack → 渲染到 <video>)
 *    │←════════ DataChannel ═══════════════│ (双向，传输输入事件)
 *
 *  控制方 Alice 的键盘/鼠标事件 → DataChannel → 被控方 Bob 模拟输入
 *  （本模块只负责传输，实际模拟输入由被控方宿主环境处理）
 *
 * ─── DataChannel 协议 ────────────────────────────────────────
 * 输入事件以 JSON 序列化通过 DataChannel 传输，格式见 InputEvent。
 * DataChannel 配置：ordered=true, maxRetransmits=10（输入事件要求有序但允许丢包，
 * 超过 10 次重传仍失败则放弃——实时性优先于可靠性）。
 *
 * ─── SSR 安全 ────────────────────────────────────────────────
 * 所有 WebRTC API（RTCPeerConnection、navigator.mediaDevices）访问前检测
 * typeof window，服务端渲染时构造函数安全但所有方法抛出明确错误。
 */

import type { IceCandidatePayload } from "./signaling";

// ─── 输入事件类型 ──────────────────────────────────────────────

/** 输入事件类型标签 */
export type InputEventType = "mouse-move" | "mouse-click" | "mouse-scroll" | "key-press";

/** 鼠标按键 */
export type MouseButton = "left" | "right" | "middle";

/** 键盘修饰键 */
export interface KeyModifiers {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

/** 输入事件联合类型（判别联合，type 字段区分） */
export type InputEvent =
  | { type: "mouse-move"; x: number; y: number }
  | {
      type: "mouse-click";
      x: number;
      y: number;
      button: MouseButton;
      action: "down" | "up" | "double";
    }
  | { type: "mouse-scroll"; x: number; y: number; deltaY: number }
  | { type: "key-press"; key: string; modifiers?: KeyModifiers; action: "down" | "up" };

// ─── 会话状态 ──────────────────────────────────────────────────

/** 远程控制会话状态 */
export type RemoteControlSessionState =
  | "idle" // 初始/未开始
  | "initiating" // 正在创建 offer
  | "accepting" // 正在创建 answer
  | "connecting" // ICE 协商中
  | "connected" // 连接已建立
  | "disconnected" // 连接断开（可重连）
  | "failed" // 连接失败
  | "closed"; // 已主动关闭

/** 会话角色 */
export type SessionRole = "controller" | "controlled";

// ─── ICE 服务器配置 ────────────────────────────────────────────

/**
 * 仅 STUN 的回退配置（API 不可用或失败时使用）。
 *
 * 安全说明：STUN 仅用于候选地址发现，无需凭据，可安全内联到客户端 bundle。
 * TURN 凭证则必须通过服务端 API 动态签发短期令牌，禁止通过 NEXT_PUBLIC_ 前缀
 * 环境变量暴露（NEXT_PUBLIC_ 会在构建时内联到客户端 JS，凭据可被提取）。
 */
const STUN_ONLY_FALLBACK: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

/**
 * 从服务端 API 获取 ICE 服务器配置（含短期 TURN 凭证）。
 *
 * 安全模型：
 *  - TURN 凭证由服务端按需签发短期令牌（time-limited credentials），
 *    避免长期凭据暴露到客户端 bundle。
 *  - API 不可用或返回异常时，回退到仅 STUN 配置（无法穿越对称 NAT，但基本连通性保留）。
 *  - SSR 期间（typeof window === "undefined"）直接回退，不发起 fetch。
 *
 * @returns ICE 服务器配置数组
 */
async function fetchIceServers(): Promise<RTCIceServer[]> {
  // SSR 安全：服务端不发起 fetch，直接回退
  if (typeof window === "undefined") return STUN_ONLY_FALLBACK;
  try {
    const res = await fetch("/api/v1/remote-control/ice-servers");
    if (!res.ok) throw new Error(`ice-servers API responded ${res.status}`);
    const json = (await res.json()) as { data?: { iceServers?: RTCIceServer[] } };
    const servers = json.data?.iceServers;
    if (!Array.isArray(servers) || servers.length === 0) {
      return STUN_ONLY_FALLBACK;
    }
    return servers;
  } catch {
    // API 不可用或响应异常：回退到仅 STUN
    return STUN_ONLY_FALLBACK;
  }
}

// ─── 回调类型 ──────────────────────────────────────────────────

/** 远程流回调（收到对端视频/音频轨道时触发） */
export type RemoteStreamCallback = (stream: MediaStream) => void;

/** 输入事件回调（通过 DataChannel 收到对端输入事件时触发） */
export type InputEventCallback = (event: InputEvent) => void;

/** 状态变更回调 */
export type StateChangeCallback = (state: RemoteControlSessionState) => void;

/** SDP 就绪回调（offer/answer 创建完成，需通过信令发送给对端） */
export type SdpReadyCallback = (sdp: string, type: "offer" | "answer") => void;

/** ICE 候选就绪回调（需通过信令发送给对端） */
export type IceCandidateReadyCallback = (candidate: IceCandidatePayload) => void;

// ─── RemoteControlSession ──────────────────────────────────────

/** 会话配置 */
export interface RemoteControlSessionOptions {
  /** 会话角色：controller（控制方，发起请求）或 controlled（被控方，接受请求） */
  role: SessionRole;
  /** 会话 ID（由 API 创建会话时生成） */
  sessionId: string;
  /** DataChannel 标签（默认 "input"） */
  dataChannelLabel?: string;
}

/**
 * WebRTC 远程控制会话。
 *
 * 封装 RTCPeerConnection + DataChannel + 屏幕共享流管理。
 *
 * 用法（控制方 Alice）：
 *   const session = new RemoteControlSession({ role: "controller", sessionId });
 *   session.onRemoteStream((stream) => { videoEl.srcObject = stream; });
 *   session.onSdpReady((sdp, type) => { signaling.send({ type, sdp, ... }); });
 *   session.onIceCandidateReady((c) => { signaling.send({ type: "ice-candidate", candidate: c, ... }); });
 *   await session.initiate();  // 创建 offer
 *
 * 用法（被控方 Bob）：
 *   const session = new RemoteControlSession({ role: "controlled", sessionId });
 *   session.onInputEvent((e) => { simulateInput(e); });
 *   await session.startScreenShare();  // 获取屏幕流并加入连接
 *   await session.accept(offerSdp);     // 接收 offer，创建 answer
 */
export class RemoteControlSession {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private screenStream: MediaStream | null = null;

  private currentState: RemoteControlSessionState = "idle";
  private readonly role: SessionRole;
  private readonly sessionId: string;
  private readonly dataChannelLabel: string;

  // 回调集合
  private remoteStreamCallbacks = new Set<RemoteStreamCallback>();
  private inputEventCallbacks = new Set<InputEventCallback>();
  private stateChangeCallbacks = new Set<StateChangeCallback>();
  private sdpReadyCallbacks = new Set<SdpReadyCallback>();
  private iceCandidateReadyCallbacks = new Set<IceCandidateReadyCallback>();

  constructor(options: RemoteControlSessionOptions) {
    this.role = options.role;
    this.sessionId = options.sessionId;
    this.dataChannelLabel = options.dataChannelLabel ?? "input";
  }

  /** 当前会话状态 */
  get state(): RemoteControlSessionState {
    return this.currentState;
  }

  /** 会话角色 */
  get sessionRole(): SessionRole {
    return this.role;
  }

  /** 会话 ID */
  get id(): string {
    return this.sessionId;
  }

  // ─── 连接建立 ──────────────────────────────────────────────

  /**
   * 初始化底层 RTCPeerConnection。
   *
   * SSR 安全：服务端无 RTCPeerConnection，抛出明确错误。
   *
   * 异步：需先通过 fetchIceServers() 从服务端 API 获取短期 TURN 凭证，
   * 再创建 RTCPeerConnection。所有调用点必须 await。
   */
  private async ensurePeerConnection(): Promise<RTCPeerConnection> {
    if (this.peerConnection) return this.peerConnection;

    if (typeof window === "undefined" || typeof RTCPeerConnection === "undefined") {
      throw new Error("[webrtc] RTCPeerConnection unavailable (SSR or unsupported browser)");
    }

    // P1-fix: 通过服务端 API 获取 ICE 配置（含短期 TURN 凭证），
    // 避免 NEXT_PUBLIC_ 环境变量在构建时内联到客户端 bundle 暴露长期凭据。
    const iceServers = await fetchIceServers();

    const pc = new RTCPeerConnection({
      iceServers,
      // 仅收集 ICE 候选，不强制使用 relay（允许直连优化延迟）
      iceTransportPolicy: "all",
      // Unified Plan 是现代浏览器默认语义，无需显式设置 sdpSemantics
    });

    // ICE 候选就绪 → 通过信令发送给对端
    pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate) {
        const payload: IceCandidatePayload = {
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
          usernameFragment: event.candidate.usernameFragment,
        };
        for (const cb of this.iceCandidateReadyCallbacks) {
          try {
            cb(payload);
          } catch (err) {
            console.error("[webrtc] iceCandidateReady callback error:", err);
          }
        }
      }
    };

    // 连接状态变更
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      switch (state) {
        case "connected":
          this.setState("connected");
          break;
        case "disconnected":
          this.setState("disconnected");
          break;
        case "failed":
          this.setState("failed");
          break;
        case "closed":
          this.setState("closed");
          break;
      }
    };

    // ICE 连接状态变更（更细粒度）
    pc.oniceconnectionstatechange = () => {
      const iceState = pc.iceConnectionState;
      if (iceState === "connected" || iceState === "completed") {
        if (this.currentState === "connecting") {
          this.setState("connected");
        }
      } else if (iceState === "failed") {
        this.setState("failed");
      }
    };

    // 收到远程轨道（被控方的屏幕共享流）
    pc.ontrack = (event: RTCTrackEvent) => {
      const stream = event.streams[0];
      if (stream) {
        for (const cb of this.remoteStreamCallbacks) {
          try {
            cb(stream);
          } catch (err) {
            console.error("[webrtc] remoteStream callback error:", err);
          }
        }
      }
    };

    // DataChannel 事件（被控方通过 ondatachannel 接收控制方创建的 channel）
    pc.ondatachannel = (event: RTCDataChannelEvent) => {
      this.setupDataChannel(event.channel);
    };

    this.peerConnection = pc;
    return pc;
  }

  /**
   * 配置 DataChannel 事件监听。
   *
   * DataChannel 用于双向传输输入事件（JSON 序列化）。
   */
  private setupDataChannel(channel: RTCDataChannel): void {
    this.dataChannel = channel;

    channel.onopen = () => {
      // DataChannel 就绪，可发送输入事件
    };

    channel.onclose = () => {
      this.dataChannel = null;
    };

    channel.onerror = (event: Event) => {
      console.error("[webrtc] DataChannel error:", event);
    };

    channel.onmessage = (event: MessageEvent) => {
      try {
        const inputEvent = JSON.parse(event.data) as InputEvent;
        if (inputEvent?.type) {
          for (const cb of this.inputEventCallbacks) {
            try {
              cb(inputEvent);
            } catch (err) {
              console.error("[webrtc] inputEvent callback error:", err);
            }
          }
        }
      } catch (err) {
        console.error("[webrtc] failed to parse DataChannel message:", err);
      }
    };
  }

  /**
   * 创建 offer 并设置本地描述（控制方 Alice 调用）。
   *
   * 调用前应已通过 startScreenShare() 添加屏幕轨道（被控方场景）。
   * 创建完成后通过 onSdpReady 回调输出 SDP，调用方负责通过信令发送给对端。
   */
  async initiate(): Promise<void> {
    const pc = await this.ensurePeerConnection();
    this.setState("initiating");

    try {
      // 控制方创建 DataChannel（被控方通过 ondatachannel 接收）
      if (this.role === "controller") {
        const channel = pc.createDataChannel(this.dataChannelLabel, {
          ordered: true,
          maxRetransmits: 10, // 输入事件实时性优先，允许丢包
        });
        this.setupDataChannel(channel);
      }

      const offer = await pc.createOffer({
        // 若已添加屏幕轨道，offerToReceiveVideo 无需设置（轨道自带方向）
        offerToReceiveAudio: false,
        offerToReceiveVideo: this.role === "controller",
      });
      await pc.setLocalDescription(offer);

      this.setState("connecting");

      for (const cb of this.sdpReadyCallbacks) {
        try {
          cb(offer.sdp ?? "", "offer");
        } catch (err) {
          console.error("[webrtc] sdpReady callback error:", err);
        }
      }
    } catch (err) {
      console.error("[webrtc] initiate failed:", err);
      this.setState("failed");
      throw err;
    }
  }

  /**
   * 接收 offer，创建 answer 并设置本地描述（被控方 Bob 调用）。
   *
   * 调用前应已通过 startScreenShare() 添加屏幕轨道。
   */
  async accept(offerSdp: string): Promise<void> {
    const pc = await this.ensurePeerConnection();
    this.setState("accepting");

    try {
      await pc.setRemoteDescription({
        type: "offer",
        sdp: offerSdp,
      });

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      this.setState("connecting");

      for (const cb of this.sdpReadyCallbacks) {
        try {
          cb(answer.sdp ?? "", "answer");
        } catch (err) {
          console.error("[webrtc] sdpReady callback error:", err);
        }
      }
    } catch (err) {
      console.error("[webrtc] accept failed:", err);
      this.setState("failed");
      throw err;
    }
  }

  /**
   * 接收对端的 answer SDP，设置远程描述（控制方 Alice 调用）。
   */
  async handleAnswer(answerSdp: string): Promise<void> {
    const pc = this.peerConnection;
    if (!pc) throw new Error("[webrtc] peer connection not initialized");
    await pc.setRemoteDescription({
      type: "answer",
      sdp: answerSdp,
    });
  }

  /**
   * 处理来自对端的 ICE 候选。
   */
  async handleIceCandidate(candidate: IceCandidatePayload): Promise<void> {
    const pc = this.peerConnection;
    if (!pc) return; // 尚未初始化，忽略（信令乱序时可能发生）
    try {
      await pc.addIceCandidate({
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
        usernameFragment: candidate.usernameFragment,
      });
    } catch (err) {
      // ICE 候选添加失败可能是乱序（remoteDescription 未设置），忽略即可
      console.warn("[webrtc] addIceCandidate failed (may be out-of-order):", err);
    }
  }

  // ─── 屏幕共享 ──────────────────────────────────────────────

  /**
   * 获取屏幕共享流并添加到 peer connection（被控方调用）。
   *
   * 使用 navigator.mediaDevices.getDisplayMedia()。
   * 用户会在浏览器弹窗中选择共享的屏幕/窗口/标签页。
   *
   * SSR 安全：服务端无 navigator.mediaDevices，抛出明确错误。
   */
  async startScreenShare(): Promise<MediaStream> {
    if (typeof window === "undefined" || !navigator?.mediaDevices?.getDisplayMedia) {
      throw new Error("[webrtc] getDisplayMedia unavailable (SSR or unsupported browser)");
    }

    // 停止已有的屏幕流
    this.stopScreenShare();

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        // 屏幕共享分辨率提示（浏览器可能无法精确满足）
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30, max: 60 },
      },
      audio: false, // 远程控制不需要共享音频
    });

    this.screenStream = stream;

    // 将轨道添加到 peer connection
    const pc = await this.ensurePeerConnection();
    for (const track of stream.getTracks()) {
      pc.addTrack(track, stream);

      // 用户在浏览器 UI 停止共享时（点击"停止共享"按钮）
      track.onended = () => {
        this.stopScreenShare();
        this.close();
      };
    }

    return stream;
  }

  /**
   * 停止屏幕共享，移除轨道并关闭流。
   */
  stopScreenShare(): void {
    if (this.screenStream) {
      for (const track of this.screenStream.getTracks()) {
        track.stop();
        this.peerConnection?.getSenders().forEach((sender) => {
          if (sender.track === track) {
            this.peerConnection?.removeTrack(sender);
          }
        });
      }
      this.screenStream = null;
    }
  }

  // ─── 输入事件传输 ──────────────────────────────────────────

  /**
   * 通过 DataChannel 发送输入事件（控制方调用）。
   *
   * DataChannel 必须已打开（onopen 触发后）。未打开时静默丢弃
   * （输入事件实时性优先，缓冲重发无意义）。
   */
  sendInputEvent(event: InputEvent): void {
    if (!this.dataChannel || this.dataChannel.readyState !== "open") {
      return; // DataChannel 未就绪，丢弃输入事件
    }
    try {
      this.dataChannel.send(JSON.stringify(event));
    } catch (err) {
      console.error("[webrtc] sendInputEvent failed:", err);
    }
  }

  // ─── 回调注册 ──────────────────────────────────────────────

  /** 注册远程流回调（收到对端视频流时触发）。返回取消订阅函数。 */
  onRemoteStream(callback: RemoteStreamCallback): () => void {
    this.remoteStreamCallbacks.add(callback);
    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      this.remoteStreamCallbacks.delete(callback);
    };
  }

  /** 注册输入事件回调（通过 DataChannel 收到对端输入时触发）。返回取消订阅函数。 */
  onInputEvent(callback: InputEventCallback): () => void {
    this.inputEventCallbacks.add(callback);
    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      this.inputEventCallbacks.delete(callback);
    };
  }

  /** 注册状态变更回调。返回取消订阅函数。 */
  onStateChange(callback: StateChangeCallback): () => void {
    this.stateChangeCallbacks.add(callback);
    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      this.stateChangeCallbacks.delete(callback);
    };
  }

  /** 注册 SDP 就绪回调（offer/answer 创建完成时触发）。返回取消订阅函数。 */
  onSdpReady(callback: SdpReadyCallback): () => void {
    this.sdpReadyCallbacks.add(callback);
    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      this.sdpReadyCallbacks.delete(callback);
    };
  }

  /** 注册 ICE 候选就绪回调。返回取消订阅函数。 */
  onIceCandidateReady(callback: IceCandidateReadyCallback): () => void {
    this.iceCandidateReadyCallbacks.add(callback);
    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      this.iceCandidateReadyCallbacks.delete(callback);
    };
  }

  // ─── 关闭 ──────────────────────────────────────────────────

  /**
   * 关闭会话，释放所有资源。幂等，多次调用安全。
   */
  close(): void {
    if (this.currentState === "closed") return;

    this.stopScreenShare();

    if (this.dataChannel) {
      try {
        this.dataChannel.close();
      } catch {
        // 忽略关闭错误
      }
      this.dataChannel = null;
    }

    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch {
        // 忽略关闭错误
      }
      this.peerConnection = null;
    }

    this.setState("closed");
    this.remoteStreamCallbacks.clear();
    this.inputEventCallbacks.clear();
    this.stateChangeCallbacks.clear();
    this.sdpReadyCallbacks.clear();
    this.iceCandidateReadyCallbacks.clear();
  }

  // ─── 内部方法 ──────────────────────────────────────────────

  private setState(state: RemoteControlSessionState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    for (const cb of this.stateChangeCallbacks) {
      try {
        cb(state);
      } catch (err) {
        console.error("[webrtc] stateChange callback error:", err);
      }
    }
  }
}

// ─── 输入事件构造辅助函数 ──────────────────────────────────────

/** 构造鼠标移动事件 */
export function mouseMove(x: number, y: number): InputEvent {
  return { type: "mouse-move", x, y };
}

/** 构造鼠标点击事件 */
export function mouseClick(
  x: number,
  y: number,
  button: MouseButton,
  action: "down" | "up" | "double" = "down",
): InputEvent {
  return { type: "mouse-click", x, y, button, action };
}

/** 构造鼠标滚轮事件 */
export function mouseScroll(x: number, y: number, deltaY: number): InputEvent {
  return { type: "mouse-scroll", x, y, deltaY };
}

/** 构造键盘按键事件 */
export function keyPress(
  key: string,
  action: "down" | "up" = "down",
  modifiers?: KeyModifiers,
): InputEvent {
  return { type: "key-press", key, action, modifiers };
}

/** 从浏览器 MouseEvent.button 数字映射到 MouseButton 字符串 */
export function mapMouseButton(buttonNumber: number): MouseButton {
  switch (buttonNumber) {
    case 0:
      return "left";
    case 1:
      return "middle";
    case 2:
      return "right";
    default:
      return "left";
  }
}
