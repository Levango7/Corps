/**
 * LIKE / ILIKE 右操作数转义。
 *
 * ## 为什么需要
 *
 * 三个消息搜索端点里，走 Prisma `contains + mode:"insensitive"` 的那两个由 ORM
 * 自动转义 LIKE 元字符；而 `/api/v1/im/search` 因为要用 tsvector 只能走
 * `$queryRawUnsafe`，把用户输入直接拼进 `'%' || $n || '%'`。后果是查询串里的
 * `%` 和 `_` 会被当成通配符而不是字面字符：
 *
 * 实测（postgres:18.6，20005 行）`body ILIKE '%' || '100%' || '%'` 命中 **140 行**
 * ——用户想搜「100%」，实际搜到所有以 100 开头的数字；转义后同一查询命中 **0 行**。
 * 这类 bleed 不报错、不 500，只是静默给出与用户输入不一致的结果，所以必须在
 * 进入 SQL 前处理，而不是靠前端约束输入。
 *
 * ## 用法
 *
 * SQL 侧必须配套写 `ESCAPE '\'`（PostgreSQL 默认转义符是反斜杠，但显式写出
 * 是为了让查询不依赖 `standard_conforming_strings` 的会话取值）。
 */

/** 把用户原文转成可安全用作 ILIKE 模式片段的字面串（`\`、`%`、`_` 三字符前置反斜杠）。 */
export function escapeLikeOperand(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** 拼成完整 ILIKE 模式：前后加通配符，中间是已转义的用户输入。 */
export function likeContainsPattern(input: string): string {
  return `%${escapeLikeOperand(input)}%`;
}
