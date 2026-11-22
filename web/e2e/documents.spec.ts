import { expect, test } from "@playwright/test";
import { registerAndLogin, uniqueEmail } from "./helpers";

// 文档中心：新建文档→跳编辑页→回列表出现该文档。
// 覆盖=真实链路：POST /documents 创建 → 编辑页可达 → 列表渲染。
test.describe("文档中心", () => {
  test("新建文档→跳编辑页→回列表出现", async ({ browser }) => {
    test.setTimeout(180_000);
    const ctxA = await browser.newContext({ locale: "zh-CN" });
    const pageA = await ctxA.newPage();
    const wid = await registerAndLogin(pageA, uniqueEmail("e2e-doc-owner"), "E2E文档工作区");

    await pageA.goto(`/w/${wid}/documents`);
    await expect(pageA.getByRole("button", { name: "新建文档" })).toBeVisible({
      timeout: 15_000,
    });
    await pageA.getByRole("button", { name: "新建文档" }).click();
    // 新建后跳到编辑页（URL 含 /documents/<uuid>），编辑页有标题输入
    await pageA.waitForURL(/\/documents\/[0-9a-f-]{36}/i, { timeout: 20_000 });
    await expect(pageA.getByPlaceholder("文档标题")).toBeVisible({ timeout: 15_000 });

    // 回列表页 → 列表出现「未命名文档」
    await pageA.goto(`/w/${wid}/documents`);
    await expect(pageA.getByText("未命名文档", { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });

    await ctxA.close();
  });
});
