// @vitest-environment node
import { describe, it, expect } from "vitest";

import { livekitApiHost } from "@/lib/livekit-utils";

/**
 * livekitApiHost（lib/livekit-utils.ts）契约：
 * LiveKit 的 LIVEKIT_URL 是 ws(s):// 接入地址，而 EgressClient 需要 http(s)
 * 主机 —— 这里把两种协议各自转一次，其余原样透传。
 */
describe("livekitApiHost：WebSocket 接入地址 → HTTP API 主机", () => {
  it("wss:// → https://（保留 host 与端口）", () => {
    expect(livekitApiHost("wss://livekit.example.com")).toBe("https://livekit.example.com");
    expect(livekitApiHost("wss://livekit.example.com:7880")).toBe(
      "https://livekit.example.com:7880",
    );
  });

  it("ws:// → http://（本地开发常用形态）", () => {
    expect(livekitApiHost("ws://localhost:7880")).toBe("http://localhost:7880");
  });

  it("已是 http/https 时原样返回", () => {
    expect(livekitApiHost("https://livekit.example.com")).toBe("https://livekit.example.com");
    expect(livekitApiHost("http://127.0.0.1:7880")).toBe("http://127.0.0.1:7880");
  });

  it("无协议前缀的原样返回（不强加猜测）", () => {
    expect(livekitApiHost("livekit.example.com")).toBe("livekit.example.com");
    expect(livekitApiHost("")).toBe("");
  });
});
