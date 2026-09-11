// F5：分享密码验证 IP 级别限流
// 密码错误 3 次 → 5 分钟锁定（内存 Map，单实例足够；多实例部署可换 Redis）。
// key 格式：`${entityType}:${entityId}:${ip}`，按实体+IP 维度独立计数。

const MAX_FAILURES = 3;
const LOCK_WINDOW_MS = 5 * 60 * 1000; // 5 分钟

interface FailureRecord {
  count: number;
  firstFailedAt: number;
}

// 模块级 Map：进程生命周期内保持（重启清空，可接受）
const failureMap = new Map<string, FailureRecord>();

/**
 * 检查指定 IP 是否已被锁定（密码错误次数过多）。
 * @returns true 已锁定，false 未锁定
 */
export function isLocked(key: string): boolean {
  const record = failureMap.get(key);
  if (!record) return false;
  // 锁定窗口已过 → 清除记录，视为未锁定
  if (Date.now() - record.firstFailedAt > LOCK_WINDOW_MS) {
    failureMap.delete(key);
    return false;
  }
  return record.count >= MAX_FAILURES;
}

/**
 * 记一次密码验证失败。窗口外首次失败重置计数。
 */
export function recordFailure(key: string): void {
  const now = Date.now();
  const record = failureMap.get(key);
  if (!record || now - record.firstFailedAt > LOCK_WINDOW_MS) {
    failureMap.set(key, { count: 1, firstFailedAt: now });
  } else {
    record.count += 1;
  }
}

/**
 * 密码验证成功后清除失败记录。
 */
export function clearFailures(key: string): void {
  failureMap.delete(key);
}

/**
 * 构造限流 key。
 */
export function rateLimitKey(
  entityType: "document" | "task",
  entityId: string,
  ip: string,
): string {
  return `${entityType}:${entityId}:${ip}`;
}