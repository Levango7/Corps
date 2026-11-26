// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runWorker: vi.fn() }));
vi.mock("@/lib/delivery/outbox-worker", () => ({ runDeliveryOutboxWorker: mocks.runWorker }));
vi.mock("@/lib/red-metrics", () => ({ withRed: (fn: unknown) => fn }));

import { GET } from "@/app/api/cron/deliverable-outbox/route";

const previousSecret = process.env.CRON_SECRET;
const secret = `unit-${Math.random().toString(36).slice(2)}`;

function request(token?: string, limit = "7") {
  return new NextRequest(`http://localhost/api/cron/deliverable-outbox?limit=${limit}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

describe("deliverable outbox cron route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = secret;
    mocks.runWorker.mockResolvedValue({
      claimed: 2,
      completed: 1,
      rescheduled: 1,
      failed: 0,
      deadLetter: 0,
    });
  });

  afterEach(() => {
    if (previousSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
  });

  it("错误密钥返回 401，且不执行 worker", async () => {
    const response = await GET(request("wrong-token"));
    expect(response.status).toBe(401);
    expect(mocks.runWorker).not.toHaveBeenCalled();
  });

  it("正确密钥执行有界批处理并透传 limit", async () => {
    const response = await GET(request(secret));
    expect(response.status).toBe(200);
    expect(mocks.runWorker).toHaveBeenCalledWith(7);
    const body = await response.json();
    expect(body.data).toEqual({
      claimed: 2,
      completed: 1,
      rescheduled: 1,
      failed: 0,
      deadLetter: 0,
    });
  });
});
