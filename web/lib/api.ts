"use client";

/**
 * access token 已迁移至 httpOnly cookie（由服务端 login/register/refresh 端点设置）。
 * JavaScript 无法读取，浏览器随同源请求自动发送（credentials: "include"），
 * 从而消除 XSS 窃取 token 的风险。
 */

// api-messages.ts 对 next/server 只有 type-only import，编译期即擦除，
// 因此可安全用于客户端 bundle（不会把 next/server 打进浏览器产物）。
import { API_MESSAGES, type ApiMsgKey } from "./api-messages";

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
    /**
     * api-messages.ts 的文案键（可映射的错误码）。
     * `message` 已是按当前语言解析好的展示文案；调用方若需自行按语言重新渲染
     * （如走 next-intl 而不是直接显示 message），可凭此键查表，
     * 不必再对展示文案做字符串比较。
     */
    public messageKey?: ApiMsgKey,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** refresh 端点路径（Better Auth 会话 cookie 轮换 access_token cookie） */
const REFRESH_ENDPOINT = "/api/v1/auth/refresh";
/** JSON Content-Type 常量，避免魔法字符串 */
const JSON_CONTENT_TYPE = "application/json";
/**
 * 401 且 refresh 失败时抛出的错误所对应的文案键。
 *
 * 此前这里是裸字符串 `"unauthorized"`——它同时充当"错误码"和"展示文案"，
 * 直接进 Toast，英文用户看到字面量 `unauthorized`（AC-21 禁止）。现在：
 * message = 按当前语言解析好的真实文案；messageKey = 可映射的错误码。
 */
const UNAUTHORIZED_KEY: ApiMsgKey = "unauthorized";

/**
 * 客户端语言探测：与组件侧同口径（`<html lang>`，由 next-intl 注入）。
 * 服务端/无 DOM 环境回退 zh，与 api-messages.ts 的默认语言策略一致。
 */
function clientLocale(): "zh" | "en" {
  if (typeof document === "undefined") return "zh";
  return document.documentElement.lang?.toLowerCase().startsWith("en") ? "en" : "zh";
}

/** 按当前语言解析 api-messages 文案（客户端无 NextRequest，故不走 apiLocale） */
function clientMsg(key: ApiMsgKey): string {
  return API_MESSAGES[key][clientLocale()];
}
/**
 * 会话有效但操作被权限策略拒绝时的错误信息。
 * 对应 messages 的 error.forbidden（"无权访问"）。
 *
 * 与 UNAUTHORIZED_KEY 同源问题：此前是裸字符串 `"forbidden"`，会直接进 Toast。
 */
const FORBIDDEN_KEY: ApiMsgKey = "forbidden";

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
      // 刷新成功（会话有效）却仍 401 ⇒ 这是权限拒绝，不是身份过期。
      // 后端为让 157 个 handler 零改动受保护，统一走 401 分支（见 lib/auth.ts:194 注释），
      // 此处把语义还原为 403，避免上层把"无权限"误判为"需要重新登录"。
      if (res.status === 401) {
        throw new ApiError(clientMsg(FORBIDDEN_KEY), 403, 403, FORBIDDEN_KEY);
      }
    } else {
      // 抛出的是**展示文案** + 可映射的文案键，不再是裸 key 字面量（AC-21）
      throw new ApiError(clientMsg(UNAUTHORIZED_KEY), 401, 401, UNAUTHORIZED_KEY);
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

/**
 * 列表载荷归一化。
 *
 * GET 列表端点统一分页格式 `{ items, page, limit, total, hasMore }`（R8C-06），
 * 但历史调用方按裸数组消费：`api()` 解包后拿到分页对象，直接 `.map/.filter`
 * 会在运行时抛 "xxx is not a function"（NewTaskDialog 曾因此把整个看板页打进
 * 路由级错误边界）。兼容两种形状，避免每个调用点各写一遍 Array.isArray 分支。
 */
export function itemsOf<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  const items = (data as { items?: unknown } | null | undefined)?.items;
  return Array.isArray(items) ? (items as T[]) : [];
}

/**
 * GET 列表端点的便捷封装：请求 + 归一化，一次拿到数组。
 * 新增列表请求请用它，不要再手写 `api<T[]>()`（分页信封会让 `.map` 直接崩）。
 */
export async function apiList<T>(path: string, opts?: RequestInit): Promise<T[]> {
  return itemsOf<T>(await api<unknown>(path, opts));
}
