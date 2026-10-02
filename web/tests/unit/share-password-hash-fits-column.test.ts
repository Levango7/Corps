import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { hash, verify } from "@/lib/crypto";

/**
 * 回归守卫：分享密码哈希必须放得进声明它的列。
 *
 * 起因：better-auth 的 scrypt 哈希实测 161 字符，而 `tasks.share_password` /
 * `documents.share_password` 曾声明为 VarChar(100)，于是"给文档设置分享密码"
 * 这个动作必然 500（Prisma P2000 → value too long for type character
 * varying(100)）。列宽与上游哈希长度都是会变的，所以这里不写死数字，
 * 而是拿真实哈希长度去比 schema 里声明的宽度。
 */
const DECLARED_WIDTHS = (source: string): number[] =>
  [...source.matchAll(/@map\("share_password"\)[^#\n]*?@db\.VarChar\((\d+)\)/g)].map((m) =>
    Number(m[1]),
  );

describe("分享密码哈希与列宽", () => {
  it("schema 里两处 share_password 都装得下实际哈希", async () => {
    const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
    const widths = DECLARED_WIDTHS(schema);
    // 两处：Task 与 Document。少一处说明字段被改名或删除，本守卫应失效可见。
    expect(widths).toHaveLength(2);

    const hashed = await hash("Share#2026");
    for (const width of widths) {
      expect(hashed.length).toBeLessThanOrEqual(width);
    }
  });

  it("哈希可被 verify 往返校验，且错误密码判否", async () => {
    const hashed = await hash("Share#2026");
    await expect(verify("Share#2026", hashed)).resolves.toBe(true);
    await expect(verify("Wrong#Pass1", hashed)).resolves.toBe(false);
  });
});
