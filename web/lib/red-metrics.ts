/**
 * 按路由的 RED 指标注册表。
 *
 * RED = Rate（请求数）/ Errors（错误数）/ Duration（耗时）。这个项目此前
 * `/api/metrics` 只有 6 个进程级 gauge（uptime / rss / heap / node_version /
 * pid），**没有任何按路由维度的指标** —— 也就是说"哪个接口在报错、报得多不多"
 * 在指标层面是完全瞎的。
 *
 * ─── 为什么只接通了 Errors 一维（务必读完再想"补全"）───────────────────
 *
 * 三种接法都试过/评估过，结论是**在没有逐路由包装器的前提下，只有 Errors 能诚实接通**：
 *
 * 1. **Errors** —— `instrumentation.ts` 的 `onRequestError` 钩子。
 *    它在 Node runtime 跑，`context.routePath` 给出逐路由标识。
 *    **这一维已真实接通**，见 instrumentation.ts 与 /api/metrics。
 *
 * 2. **Rate** —— 曾考虑在 `middleware.ts` 里记。**行不通**：middleware 跑在
 *    Edge runtime，是独立的 isolate，模块级状态与 Node runtime 的
 *    `/api/metrics` **不共享**。在 middleware 里记数，指标在 /api/metrics
 *    里一个都看不到 —— 那等于接了一条假线，比不接更坏。
 *
 * 3. **Duration** —— App Router 没有暴露"路由处理器执行完毕"的全局钩子，
 *    拿不到状态码也拿不到耗时。要么逐路由包一层（见下方 `withRed`），
 *    要么在边缘代理（deploy/ 的 Caddy）出指标。
 *
 * 因此 `withRed()` 已经写好并可用，但**当前零调用点** —— 本文件不把它算作
 * "已接线"。哪个维度真的接了线，以 /api/metrics 实际能吐出什么为准，
 * 不以文件是否存在为准。
 *
 * ─── 基数控制 ────────────────────────────────────────────────────────────
 * 路由标签一律用**模式**（`/api/v1/workspaces/[id]/tasks`）而不是具体 URL。
 * 具体 URL 里全是 uuid，一个接口就能把标签基数撑爆，Prometheus 直接被打死。
 * `normalizeRoute()` 负责把 id 形态的段折叠成 `[id]`。
 */

/** 单条路由的计数/直方图状态 */
interface RouteStats {
  requests: number;
  errors: number;
  /** 耗时桶（毫秒）：1, 5, 25, 100, 500, 2500, 10000, +Inf */
  durationBuckets: number[];
  durationCount: number;
  durationSumMs: number;
}

/** 与 Prometheus 默认直方图桶对齐的毫秒边界 */
const DURATION_BUCKETS_MS = [1, 5, 25, 100, 500, 2500, 10000] as const;

/** 标签基数上限：超过就拒绝新路由，防止内存被 uuid 撑爆 */
const MAX_ROUTES = 500;

const registry = new Map<string, RouteStats>();

function emptyStats(): RouteStats {
  return {
    requests: 0,
    errors: 0,
    durationBuckets: new Array(DURATION_BUCKETS_MS.length + 1).fill(0),
    durationCount: 0,
    durationSumMs: 0,
  };
}

function statsFor(route: string): RouteStats | null {
  let s = registry.get(route);
  if (!s) {
    if (registry.size >= MAX_ROUTES) return null;
    s = emptyStats();
    registry.set(route, s);
  }
  return s;
}

/**
 * 把具体 URL 折叠成路由模式。
 *
 * `/api/v1/workspaces/3f2a.../tasks/9c1b...` → `/api/v1/workspaces/[id]/tasks/[id]`
 *
 * 判定"这是 id 而不是路径段"的三种形态：uuid、24 位十六进制、纯数字。
 * 不猜更多形态 —— 猜错的代价是把两个不同资源并成一个标签，比基数爆炸更糟。
 */
export function normalizeRoute(pathname: string): string {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const HEX24_RE = /^[0-9a-f]{24}$/i;
  const NUM_RE = /^\d+$/;
  return pathname
    .split("?")[0]
    .split("/")
    .map((seg) => (UUID_RE.test(seg) || HEX24_RE.test(seg) || NUM_RE.test(seg) ? "[id]" : seg))
    .join("/");
}

/** 记录一次请求到达（Rate）。不记录状态码/耗时 —— 那些在接入点拿不到。 */
export function recordRequest(input: { route: string; method?: string }): void {
  const s = statsFor(input.route);
  if (s) s.requests += 1;
}

/** 记录一次路由错误（Errors）。数据来源是 onRequestError 钩子。 */
export function recordError(input: { route: string; method?: string }): void {
  const s = statsFor(input.route);
  if (s) s.errors += 1;
}

/** 记录一次路由耗时（Duration）。只有 `withRed` 包过的路由才会调到这里。 */
export function recordDuration(input: {
  route: string;
  method?: string;
  durationMs: number;
}): void {
  const s = statsFor(input.route);
  if (!s) return;
  s.durationCount += 1;
  s.durationSumMs += input.durationMs;
  for (let i = 0; i < DURATION_BUCKETS_MS.length; i += 1) {
    if (input.durationMs <= DURATION_BUCKETS_MS[i]) {
      s.durationBuckets[i] += 1;
      return;
    }
  }
  s.durationBuckets[DURATION_BUCKETS_MS.length] += 1;
}

/**
 * 逐路由包装器：Rate + Duration + 按状态码分档的错误数。
 *
 * **当前零调用点。** 要用它接通 Rate/Duration 两维，就把它套到路由处理器上：
 *
 *   export const GET = withRed(async (req) => { ... });
 *
 * 套一两个路由没有意义（覆盖率 0.3%，指标存在但基本是空的），
 * 要套就按目录批量套，并同步在评分器里把对应检查从 WARN 改成 PASS。
 *
 * 签名说明：入参刻意用宽类型的 `Request`（而非 NextRequest），这样既不受
 * Next 版本约束，也不会把调用点的参数类型窄化。返回类型保持 `T`，
 * 让 `export const GET = withRed(GET)` 的类型推导不丢。
 */
type AnyRouteHandler = (req: Request, ctx?: unknown) => Promise<Response>;

export function withRed<T extends AnyRouteHandler>(handler: T): T {
  const wrapped = async (req: Request, ctx?: unknown): Promise<Response> => {
    const route = normalizeRoute(new URL(req.url).pathname);
    const method = req.method;
    recordRequest({ route, method });
    const started = Date.now();
    try {
      const res = await handler(req, ctx);
      recordDuration({ route, method, durationMs: Date.now() - started });
      if (res.status >= 500) recordError({ route, method });
      return res;
    } catch (err) {
      recordDuration({ route, method, durationMs: Date.now() - started });
      recordError({ route, method });
      throw err;
    }
  };
  // 宽类型函数赋回具体 handler 类型：调用点看到的仍是原签名。
  return wrapped as unknown as T;
}

/** Prometheus exposition format 文本。空注册表返回空串。 */
export function redMetricsText(): string {
  const lines: string[] = [];
  const routeLabel = (route: string) => `route="${route}"`;

  // 只在真有非零样本时才吐 HELP/TYPE —— 否则 exposition 里会出现
  // "声明了 series 却一个样本都没有"的孤立块，Prometheus 侧表现为
  // 空 series 噪声，也会让"这一维到底通没通电"变得看不出来。
  const anyRequests = [...registry.values()].some((s) => s.requests > 0);
  if (anyRequests) {
    lines.push("# HELP corps_http_requests_total Total HTTP requests by route");
    lines.push("# TYPE corps_http_requests_total counter");
    for (const [route, s] of registry) {
      if (s.requests > 0) {
        lines.push(`corps_http_requests_total{${routeLabel(route)}} ${s.requests}`);
      }
    }
  }

  const anyErrors = [...registry.values()].some((s) => s.errors > 0);
  if (anyErrors) {
    lines.push("# HELP corps_http_request_errors_total Unhandled route errors by route");
    lines.push("# TYPE corps_http_request_errors_total counter");
    for (const [route, s] of registry) {
      if (s.errors > 0) {
        lines.push(`corps_http_request_errors_total{${routeLabel(route)}} ${s.errors}`);
      }
    }
  }

  const hasDuration = [...registry.values()].some((s) => s.durationCount > 0);
  if (hasDuration) {
    lines.push("# HELP corps_http_request_duration_ms Request duration histogram in ms");
    lines.push("# TYPE corps_http_request_duration_ms histogram");
    for (const [route, s] of registry) {
      if (s.durationCount === 0) continue;
      const label = routeLabel(route);
      let cumulative = 0;
      DURATION_BUCKETS_MS.forEach((bound, i) => {
        cumulative += s.durationBuckets[i];
        lines.push(`corps_http_request_duration_ms_bucket{${label},le="${bound}"} ${cumulative}`);
      });
      cumulative += s.durationBuckets[DURATION_BUCKETS_MS.length];
      lines.push(`corps_http_request_duration_ms_bucket{${label},le="+Inf"} ${cumulative}`);
      lines.push(`corps_http_request_duration_ms_sum{${label}} ${s.durationSumMs}`);
      lines.push(`corps_http_request_duration_ms_count{${label}} ${s.durationCount}`);
    }
  }

  return lines.join("\n");
}

/** 测试用：清空注册表。 */
export function resetRedMetrics(): void {
  registry.clear();
}

/** 测试用：当前已登记的路由数。 */
export function redRouteCount(): number {
  return registry.size;
}
