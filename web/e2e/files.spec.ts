import { expect, test } from "@playwright/test";
import { registerAndLogin, uniqueEmail } from "./helpers";

// 云盘域：上传文件→列表出现→版本历史弹层显示 v1。
// 覆盖=真实链路：FileUploader 上传（multipart）→ 列表渲染 → 版本历史弹层。
test.describe("云盘", () => {
  test("上传文件→列表出现→版本历史弹层显示 v1", async ({ browser }) => {
    test.setTimeout(180_000);
    const ctxA = await browser.newContext({ locale: "zh-CN" });
    const pageA = await ctxA.newPage();
    const wid = await registerAndLogin(pageA, uniqueEmail("e2e-file-owner"), "E2E云盘工作区");
    const fileName = `e2e-云盘-${Date.now()}.txt`;

    await pageA.goto(`/w/${wid}/files`);
    // FileUploader compact 按钮「上传」→ 隐藏 input[type=file] 注入文件
    await pageA.getByRole("button", { name: "上传", exact: true }).click();
    await pageA.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from("E2E 云盘上传内容 " + Date.now()),
    });
    // 列表出现该文件名
    await expect(pageA.getByText(fileName, { exact: true }).first()).toBeVisible({
      timeout: 20_000,
    });

    // 点「版本历史」→ 弹层显示版本列表（含 v1）
    await pageA.getByRole("button", { name: /版本历史/ }).click();
    await expect(pageA.getByText(/v1|版本 1|第 1 版/).first()).toBeVisible({ timeout: 10_000 });

    await ctxA.close();
  });
});
