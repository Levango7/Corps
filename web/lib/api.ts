"use client";

/**
 * access token 已迁移至 httpOnly cookie（由服务端 login/register/refresh 端点设置）。
 * JavaScript 无法读取，浏览器随同源请求自动发送（credentials: "include"），
 * 从而消除 XSS 窃取 token 的风险。
 *
 * setToken/clearToken 保留为 no-op，仅为向后兼容尚未迁移的调用方，不再做任何实际存储。
 */
export function setToken(_t: string) {
  /* no-op：token 由服务端 httpOnly cookie 托管 */
}
export function getToken(): string | null {
  /* no-op：httpOnly cookie 对 JavaScript 不可读，统一返回 null */
  return null;
}
export function clearToken() {
  /* no-op：退出时调 /api/auth/sign-out 由服务端清 cookie */
}

/**
 * 统一 API 客户端：依赖 httpOnly access_token cookie（浏览器自动随请求发送），
 * 遇到 401 自动用 Better Auth 会话 cookie 调 /v1/auth/refresh 轮换（新 cookie 由服务端下发），
 * 成功后直接重试原请求，失败则抛出。响应解包为 data。
 */
export async function api<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers = new Headers(opts.headers);
  if (!headers.has("Content-Type") && opts.body) headers.set("Content-Type", "application/json");

  const doFetch = (h: Headers) =>
    fetch(path, { ...opts, headers: h, credentials: "include" });

  let res = await doFetch(headers);

  if (res.status === 401) {
    // access token cookie 过期：用 Better Auth 会话 cookie 轮换，新 access_token cookie 由服务端下发
    const refreshed = await fetch("/api/v1/auth/refresh", {
      method: "POST",
      credentials: "include",
    });
    if (refreshed.ok) {
      // cookie 已更新，直接重试原请求
      res = await doFetch(headers);
    } else {
      throw new Error("unauthorized");
    }
  }

  const json = await res.json().catch(() => ({ code: res.status, message: res.statusText, data: null }));
  if (!res.ok) {
    throw new Error(json?.message || `请求失败 (${res.status})`);
  }
  return json.data as T;
}
