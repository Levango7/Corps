// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { useState } from "react";

import {
  Button,
  IconButton,
  Input,
  Textarea,
  Select,
  Dialog,
  Sheet,
  Tabs,
  TabPanel,
  Toolbar,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
  TableMessage,
  ToastProvider,
  useToast,
  EmptyState,
  cn,
} from "@/components/ui";

/**
 * 11 个 UI 原语的**无障碍契约**测试（设计方案 §7.2 第 1 步配套）。
 *
 * 为什么要单测这些而不是快照：这些断言描述的是「读屏/键盘用户能不能用」，
 * 每一条都能对应一个真实失效方式（label 没关联、错误没播报、Esc 关不掉、
 * 焦点没跟着选项走）。快照只能告诉你"渲染结果变了"，不能告诉你"变得对不对"。
 *
 * 覆盖边界（诚实说明）：
 *  - 这里**不测样式是否生效**（jsdom 不算 Tailwind）。`bg-surface` 这类语义类到底
 *    有没有生成，由 `scripts/check_theme_tokens.py`（别名指向真 token）与
 *    e2e 的 computed style 断言（B1b）两层覆盖。
 *  - 不测动画与布局（jsdom 没有布局引擎）。
 */

afterEach(() => cleanup());

describe("Button", () => {
  it("默认渲染 type=button，避免在表单里误触发 submit", () => {
    render(<Button>保存</Button>);
    const btn = screen.getByRole("button", { name: "保存" });
    expect(btn).toHaveAttribute("type", "button");
  });

  it("默认 md 尺寸命中 44px 触摸目标（DESIGN.md §a11y 硬要求）", () => {
    render(<Button>保存</Button>);
    expect(screen.getByRole("button", { name: "保存" }).className).toContain("h-11");
  });

  it("loading 时 aria-busy 且不可点（防重复提交）", () => {
    render(<Button loading>保存</Button>);
    const btn = screen.getByRole("button", { name: "保存" });
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn).toBeDisabled();
  });

  it("IconButton 把 label 渲染成 aria-label（图标本身不是文本）", () => {
    render(<IconButton label="关闭面板">x</IconButton>);
    expect(screen.getByRole("button", { name: "关闭面板" })).toBeInTheDocument();
  });

  it("类型层强制：IconButton 缺 label 必须编译失败", () => {
    // 这条断言没有运行时效果，靠 tsc 执行：@ts-expect-error 若"没报错"会反过来失败
    function typeContract() {
      // @ts-expect-error label 是必填的（漏了读屏用户就没有可访问名称）
      return <IconButton>x</IconButton>;
    }
    void typeContract;
    expect(true).toBe(true);
  });
});

describe("Input / Textarea / Select", () => {
  it("Input 的 label 与控件关联（getByLabelText 能命中即证明 for/id 接对）", () => {
    render(<Input label="邮箱" />);
    expect(screen.getByLabelText("邮箱")).toBeInTheDocument();
  });

  it("Input 有错误时 aria-invalid + aria-describedby 指向错误文案", () => {
    render(<Input label="邮箱" error="邮箱格式不对" />);
    const input = screen.getByLabelText("邮箱");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const descId = input.getAttribute("aria-describedby");
    expect(descId).toBeTruthy();
    expect(document.getElementById(descId!)).toHaveTextContent("邮箱格式不对");
    // 错误要能被读屏主动播报
    expect(screen.getByRole("alert")).toHaveTextContent("邮箱格式不对");
  });

  it("required 同时落到 aria-required（不只是视觉星号）", () => {
    render(<Input label="邮箱" required />);
    expect(screen.getByLabelText("邮箱", { exact: false })).toHaveAttribute(
      "aria-required",
      "true",
    );
  });

  it("Textarea 与 Input 的 a11y 契约一致", () => {
    render(<Textarea label="描述" error="太长了" />);
    const area = screen.getByLabelText("描述");
    expect(area.tagName).toBe("TEXTAREA");
    expect(area).toHaveAttribute("aria-invalid", "true");
  });

  it("Select 渲染 options 且保留 native select 语义", () => {
    render(
      <Select
        label="优先级"
        options={[
          { value: "high", label: "高" },
          { value: "low", label: "低" },
        ]}
        defaultValue="high"
      />,
    );
    const sel = screen.getByLabelText("优先级");
    expect(sel.tagName).toBe("SELECT");
    expect(sel).toHaveValue("high");
    expect(screen.getByRole("option", { name: "低" })).toBeInTheDocument();
  });
});

describe("Dialog / Sheet", () => {
  it("打开时给足模态语义：role/aria-modal/labelledby 指向标题", () => {
    render(
      <Dialog open onClose={() => {}} title="删除任务" closeLabel="关闭">
        <p>确认删除？</p>
      </Dialog>,
    );
    const dlg = screen.getByRole("dialog");
    expect(dlg).toHaveAttribute("aria-modal", "true");
    const labelId = dlg.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId!)).toHaveTextContent("删除任务");
  });

  it("挂在 body 下（portal）：否则会被祖先 transform 劫持成「只盖住父容器」", () => {
    render(
      <div style={{ transform: "translateZ(0)" }}>
        <Dialog open onClose={() => {}} title="t" closeLabel="关闭">
          x
        </Dialog>
      </div>,
    );
    const dlg = screen.getByRole("dialog");
    expect(dlg.closest("body")).toBe(document.body);
    // 面板不能落在那个带 transform 的祖先里
    expect(dlg.parentElement?.parentElement).not.toHaveAttribute("style");
  });

  it("Esc 关闭走 onClose（FocusTrap 只管 Tab，Esc 是原语补的）", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="t" closeLabel="关闭">
        x
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("遮罩关闭是一个真正的按钮（有可访问名称），不是给 div 挂 onClick", () => {
    render(
      <Dialog open onClose={() => {}} title="t" closeLabel="关闭">
        x
      </Dialog>,
    );
    // 关闭按钮 + 遮罩按钮，共两个"关闭"入口
    expect(screen.getAllByRole("button", { name: "关闭" }).length).toBeGreaterThanOrEqual(2);
  });

  it("Sheet 复用同一套模态实现，面板满高", () => {
    render(
      <Sheet open onClose={() => {}} title="筛选" closeLabel="关闭" side="right">
        x
      </Sheet>,
    );
    const dlg = screen.getByRole("dialog");
    expect(dlg).toHaveAttribute("aria-modal", "true");
    expect(dlg.className).toContain("h-full");
  });
});

function TabsHarness() {
  const [v, setV] = useState("a");
  return (
    <>
      <Tabs
        label="视图切换"
        baseId="t"
        value={v}
        onChange={setV}
        items={[
          { id: "a", label: "列表" },
          { id: "b", label: "看板" },
          { id: "c", label: "禁用", disabled: true },
        ]}
      />
      <TabPanel baseId="t" itemId={v}>
        面板 {v}
      </TabPanel>
    </>
  );
}

describe("Tabs", () => {
  it("角色齐备且只有选中项 tabIndex=0（roving tabindex）", () => {
    render(<TabsHarness />);
    expect(screen.getByRole("tablist", { name: "视图切换" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "列表" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "列表" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "看板" })).toHaveAttribute("tabindex", "-1");
  });

  it("→ 跳到下一项并让焦点跟随（ARIA 要求），跳过禁用项", () => {
    render(<TabsHarness />);
    const first = screen.getByRole("tab", { name: "列表" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    const second = screen.getByRole("tab", { name: "看板" });
    expect(second).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(second);
    // 再往右应跳过禁用的第三项，回到第一项
    fireEvent.keyDown(second, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "列表" })).toHaveAttribute("aria-selected", "true");
  });

  it("面板用 aria-labelledby 指回对应 tab", () => {
    render(<TabsHarness />);
    const panel = screen.getByRole("tabpanel");
    const tab = screen.getByRole("tab", { name: "列表" });
    expect(panel).toHaveAttribute("aria-labelledby", tab.id);
    expect(panel).toHaveTextContent("面板 a");
  });

  it("禁用项点击不改变选中", () => {
    render(<TabsHarness />);
    fireEvent.click(screen.getByRole("tab", { name: "禁用" }));
    expect(screen.getByRole("tab", { name: "列表" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("Toolbar / Table / 收编项", () => {
  it("Toolbar 有 role 与可访问名称", () => {
    render(
      <Toolbar label="批量操作">
        <Button>删除</Button>
      </Toolbar>,
    );
    expect(screen.getByRole("toolbar", { name: "批量操作" })).toBeInTheDocument();
  });

  it("Table 的 th 默认带 scope=col（读屏据此关联列头）", () => {
    render(
      <Table>
        <THead>
          <TR>
            <TH>名称</TH>
          </TR>
        </THead>
        <TBody>
          <TR>
            <TD>任务一</TD>
          </TR>
        </TBody>
      </Table>,
    );
    const th = screen.getByRole("columnheader", { name: "名称" });
    expect(th).toHaveAttribute("scope", "col");
    expect(screen.getByRole("cell", { name: "任务一" })).toBeInTheDocument();
  });

  it("TableMessage 用 colSpan 铺满，避免空表格听起来像「没有内容」", () => {
    render(
      <Table>
        <TBody>
          <TableMessage colSpan={3}>暂无数据</TableMessage>
        </TBody>
      </Table>,
    );
    const cell = screen.getByRole("cell", { name: "暂无数据" });
    expect(cell).toHaveAttribute("colspan", "3");
  });

  it("Toast / EmptyState 是收编的同一份实现（导出可用即证明没另造一套）", () => {
    expect(typeof ToastProvider).toBe("function");
    expect(typeof useToast).toBe("function");
    expect(typeof EmptyState).toBe("function");
  });

  it("cn 只拼接真值（布局类的组合器）", () => {
    expect(cn("a", false, undefined, "b", null)).toBe("a b");
  });
});

describe("原语在 act 之外不产生副作用警告", () => {
  it("Dialog 关闭状态不渲染任何东西", () => {
    const { container } = render(
      <Dialog open={false} onClose={() => {}} title="t" closeLabel="关闭">
        x
      </Dialog>,
    );
    act(() => {});
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
