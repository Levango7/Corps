// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";

/**
 * OnlinePresence 契约（components/OnlinePresence.tsx，default 导出）：
 *  - 挂载 GET /api/v1/workspaces/{wid}/presence；默认同时立即发一次心跳 POST（同 URL）
 *  - data 未到 → 骨架屏 aria-busy + aria-label presence:loading；失败且无 data →
 *    role=status + presence:loadFailed（静默降级，不抛错）
 *  - 成员渲染：onlineCount/total 文本 + 容器 aria-label presence:onlineCount {count}；
 *    image 有 → img(src,alt)；无 → 姓名首字母大写占位（空名 "?"）
 *  - 在线绿点 bg-[var(--success)] / 离线灰点 bg-[var(--meta)]，title "名字 · online|offline"
 *  - max 截断：只显示前 max 个，超出 total-visible 折叠为 +N
 *  - 轮询：每 30s 重新 GET；心跳每 120s POST；heartbeat=false 全关；
 *    卸载清掉两个定时器
 */

const h = vi.hoisted(() => ({
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
vi.mock("@/lib/api", () => ({ api: h.api }));

import OnlinePresence from "@/components/OnlinePresence";

const WID = "ws-pr-1";
const ENDPOINT = `/api/v1/workspaces/${WID}/presence`;

function member(id: string, overrides: Record<string, unknown> = {}) {
  return {
    userId: id,
    name: `用户${id}`,
    image: null,
    role: "member",
    online: true,
    onlineAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const PRESENCE = {
  items: [member("u-1", { name: "Ada" }), member("u-2", { name: "bob", online: false })],
  total: 2,
  onlineCount: 1,
};

/** 按方法分流：GET 依次消费 gets 队列，POST 记录后成功 */
let gets: Array<object | Error>;
function mockFlow() {
  h.api.mockImplementation(async (_url: string, opts?: { method?: string }) => {
    if (opts?.method === "POST") return { onlineAt: "2026-01-01T00:00:00.000Z" };
    const next = gets.shift();
    if (next instanceof Error) throw next;
    return next ?? PRESENCE;
  });
}

/** fake timers 下等待微任务与定时器链 flush */
async function flushTimers(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const getUrls = () => h.api.mock.calls.filter(([, opts]) => !opts?.method).map(([url]) => url);
const postUrls = () =>
  h.api.mock.calls.filter(([, opts]) => opts?.method === "POST").map(([url]) => url);

beforeEach(() => {
  h.api.mockReset();
  gets = [];
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("OnlinePresence", () => {
  it("挂载：GET 精确 URL + 立即心跳 POST 同 URL（默认 heartbeat）", async () => {
    mockFlow();
    render(<OnlinePresence wid={WID} />);
    await waitFor(() => expect(screen.getByText("1/2")).toBeInTheDocument());
    expect(getUrls()).toEqual([ENDPOINT]);
    expect(postUrls()).toEqual([ENDPOINT]);
  });

  it("data 未到：骨架屏 aria-busy + presence:loading", () => {
    h.api.mockReturnValue(new Promise(() => {}));
    render(<OnlinePresence wid={WID} />);
    const skeleton = screen.getByLabelText("presence:loading");
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(skeleton.querySelectorAll("span")).toHaveLength(5);
  });

  it("成员渲染：计数文本 + 容器 aria-label onlineCount {count}", async () => {
    mockFlow();
    render(<OnlinePresence wid={WID} />);
    await waitFor(() => expect(screen.getByText("1/2")).toBeInTheDocument());
    expect(screen.getByLabelText(`presence:onlineCount:{"count":1}`)).toBeInTheDocument();
  });

  it("image 有 → img(src,alt)；无 → 首字母占位（trim 大写、空名 → ?）", async () => {
    h.api.mockImplementation(async (_url: string, opts?: { method?: string }) => {
      if (opts?.method === "POST") return {};
      return {
        items: [
          member("u-1", { name: "Ada", image: "https://cdn/a.png" }),
          member("u-2", { name: "  bob " }),
          member("u-3", { name: "  " }),
        ],
        total: 3,
        onlineCount: 3,
      };
    });
    render(<OnlinePresence wid={WID} />);
    await waitFor(() => expect(screen.getByText("3/3")).toBeInTheDocument());
    const img = screen.getByRole("img", { name: "Ada" });
    expect(img).toHaveAttribute("src", "https://cdn/a.png");
    expect(screen.getByText("B")).toBeInTheDocument(); // "  bob " → 首字符大写
    expect(screen.getByText("?")).toBeInTheDocument(); // 空白名 → "?"
  });

  it("在线绿点 / 离线灰点：指示点类名与 title 文案", async () => {
    mockFlow();
    render(<OnlinePresence wid={WID} />);
    await waitFor(() => expect(screen.getByText("1/2")).toBeInTheDocument());
    const online = screen.getByTitle("Ada · presence:online");
    expect(online.querySelector("span.bg-\\[var\\(--success\\)\\]")).toBeTruthy();
    const offline = screen.getByTitle("bob · presence:offline");
    expect(offline.querySelector("span.bg-\\[var\\(--meta\\)\\]")).toBeTruthy();
  });

  it("max 截断：只显示前 max 个成员，超出折叠为 +N", async () => {
    mockFlow();
    h.api.mockImplementation(async (_url: string, opts?: { method?: string }) => {
      if (opts?.method === "POST") return {};
      return {
        items: [member("u-1"), member("u-2"), member("u-3")],
        total: 5,
        onlineCount: 3,
      };
    });
    render(<OnlinePresence wid={WID} max={2} />);
    await waitFor(() => expect(screen.getByText("3/5")).toBeInTheDocument());
    expect(screen.getByTitle("用户u-1 · presence:online")).toBeInTheDocument();
    expect(screen.getByTitle("用户u-2 · presence:online")).toBeInTheDocument();
    expect(screen.queryByTitle("用户u-3 · presence:online")).not.toBeInTheDocument();
    // overflow = total(5) - visible(2) = 3
    expect(screen.getByText("+3")).toBeInTheDocument();
  });

  it("GET 失败且无 data：role=status + presence:loadFailed", async () => {
    h.api.mockRejectedValue(new Error("offline"));
    render(<OnlinePresence wid={WID} />);
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("presence:loadFailed");
    expect(screen.queryByLabelText("presence:loading")).not.toBeInTheDocument();
  });

  it("失败后恢复：下一次轮询 GET 成功 → 正常渲染成员列表", async () => {
    vi.useFakeTimers();
    gets = [new Error("offline"), PRESENCE];
    mockFlow();
    render(<OnlinePresence wid={WID} />);
    await flushTimers(0);
    expect(screen.getByRole("status")).toHaveTextContent("presence:loadFailed");
    await flushTimers(30_000); // 30s 轮询触发第二次 GET
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("轮询：30s 一次 GET（120s 内共 5 次），心跳 120s 一次 POST", async () => {
    vi.useFakeTimers();
    mockFlow();
    render(<OnlinePresence wid={WID} />);
    await flushTimers(0);
    expect(getUrls()).toHaveLength(1);
    await flushTimers(30_000);
    expect(getUrls()).toHaveLength(2);
    await flushTimers(60_000); // 累计 90s
    expect(getUrls()).toHaveLength(4);
    await flushTimers(30_000); // 累计 120s：GET#5 + POST#2
    expect(getUrls()).toHaveLength(5);
    expect(postUrls()).toHaveLength(2);
  });

  it("heartbeat=false：不发 POST，但 30s 轮询 GET 照常", async () => {
    vi.useFakeTimers();
    mockFlow();
    render(<OnlinePresence wid={WID} heartbeat={false} />);
    await flushTimers(0);
    expect(postUrls()).toEqual([]);
    await flushTimers(30_000);
    expect(getUrls()).toHaveLength(2);
    expect(postUrls()).toEqual([]);
  });

  it("卸载：清除轮询与心跳定时器，之后不再发请求", async () => {
    vi.useFakeTimers();
    mockFlow();
    const { unmount } = render(<OnlinePresence wid={WID} />);
    await flushTimers(0);
    expect(getUrls()).toHaveLength(1);
    unmount();
    await flushTimers(120_000);
    expect(getUrls()).toHaveLength(1);
    expect(postUrls()).toHaveLength(1);
  });
});
