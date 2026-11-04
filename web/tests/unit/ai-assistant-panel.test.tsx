// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";

/**
 * AssistantPanel 契约（components/ai/AssistantPanel.tsx）：
 *  1. 挂载即 GET /api/v1/ai/assistant/conversations?wid=（历史列表）与
 *     GET /api/v1/ai/assistant/suggestions?phase=in_progress（建议卡片，仅空对话渲染）
 *  2. 发送 → POST /api/v1/ai/assistant/chat {wid, message, phase, conversationId?}；
 *     回填 conversationId / nextPhase，渲染 assistant 消息 + capability 标签 +
 *     suggestions 按钮（点击填入 input）+ recommendedNext 按钮（点击填入 reason）
 *  3. res.status===429 → t("rateLimited")；json 无 data → t("error")；网络异常 → t("error")
 *  4. 历史下拉（aria-label=t("history")）：切换对话 GET ?wid=&id= 加载消息（每条生成新 id）；
 *     当前对话条目 aria-current
 *  5. 新对话按钮清空消息/输入；Enter 键发送；发送中 thinking 且控件禁用
 *  数据通道为原生 fetch（非 @/lib/api），测试用 vi.stubGlobal("fetch") 拦截。
 */

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
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

import { AssistantPanel } from "@/components/ai/AssistantPanel";

const WID = "ws-ap-1";

/** fetch 响应的最小形状（组件只消费 status 与 json().data） */
interface FetchLike {
  ok: boolean;
  status: number;
  json: () => Promise<{ data: unknown }>;
}

function res(data: unknown, status = 200): FetchLike {
  return { ok: status >= 200 && status < 300, status, json: async () => ({ data }) };
}

const THIRTY_SECONDS_AGO = new Date(Date.now() - 30_000).toISOString();

const CONVERSATIONS = [
  {
    id: "conv-1",
    createdAt: THIRTY_SECONDS_AGO,
    updatedAt: THIRTY_SECONDS_AGO,
    _count: { messages: 3 },
  },
];

const SUGGESTIONS = [
  { id: "s1", labelKey: "suggestionA", description: "帮我总结本周进展" },
  { id: "s2", label: "旧格式建议", description: "查看项目风险" },
];

function chatData(overrides: Record<string, unknown> = {}) {
  return {
    content: "已为你创建任务",
    capabilityId: "semantic-search",
    suggestions: ["再查一下排期", "生成周报"],
    recommendedNext: { nextCapability: "daily-report", reason: "可以顺手生成日报" },
    conversationId: "conv-new-1",
    nextPhase: "semantic_search",
    ...overrides,
  };
}

// handler 可同步返回 FetchLike 或直接返回 Promise（installFetch 统一包 Promise.resolve）
type FetchRoute = () => FetchLike | Promise<FetchLike>;

/** 按 URL 前缀路由的 fetch mock；键的插入顺序即匹配顺序 */
function installFetch(routes: Record<string, FetchRoute>) {
  mocks.fetch.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    for (const [prefix, handler] of Object.entries(routes)) {
      if (url.startsWith(prefix)) return Promise.resolve(handler());
    }
    return Promise.resolve(res(null));
  });
}

function baseRoutes(
  overrides: {
    conversations?: FetchRoute;
    convDetail?: FetchRoute;
    suggestions?: FetchRoute;
    chat?: FetchRoute;
  } = {},
): Record<string, FetchRoute> {
  return {
    // 带 &id= 的详情 URL 必须排在列表前缀之前，避免被列表分支吞掉
    [`/api/v1/ai/assistant/conversations?wid=${WID}&id=`]:
      overrides.convDetail ??
      (() =>
        res({
          messages: [
            { role: "assistant", content: "历史回答" },
            { role: "user", content: "历史提问" },
          ],
        })),
    [`/api/v1/ai/assistant/conversations?wid=${WID}`]:
      overrides.conversations ?? (() => res({ conversations: CONVERSATIONS })),
    "/api/v1/ai/assistant/suggestions?phase=":
      overrides.suggestions ?? (() => res({ suggestions: SUGGESTIONS })),
    "/api/v1/ai/assistant/chat": overrides.chat ?? (() => res(chatData())),
  };
}

function renderPanel() {
  return render(<AssistantPanel wid={WID} />);
}

const input = () => screen.getByLabelText("assistant:placeholder") as HTMLInputElement;
const sendBtn = () => screen.getByLabelText("assistant:send") as HTMLButtonElement;
const historyBtn = () => screen.getByLabelText("assistant:history");
const newChatBtn = () => screen.getByLabelText("assistant:newChat");
const chatCalls = () =>
  mocks.fetch.mock.calls.filter((c) => String(c[0]) === "/api/v1/ai/assistant/chat");

async function typeAndSend(text: string) {
  fireEvent.change(input(), { target: { value: text } });
  fireEvent.click(sendBtn());
}

/** 等建议卡片加载完成（挂载期两个 GET 均已返回） */
async function suggestionsReady() {
  await waitFor(() => expect(screen.getByText("assistant:suggestionA")).toBeInTheDocument());
}

beforeEach(() => {
  mocks.fetch.mockReset();
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal("fetch", mocks.fetch);
  installFetch(baseRoutes());
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("AssistantPanel", () => {
  it("挂载即拉历史对话列表与阶段建议卡片（URL 精确），空对话显示欢迎文案", async () => {
    renderPanel();
    await suggestionsReady();

    const urls = mocks.fetch.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain(`/api/v1/ai/assistant/conversations?wid=${WID}`);
    expect(urls).toContain("/api/v1/ai/assistant/suggestions?phase=in_progress");
    expect(screen.getAllByText("assistant:welcome")).toHaveLength(2); // 顶栏 + 空态
    expect(screen.getByText("assistant:welcomeDesc")).toBeInTheDocument();
  });

  it("发送消息：POST body 精确断言，渲染用户消息 / assistant 回复 / capability 标签", async () => {
    renderPanel();
    await suggestionsReady();
    await typeAndSend("  帮我查风险  ");
    await waitFor(() => expect(screen.getByText("已为你创建任务")).toBeInTheDocument());

    expect(screen.getByText("帮我查风险")).toBeInTheDocument();
    expect(screen.getByText("assistant:capability: semantic-search")).toBeInTheDocument();
    expect(chatCalls()).toHaveLength(1);
    expect(chatCalls()[0]?.[1]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wid: WID,
        message: "帮我查风险",
        phase: "in_progress",
        conversationId: undefined,
      }),
    });
  });

  it("首次发送回填 conversationId 与 nextPhase：二次发送带 conversationId，且按新 phase 重拉建议", async () => {
    let round = 0;
    installFetch(
      baseRoutes({
        chat: () => {
          round += 1;
          return round === 1
            ? res(chatData())
            : res(
                chatData({
                  content: "第二条回复",
                  suggestions: [],
                  recommendedNext: undefined,
                  nextPhase: "mail",
                }),
              );
        },
      }),
    );
    renderPanel();
    await suggestionsReady();
    await typeAndSend("第一条");
    await waitFor(() => expect(screen.getByText("已为你创建任务")).toBeInTheDocument());
    await typeAndSend("第二条");
    await waitFor(() => expect(screen.getByText("第二条回复")).toBeInTheDocument());

    expect(chatCalls()).toHaveLength(2);
    expect((chatCalls()[1]?.[1] as { body: string }).body).toBe(
      JSON.stringify({
        wid: WID,
        message: "第二条",
        phase: "semantic_search",
        conversationId: "conv-new-1",
      }),
    );
    const suggestionUrls = mocks.fetch.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.startsWith("/api/v1/ai/assistant/suggestions?"));
    expect(suggestionUrls).toContain("/api/v1/ai/assistant/suggestions?phase=semantic_search");
  });

  it("回复里的 suggestions 按钮与 recommendedNext 按钮点击后填入输入框", async () => {
    renderPanel();
    await suggestionsReady();
    await typeAndSend("你好");
    await waitFor(() => expect(screen.getByText("已为你创建任务")).toBeInTheDocument());

    fireEvent.click(screen.getByText("再查一下排期"));
    expect(input().value).toBe("再查一下排期");
    fireEvent.click(screen.getByText("可以顺手生成日报").closest("button")!);
    expect(input().value).toBe("可以顺手生成日报");
    expect(screen.getByText("assistant:nextStep:")).toBeInTheDocument();
  });

  it("发送过程中显示 thinking，输入框与发送按钮禁用；完成后恢复", async () => {
    let resolveChat!: (r: FetchLike) => void;
    installFetch(
      baseRoutes({
        chat: () =>
          new Promise<FetchLike>((resolve) => {
            resolveChat = resolve;
          }),
      }),
    );
    renderPanel();
    await suggestionsReady();
    await typeAndSend("你好");

    expect(screen.getByText("assistant:thinking")).toBeInTheDocument();
    expect(input()).toBeDisabled();
    expect(sendBtn()).toBeDisabled();

    await act(async () => {
      resolveChat(res(chatData()));
    });
    await waitFor(() => expect(screen.getByText("已为你创建任务")).toBeInTheDocument());
    expect(screen.queryByText("assistant:thinking")).toBeFalsy();
    expect(input()).not.toBeDisabled();
  });

  it("响应状态 429 → rateLimited 文案", async () => {
    installFetch(
      baseRoutes({ chat: () => ({ ok: false, status: 429, json: async () => ({ data: null }) }) }),
    );
    renderPanel();
    await suggestionsReady();
    await typeAndSend("你好");
    await waitFor(() => expect(screen.getByText("assistant:rateLimited")).toBeInTheDocument());
  });

  it("响应 json 无 data → error 文案", async () => {
    installFetch(baseRoutes({ chat: () => res(null) }));
    renderPanel();
    await suggestionsReady();
    await typeAndSend("你好");
    await waitFor(() => expect(screen.getByText("assistant:error")).toBeInTheDocument());
  });

  it("请求网络异常 → error 文案", async () => {
    installFetch(
      baseRoutes({
        chat: () => {
          throw new Error("network boom");
        },
      }),
    );
    renderPanel();
    await suggestionsReady();
    await typeAndSend("你好");
    await waitFor(() => expect(screen.getByText("assistant:error")).toBeInTheDocument());
  });

  it("历史下拉：条目渲染消息数与相对时间；空列表显示 historyEmpty", async () => {
    renderPanel();
    await suggestionsReady();
    fireEvent.click(historyBtn());
    expect(screen.getByText('assistant:msgCount:{"count":3}')).toBeInTheDocument();
    expect(screen.getByText("time:justNow")).toBeInTheDocument();

    cleanup();
    installFetch(baseRoutes({ conversations: () => res({ conversations: [] }) }));
    renderPanel();
    await suggestionsReady();
    fireEvent.click(historyBtn());
    expect(screen.getByText("assistant:historyEmpty")).toBeInTheDocument();
  });

  it("切换历史对话：GET ?wid=&id= 加载消息并逐条生成新 id；当前对话条目带 aria-current", async () => {
    renderPanel();
    await suggestionsReady();
    fireEvent.click(historyBtn());
    fireEvent.click(screen.getByText('assistant:msgCount:{"count":3}').closest("button")!);

    await waitFor(() => expect(screen.getByText("历史回答")).toBeInTheDocument());
    expect(screen.getByText("历史提问")).toBeInTheDocument();
    const urls = mocks.fetch.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain(`/api/v1/ai/assistant/conversations?wid=${WID}&id=conv-1`);

    fireEvent.click(historyBtn());
    const item = screen.getByText('assistant:msgCount:{"count":3}').closest("button")!;
    expect(item.getAttribute("aria-current")).toBe("true");
  });

  it("新对话按钮：清空消息与输入回到空态，建议卡片重新出现", async () => {
    renderPanel();
    await suggestionsReady();
    await typeAndSend("你好");
    await waitFor(() => expect(screen.getByText("已为你创建任务")).toBeInTheDocument());
    expect(screen.queryByText("assistant:suggestionA")).toBeFalsy(); // 有消息后卡片隐藏

    fireEvent.click(newChatBtn());
    expect(screen.queryByText("已为你创建任务")).toBeFalsy();
    expect(screen.getAllByText("assistant:welcome")).toHaveLength(2);
    expect(screen.getByText("assistant:suggestionA")).toBeInTheDocument();
    expect(input().value).toBe("");
  });

  it("建议卡片：labelKey 优先于 label 渲染，点击填入 description", async () => {
    renderPanel();
    await suggestionsReady();

    expect(screen.getByText("旧格式建议")).toBeInTheDocument();
    fireEvent.click(screen.getByText("assistant:suggestionA"));
    expect(input().value).toBe("帮我总结本周进展");
  });

  it("输入为空时发送按钮禁用，Enter 空输入不发送；有内容时 Enter 触发发送", async () => {
    renderPanel();
    await suggestionsReady();

    expect(sendBtn()).toBeDisabled();
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(chatCalls()).toHaveLength(0);

    fireEvent.change(input(), { target: { value: "Enter 发送" } });
    expect(sendBtn()).not.toBeDisabled();
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(chatCalls()).toHaveLength(1));
    expect((chatCalls()[0]?.[1] as { body: string }).body).toContain("Enter 发送");
  });
});
