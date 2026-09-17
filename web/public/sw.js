/* =============================================================================
 * corps · service worker
 * 策略：网络优先（network-first），失败回退缓存；离线时回退到首页壳。
 *  - install：预缓存核心资源（首页 / manifest / favicon），失败不阻断激活。
 *  - activate：清理旧版本缓存，立即接管客户端。
 *  - fetch：仅拦截同源 GET；命中后把响应副本写入缓存，离线时回退缓存或首页。
 * ========================================================================== */

const CACHE_VERSION = "corps-sw-v1";
const CORE_ASSETS = ["/", "/offline", "/manifest.json", "/favicon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(CORE_ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // 仅缓存同源 GET 请求；POST/PUT 等与跨域请求直接放行。
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // 仅缓存有效响应（basic 类型），避免缓存 opaque / 错误响应。
        if (response.type === "basic" && response.status === 200) {
          const copy = response.clone();
          caches
            .open(CACHE_VERSION)
            .then((cache) => cache.put(request, copy))
            .catch(() => {});
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached || caches.match("/offline"))
      )
  );
});