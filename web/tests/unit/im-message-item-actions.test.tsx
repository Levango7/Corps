// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { Message } from "@/components/im/types";

/**
 * MessageItem 的"操作失败可见"契约（2026-10-27，ADR-013 整合）。
 *
 * 为什么需要这一条：整合前 IM 的失败路径是**完全静默**的 ——
 * `useIM.editMessage/revokeMessage` 会 setError 并 rethrow，但调用点
 * `IMClient` 用 `.catch(() => {})` 吞掉、`TaskChatPanel` 用 `void` 丢弃，
 * 而 `IMClient` 只在"未选中会话"时渲染 error，所以会话内编辑/撤回失败时
 * 用户看不到任何提示。这条机制是从被删除的旧聊天树 `MessageBubble` 迁过来的。
 *
 * 三条用例各自负责一个判定维度：
 *  1. 失败 → 出现 role="alert"，文案取 rejection 的 message，且编辑态不退出（内容不丢）；
 *  2. rejection 不是 Error 时 → 回落到 i18n 文案（不能显示 undefined）；
 *  3. 成功 → 不出现 alert（控制组：证明 alert 不是恒显，否则第 1 条是空断言）。
 */

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}:${key}`,
  useLocale: () => "zh",
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ locale: "zh", wid: "w1" }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { MessageItem } from "@/components/im/MessageItem";

const baseMessage: Message = {
  id: "m1",
  conversationId: "c1",
  authorId: "u1",
  author: { id: "u1", name: "测试用户", email: null, image: null },
  body: "原始内容",
  type: "text",
  createdAt: new Date().toISOString(),
  editedAt: null,
  revokedAt: null,
  revokedBy: null,
  replyToId: null,
  mentions: [],
  attachments: [],
  readByCount: 0,
};

function renderItem(onEdit: (mid: string, body: string) => void | Promise<void>) {
  return render(
    <MessageItem
      message={baseMessage}
      isOwn
      showAuthor={false}
      onEdit={onEdit}
      onRevoke={() => undefined}
    />,
  );
}

/** 进入编辑态并把内容改掉，点「保存」 */
function startEditAndSave(nextBody: string) {
  fireEvent.click(screen.getByLabelText("chat:edit"));
  fireEvent.change(screen.getByLabelText("chat:editMessage"), { target: { value: nextBody } });
  fireEvent.click(screen.getByText("chat:save"));
}

afterEach(() => cleanup());

describe("MessageItem：编辑失败必须告诉用户", () => {
  it("onEdit 拒绝 → 出现 role=alert 且文案取 rejection 的 message，编辑态保留", async () => {
    const onEdit = vi.fn().mockRejectedValue(new Error("没有权限修改这条消息"));
    renderItem(onEdit);

    startEditAndSave("改过的内容");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("没有权限修改这条消息");

    // 编辑态不能退出：用户刚输入的内容还在，才能直接重试
    expect(screen.getByLabelText("chat:editMessage")).toBeInTheDocument();
  });

  it("rejection 不是 Error 时回落到 i18n 文案（不能显示 undefined）", async () => {
    const onEdit = vi.fn().mockRejectedValue("plain-string-rejection");
    renderItem(onEdit);

    startEditAndSave("再改一次");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("chat:editMessageFailed");
  });

  it("控制组：编辑成功时不出现 alert", async () => {
    const onEdit = vi.fn().mockResolvedValue(undefined);
    renderItem(onEdit);

    startEditAndSave("成功的内容");

    await waitFor(() => expect(onEdit).toHaveBeenCalledWith("m1", "成功的内容"));
    // 成功路径应退出编辑态，且不留下任何提示
    await waitFor(() =>
      expect(screen.queryByLabelText("chat:editMessage")).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
