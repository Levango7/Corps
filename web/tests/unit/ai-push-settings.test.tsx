// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";

/**
 * AiPushSettings 契约（components/ai/AiPushSettings.tsx，named 导出）：
 *  1. 挂载即 GET /api/v1/ai/push/schedules?wid=..；loading 态只有 Loader2 图标、无文案
 *  2. 列表项：状态点 aria-label（enabled/disabled）、capability 显示名、cron（code）、
 *     lastRunAt（null → "—"，有值 → relativeTime/time ns）、操作按钮 title
 *     （trigger=t("trigger")、toggle=enabled?t("disabled"):t("enabled")、delete=t("error")）
 *  3. 创建：header 按钮 t("create") 开关表单（表单内另有同名 h2 与提交按钮）；提交
 *     POST /api/v1/ai/push/schedules {wid,capability,cron,enabled}，成功关表单并重拉列表；
 *     cron 为空时提交 disabled；失败仅在表单内显示 t("error")
 *  4. 手动触发：POST /api/v1/ai/push/trigger {wid,capability,scheduleId}，不重拉列表
 *  5. 启停：PATCH /api/v1/ai/push/schedules/{id} {wid,enabled:!enabled}，成功重拉；失败 t("error")
 *  6. 删除：DELETE /api/v1/ai/push/schedules/{id}?wid=..，成功重拉
 *  7. 加载失败 → t("loadFailed")；空列表 → Bell + t("noRecords")
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
}));

vi.mock("next-intl", () => {
  const cache = new Map<string, (key: string, vars?: Record<string, unknown>) => string>();
  const useTranslations = (ns: string) => {
    let fn = cache.get(ns);
    if (!fn) {
      const created = (key: string, vars?: Record<string, unknown>) =>
        vars ? `${ns}:${key}:${JSON.stringify(vars)}` : `${ns}:${key}`;
      cache.set(ns, created);
      fn = created;
    }
    return fn;
  };
  return { useTranslations };
});
vi.mock("@/lib/api", () => ({ api: mocks.api }));

import { AiPushSettings } from "@/components/ai/AiPushSettings";

const WID = "ws-set-1";
const GET_URL = "/api/v1/ai/push/schedules?wid=ws-set-1";

interface ScheduleShape {
  id: string;
  capability: string;
  cron: string;
  enabled: boolean;
  lastRunAt: string | null;
}

function makeSchedule(overrides: Partial<ScheduleShape> = {}): ScheduleShape {
  return {
    id: "sch-1",
    capability: "daily_briefing",
    cron: "0 9 * * 1-5",
    enabled: true,
    lastRunAt: null,
    ...overrides,
  };
}

function headerCreateBtn() {
  return screen.getAllByRole("button", { name: "aiPush:create" })[0];
}

function submitCreateBtn() {
  return screen.getAllByRole("button", { name: "aiPush:create" })[1];
}

beforeEach(() => {
  mocks.api.mockReset();
});
afterEach(() => cleanup());

describe("AiPushSettings", () => {
  it("挂载即 GET /api/v1/ai/push/schedules?wid=..，loading 期间只有图标", async () => {
    let resolveApi!: (v: unknown) => void;
    mocks.api.mockReturnValueOnce(
      new Promise((res) => {
        resolveApi = res;
      }),
    );
    const { container } = render(<AiPushSettings wid={WID} />);

    expect(mocks.api).toHaveBeenCalledWith(GET_URL);
    expect(container.querySelector("svg.lucide-loader-2")).toBeTruthy();
    expect(screen.queryByText("aiPush:noRecords")).toBeFalsy();
    resolveApi([]);
    await screen.findByText("aiPush:noRecords");
  });

  it("列表渲染：状态点 aria-label/标签/cron/lastRun(null→—,有值→justNow)/操作按钮 title", async () => {
    mocks.api.mockResolvedValueOnce([
      makeSchedule(),
      makeSchedule({
        id: "sch-2",
        capability: "risk_alert",
        enabled: false,
        lastRunAt: new Date().toISOString(),
      }),
    ]);
    render(<AiPushSettings wid={WID} />);

    const li1 = (await screen.findByText("aiPush:dailyBriefing")).closest("li")!;
    expect(within(li1).getByLabelText("aiPush:enabled")).toBeTruthy();
    expect(within(li1).getByText("0 9 * * 1-5")).toBeInTheDocument();
    expect(within(li1).getByText("—")).toBeInTheDocument();
    expect(within(li1).getByTitle("aiPush:trigger")).toBeTruthy();
    expect(within(li1).getByTitle("aiPush:disabled")).toBeTruthy(); // 已启用 → 点击则禁用
    expect(within(li1).getByTitle("aiPush:error")).toBeTruthy(); // 删除

    const li2 = screen.getByText("aiPush:riskAlert").closest("li")!;
    expect(within(li2).getByLabelText("aiPush:disabled")).toBeTruthy();
    expect(within(li2).getByText("time:justNow")).toBeInTheDocument();
    expect(within(li2).getByTitle("aiPush:enabled")).toBeTruthy(); // 已停用 → 点击则启用
  });

  it("空列表 → Bell 空态文案 noRecords", async () => {
    mocks.api.mockResolvedValueOnce([]);
    render(<AiPushSettings wid={WID} />);
    expect(await screen.findByText("aiPush:noRecords")).toBeInTheDocument();
  });

  it("加载失败 → t(loadFailed) 错误条，不泄露 e.message", async () => {
    mocks.api.mockRejectedValueOnce(new Error("sensitive boom"));
    render(<AiPushSettings wid={WID} />);
    expect(await screen.findByText("aiPush:loadFailed")).toBeInTheDocument();
    expect(screen.queryByText("sensitive boom")).toBeFalsy();
  });

  it("创建表单：打开显示默认值（daily_briefing/0 9 * * 1-5/启用），再次点击 header 按钮收起", async () => {
    mocks.api.mockResolvedValue([]);
    render(<AiPushSettings wid={WID} />);
    await screen.findByText("aiPush:noRecords");

    fireEvent.click(headerCreateBtn());
    expect(screen.getByLabelText("aiPush:capability")).toHaveValue("daily_briefing");
    expect((screen.getByLabelText("aiPush:cron") as HTMLInputElement).value).toBe("0 9 * * 1-5");
    expect(screen.getByLabelText("aiPush:enabled")).toBeChecked();

    fireEvent.click(headerCreateBtn()); // header 按钮为开关：再点收起
    expect(screen.queryByLabelText("aiPush:cron")).toBeFalsy();
  });

  it("cron 清空 → 提交按钮 disabled", async () => {
    mocks.api.mockResolvedValue([]);
    render(<AiPushSettings wid={WID} />);
    await screen.findByText("aiPush:noRecords");

    fireEvent.click(headerCreateBtn());
    fireEvent.change(screen.getByLabelText("aiPush:cron"), { target: { value: "" } });
    expect(submitCreateBtn()).toBeDisabled();
  });

  it("创建成功：POST body 精确、表单收起并重新拉取列表", async () => {
    mocks.api.mockResolvedValue([]);
    render(<AiPushSettings wid={WID} />);
    await screen.findByText("aiPush:noRecords");

    fireEvent.click(headerCreateBtn());
    fireEvent.change(screen.getByLabelText("aiPush:capability"), {
      target: { value: "risk_alert" },
    });
    fireEvent.change(screen.getByLabelText("aiPush:cron"), { target: { value: "30 8 * * *" } });
    fireEvent.click(screen.getByLabelText("aiPush:enabled")); // 取消勾选
    fireEvent.click(submitCreateBtn());

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(3)); // GET + POST + 重拉 GET
    expect(mocks.api).toHaveBeenNthCalledWith(2, "/api/v1/ai/push/schedules", {
      method: "POST",
      body: JSON.stringify({
        wid: WID,
        capability: "risk_alert",
        cron: "30 8 * * *",
        enabled: false,
      }),
    });
    expect(mocks.api).toHaveBeenNthCalledWith(3, GET_URL);
    await waitFor(() => expect(screen.queryByLabelText("aiPush:cron")).toBeFalsy());
  });

  it("创建失败：仅在表单内显示 t(error)，表单保持打开", async () => {
    mocks.api.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("boom"));
    render(<AiPushSettings wid={WID} />);
    await screen.findByText("aiPush:noRecords");

    fireEvent.click(headerCreateBtn());
    fireEvent.click(submitCreateBtn());
    expect(await screen.findByText("aiPush:error")).toBeInTheDocument();
    expect(screen.getByLabelText("aiPush:cron")).toBeInTheDocument();
  });

  it("手动触发：POST /api/v1/ai/push/trigger {wid,capability,scheduleId}，且不重拉列表", async () => {
    mocks.api.mockResolvedValueOnce([makeSchedule()]).mockResolvedValueOnce({});
    render(<AiPushSettings wid={WID} />);
    const li = (await screen.findByText("aiPush:dailyBriefing")).closest("li")!;

    fireEvent.click(within(li).getByTitle("aiPush:trigger"));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api).toHaveBeenNthCalledWith(2, "/api/v1/ai/push/trigger", {
      method: "POST",
      body: JSON.stringify({ wid: WID, capability: "daily_briefing", scheduleId: "sch-1" }),
    });
  });

  it("启停切换：PATCH {wid,enabled:false}，成功后重拉列表", async () => {
    mocks.api
      .mockResolvedValueOnce([makeSchedule()])
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce([]);
    render(<AiPushSettings wid={WID} />);
    const li = (await screen.findByText("aiPush:dailyBriefing")).closest("li")!;

    fireEvent.click(within(li).getByTitle("aiPush:disabled"));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(3)); // GET + PATCH + 重拉 GET
    expect(mocks.api).toHaveBeenNthCalledWith(2, "/api/v1/ai/push/schedules/sch-1", {
      method: "PATCH",
      body: JSON.stringify({ wid: WID, enabled: false }),
    });
    expect(mocks.api).toHaveBeenNthCalledWith(3, GET_URL);
  });

  it("启停失败 → t(error) 错误条", async () => {
    mocks.api.mockResolvedValueOnce([makeSchedule()]).mockRejectedValueOnce(new Error("boom"));
    render(<AiPushSettings wid={WID} />);
    const li = (await screen.findByText("aiPush:dailyBriefing")).closest("li")!;

    fireEvent.click(within(li).getByTitle("aiPush:disabled"));
    expect(await screen.findByText("aiPush:error")).toBeInTheDocument();
  });

  it("删除：DELETE /api/v1/ai/push/schedules/{id}?wid=..，成功后重拉列表", async () => {
    mocks.api
      .mockResolvedValueOnce([makeSchedule()])
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce([]);
    render(<AiPushSettings wid={WID} />);
    const li = (await screen.findByText("aiPush:dailyBriefing")).closest("li")!;

    fireEvent.click(within(li).getByTitle("aiPush:error"));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(3)); // GET + DELETE + 重拉 GET
    expect(mocks.api).toHaveBeenNthCalledWith(2, `/api/v1/ai/push/schedules/sch-1?wid=${WID}`, {
      method: "DELETE",
    });
    expect(mocks.api).toHaveBeenNthCalledWith(3, GET_URL);
  });
});
