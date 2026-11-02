// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { MessageSearch } from "@/components/im/MessageSearch";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock("@/lib/api", () => ({ api: apiMock }));

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
  return { useTranslations, useLocale: () => "zh" };
});

interface SearchResult {
  messageId: string;
  body: string;
  authorId: string | null;
  authorName: string | null;
  authorImage: string | null;
  conversationId: string | null;
  conversationTitle: string | null;
  createdAt: string;
  rank: number;
}

function mkResult(over: Partial<SearchResult> = {}): SearchResult {
  return {
    messageId: "m1",
    body: "hello world",
    authorId: "u-alice",
    authorName: "Alice",
    authorImage: null,
    conversationId: "conv-1",
    conversationTitle: "General",
    createdAt: "2026-06-15T09:00:00Z",
    rank: 0.5,
    ...over,
  };
}

const baseProps = {
  workspaceId: "ws-1",
  onJumpToMessage: vi.fn(),
};

function searchFor(query: string, conversationId?: string) {
  const props = { ...baseProps, ...(conversationId ? { conversationId } : {}) };
  const { container } = render(<MessageSearch {...props} />);
  fireEvent.change(screen.getByPlaceholderText("im.search:placeholder"), {
    target: { value: query },
  });
  return container;
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleString("zh", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

describe("MessageSearch", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = () => {};
  });

  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    baseProps.onJumpToMessage.mockClear();
  });

  it("renders the initial hint before any search", () => {
    render(<MessageSearch {...baseProps} />);
    expect(screen.getByText("im.search:hint")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("im.search:placeholder")).toBeInTheDocument();
    expect(screen.queryByText("im.search:searching")).toBeNull();
  });

  it("does not search before the debounce window elapses", async () => {
    vi.useFakeTimers();
    try {
      searchFor("hello");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(299);
      });
      expect(apiMock).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(apiMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("searches with workspaceId, query and limit after the debounce", async () => {
    vi.useFakeTimers();
    try {
      apiMock.mockResolvedValue([]);
      searchFor("hello");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(apiMock).toHaveBeenCalledWith("/api/v1/im/search?workspaceId=ws-1&q=hello&limit=20", {
        signal: expect.any(AbortSignal),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("appends cid when constrained to a conversation", async () => {
    vi.useFakeTimers();
    try {
      apiMock.mockResolvedValue([]);
      searchFor("hello", "conv-9");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(apiMock).toHaveBeenCalledWith(
        "/api/v1/im/search?workspaceId=ws-1&q=hello&limit=20&cid=conv-9",
        expect.anything(),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("only searches the latest keyword when typing quickly", async () => {
    vi.useFakeTimers();
    try {
      apiMock.mockResolvedValue([]);
      render(<MessageSearch {...baseProps} />);
      const input = screen.getByPlaceholderText("im.search:placeholder");
      fireEvent.change(input, { target: { value: "abc" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(150);
      });
      fireEvent.change(input, { target: { value: "xyz" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(apiMock).toHaveBeenCalledTimes(1);
      expect(apiMock).toHaveBeenCalledWith(
        "/api/v1/im/search?workspaceId=ws-1&q=xyz&limit=20",
        expect.anything(),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders results with author, conversation, time and highlighted body", async () => {
    vi.useFakeTimers();
    try {
      apiMock.mockResolvedValue([mkResult({ body: "Say Hello again" })]);
      searchFor("hello");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(screen.getByText("Alice")).toBeInTheDocument();
      expect(screen.getByText("General")).toBeInTheDocument();
      expect(screen.getByText(timeOf("2026-06-15T09:00:00Z"))).toBeInTheDocument();
      const mark = screen.getByText("Hello");
      expect(mark.tagName).toBe("MARK");
      expect(screen.getByText(/again/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("highlights every case-insensitive occurrence while keeping original case", async () => {
    vi.useFakeTimers();
    try {
      apiMock.mockResolvedValue([mkResult({ body: "Hello hello HELLO" })]);
      searchFor("hello");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      const marks = document.querySelectorAll("mark");
      expect(marks.length).toBe(3);
      expect(Array.from(marks).map((m) => m.textContent)).toEqual(["Hello", "hello", "HELLO"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("truncates long bodies to 120 characters plus an ellipsis", async () => {
    vi.useFakeTimers();
    try {
      apiMock.mockResolvedValue([mkResult({ body: "x".repeat(130) })]);
      searchFor("long");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      const para = document.querySelector("p.line-clamp-2");
      expect(para?.textContent).toBe(`${"x".repeat(120)}…`);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the loading state while searching", async () => {
    vi.useFakeTimers();
    try {
      apiMock.mockReturnValue(new Promise<SearchResult[]>(() => {}));
      searchFor("hello");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(screen.getByText("im.search:searching")).toBeInTheDocument();
      expect(document.querySelectorAll("svg.lucide-loader-2").length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the no-results state after an empty search", async () => {
    vi.useFakeTimers();
    try {
      apiMock.mockResolvedValue([]);
      searchFor("zzz");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(screen.getByText('im.search:noResults:{"keyword":"zzz"}')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the error message when the search fails", async () => {
    vi.useFakeTimers();
    try {
      apiMock.mockRejectedValue(new Error("boom"));
      searchFor("hello");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(screen.getByText("boom")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the generic error for non-Error failures", async () => {
    vi.useFakeTimers();
    try {
      apiMock.mockRejectedValue("not-an-error");
      searchFor("hello");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(screen.getByText("im.search:error")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays silent when the request is aborted", async () => {
    vi.useFakeTimers();
    try {
      const aborted = new Error("aborted");
      aborted.name = "AbortError";
      apiMock.mockRejectedValue(aborted);
      searchFor("hello");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      // AbortError 不算错误也不算已搜索，回到初始提示
      expect(screen.getByText("im.search:hint")).toBeInTheDocument();
      expect(screen.queryByText("im.search:error")).toBeNull();
      expect(screen.queryByText("boom")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("jumps to a message when a result is clicked", async () => {
    vi.useFakeTimers();
    try {
      apiMock.mockResolvedValue([mkResult({ conversationId: "conv-1", messageId: "m1" })]);
      const container = searchFor("hello");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      fireEvent.click(container.querySelector("ul li button")!);
      expect(baseProps.onJumpToMessage).toHaveBeenCalledWith("conv-1", "m1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not jump when the result has no conversation", async () => {
    vi.useFakeTimers();
    try {
      apiMock.mockResolvedValue([mkResult({ conversationId: null })]);
      const container = searchFor("hello");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      fireEvent.click(container.querySelector("ul li button")!);
      expect(baseProps.onJumpToMessage).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears results when the query is emptied or the clear button is used", async () => {
    vi.useFakeTimers();
    try {
      apiMock.mockResolvedValue([mkResult()]);
      searchFor("hello");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(screen.getByText("Alice")).toBeInTheDocument();
      const input = screen.getByPlaceholderText("im.search:placeholder");
      // 清空按钮
      fireEvent.click(screen.getByLabelText("im.search:clear"));
      expect(input).toHaveValue("");
      expect(screen.getByText("im.search:hint")).toBeInTheDocument();
      expect(screen.queryByText("Alice")).toBeNull();
      // 再次搜索后直接清空输入
      fireEvent.change(input, { target: { value: "hi" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(screen.getByText("Alice")).toBeInTheDocument();
      fireEvent.change(input, { target: { value: "" } });
      expect(screen.getByText("im.search:hint")).toBeInTheDocument();
      expect(screen.queryByText("Alice")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to unknown author and default conversation title", async () => {
    vi.useFakeTimers();
    try {
      apiMock.mockResolvedValue([
        mkResult({ authorName: null, authorId: null, conversationTitle: null }),
      ]);
      searchFor("hello");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(screen.getByText("im.search:unknownAuthor")).toBeInTheDocument();
      expect(screen.getByText("im.search:defaultConversation")).toBeInTheDocument();
      expect(screen.getByText("?")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows an avatar image when the author has one", async () => {
    vi.useFakeTimers();
    try {
      apiMock.mockResolvedValue([mkResult({ authorImage: "http://x/a.png" })]);
      searchFor("hello");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      const img = document.querySelector("img");
      expect(img).toHaveAttribute("src", "http://x/a.png");
      expect(img).toHaveAttribute("alt", "Alice");
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts the in-flight request on unmount", async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      apiMock.mockImplementation((_path: string, opts?: { signal?: AbortSignal }) => {
        signal = opts?.signal;
        return new Promise<SearchResult[]>(() => {});
      });
      searchFor("hello");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(signal).toBeDefined();
      expect(signal!.aborted).toBe(false);
      cleanup();
      expect(signal!.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
