/**
 * 将 LiveKit WebSocket 接入地址转换为 HTTP/HTTPS API 地址。
 * EgressClient 需要 HTTP host（如 http://host:7880），
 * 而 LIVEKIT_URL 通常是 ws:// 或 wss://。
 */
export function livekitApiHost(wsUrl: string): string {
  if (wsUrl.startsWith("wss://")) return "https://" + wsUrl.slice(6);
  if (wsUrl.startsWith("ws://")) return "http://" + wsUrl.slice(5);
  return wsUrl; // 已是 http/https
}