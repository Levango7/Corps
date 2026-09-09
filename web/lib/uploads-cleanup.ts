import { promises as fs } from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";

/**
 * IM 附件磁盘文件清理（审计 P2：孤儿文件无清理机制，磁盘单调增长）。
 *
 * 背景：任务删除经外键级联清掉 message_attachments 记录，但 web/uploads/ 里的
 * 磁盘文件不随之删除——长期运行磁盘单调增长（本地 E2E 已遗留 15 个孤儿 PDF
 * 为实证）。本模块提供两段清理：
 *
 *  - deleteTaskFiles(taskId)：任务删除前按 url 定位该任务附件的磁盘文件并删除
 *    （尽力而为：文件级失败只记日志，绝不阻断删除主流程）。
 *  - cleanupOrphanUploads(): 全库扫描——对比 uploads/ 目录与 message_attachments
 *    的 url 列，删除无任何记录引用的孤儿文件（返回删除数）。
 *
 * url 形如 /uploads/<uuid>.<ext>，与磁盘 uploads/<uuid>.<ext> 一一对应；
 * 清理前做路径遍历防护（resolve 后必须仍在 uploads/ 内）。
 */

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

/** 把 /uploads/<file> URL 映射为 uploads/ 内的安全绝对路径；非法返回 null */
function urlToSafePath(url: string): string | null {
  const m = url.match(/^\/uploads\/([A-Za-z0-9._-]+)$/);
  if (!m) return null;
  const resolved = path.resolve(UPLOAD_DIR, m[1]);
  if (!resolved.startsWith(UPLOAD_DIR + path.sep)) return null; // 路径遍历防护
  return resolved;
}

/** 删除单个任务关联的全部附件文件（任务 DELETE 前调用；尽力而为） */
export async function deleteTaskFiles(taskId: string): Promise<void> {
  try {
    const atts = await prisma.messageAttachment.findMany({
      where: { message: { taskId } },
      select: { url: true, thumbnailUrl: true },
    });
    const urls = new Set<string>();
    for (const a of atts) {
      if (a.url) urls.add(a.url);
      if (a.thumbnailUrl) urls.add(a.thumbnailUrl);
    }
    for (const url of urls) {
      const p = urlToSafePath(url);
      if (!p) continue;
      await fs.unlink(p).catch(() => {
        /* 文件缺失/已删：幂等 */
      });
    }
  } catch (err) {
    // 清理失败不阻断删除主流程
    console.error("[attachment-cleanup] deleteTaskFiles failed (non-blocking):", err);
  }
}

/** 全库孤儿清理：删除 uploads/ 中无 message_attachments 记录引用的文件
 *
 * 优化（DL-15，P3：孤儿清理全扫描）：
 *  - 原实现一次性 `findMany` 全表加载所有附件 url 到内存，message_attachments
 *    百万级时会 OOM；且磁盘全扫无上限，单次 cron 可能跑很久。
 *  - 现改为：① 分页加载附件 url（每页 1000 条），内存常驻仅一页；
 *    ② 磁盘文件按 mtime 升序（老文件优先）排序，单次最多处理 maxFilesToCheck
 *    个（默认 200），未处理完下次 cron 继续；
 *    ③ 候选磁盘文件确定后，仅查这些 url 是否被引用（仍需全分页扫表确认
 *    不在引用集中——避免误删）。
 *
 * @param options.maxFilesToCheck - 单次最多检查的磁盘文件数（默认 200）
 *   调度建议：每周一次 cron，孤儿无害仅占空间，无需一次清完。
 */
export async function cleanupOrphanUploads(
  options?: { maxFilesToCheck?: number },
): Promise<{ deleted: number; kept: number; skipped: number }> {
  const maxFilesToCheck = options?.maxFilesToCheck ?? 200;

  // 1. 收集所有被引用的 url（分页加载，避免全表 OOM）
  //    message_attachments 不受 RLS，裸查安全
  const PAGE_SIZE = 1000;
  const referenced = new Set<string>();
  let cursor: string | undefined;
  while (true) {
    const atts = await prisma.messageAttachment.findMany({
      select: { id: true, url: true, thumbnailUrl: true },
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (atts.length === 0) break;
    for (const a of atts) {
      if (a.url) referenced.add(a.url);
      if (a.thumbnailUrl) referenced.add(a.thumbnailUrl);
    }
    cursor = atts[atts.length - 1].id;
    if (atts.length < PAGE_SIZE) break;
  }

  // 2. 扫描磁盘，按 mtime 升序（老文件优先清理），单次最多处理 maxFilesToCheck 个
  let deleted = 0;
  let kept = 0;

  let entries: string[];
  try {
    entries = await fs.readdir(UPLOAD_DIR);
  } catch {
    return { deleted: 0, kept: 0, skipped: 0 }; // 目录不存在（未启用上传）→ 无事可做
  }

  // 收集候选文件及其 stat，过滤 .gitkeep，按 mtime 升序排序
  const candidates: Array<{ name: string; mtime: number }> = [];
  for (const name of entries) {
    if (name === ".gitkeep") continue;
    const p = path.resolve(UPLOAD_DIR, name);
    if (!p.startsWith(UPLOAD_DIR + path.sep)) continue; // 路径遍历防护
    try {
      const stat = await fs.stat(p);
      candidates.push({ name, mtime: stat.mtimeMs });
    } catch {
      // 文件已被并发删除：跳过
    }
  }
  candidates.sort((a, b) => a.mtime - b.mtime); // 老文件优先

  // 限制单次处理数量
  const toProcess = candidates.slice(0, maxFilesToCheck);
  const skipped = candidates.length - toProcess.length; // 本次未处理的文件数

  for (const { name } of toProcess) {
    const url = `/uploads/${name}`;
    if (referenced.has(url)) {
      kept++;
      continue;
    }
    const p = path.resolve(UPLOAD_DIR, name);
    if (!p.startsWith(UPLOAD_DIR + path.sep)) continue;
    await fs.unlink(p).catch(() => {
      /* 已被并发删除：幂等 */
    });
    deleted++;
  }
  return { deleted, kept, skipped };
}
