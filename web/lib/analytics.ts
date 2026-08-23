"use client";

/**
 * 客户端分析埋点 —— P2 数据埋点。
 *
 * 设计：
 *  - 批量缓冲：事件先入队列，flush 时批量 POST /api/v1/events（一次最多 50 条）。
 *  - 触发 flush：队列满 20 条 / 页面隐藏（visibilitychange）/ 页面卸载（beforeunload）。
 *  - sendBeacon 优先：卸载时用 navigator.sendBeacon 避免请求被取消。
 *  - sessionId：localStorage 持久化匿名会话 ID（30 分钟过期），用于漏斗关联。
 *  - 不阻塞主线程：所有写入 fire-and-forget，失败静默。
 *
 * 用法：
 *   import { track } from "@/lib/analytics";
 *   track("create_task", { taskId: "xxx", priority: "high" });
 */

const BATCH_SIZE = 20;
const FLUSH_ENDPOINT = "/api/v1/events";
const SESSION_KEY = "corps_analytics_sid";
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 分钟

interface QueuedEvent {
  name: string;
  props: Record<string, unknown>;
  sessionId: string;
  workspaceId?: string;
  ts: number;
}

const queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;

/** 获取或创建匿名会话 ID（30 分钟 TTL）。 */
function getSessionId(): string {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { sid: string; ts: number };
      if (Date.now() - parsed.ts < SESSION_TTL_MS) {
        // 续期
        localStorage.setItem(SESSION_KEY, JSON.stringify({ sid: parsed.sid, ts: Date.now() }));
        return parsed.sid;
      }
    }
  } catch {
    // localStorage 不可用（隐私模式）—— 退化为内存随机
  }
  const sid = crypto.randomUUID();
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ sid, ts: Date.now() }));
  } catch {
    // ignore
  }
  return sid;
}

/** 当前工作区 ID（由 setWorkspaceContext 设置，用于事件自动附加 wid）。 */
let currentWid: string | undefined;

/** 设置当前工作区上下文（layout 在切换工作区时调用）。 */
export function setWorkspaceContext(wid: string | undefined) {
  currentWid = wid;
}

/** 注册全局事件监听器（visibilitychange / beforeunload）。仅初始化一次。 */
function ensureInitialized() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("beforeunload", () => {
    flushSync();
  });
  // pagehide 兜底（移动端 beforeunload 不触发）
  window.addEventListener("pagehide", () => {
    flushSync();
  });
}

/**
 * 埋点入口：记录事件到队列，达到阈值自动 flush。
 * 不抛错、不阻塞，fire-and-forget。
 */
export function track(name: string, props: Record<string, unknown> = {}): void {
  if (typeof window === "undefined") return;
  ensureInitialized();

  const event: QueuedEvent = {
    name,
    props,
    sessionId: getSessionId(),
    workspaceId: currentWid,
    ts: Date.now(),
  };
  queue.push(event);

  // 队列满 → 立即 flush
  if (queue.length >= BATCH_SIZE) {
    flush();
  } else if (!flushTimer) {
    // 5 秒后兜底 flush（避免事件长时间滞留队列）
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush();
    }, 5000);
  }
}

/** 异步 flush：用 fetch POST，失败静默。 */
export async function flush(): Promise<void> {
  if (queue.length === 0) return;
  const batch = queue.splice(0, BATCH_SIZE);
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  try {
    await fetch(FLUSH_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: batch }),
      credentials: "include",
      keepalive: true,
    });
  } catch {
    // 失败：事件已出队，放弃重试（避免无限累积）
  }
}

/** 同步 flush：用 sendBeacon，避免卸载时请求被取消。 */
function flushSync(): void {
  if (queue.length === 0) return;
  const batch = queue.splice(0, BATCH_SIZE);
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  try {
    const blob = new Blob([JSON.stringify({ events: batch })], {
      type: "application/json",
    });
    navigator.sendBeacon(FLUSH_ENDPOINT, blob);
  } catch {
    // sendBeacon 不可用：放弃（已出队）
  }
}