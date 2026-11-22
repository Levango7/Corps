import { expect, test, type Browser } from "@playwright/test";
import { registerAndLogin, uniqueEmail } from "./helpers";

// 成员管理域：邀请（已注册直加/未注册出链接）+ 改角色 + 两步确认移除 + 非管理员入口收敛。
// 覆盖=真实链路：注册/邀请建成员 → 页面邀请/改角色/移除 → 列表与角色状态断言。
// 双账号夹具：A=owner（widA），B=已注册成员（被邀入 widA）。不依赖 helpers 改动。

async function setup(browser: Browser) {
  const ctxA = await browser.newContext({ locale: "zh-CN" });
  const pageA = await ctxA.newPage();
  const wid = await registerAndLogin(pageA, uniqueEmail("e2e-mem-owner"), "E2E成员管理工作区");
  const ctxB = await browser.newContext({ locale: "zh-CN" });
  const pageB = await ctxB.newPage();
  const emailB = uniqueEmail("e2e-mem-member");
  await registerAndLogin(pageB, emailB, "成员自有工作区");
  return { ctxA, pageA, ctxB, pageB, wid, emailB };
}

test.describe("成员管理", () => {
  test("全流程：邀请已注册成员→改角色为管理员→两步确认移除", async ({ browser }) => {
    test.setTimeout(180_000);
    // 本用例全程 owner 视角操作（B 仅作被邀请对象，不开页面），故不解构 pageB
    const { ctxA, pageA, ctxB, wid, emailB } = await setup(browser);

    // A 邀请 B（已注册用户→直接加入）
    await pageA.goto(`/w/${wid}/members`);
    await pageA.getByPlaceholder("输入邮箱地址（未注册也可邀请）").fill(emailB);
    await pageA.getByRole("button", { name: "邀请", exact: true }).click();
    await expect(pageA.getByText("已发送邀请邮件", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    // 列表出现 B 的邮箱（行/卡两种布局同渲染，取其一）
    await expect(pageA.getByText(emailB, { exact: true }).first()).toBeVisible({
      timeout: 10_000,
    });

    // A 把 B 的角色改为管理员（页面上仅 B 的角色下拉是可编辑 combobox）
    const roleSelect = pageA.getByRole("combobox");
    await roleSelect.selectOption("admin");
    await expect(roleSelect).toHaveValue("admin", { timeout: 10_000 });

    // A 移除 B：第一次点击进入确认态，第二次执行（两步确认）。
    // 删除按钮 aria=「移除 {name}」（name=邮箱本地部分）；页面上仅 B 可被移除（A 自己不可移除）。
    await pageA.getByRole("button", { name: /移除/ }).click();
    await pageA.getByRole("button", { name: /确定移除/ }).click();
    // B 的邮箱从列表消失
    await expect(pageA.getByText(emailB, { exact: true })).toHaveCount(0, { timeout: 10_000 });

    await ctxA.close();
    await ctxB.close();
  });

  test("未注册邀请出链接、重复邀请报错、非管理员无邀请入口", async ({ browser }) => {
    test.setTimeout(180_000);
    const { ctxA, pageA, ctxB, pageB, wid, emailB } = await setup(browser);

    // 邀请未注册邮箱 → 出可分享链接
    await pageA.goto(`/w/${wid}/members`);
    const emailC = uniqueEmail("e2e-mem-newbie");
    await pageA.getByPlaceholder("输入邮箱地址（未注册也可邀请）").fill(emailC);
    await pageA.getByRole("button", { name: "邀请", exact: true }).click();
    await expect(pageA.getByText(/已为 .* 创建邀请（7 天有效）/)).toBeVisible({
      timeout: 15_000,
    });
    await expect(pageA.locator("code", { hasText: "invite=" })).toBeVisible();
    await expect(pageA.getByRole("button", { name: "复制链接" })).toBeVisible();

    // 重复邀请同一未注册邮箱 → 已有未接受邀请时复用记录（不报错）；已注册成员重复邀请 → 409
    // 先把 B 加成成员（已注册直加），再重复邀请 B → 该用户已是成员
    await pageA.getByPlaceholder("输入邮箱地址（未注册也可邀请）").fill(emailB);
    await pageA.getByRole("button", { name: "邀请", exact: true }).click();
    await expect(pageA.getByText("已发送邀请邮件", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await pageA.getByPlaceholder("输入邮箱地址（未注册也可邀请）").fill(emailB);
    await pageA.getByRole("button", { name: "邀请", exact: true }).click();
    await expect(pageA.getByText("该用户已是成员", { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // B（member）打开 members 页：无邀请输入框与邀请按钮
    await pageB.goto(`/w/${wid}/members`);
    await expect(pageB.getByRole("heading", { name: "成员", exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(pageB.getByPlaceholder("输入邮箱地址（未注册也可邀请）")).toHaveCount(0);
    await expect(pageB.getByRole("button", { name: "邀请", exact: true })).toHaveCount(0);

    await ctxA.close();
    await ctxB.close();
  });
});
