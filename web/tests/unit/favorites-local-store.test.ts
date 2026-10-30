// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  addFavorite,
  isFavorite,
  listFavorites,
  removeFavorite,
  toggleFavorite,
  type FavoriteEntry,
} from "@/lib/favorites";

/**
 * 本地收藏夹契约（lib/favorites.ts）：
 *  - localStorage 驱动（存储项名 corps_favorites_v1），列表按 ts 倒序
 *  - 脏数据防御：非法 JSON / 缺字段条目静默丢弃，不抛
 *  - 同 tab 变更派发 corps:favorites-changed 事件（layout 重新拉取）
 *  - toggleFavorite 返回切换后的状态（true=已收藏）
 */
// 注：常量名刻意避开 "KEY" 字样 —— gitleaks 的 generic-api-key 规则会把它当成密钥赋值（PR #226 实测）
const STORAGE_NAME = "corps_favorites_v1";

const entry = (taskId: string, workspaceId = "w1", title = "t"): Omit<FavoriteEntry, "ts"> => ({
  taskId,
  workspaceId,
  title,
});

// 本仓库的 vitest jsdom 环境不提供 localStorage（存量 sync 测试同样绕开它），
// 这里装一个最小内存实现，顺带让「写入抛错」分支可测（failStorage 开关）。
let store: Map<string, string>;
let failStorage: boolean;

beforeEach(() => {
  store = new Map();
  failStorage = false;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        if (failStorage) throw new Error("QuotaExceededError");
        store.set(k, v);
      },
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
});

describe("listFavorites：读取与排序", () => {
  it("空存储 → 空数组", () => {
    expect(listFavorites()).toEqual([]);
  });

  it("按 ts 倒序（最新在前）", () => {
    localStorage.setItem(
      STORAGE_NAME,
      JSON.stringify([
        { taskId: "a", workspaceId: "w", title: "A", ts: 100 },
        { taskId: "b", workspaceId: "w", title: "B", ts: 300 },
        { taskId: "c", workspaceId: "w", title: "C", ts: 200 },
      ]),
    );
    expect(listFavorites().map((e) => e.taskId)).toEqual(["b", "c", "a"]);
  });

  it("非法 JSON → 空数组（静默）", () => {
    localStorage.setItem(STORAGE_NAME, "{not json");
    expect(listFavorites()).toEqual([]);
  });

  it("非数组 JSON → 空数组", () => {
    localStorage.setItem(STORAGE_NAME, JSON.stringify({ taskId: "a" }));
    expect(listFavorites()).toEqual([]);
  });

  it("缺 taskId/workspaceId 的脏条目被丢弃，合法条目保留", () => {
    localStorage.setItem(
      STORAGE_NAME,
      JSON.stringify([
        { taskId: "a", workspaceId: "w", title: "A", ts: 1 },
        { workspaceId: "w", title: "missing id", ts: 2 },
        { taskId: "b", title: "missing ws", ts: 3 },
        null,
      ]),
    );
    expect(listFavorites().map((e) => e.taskId)).toEqual(["a"]);
  });
});

describe("add / remove / isFavorite / toggle", () => {
  it("addFavorite：写入最新 ts、去重（同 taskId 先移除再前插）", () => {
    addFavorite(entry("a"));
    addFavorite(entry("b"));
    addFavorite(entry("a", "w1", "updated title"));
    const list = listFavorites();
    expect(list.map((e) => e.taskId)).toEqual(["a", "b"]);
    expect(list[0].title).toBe("updated title");
  });

  it("isFavorite / removeFavorite", () => {
    addFavorite(entry("a"));
    expect(isFavorite("a")).toBe(true);
    removeFavorite("a");
    expect(isFavorite("a")).toBe(false);
    expect(listFavorites()).toEqual([]);
  });

  it("toggleFavorite：未收藏→收藏返回 true；已收藏→取消返回 false", () => {
    expect(toggleFavorite(entry("a"))).toBe(true);
    expect(isFavorite("a")).toBe(true);
    expect(toggleFavorite(entry("a"))).toBe(false);
    expect(isFavorite("a")).toBe(false);
  });

  it("每次写操作派发 corps:favorites-changed 事件", () => {
    const onChanged = vi.fn();
    window.addEventListener("corps:favorites-changed", onChanged);
    addFavorite(entry("a"));
    removeFavorite("a");
    toggleFavorite(entry("b"));
    window.removeEventListener("corps:favorites-changed", onChanged);
    expect(onChanged).toHaveBeenCalledTimes(3);
  });

  it("storage 写入抛错（超限）时静默不抛", () => {
    failStorage = true;
    expect(() => addFavorite(entry("a"))).not.toThrow();
  });
});
