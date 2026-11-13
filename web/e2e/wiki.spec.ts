import { expect, test } from "@playwright/test";
import { registerAndLogin, uniqueEmail } from "./helpers";

/**
 * E2E：Wiki 域 —— 建页（根/子）→ 编辑 → 手动保存 → 预览 → 持久化 → 删除 → 空态/404。
 *
 * 覆盖：
 *  - 侧边栏「新建页面」（window.prompt 输入标题）建根页，创建后选中进编辑页
 *  - 编辑器改内容 + 手动保存（dirty 守卫：保存后按钮禁用）+ reload 后内容仍在
 *    （持久化硬证据，独立于 2s 自动保存 debounce）
 *  - 编辑/预览 tab 切换（预览渲染标题与 Markdown 正文）
 *  - hover 行内「new subpage」按钮建子页（opacity-0 group-hover 显形，先 hover）
 *  - 删除走 window.confirm（accept 即确认）：子页删除后父页仍在；再删父页清空树
 *  - 空态（noPages）+ 随机 pageId 访问的 notFound 态（客户端 404）
 *
 * 前置：dev server + RATE_LIMIT_DISABLED=1 + 库可达（同其他 spec）。
 * 独立性：每个 test 自带账号夹具（注册即登录），互不依赖执行顺序——
 * 所以不用 describe.serial：serial 下首条红会把整组后续用例标成 skipped，
 * 覆盖悄悄缩水，报告里只看得到第一条红。
 */

test.describe("知识库：建页 → 编辑保存 → 预览 → 子页 → 删除 → 空态/404", () => {
  test("Wiki 页面 CRUD：根页+子页建改存、预览、逐级删除", async ({ page }) => {
    // 建页/编辑/保存/预览/两级删除串联，放宽总超时
    test.setTimeout(120_000);
    const wid = await registerAndLogin(page, uniqueEmail("e2e-wiki"), "E2E知识库工作区");
    const parentTitle = `E2Ewiki父页-${Date.now()}`;
    // 子页标题须与父页拉开 slug：slugify 会丢弃全部非 ASCII 字符（route 实测），
    // 同一 tick 求值的 Date.now() 同值会让父子 slug 完全相同，撞工作区
    // slug 唯一约束返回 409「页面标识冲突」，建页流程中断在子页
    const childTitle = `E2Ewiki子页-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const bodyText = `E2E-WIKI-BODY-${Date.now()}`;
    const content = `# E2E 标题\n\n${bodyText}`;

    // ── 空树首页 ──
    await page.goto(`/w/${wid}/wiki`);
    await expect(page.getByText("暂无页面，点击「新建页面」开始")).toBeVisible({ timeout: 10_000 });

    // ── 建根页（window.prompt：先挂 dialog 再点按钮）──
    page.once("dialog", (dialog) => dialog.accept(parentTitle));
    await page.getByRole("button", { name: "新建页面", exact: true }).click();
    // 创建后选中进编辑页（URL /wiki/<id>，标题 input 值为 prompt 标题）
    // 标题 input 用 placeholder 锚定：侧栏搜索框同为 type=text，
    // 直选 input[type="text"] 会 strict 命中 2 个（WikiEditor/WikiSidebar 实测 markup）
    await page.waitForURL(/\/wiki\//, { timeout: 10_000 });
    await expect(page.getByPlaceholder("输入页面标题")).toHaveValue(parentTitle, {
      timeout: 10_000,
    });

    // ── 编辑内容 + 手动保存（dirty 守卫：保存后按钮禁用）──
    await page.locator("textarea").fill(content);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByRole("button", { name: "保存", exact: true })).toBeDisabled({
      timeout: 10_000,
    });
    // 持久化硬证据：reload 后内容仍在
    await page.reload();
    await expect(page.locator("textarea")).toHaveValue(content, { timeout: 10_000 });

    // ── 预览 tab：标题与 Markdown 正文渲染 ──
    await page.getByRole("button", { name: "预览", exact: true }).click();
    await expect(page.getByRole("heading", { name: parentTitle })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(bodyText)).toBeVisible({ timeout: 10_000 });

    // ── 回首页建子页（hover 行内 new subpage 按钮，opacity-0 需先 hover）──
    await page.goto(`/w/${wid}/wiki`);
    await expect(page.getByText(parentTitle, { exact: true })).toBeVisible({ timeout: 10_000 });
    page.once("dialog", (dialog) => dialog.accept(childTitle));
    await page.getByText(parentTitle, { exact: true }).hover();
    await page.locator('button[aria-label="new subpage"]').click();
    await page.waitForURL(/\/wiki\//, { timeout: 10_000 });
    await expect(page.getByPlaceholder("输入页面标题")).toHaveValue(childTitle, {
      timeout: 10_000,
    });

    // ── 树中父子都在 ──
    await page.goto(`/w/${wid}/wiki`);
    await expect(page.getByText(parentTitle, { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(childTitle, { exact: true })).toBeVisible({ timeout: 10_000 });

    // ── 删除子页（window.confirm：accept 即确认）──
    await page.getByText(childTitle, { exact: true }).click();
    await expect(page.getByPlaceholder("输入页面标题")).toHaveValue(childTitle, {
      timeout: 10_000,
    });
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "删除", exact: true }).click();
    await page.waitForURL(/\/w\/[^/]+\/wiki$/, { timeout: 10_000 });
    await expect(page.getByText(childTitle, { exact: true })).not.toBeVisible({ timeout: 10_000 });

    // ── 删除父页（deleteConfirm 语义：子页面将变为根页面；本例树已空）──
    await page.getByText(parentTitle, { exact: true }).click();
    await expect(page.getByPlaceholder("输入页面标题")).toHaveValue(parentTitle, {
      timeout: 10_000,
    });
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "删除", exact: true }).click();
    await page.waitForURL(/\/w\/[^/]+\/wiki$/, { timeout: 10_000 });
    await expect(page.getByText("暂无页面，点击「新建页面」开始")).toBeVisible({ timeout: 10_000 });
  });

  test("Wiki 空态与不存在页面（notFound）", async ({ page }) => {
    const wid = await registerAndLogin(page, uniqueEmail("e2e-wiki-404"), "E2E知识库工作区");
    await page.goto(`/w/${wid}/wiki`);
    await expect(page.getByText("暂无页面，点击「新建页面」开始")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("从左侧选择页面查看")).toBeVisible({ timeout: 10_000 });

    // 随机 pageId：客户端 404 → notFound 态（页面不存在）
    await page.goto(`/w/${wid}/wiki/00000000-0000-4000-8000-000000000000`);
    await expect(page.getByText("页面不存在")).toBeVisible({ timeout: 10_000 });
  });
});
