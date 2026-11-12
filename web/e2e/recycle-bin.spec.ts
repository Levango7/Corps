import { expect, test } from "@playwright/test";
import { registerAndLogin, uniqueEmail } from "./helpers";

/**
 * E2E：回收站域 —— 空态与类型筛选可用性。
 *
 * ⚠️ 覆盖缺口（实证钉死，勿伪造数据补齐）：
 *  网页端删除全部走硬删除——tasks/[id] DELETE = tx.task.delete、
 *  documents/[id] DELETE = tx.document.delete、tasks/batch action=delete =
 *  deleteMany、看板「立即删除」同走 DELETE /tasks/{id}；deletedAt 唯一写入端
 *  是 /api/v1/sync 同步协议（route.ts:425），网页 UI 无软删入口 ⇒ 回收站
 *  网页端恒为空。因此本 spec 只钉：空态文案 + 全部/任务/文档三 tab 切换
 *  可用性。恢复 / 永久删除 / 清空 / 批量正反向用例须等软删写入端立项后补。
 *
 * 前置：dev server + RATE_LIMIT_DISABLED=1 + 库可达（同其他 spec）。
 * 独立性：每个 test 自带账号夹具（注册即登录），互不依赖执行顺序——
 * 所以不用 describe.serial：serial 下首条红会把整组后续用例标成 skipped，
 * 覆盖悄悄缩水，报告里只看得到第一条红。
 */

test.describe("回收站：空态与类型筛选", () => {
  test("回收站恒为空（网页端无软删写入端），三 tab 切换可用", async ({ page }) => {
    const wid = await registerAndLogin(page, uniqueEmail("e2e-recycle"), "E2E回收站工作区");
    await page.goto(`/w/${wid}/recycle-bin`);

    // 空态（网页端删除全硬删，回收站无数据可渲染——这是诚实覆盖，不是缩水）
    await expect(page.getByText("回收站为空")).toBeVisible({ timeout: 10_000 });

    // 类型筛选 tab：全部 / 任务 / 文档，切换后空态保持
    for (const tab of ["全部", "任务", "文档"]) {
      await page.getByRole("button", { name: tab, exact: true }).click();
      await expect(page.getByText("回收站为空")).toBeVisible({ timeout: 10_000 });
    }
  });
});
