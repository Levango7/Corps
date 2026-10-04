import { expect, test, type Page } from "@playwright/test";
import { registerAndLogin, uniqueEmail } from "./helpers";

/**
 * 工作区内容不得留在 Cache Storage：写入侧断掉 + 登出时清掉。
 *
 * 背景：public/sw.js 对所有同源 GET 做 stale-while-revalidate，缓存 key 只有 URL、不含身份，
 * 实测能把上一位登录者的数据回给下一个账号（见 CHANGELOG 与 docs/audit/REVERIFY-2026-09-29.md §6.2）。
 * /api 先被排除；剩下的另一半是 /w/{wid}/… 的页面 shell 与 RSC payload。
 *
 * 为什么是两条用例而不是"登出前后各拍一张快照比差"：
 * 第一版这里只断言"登出后没有租户条目"，全量跑实测红——登出确实删掉了桶，
 * 但侧栏被 Next 预取的 5 个页面（decisions/meetings/meeting-minutes/approvals/announcements）
 * 由 SW 的后台 revalidate 在删除**之后**写回（sw.js 里 networkUpdate → cache.put 脱离请求链），
 * 负载越高越容易命中。"清一次"这件事本身就没有确定性可言，所以：
 *  - 用例 1 钉写入侧：租户页面从来不该进缓存（与登出、与时序无关）。
 *  - 用例 2 钉清理侧：登出必须把本应用写过的东西删掉（用人工种一条来证明这道清理真的在跑）。
 * 每条用例自带账号与工作区，互不依赖。
 *
 * 只在生产构建下有意义：PwaRegister 对 NODE_ENV!=="production" 直接跳过注册，
 * 所以本文件必须对着 `next start` 跑（baseURL 指向生产端口）。
 */

interface CacheSnapshot {
  supported: boolean;
  buckets: { name: string; size: number; urls: string[] }[];
  total: number;
}

/** 读取本应用拥有的缓存桶、条目数与其中的路径 */
async function appCaches(page: Page): Promise<CacheSnapshot> {
  const snapshot = await page.evaluate(async () => {
    if (!("caches" in window)) {
      return { supported: false, buckets: [] as { name: string; size: number; urls: string[] }[] };
    }
    const names = (await caches.keys()).filter((n) => n.startsWith("corps-sw"));
    const buckets = await Promise.all(
      names.map(async (name) => {
        const reqs = await (await caches.open(name)).keys();
        return { name, size: reqs.length, urls: reqs.map((r) => new URL(r.url).pathname) };
      }),
    );
    return { supported: true, buckets };
  });
  return {
    ...snapshot,
    total: snapshot.buckets.reduce((sum, b) => sum + b.size, 0),
  };
}

/** 缓存里属于该工作区的条目 = 上一位登录者可能残留的租户页面 */
function tenantEntries(snapshot: CacheSnapshot, wid: string): string[] {
  return snapshot.buckets.flatMap((b) => b.urls.filter((u) => u.includes(`/w/${wid}`)));
}

test("SW 从不把工作区页面写进 Cache Storage", async ({ page }) => {
  test.setTimeout(120_000);
  const email = uniqueEmail("sw-no-tenant-cache");
  const wid = await registerAndLogin(page, email, "SW 不缓存工作区页 E2E");

  // 走几个页面 + 让侧栏预取有机会发生（登录后的 dashboard 上侧栏链接全部在视口内）
  await page.goto(`/w/${wid}/board`);
  await page.goto(`/w/${wid}/documents`);
  await page.goto(`/w/${wid}/decisions`);

  // 反证控制：SW 必须真的在跑并且缓存了"别的东西"，否则"没有租户条目"是空断言。
  // install 会预缓存 / 与 /offline，/_next/static 的 chunk 也走同一条 SWR 分支。
  await expect
    .poll(async () => (await appCaches(page)).total, {
      timeout: 20_000,
      intervals: [500, 1000, 2000],
      message: "SW 未注册或未写入任何缓存条目，本用例前提不成立",
    })
    .toBeGreaterThan(0);

  // 给"删除之后才落地的后台 revalidate"留出时间：写入侧断掉后，这段等待不该改变结果
  await page.waitForTimeout(3_000);
  const snap = await appCaches(page);
  console.info("SW-NO-TENANT-CACHE snapshot:", JSON.stringify(snap));
  expect(snap.supported, "生产环境应支持 Cache Storage").toBe(true);
  expect(tenantEntries(snap, wid), "工作区页面不应出现在缓存里").toEqual([]);
});

test("登出会清掉本应用写过的 Cache Storage", async ({ page }) => {
  test.setTimeout(120_000);
  const email = uniqueEmail("logout-cache");
  const wid = await registerAndLogin(page, email, "登出清缓存 E2E");
  await page.goto(`/w/${wid}/board`);

  // SW 注册与安装是异步的，等到有桶为止（下面的种入需要有桶可写）
  await expect
    .poll(async () => (await appCaches(page)).buckets.length, {
      timeout: 20_000,
      intervals: [500, 1000, 2000],
      message: "SW 未创建 corps-sw* 缓存桶，本用例前提不成立",
    })
    .toBeGreaterThan(0);

  // 人工种一条"看起来像上一位留下的"租户页面条目。
  // 为什么这么干：写入侧已经断掉（上一条用例），真实链路里再也造不出租户条目，
  // 而登出清理要防的正是"历史上/别处写进来的残留"——所以直接构造它，
  // 这样断言的是"登出确实在删"，不是"运行时恰好没东西可删"。
  const bucket = (await appCaches(page)).buckets[0].name;
  const seeded = await page.evaluate(
    async ({ bucket: name, path }) => {
      const cache = await caches.open(name);
      await cache.put(new Request(path), new Response("seeded-tenant-shell"));
      return (await cache.keys()).map((r) => new URL(r.url).pathname).filter((p) => p === path)
        .length;
    },
    { bucket, path: `/w/${wid}/board` },
  );
  expect(seeded, "种入后缓存里应能看到该条目").toBe(1);
  const before = await appCaches(page);
  console.info("LOGOUT-CACHE before logout:", JSON.stringify(before));
  expect(before.supported, "生产环境应支持 Cache Storage").toBe(true);
  expect(tenantEntries(before, wid), "登出前应存在被种入的租户条目").toEqual([`/w/${wid}/board`]);

  // 通过 UI 登出（头像菜单 → 退出登录）
  await page.getByRole("button", { name: "个人设置" }).click();
  await page.getByRole("button", { name: "退出登录" }).click();
  await page.waitForURL(/\/auth\/login/, { timeout: 20_000 });

  const rightAfter = await appCaches(page);
  console.info("LOGOUT-CACHE right after logout:", JSON.stringify(rightAfter));

  // 轮询而不是瞬时断言：登出时那次删除可能被"仍在飞行的 revalidate"重新写入，
  // 真正的保证还包括 /auth 页挂载时的兜底清扫（PwaRegister 注册 effect 里那段）。
  // 8s 是给它的时间上界，超过就算失败——不是把断言放宽。
  await expect
    .poll(async () => tenantEntries(await appCaches(page), wid).length, {
      timeout: 8_000,
      intervals: [200, 500, 1000],
      message: "登出后缓存里不应残留该工作区的任何页面",
    })
    .toBe(0);

  const settled = await appCaches(page);
  console.info("LOGOUT-CACHE after /auth sweep:", JSON.stringify(settled));
});
