/* =============================================================================
 * corps · service worker
 * 策略：stale-while-revalidate（先返回缓存，同时后台拉取更新）。
 *  - install：预缓存核心资源 + 关键路由（dashboard / board / my-tasks），
 *    失败不阻断激活。
 *  - activate：清理旧版本缓存，立即接管客户端。
 *  - fetch：
 *    · 仅拦截同源 GET；POST/PUT 等与跨域请求直接放行。
 *    · API 请求中 auth 路由（/me /login /logout /sessions /token /auth）不缓存。
 *    · 其余同源 GET 走 stale-while-revalidate：有缓存先返回，后台并发更新。
 *    · 离线时导航请求回退到 /offline，其他请求回退缓存或 503。
 *  - 来源：M3 移动端体验优化（任务 327）。
 * ========================================================================== */

const CACHE_VERSION = "corps-sw-v2";
const CORE_ASSETS = ["/", "/offline", "/manifest.json", "/favicon.svg"];
// 关键路由：核心页面离线可访问（预缓存 + 运行时 SWR 持续更新）
const CORE_ROUTES = ["/dashboard", "/board", "/my-tasks"];

/**
 * 判断是否为不应缓存的 API 请求：
 *  - 非 /api/ 前缀：不是 API，按普通资源处理（返回 false）
 *  - /api/ 下 auth 相关路由（me / login / logout / sessions / token / auth）：不缓存
 */
function isNonCacheableApi(url) {
  if (!url.pathname.startsWith("/api/")) return false;
  return /\/(auth|login|logout|me|sessions|token)\b/i.test(url.pathname);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // 预缓存核心资源 + 关键路由；任一失败不阻断激活
      cache.addAll([...CORE_ASSETS, ...CORE_ROUTES]).catch(() => {}),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // 仅缓存同源 GET 请求；POST/PUT 等与跨域请求直接放行。
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API 请求中 auth 路由不缓存，直接走网络（避免缓存敏感数据 / 登录态串扰）
  if (isNonCacheableApi(url)) return;

  // stale-while-revalidate：先返回缓存（stale），同时后台拉取更新（revalidate）
  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(request);

      // 后台 revalidate：拉取最新并写入缓存，失败静默（不阻断 stale 响应）
      const networkUpdate = fetch(request)
        .then((response) => {
          // 仅缓存有效响应（basic 类型），避免缓存 opaque / 错误响应
          if (response.type === "basic" && response.status === 200) {
            cache.put(request, response.clone()).catch(() => {});
          }
          return response;
        })
        .catch(() => null);

      // 有缓存先返回（stale-while-revalidate 的 stale 分支）
      if (cached) return cached;

      // 无缓存：等网络结果
      const networkResponse = await networkUpdate;
      if (networkResponse) return networkResponse;

      // 离线兜底：导航请求回退 /offline，其他请求回退缓存或 503
      if (request.mode === "navigate") {
        const offline = await cache.match("/offline");
        if (offline) return offline;
      }
      return new Response("Offline", {
        status: 503,
        statusText: "Service Unavailable",
      });
    }),
  );
});
