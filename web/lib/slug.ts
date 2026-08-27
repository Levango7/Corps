import { runWithAuthOp } from "./auth";

/**
 * slug 生成工具：清洗 + 唯一性重试。
 *
 *  - 清洗规则：小写化、非字母数字替换为 -、连续 - 合并、首尾 - 去除、截断 40 字符。
 *  - 最少保留 "ws" 前缀（避免清洗后为空）。
 *  - 唯一性：最多重试 5 次（追加 4 位随机后缀），DB unique 约束兜底并发碰撞。
 *
 * RLS 说明：workspaces 表为 FORCE RLS（db/rls-activate.sql），加固模式下
 * 无上下文的直连查询不可见任何行，唯一性预检会失效（误判 slug 可用 →
 * 创建时撞 unique 约束 P2002）。slug 预检发生在用户/工作区上下文建立之前，
 * 与注册路径的 workspace.create 同属该类场景，经 provision 逃生口访问
 * （p_workspaces_select 策略对 auth_op='provision' 放行）。
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
    const exists = await runWithAuthOp(
      "provision",
      (tx) =>
        tx.workspace.findUnique({
          where: { slug },
          select: { id: true },
        }),
    );
    if (!exists) return slug;
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }
  // 5 次重试后仍碰撞，交由 DB unique 约束抛 P2002，调用方映射 409
  return slug;
}
