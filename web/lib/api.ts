"use client";

/**
 * access token 已迁移至 httpOnly cookie（由服务端 login/register/refresh 端点设置）。
 * JavaScript 无法读取，浏览器随同源请求自动发送（credentials: "include"），
 * 从而消除 XSS 窃取 token 的风险。
 */

/** 后端统一响应信封：{ code, message, data } */
interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T | null;
}

/** T2.9：结构化 API 错误类，携带 HTTP status + 业务 code，便于调用方做分支判断 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** refresh 端点路径（Better Auth 会话 cookie 轮换 access_token cookie） */
const REFRESH_ENDPOINT = "/api/v1/auth/refresh";
/** JSON Content-Type 常量，避免魔法字符串 */
const JSON_CONTENT_TYPE = "application/json";
/** 401 时未能在刷新后恢复身份的错误信息 */
const UNAUTHORIZED_MESSAGE = "unauthorized";

/**
 * 统一 API 客户端：依赖 httpOnly access_token cookie（浏览器自动随请求发送），
 * 遇到 401 自动用 Better Auth 会话 cookie 调 /v1/auth/refresh 轮换（新 cookie 由服务端下发），
 * 成功后直接重试原请求，失败则抛出。响应解包为 data。
 */
export async function api<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers = new Headers(opts.headers);
  if (!headers.has("Content-Type") && opts.body) headers.set("Content-Type", JSON_CONTENT_TYPE);

  const doFetch = (h: Headers) => fetch(path, { ...opts, headers: h, credentials: "include" });

  let res = await doFetch(headers);

  if (res.status === 401) {
    // access token cookie 过期：用 Better Auth 会话 cookie 轮换，新 access_token cookie 由服务端下发
    const refreshed = await fetch(REFRESH_ENDPOINT, {
      method: "POST",
      credentials: "include",
    });
    if (refreshed.ok) {
      // cookie 已更新，直接重试原请求
      res = await doFetch(headers);
    } else {
      throw new ApiError(UNAUTHORIZED_MESSAGE, 401, 401);
    }
  }

  const json: ApiResponse = await res
    .json()
    .catch((): ApiResponse => ({ code: res.status, message: res.statusText, data: null }));
  if (!res.ok) {
    throw new ApiError(
      json?.message || `请求失败 (${res.status})`,
      res.status,
      json?.code ?? res.status,
    );
  }
  return json.data as T;
}
