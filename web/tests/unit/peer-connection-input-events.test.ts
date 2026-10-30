// @vitest-environment jsdom
import { describe, it, expect } from "vitest";

import {
  keyPress,
  mapMouseButton,
  mouseClick,
  mouseMove,
  mouseScroll,
  type InputEvent,
} from "@/lib/webrtc/peer-connection";

/** 判别联合窄化助手（返回类型是 InputEvent，直接取分支字段会被 tsc 拒） */
const asClick = (e: InputEvent) => e as Extract<InputEvent, { type: "mouse-click" }>;
const asKey = (e: InputEvent) => e as Extract<InputEvent, { type: "key-press" }>;

/**
 * 远程控制输入事件构造函数契约（lib/webrtc/peer-connection.ts 的纯函数面）：
 *  这些函数的产物经 DataChannel 原样发给被控端，形状即协议——
 *  判别联合 type 字段、"down/up/double" 动作取值、坐标与 deltaY、修饰键透传
 *  （缺省 undefined 而非 {}）、以及浏览器 MouseEvent.button → MouseButton 的映射
 *  （未知值保守回 "left"）。
 */
describe("mouseMove", () => {
  it("形状：{ type: 'mouse-move', x, y }", () => {
    expect(mouseMove(120, 340)).toEqual({ type: "mouse-move", x: 120, y: 340 });
  });
});

describe("mouseClick", () => {
  it("默认 action=down；显式 up/double 透传", () => {
    expect(mouseClick(1, 2, "left")).toEqual({
      type: "mouse-click",
      x: 1,
      y: 2,
      button: "left",
      action: "down",
    });
    expect(asClick(mouseClick(1, 2, "right", "up")).action).toBe("up");
    expect(asClick(mouseClick(1, 2, "middle", "double")).action).toBe("double");
  });
});

describe("mouseScroll", () => {
  it("形状：{ type: 'mouse-scroll', x, y, deltaY }（负值向上）", () => {
    expect(mouseScroll(10, 20, -120)).toEqual({
      type: "mouse-scroll",
      x: 10,
      y: 20,
      deltaY: -120,
    });
  });
});

describe("keyPress", () => {
  it("默认 action=down；modifiers 透传；不传时字段为 undefined（不是 {}）", () => {
    expect(keyPress("Enter")).toEqual({
      type: "key-press",
      key: "Enter",
      action: "down",
      modifiers: undefined,
    });
    const withMods = asKey(
      keyPress("c", "down", { ctrl: true, shift: true, alt: false, meta: true }),
    );
    expect(withMods.modifiers).toEqual({ ctrl: true, shift: true, alt: false, meta: true });
    expect(asKey(keyPress("Escape", "up")).action).toBe("up");
  });
});

describe("mapMouseButton：浏览器 button 数字 → 协议字符串", () => {
  it("0→left / 1→middle / 2→right；未知值保守回 left", () => {
    expect(mapMouseButton(0)).toBe("left");
    expect(mapMouseButton(1)).toBe("middle");
    expect(mapMouseButton(2)).toBe("right");
    expect(mapMouseButton(3)).toBe("left"); // back 键等未知值 → 保守 left
    expect(mapMouseButton(-1)).toBe("left");
    expect(mapMouseButton(99)).toBe("left");
  });
});
