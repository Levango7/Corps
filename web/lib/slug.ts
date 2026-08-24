import { prisma } from "./prisma";

/**
 * slug 生成工具：清洗 + 唯一性重试。
 *
 *  - 清洗规则：小写化、非字母数字替换为 -、连续 - 合并、首尾 - 去除、截断 40 字符。
 *  - 最少保留 "ws" 前缀（避免清洗后为空）。
 *  - 唯一性：最多重试 5 次（追加 4 位随机后缀），DB unique 约束兜底并发碰撞。
 */
export async function generateSlug(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "ws";

  let slug = base;
  for (let attempt = 0; attempt < 5; attempt++) {
    const exists = await prisma.workspace.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!exists) return slug;
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }
  // 5 次重试后仍碰撞，交由 DB unique 约束抛 P2002，调用方映射 409
  return slug;
}
