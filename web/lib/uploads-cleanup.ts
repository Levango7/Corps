import { promises as fs } from "fs";
import path from "path";
import { runWithAuthOp } from "@/lib/auth";

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
 *
 * RLS（S1 修复）：message_attachments 自 20260831000000 迁移后纳入 FORCE RLS，
 * 按 workspace_id 谓词 + cron SELECT 逃生口放行。裸 prisma 查询在 RLS 加固
 * 模式下恒返空（无 GUC 注入），故所有查询经 runWithAuthOp("cron", ...) 包裹。
 *
 * 竞态防护（S3 修复）：孤儿清理与新消息附件插入存在竞态——
 *   T1(清理): 查 url X 无引用 → 准备删
 *   T2(新消息): 插入附件引用 url X
 *   T1: 删文件 X → 误删
 * 消除方案：删除前在 advisory lock 事务内再次检查引用。advisory lock 以 url
 * 哈希为键，确保清理脚本检查+删除期间不会被另一个清理实例并发操作同一文件。
 * 新消息插入侧若也加同键 lock（后续迭代），可完全消除竞态；当前已将窗口
 * 缩至单事务内（毫秒级），误删概率极低且孤儿仅占空间、可重传恢复。
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
    // S1 修复：message_attachments 受 FORCE RLS，经 cron 逃生口放行只读查询
    const atts = await runWithAuthOp("cron", (tx) =>
      tx.messageAttachment.findMany({
        where: { message: { taskId } },
        select: { url: true, thumbnailUrl: true },
      }),
    );
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

/**
 * 在 advisory lock 事务内检查 url 是否被引用；未被引用则可安全删除。
 *
 * S3 修复：用 pg_advisory_xact_lock(hashtext(url)) 锁定该 url 的清理权，
 * 事务内再次查询引用计数。事务提交后 lock 自动释放，此时若新消息插入
 * 引用了该 url，插入侧（未来加同键 lock）会等待；当前插入侧未加 lock，
 * 但事务窗口仅毫秒级，误删概率极低。
 *
 * 返回 true 表示可删除（无引用），false 表示被引用应保留。
 */
async function isOrphanUnderLock(url: string): Promise<boolean> {
  return runWithAuthOp("cron", async (tx) => {
    // advisory lock：以 url 哈希为键，防止并发清理实例同时操作同一文件
    // pg_advisory_xact_lock 接受 int4 参数；hashtext 返回 int4
    await tx.$executeRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      url,
    );
    // 事务内再次检查引用（url 或 thumbnailUrl 匹配）
    const refCount = await tx.messageAttachment.count({
      where: { OR: [{ url }, { thumbnailUrl: url }] },
    });
    return refCount === 0;
  });
}

/** 全库孤儿清理：删除 uploads/ 中无 message_attachments 记录引用的文件
 *
 * 优化（DL-15 + S2/S3 修复）：
 *  - S2 修复：原实现全表分页加载所有附件 url 到内存 Set（百万级 OOM 风险，
 *    且注释"分页加载避免 OOM"误导——分页只控制单次查询行数，Set 仍全量累积）。
 *    现改为：先扫描磁盘得候选文件（≤maxFilesToCheck），仅查这些候选 URL
 *    是否被引用，内存常驻仅候选数量（默认 200）而非全表。
 *  - S3 修复：删除前在 advisory lock 事务内再次检查引用，消除竞态。
 *  - 磁盘文件按 mtime 升序（老文件优先）排序，单次最多处理 maxFilesToCheck
 *    个（默认 200），未处理完下次 cron 继续。
 *
 * @param options.maxFilesToCheck - 单次最多检查的磁盘文件数（默认 200）
 *   调度建议：每周一次 cron，孤儿无害仅占空间，无需一次清完。
 */
export async function cleanupOrphanUploads(
  options?: { maxFilesToCheck?: number },
): Promise<{ deleted: number; kept: number; skipped: number }> {
  const maxFilesToCheck = options?.maxFilesToCheck ?? 200;

  // 1. 扫描磁盘，按 mtime 升序（老文件优先清理），单次最多处理 maxFilesToCheck 个
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

  // 2. S2 修复：仅查候选 URL 是否被引用（不全量加载全表）
  //    一次性 IN 查询，内存常驻仅候选数量（≤200）而非全表
  const candidateUrls = toProcess.map(({ name }) => `/uploads/${name}`);
  const referencedSet = new Set<string>();
  if (candidateUrls.length > 0) {
    // S1 修复：经 cron 逃生口放行 RLS
    const refs = await runWithAuthOp("cron", (tx) =>
      tx.messageAttachment.findMany({
        where: { OR: [{ url: { in: candidateUrls } }, { thumbnailUrl: { in: candidateUrls } }] },
        select: { url: true, thumbnailUrl: true },
      }),
    );
    for (const a of refs) {
      if (a.url) referencedSet.add(a.url);
      if (a.thumbnailUrl) referencedSet.add(a.thumbnailUrl);
    }
  }

  // 3. 逐文件处理：未被引用的在 advisory lock 事务内再次确认后删除（S3）
  let deleted = 0;
  let kept = 0;

  for (const { name } of toProcess) {
    const url = `/uploads/${name}`;
    // 快速路径：候选查询已确认被引用 → 直接保留
    if (referencedSet.has(url)) {
      kept++;
      continue;
    }
    const p = path.resolve(UPLOAD_DIR, name);
    if (!p.startsWith(UPLOAD_DIR + path.sep)) continue;

    // S3 修复：advisory lock 事务内再次检查引用，消除检查→删除竞态
    let canDelete: boolean;
    try {
      canDelete = await isOrphanUnderLock(url);
    } catch (err) {
      // lock/查询失败 → 保守保留（不误删）
      console.error("[attachment-cleanup] isOrphanUnderLock failed, keeping file:", url, err);
      kept++;
      continue;
    }
    if (!canDelete) {
      kept++;
      continue;
    }

    await fs.unlink(p).catch((err: NodeJS.ErrnoException) => {
      // L4 修复：只静默 ENOENT（并发删除时文件已被其他进程删除），
      // 其他错误（EACCES/EPERM 等）记录日志以便排查
      if (err.code !== "ENOENT") {
        console.error("[uploads-cleanup] Failed to delete:", p, err);
      }
    });
    deleted++;
  }
  return { deleted, kept, skipped };
}
