// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

import { deleteTaskFiles, cleanupOrphanUploads } from "@/lib/uploads-cleanup";

/**
 * 附件清理契约（lib/uploads-cleanup.ts）：
 *  - 这是「会不会误删用户文件」的代码，断言集中在两条红线：
 *    ① 被引用的文件绝不删（快速路径 + advisory lock 事务内二次确认）
 *    ② 任何不确定态一律保留（lock/查询失败 → kept，不删）
 *  - 路径安全：只有 /uploads/<单段安全名> 形状的 URL 才允许落盘操作（防遍历）
 *  - deleteTaskFiles 尽力而为：DB 错/文件缺失都不抛（不阻断任务删除主流程）
 *
 * 依赖面全 mock：fs.promises 与 @/lib/auth 的 runWithAuthOp（cron 逃生口）。
 */

const h = vi.hoisted(() => ({
  readdir: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  executeRawUnsafe: vi.fn(),
}));

vi.mock("fs", () => ({
  promises: { readdir: h.readdir, stat: h.stat, unlink: h.unlink },
}));

vi.mock("@/lib/auth", () => ({
  runWithAuthOp: vi.fn(async (_op: string, fn: (tx: unknown) => unknown) =>
    fn({
      messageAttachment: { findMany: h.findMany, count: h.count },
      $executeRawUnsafe: h.executeRawUnsafe,
    }),
  ),
}));

beforeEach(() => {
  h.readdir.mockReset();
  h.stat.mockReset();
  h.unlink.mockReset();
  h.findMany.mockReset();
  h.count.mockReset();
  h.executeRawUnsafe.mockReset();
  h.unlink.mockResolvedValue(undefined);
  h.executeRawUnsafe.mockResolvedValue(undefined);
});

describe("deleteTaskFiles：任务删除时的附件清理", () => {
  it("删除 url 与 thumbnailUrl 两个引用文件（unlink 收到绝对路径）", async () => {
    h.findMany.mockResolvedValue([
      { url: "/uploads/a.png", thumbnailUrl: "/uploads/a.thumb.png" },
      { url: "/uploads/a.png", thumbnailUrl: null },
    ]);
    await deleteTaskFiles("t1");
    const targets = h.unlink.mock.calls.map(([p]) => String(p).replace(/\\/g, "/"));
    expect(targets.some((p) => p.endsWith("/uploads/a.png"))).toBe(true);
    expect(targets.some((p) => p.endsWith("/uploads/a.thumb.png"))).toBe(true);
    expect(h.unlink).toHaveBeenCalledTimes(2); // 去重后两个
  });

  it("非法 URL（路径遍历 / 子目录 / 非 uploads）一律跳过，不做落盘操作", async () => {
    h.findMany.mockResolvedValue([
      { url: "/uploads/../secret.env", thumbnailUrl: null },
      { url: "/uploads/sub/dir.png", thumbnailUrl: null },
      { url: "https://evil.example.com/x.png", thumbnailUrl: null },
    ]);
    await deleteTaskFiles("t1");
    expect(h.unlink).not.toHaveBeenCalled();
  });

  it("文件缺失（ENOENT）不抛；DB 查询失败也不抛（非阻塞主流程）", async () => {
    h.findMany.mockResolvedValue([{ url: "/uploads/gone.png", thumbnailUrl: null }]);
    h.unlink.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    await expect(deleteTaskFiles("t1")).resolves.toBeUndefined();

    h.findMany.mockRejectedValue(new Error("db down"));
    await expect(deleteTaskFiles("t2")).resolves.toBeUndefined();
  });
});

describe("cleanupOrphanUploads：全库孤儿清理", () => {
  const withFs = (files: Array<{ name: string; mtime: number }>) => {
    h.readdir.mockResolvedValue(files.map((f) => f.name));
    h.stat.mockImplementation(async (p: string) => {
      const name = String(p).replace(/\\/g, "/").split("/").pop()!;
      const found = files.find((f) => f.name === name);
      if (!found) throw Object.assign(new Error("gone"), { code: "ENOENT" });
      return { mtimeMs: found.mtime };
    });
  };

  it("uploads 目录不存在：返回全零（未启用上传）", async () => {
    h.readdir.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    await expect(cleanupOrphanUploads()).resolves.toEqual({ deleted: 0, kept: 0, skipped: 0 });
  });

  it("被引用的保留、无引用的删除（含 thumbnailUrl 引用）、.gitkeep 过滤", async () => {
    withFs([
      { name: ".gitkeep", mtime: 0 },
      { name: "used.png", mtime: 100 },
      { name: "used-thumb.png", mtime: 200 },
      { name: "orphan.png", mtime: 300 },
    ]);
    // 候选批量 IN 查询：used.png 与 used-thumb.png 被引用（后者经 thumbnailUrl）
    h.findMany.mockResolvedValue([
      { url: "/uploads/used.png", thumbnailUrl: null },
      { url: "/uploads/other.png", thumbnailUrl: "/uploads/used-thumb.png" },
    ]);
    h.count.mockResolvedValue(0); // orphan 在 lock 事务内确认无引用
    const res = await cleanupOrphanUploads();
    expect(res).toEqual({ deleted: 1, kept: 2, skipped: 0 });
    const deleted = h.unlink.mock.calls.map(([p]) => String(p).replace(/\\/g, "/"));
    expect(deleted.some((p) => p.endsWith("/uploads/orphan.png"))).toBe(true);
    expect(deleted.some((p) => p.endsWith(".gitkeep"))).toBe(false);
  });

  it("lock 事务内二次确认发现引用：保留不删（防检查→删除竞态）", async () => {
    withFs([{ name: "raced.png", mtime: 1 }]);
    h.findMany.mockResolvedValue([]); // 批量查询时未引用
    h.count.mockResolvedValue(1); // 事务内发现被引用（插入侧刚写入）
    const res = await cleanupOrphanUploads();
    expect(res).toEqual({ deleted: 0, kept: 1, skipped: 0 });
    expect(h.unlink).not.toHaveBeenCalled();
  });

  it("lock/查询失败：保守保留（不误删）", async () => {
    withFs([{ name: "x.png", mtime: 1 }]);
    h.findMany.mockResolvedValue([]);
    h.executeRawUnsafe.mockRejectedValue(new Error("lock failed"));
    const res = await cleanupOrphanUploads();
    expect(res).toEqual({ deleted: 0, kept: 1, skipped: 0 });
    expect(h.unlink).not.toHaveBeenCalled();
  });

  it("maxFilesToCheck：老文件优先（mtime 升序），超出部分计入 skipped", async () => {
    withFs([
      { name: "new.png", mtime: 300 },
      { name: "old.png", mtime: 100 },
      { name: "mid.png", mtime: 200 },
    ]);
    h.findMany.mockResolvedValue([]);
    h.count.mockResolvedValue(0);
    const res = await cleanupOrphanUploads({ maxFilesToCheck: 1 });
    expect(res).toEqual({ deleted: 1, kept: 0, skipped: 2 });
    const deleted = h.unlink.mock.calls.map(([p]) => String(p).replace(/\\/g, "/"));
    expect(deleted.some((p) => p.endsWith("/uploads/old.png"))).toBe(true); // 最老的那个
  });

  it("unlink 的 ENOENT 静默（并发删除），计入 deleted", async () => {
    withFs([{ name: "race.png", mtime: 1 }]);
    h.findMany.mockResolvedValue([]);
    h.count.mockResolvedValue(0);
    h.unlink.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    const res = await cleanupOrphanUploads();
    expect(res.deleted).toBe(1);
  });
});
