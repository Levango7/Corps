import { expect, test } from "@playwright/test";
import { uniqueEmail, registerAndLogin } from "./helpers";

/**
 * E2E：白板域交互 —— 一键创建跳编辑页渲染 / 空态与列表卡片。
 *
 * 覆盖 route-health 抓不到的东西：
 *  - WhiteboardList 的「新建白板」按钮是直接 POST（无表单），创建默认标题「未命名白板」
 *    后 router.push 进编辑页（与内联表单域不同：点按钮即跳转，无中间填写步骤）
 *  - 编辑页 header：标题输入框（aria-label「白板」，textbox role，与侧栏同名链接不撞）
 *    初始值「未命名白板」，工具栏按钮组（选择/矩形等）渲染
 *  - 列表空态「暂无白板」与创建后卡片（h2 标题 + 「更新于」行）
 *
 * 断言口径：
 *  - 列表卡片标题用 heading 定位（卡片是 h2，页面 h1 是「白板」，文案不同不冲突）
 *  - 删除按钮 hover 才显形（opacity 过渡），只断言卡片主体，不依赖 hover 态
 */

test.describe("白板：一键创建跳编辑页 / 空态与列表卡片", () => {
  test("新建白板：创建后跳编辑页，标题与工具栏渲染", async ({ page }) => {
    const wid = await registerAndLogin(page, uniqueEmail("e2e-whiteboard"), "E2E白板工作区");

    await page.goto(`/w/${wid}/whiteboards`);
    // 新工作区无白板：空态文案可见
    await expect(page.getByText("暂无白板", { exact: true })).toBeVisible({ timeout: 15_000 });

    // 一键创建（无表单）：POST 默认标题后跳编辑页
    await page.getByRole("button", { name: "新建白板" }).click();
    await expect(page).toHaveURL(/\/whiteboards\/[^/]+$/, { timeout: 15_000 });

    // 编辑页 header：标题输入框（textbox，避开侧栏同名链接）初始「未命名白板」
    const titleInput = page.getByRole("textbox", { name: "白板" });
    await expect(titleInput).toBeVisible({ timeout: 10_000 });
    await expect(titleInput).toHaveValue("未命名白板");
    // 工具栏按钮组（aria-label 与 title 双设）
    await expect(page.getByRole("button", { name: "选择" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "矩形" })).toBeVisible({ timeout: 10_000 });
  });

  test("列表空态与创建后卡片：回列表后新白板出现且带更新时间行", async ({ page }) => {
    const wid = await registerAndLogin(page, uniqueEmail("e2e-whiteboard"), "E2E白板工作区");

    await page.goto(`/w/${wid}/whiteboards`);
    await expect(page.getByText("暂无白板", { exact: true })).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "新建白板" }).click();
    await expect(page).toHaveURL(/\/whiteboards\/[^/]+$/, { timeout: 15_000 });

    // 回列表页：卡片标题（h2）与「更新于」时间行渲染
    await page.goto(`/w/${wid}/whiteboards`);
    await expect(page.getByRole("heading", { name: "未命名白板" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/^更新于/).first()).toBeVisible({ timeout: 10_000 });
  });
});
