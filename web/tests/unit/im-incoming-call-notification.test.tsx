// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import {
  IncomingCallNotification,
  type IncomingCallData,
} from "@/components/im/IncomingCallNotification";

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

const callData: IncomingCallData = {
  messageId: "m1",
  callerId: "u9",
  callerName: "Zed",
  callerImage: null,
  callType: "voice",
  meetingUrl: "/zh/w/ws-1/meetings/mt-1",
  meetingId: "mt-1",
};

afterEach(() => {
  cleanup();
});

describe("IncomingCallNotification", () => {
  it("renders nothing when there is no call data", () => {
    const { container } = render(
      <IncomingCallNotification callData={null} onAccept={vi.fn()} onReject={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows a voice call with phone icons and the voice label", () => {
    const { container } = render(
      <IncomingCallNotification callData={callData} onAccept={vi.fn()} onReject={vi.fn()} />,
    );
    expect(screen.getByText("Zed")).toBeTruthy();
    expect(screen.getByText("im:incomingVoiceCall")).toBeTruthy();
    // header icon + accept button icon
    expect(container.querySelectorAll("svg.lucide-phone").length).toBe(2);
    expect(container.querySelector("svg.lucide-video")).toBeNull();
    expect(container.querySelector("svg.lucide-phone-off")).not.toBeNull();
  });

  it("shows a video call with video icons and the video label", () => {
    const { container } = render(
      <IncomingCallNotification
        callData={{ ...callData, callType: "video" }}
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText("im:incomingVideoCall")).toBeTruthy();
    expect(container.querySelectorAll("svg.lucide-video").length).toBe(2);
    expect(container.querySelector("svg.lucide-phone")).toBeNull();
  });

  it("uses the caller image when present, otherwise the caller initial", () => {
    const { rerender } = render(
      <IncomingCallNotification callData={callData} onAccept={vi.fn()} onReject={vi.fn()} />,
    );
    expect(screen.getByText("Z")).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();

    rerender(
      <IncomingCallNotification
        callData={{ ...callData, callerImage: "http://x/z.png" }}
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    const img = document.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("http://x/z.png");
    expect(img!.getAttribute("alt")).toBe("Zed");
    expect(screen.queryByText("Z")).toBeNull();
  });

  it("invokes onAccept with the call data", () => {
    const onAccept = vi.fn();
    render(<IncomingCallNotification callData={callData} onAccept={onAccept} onReject={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "im:acceptCall" }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith(callData);
  });

  it("invokes onReject with the call data", () => {
    const onReject = vi.fn();
    render(<IncomingCallNotification callData={callData} onAccept={vi.fn()} onReject={onReject} />);
    fireEvent.click(screen.getByRole("button", { name: "im:rejectCall" }));
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledWith(callData);
  });
});
