// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { WikiViewer } from "@/components/wiki/WikiViewer";

afterEach(() => {
  cleanup();
});

describe("WikiViewer 空内容", () => {
  it("空字符串渲染占位符 — 且无 article", () => {
    const { container } = render(<WikiViewer content="" />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(container.querySelector("article")).toBeNull();
  });

  it("仅空白字符也走占位符分支", () => {
    render(<WikiViewer content={"   \n\t "} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("有内容时不渲染占位符", () => {
    const { container } = render(<WikiViewer content="hello" />);
    expect(screen.queryByText("—")).toBeNull();
    expect(container.querySelector("article")).toBeInTheDocument();
  });
});

describe("WikiViewer 标题", () => {
  it("# / ## / ### 分别渲染为 h1 / h2 / h3", () => {
    const { container } = render(<WikiViewer content={"# 一级\n## 二级\n### 三级"} />);
    const h1 = container.querySelector("h1");
    const h2 = container.querySelector("h2");
    const h3 = container.querySelector("h3");
    expect(h1).toHaveTextContent("一级");
    expect(h2).toHaveTextContent("二级");
    expect(h3).toHaveTextContent("三级");
  });

  it("标题内可含行内语法", () => {
    const { container } = render(<WikiViewer content="# 标题 `code` 加粗" />);
    const h1 = container.querySelector("h1");
    expect(h1).not.toBeNull();
    expect(h1?.querySelector("code")).toHaveTextContent("code");
  });

  it("四个 # 不识别为标题，按段落渲染", () => {
    const { container } = render(<WikiViewer content="#### 四级" />);
    expect(container.querySelector("h1")).toBeNull();
    expect(container.querySelector("p")).toHaveTextContent("#### 四级");
  });

  it("标题与正文之间以段落分隔渲染", () => {
    const { container } = render(<WikiViewer content={"# 标题\n正文段"} />);
    expect(container.querySelector("h1")).toHaveTextContent("标题");
    expect(container.querySelector("p")).toHaveTextContent("正文段");
  });
});

describe("WikiViewer 段落", () => {
  it("连续多行合并为单段落并以 br 分隔", () => {
    const { container } = render(<WikiViewer content={"第一行\n第二行"} />);
    const p = container.querySelector("p");
    expect(p).toHaveTextContent("第一行第二行");
    expect(p?.querySelectorAll("br")).toHaveLength(1);
  });

  it("空行分隔出两个段落", () => {
    const { container } = render(<WikiViewer content={"段一\n\n段二"} />);
    const paras = container.querySelectorAll("p");
    expect(paras).toHaveLength(2);
    expect(paras[0]).toHaveTextContent("段一");
    expect(paras[1]).toHaveTextContent("段二");
  });
});

describe("WikiViewer 列表", () => {
  it("- 渲染无序列表", () => {
    const { container } = render(<WikiViewer content={"- 苹果\n- 香蕉"} />);
    const ul = container.querySelector("ul");
    expect(ul?.querySelectorAll("li")).toHaveLength(2);
    expect(ul).toHaveTextContent("苹果");
    expect(ul).toHaveTextContent("香蕉");
  });

  it("* 与 + 同样识别为无序列表（连续行合并为一个列表）", () => {
    const { container } = render(<WikiViewer content={"* 星号项\n+ 加号项"} />);
    const ul = container.querySelector("ul");
    expect(ul?.querySelectorAll("li")).toHaveLength(2);
    expect(ul).toHaveTextContent("星号项");
    expect(ul).toHaveTextContent("加号项");
  });

  it("数字列表渲染为 ol", () => {
    const { container } = render(<WikiViewer content={"1. 首先\n2. 其次"} />);
    const ol = container.querySelector("ol");
    expect(ol?.querySelectorAll("li")).toHaveLength(2);
    expect(ol).toHaveTextContent("首先");
    expect(ol).toHaveTextContent("其次");
  });

  it("列表与后续段落分离", () => {
    const { container } = render(<WikiViewer content={"- 项一\n\n正文"} />);
    expect(container.querySelector("ul")).toHaveTextContent("项一");
    expect(container.querySelector("p")).toHaveTextContent("正文");
  });
});

describe("WikiViewer 代码块", () => {
  it("``` 围栏代码块渲染为 pre>code，保留内部文本", () => {
    const { container } = render(<WikiViewer content={"```js\nconst a = 1;\n```"} />);
    const code = container.querySelector("pre code");
    expect(code).toHaveTextContent("const a = 1;");
    expect(code).toHaveClass("whitespace-pre");
  });

  it("未闭合的代码块把剩余行全部当作代码", () => {
    const { container } = render(<WikiViewer content={"```\n第一行\n第二行"} />);
    const code = container.querySelector("pre code");
    // 直接比对原始 textContent，避免 toHaveTextContent 的空白归一化
    expect(code?.textContent).toBe("第一行\n第二行");
  });

  it("代码块内不解析行内标记", () => {
    const { container } = render(<WikiViewer content={"```\n**不是粗体**\n```"} />);
    expect(container.querySelector("pre")).toHaveTextContent("**不是粗体**");
    expect(container.querySelector("pre strong")).toBeNull();
  });
});

describe("WikiViewer 引用与分隔线", () => {
  it("> 前缀渲染为 blockquote 并去除标记", () => {
    const { container } = render(<WikiViewer content={"> 引用一\n> 引用二"} />);
    const quote = container.querySelector("blockquote");
    expect(quote).toHaveTextContent("引用一");
    expect(quote).toHaveTextContent("引用二");
    expect(quote?.querySelectorAll("p")).toHaveLength(2);
    expect(quote?.textContent).not.toContain(">");
  });

  it("--- 渲染为 hr", () => {
    const { container } = render(<WikiViewer content={"上文\n\n---\n\n下文"} />);
    expect(container.querySelector("hr")).toBeInTheDocument();
    expect(container).toHaveTextContent("上文");
    expect(container).toHaveTextContent("下文");
  });
});

describe("WikiViewer 行内语法", () => {
  it("反引号渲染为行内 code", () => {
    const { container } = render(<WikiViewer content="使用 `api` 调用" />);
    expect(container.querySelector("p code")).toHaveTextContent("api");
  });

  it("** 渲染为 strong", () => {
    const { container } = render(<WikiViewer content="这是 **粗体** 文本" />);
    expect(container.querySelector("p strong")).toHaveTextContent("粗体");
  });

  it("单 * 渲染为 em", () => {
    const { container } = render(<WikiViewer content="这是 *斜体* 文本" />);
    expect(container.querySelector("p em")).toHaveTextContent("斜体");
  });

  it("同一行混合多种行内标记", () => {
    const { container } = render(<WikiViewer content="a `b` **c** [d](/e) *f*" />);
    const p = container.querySelector("p");
    expect(p?.querySelector("code")).toHaveTextContent("b");
    expect(p?.querySelector("strong")).toHaveTextContent("c");
    expect(p?.querySelector("a")).toHaveAttribute("href", "/e");
    expect(p?.querySelector("em")).toHaveTextContent("f");
  });
});

describe("WikiViewer 链接白名单", () => {
  it("https 绝对链接带 target=_blank 与 rel", () => {
    const { container } = render(<WikiViewer content="[官网](https://example.com)" />);
    const a = container.querySelector("a");
    expect(a).toHaveAttribute("href", "https://example.com");
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", "noopener noreferrer");
    expect(a).toHaveTextContent("官网");
  });

  it("站内路径链接不新开窗口", () => {
    const { container } = render(<WikiViewer content="[内链](/w/ws-1/wiki/p-1)" />);
    const a = container.querySelector("a");
    expect(a).toHaveAttribute("href", "/w/ws-1/wiki/p-1");
    expect(a).not.toHaveAttribute("target");
    expect(a).not.toHaveAttribute("rel");
  });

  it("锚点链接放行", () => {
    const { container } = render(<WikiViewer content="[锚](#section)" />);
    expect(container.querySelector("a")).toHaveAttribute("href", "#section");
  });

  it("根路径单斜杠放行", () => {
    const { container } = render(<WikiViewer content="[首页](/)" />);
    expect(container.querySelector("a")).toHaveAttribute("href", "/");
  });

  it("javascript: 非白名单协议只渲染文本不渲染锚点", () => {
    const { container } = render(<WikiViewer content={"[恶意](javascript:alert(1))"} />);
    expect(container.querySelector("a")).toBeNull();
    // 标签作为普通文本留在段落中
    expect(container.querySelector("p")).toHaveTextContent("恶意");
  });
});

describe("WikiViewer 整体文档", () => {
  it("完整文档各块按顺序渲染", () => {
    const md = [
      "# 标题",
      "",
      "- 列表项",
      "",
      "```",
      "code-block",
      "```",
      "",
      "> 引用",
      "",
      "结尾段",
    ].join("\n");
    const { container } = render(<WikiViewer content={md} />);
    expect(container.querySelector("h1")).toHaveTextContent("标题");
    expect(container.querySelector("ul li")).toHaveTextContent("列表项");
    expect(container.querySelector("pre code")).toHaveTextContent("code-block");
    expect(container.querySelector("blockquote")).toHaveTextContent("引用");
    expect(container.querySelectorAll("p").length).toBeGreaterThan(0);
  });
});
