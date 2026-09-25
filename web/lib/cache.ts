import { unstable_cache } from "next/cache";
import { cache as reactCache } from "react";

/**
 * 缓存 Prisma 查询结果（服务端 unstable_cache）
 *
 * 适用于不频繁变更的数据（labels、milestones、members 列表等）。
 * - `keyParts` 同时用作缓存键与缓存 tag：既保证缓存隔离，又允许通过
 *   `revalidateTag(keyParts[0])` 在写操作后批量失效同一工作区的缓存。
 * - 对于带分页/过滤的查询，应把分页参数也放入 `keyParts`（首个元素仍保持
 *   `资源:${wid}` 形式作为统一失效 tag），避免不同分页互相命中。
 *
 * 注意：缓存内容必须是 workspace 级别的共享数据，不能包含 per-user 字段
 * （例如 `isSelf`）。若查询结果依赖当前用户，请在缓存外再做 map 转换。
 */
export function cachedQuery<T>(
  fn: () => Promise<T>,
  keyParts: string[],
  revalidateSeconds: number = 60,
) {
  return unstable_cache(fn, keyParts, {
    revalidate: revalidateSeconds,
    tags: keyParts,
  });
}

/**
 * React 级别缓存（同一请求内去重）
 *
 * 适用于在 RSC 中多次调用的查询，避免单次渲染内重复执行相同计算。
 */
export const memoQuery = reactCache;
