/**
 * 本地收藏任务：localStorage 驱动的轻量收藏夹（v1）。
 * 每个 entry {taskId, workspaceId, title, ts}。
 * 为什么不上 DB：当前 MVP 目标是侧栏"快速回到我喜欢的任务"，
 * 跨设备同步 v2 再上（需要迁移表 task_favorites + RLS）。
 */

const KEY = "corps_favorites_v1";

export interface FavoriteEntry {
  taskId: string;
  workspaceId: string;
  title: string;
  /** 毫秒时间戳，用于排序 */
  ts: number;
}

/** 读取所有收藏（无效条目静默丢弃）。按时间倒序。 */
export function listFavorites(): FavoriteEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as FavoriteEntry[];
    return Array.isArray(arr)
      ? arr
          .filter((e) => e && typeof e.taskId === "string" && typeof e.workspaceId === "string")
          .sort((a, b) => b.ts - a.ts)
      : [];
  } catch {
    return [];
  }
}

function save(entries: FavoriteEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    /* storage 超限时静默（不可能超过几十 K） */
  }
}

export function isFavorite(taskId: string): boolean {
  return listFavorites().some((e) => e.taskId === taskId);
}

export function addFavorite(entry: Omit<FavoriteEntry, "ts">): void {
  const list = listFavorites().filter((e) => e.taskId !== entry.taskId);
  list.unshift({ ...entry, ts: Date.now() });
  save(list);
}

export function removeFavorite(taskId: string): void {
  save(listFavorites().filter((e) => e.taskId !== taskId));
}

export function toggleFavorite(entry: Omit<FavoriteEntry, "ts">): boolean {
  if (isFavorite(entry.taskId)) {
    removeFavorite(entry.taskId);
    return false;
  }
  addFavorite(entry);
  return true;
}
