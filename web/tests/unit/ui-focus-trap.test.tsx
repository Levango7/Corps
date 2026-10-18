// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { FocusTrap } from "@/components/ui/FocusTrap";

/**
 * FocusTrap 单元测试。
 *
 * 为什么值得单测（而不是只靠 E2E）：本机跑不了 Playwright（swc 原生绑定缺失），
 * 而「焦点有没有进弹窗、Tab 有没有在弹窗内循环」是纯交互逻辑，jsdom 能完整覆盖。
 * 这是把 E2E 才能验的东西下沉到单测的一层。
 *
 * 注意：jsdom 里 offsetParent 恒为 null，所以实现里不能用它做可见性过滤
 * （改用 hidden 属性 + computed visibility）——这也是本测试能跑起来的前提。
 */

afterEach(cleanup);

/** 三个可聚焦按钮的固定结构。 */
function Trap({ label }: { label: string }) {
  return (
    <FocusTrap>
      <div>
        <button type="button">first-{label}</button>
        <button type="button">mid-{label}</button>
        <button type="button">last-{label}</button>
      </div>
    </FocusTrap>
  );
}

function activeText(): string {
  return (document.activeElement as HTMLElement | null)?.textContent ?? "";
}

describe("FocusTrap", () => {
  it("挂载后把焦点移入容器（第一个可聚焦元素）", () => {
    render(<Trap label="a" />);
    expect(activeText()).toBe("first-a");
  });

  it("容器内没有可聚焦元素时不抢焦点（不落到 body）", () => {
    const outside = document.createElement("button");
    outside.textContent = "outside";
    document.body.appendChild(outside);
    outside.focus();
    expect(activeText()).toBe("outside");

    render(
      <FocusTrap>
        <span>nothing focusable</span>
      </FocusTrap>,
    );
    expect(activeText()).toBe("outside");
    outside.remove();
  });

  it("data-autofocus 优先于第一个可聚焦元素", () => {
    render(
      <FocusTrap>
        <button type="button">should-not-get-it</button>
        <input aria-label="target" data-autofocus />
        <button type="button">also-not</button>
      </FocusTrap>,
    );
    expect(document.activeElement?.getAttribute("data-autofocus")).not.toBeNull();
  });

  it("Tab 在最后一个元素上循环回第一个", () => {
    render(<Trap label="b" />);
    const last = document.querySelectorAll("button")[2] as HTMLElement;
    last.focus();
    expect(activeText()).toBe("last-b");

    fireEvent.keyDown(document, { key: "Tab" });
    expect(activeText()).toBe("first-b");
  });

  it("Shift+Tab 在第一个元素上循环回最后一个", () => {
    render(<Trap label="c" />);
    const first = document.querySelectorAll("button")[0] as HTMLElement;
    first.focus();
    expect(activeText()).toBe("first-c");

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(activeText()).toBe("last-c");
  });

  it("焦点在容器外时按 Tab 会被拉回容器内第一个", () => {
    render(<Trap label="d" />);
    const outside = document.createElement("button");
    outside.textContent = "outside-d";
    document.body.appendChild(outside);
    outside.focus();
    expect(activeText()).toBe("outside-d");

    fireEvent.keyDown(document, { key: "Tab" });
    expect(activeText()).toBe("first-d");
    outside.remove();
  });

  it("卸载时把焦点还给打开弹窗前持有它的元素", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "trigger";
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(<Trap label="e" />);
    expect(activeText()).toBe("first-e"); // 打开后焦点在弹窗内

    unmount();
    expect(activeText()).toBe("trigger"); // 关闭后还给触发按钮
    trigger.remove();
  });

  it("focus() 抛异常时不阻塞（只读输入框等场景）", () => {
    // 某些浏览器对 disabled/hidden 元素 focus() 会抛；组件不应因此整个崩掉
    const originalFocus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function () {
      throw new Error("cannot focus");
    };
    try {
      expect(() => render(<Trap label="f" />)).not.toThrow();
    } finally {
      HTMLElement.prototype.focus = originalFocus;
    }
  });

  it("卸载后不再监听 keydown（不泄漏）", () => {
    const { unmount } = render(<Trap label="g" />);
    unmount();
    const outside = document.createElement("button");
    outside.textContent = "outside-g";
    document.body.appendChild(outside);
    outside.focus();

    fireEvent.keyDown(document, { key: "Tab" });
    expect(activeText()).toBe("outside-g"); // 卸载了就不该再拉焦点
    outside.remove();
  });

  /**
   * 受控场景：条件渲染下「打开 → 关闭」后焦点还原给触发按钮。
   *
   * 两个刻意的写法，都是为了避免在跟测试环境较劲而不是验产品行为：
   *   1. 用 fireEvent 而不是原生 .click()：act 环境里原生 click 的 state 更新
   *      不会同步 flush，紧接着 getByText("close") 会找不到元素 —— 那是调度
   *      时机的产物，不是组件的问题。
   *   2. 打开前手动 focus 触发按钮：jsdom 不实现「mousedown 先聚焦再 click」
   *      的浏览器默认行为，这一步把真实浏览器的前置状态显式补上，
   *      让还原目标确定。
   *
   * 「打开后焦点进弹窗」已由其他用例覆盖，这里只验还原方向 —— 那才是用户
   * 可感知的回归点（关掉弹窗后焦点掉回 body，键盘用户就丢失了位置）。
   */
  it("受控场景：条件渲染关弹窗后焦点还原给触发按钮", () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            open
          </button>
          {open && (
            <FocusTrap>
              <button type="button" onClick={() => setOpen(false)}>
                close
              </button>
            </FocusTrap>
          )}
        </>
      );
    }
    const { getByText } = render(<Host />);

    const openBtn = getByText("open");
    openBtn.focus(); // 真实浏览器里 mousedown 先聚焦，再触发 click
    fireEvent.click(openBtn);

    fireEvent.click(getByText("close"));
    // 关闭后焦点回到触发按钮（trap 卸载时还原）
    expect(activeText()).toBe("open");
  });
});
