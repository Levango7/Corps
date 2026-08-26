// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

/**
 * Markdown 组件单元测试
 *
 * 覆盖 web/components/Markdown.tsx：
 *  - 正确渲染标题（h1-h4）
 *  - 正确渲染代码块（含语言标签）
 *  - 正确渲染链接（含安全过滤）
 *  - 正确渲染列表（有序 / 无序）
 *  - 正确处理 @提及（作为纯文本，不特殊渲染）
 *  - 行内格式：加粗 / 斜体 / 行内代码
 *  - 引用 / 分隔线 / 段落
 *
 * 组件零依赖、不使用 dangerouslySetInnerHTML，输出语义化标签。
 */

import Markdown from "@/components/Markdown";

describe("Markdown 组件 - 标题渲染（h1-h4）", () => {
  it("单个 # 渲染为 h1", () => {
    // Arrange & Act
    const { container } = render(<Markdown source="# 一级标题" />);

    // Assert
    const h1 = container.querySelector("h1");
    expect(h1).toBeInTheDocument();
    expect(h1).toHaveTextContent("一级标题");
  });

  it("双 # 渲染为 h2", () => {
    // Arrange & Act
    const { container } = render(<Markdown source="## 二级标题" />);

    // Assert
    const h2 = container.querySelector("h2");
    expect(h2).toBeInTheDocument();
    expect(h2).toHaveTextContent("二级标题");
  });

  it("三个 # 渲染为 h3", () => {
    // Arrange & Act
    const { container } = render(<Markdown source="### 三级标题" />);

    // Assert
    const h3 = container.querySelector("h3");
    expect(h3).toBeInTheDocument();
    expect(h3).toHaveTextContent("三级标题");
  });

  it("四个 # 渲染为 h4", () => {
    // Arrange & Act
    const { container } = render(<Markdown source="#### 四级标题" />);

    // Assert
    const h4 = container.querySelector("h4");
    expect(h4).toBeInTheDocument();
    expect(h4).toHaveTextContent("四级标题");
  });

  it("多行标题各自渲染为对应层级", () => {
    // Arrange
    const source = "# 标题一\n## 标题二\n### 标题三\n#### 标题四";

    // Act
    const { container } = render(<Markdown source={source} />);

    // Assert
    expect(container.querySelector("h1")).toHaveTextContent("标题一");
    expect(container.querySelector("h2")).toHaveTextContent("标题二");
    expect(container.querySelector("h3")).toHaveTextContent("标题三");
    expect(container.querySelector("h4")).toHaveTextContent("标题四");
  });

  it("标题内可包含行内格式（加粗）", () => {
    // Arrange & Act
    const { container } = render(<Markdown source="# 标题 **加粗** 部分" />);

    // Assert
    const h1 = container.querySelector("h1");
    expect(h1).toBeInTheDocument();
    expect(h1).toHaveTextContent("标题 加粗 部分");
    expect(h1?.querySelector("strong")).toBeInTheDocument();
  });
});

describe("Markdown 组件 - 代码块渲染", () => {
  it("无语言标注的代码块渲染为 <pre><code>", () => {
    // Arrange
    const source = "```\nconst x = 1;\n```";

    // Act
    const { container } = render(<Markdown source={source} />);

    // Assert
    const pre = container.querySelector("pre");
    expect(pre).toBeInTheDocument();
    const code = pre?.querySelector("code");
    expect(code).toBeInTheDocument();
    expect(code).toHaveTextContent("const x = 1;");
  });

  it("带语言标注的代码块显示语言标签", () => {
    // Arrange
    const source = "```typescript\nconst x: number = 1;\n```";

    // Act
    const { container } = render(<Markdown source={source} />);

    // Assert
    const pre = container.querySelector("pre");
    expect(pre).toBeInTheDocument();
    // 语言标签在 div 中
    const langDiv = pre?.querySelector("div");
    expect(langDiv).toHaveTextContent("typescript");
    expect(pre).toHaveTextContent("const x: number = 1;");
  });

  it("多行代码块保留换行", () => {
    // Arrange
    const source = "```\nline1\nline2\nline3\n```";

    // Act
    const { container } = render(<Markdown source={source} />);

    // Assert
    const code = container.querySelector("pre code");
    expect(code).toHaveTextContent("line1");
    expect(code).toHaveTextContent("line2");
    expect(code).toHaveTextContent("line3");
  });
});

describe("Markdown 组件 - 链接渲染", () => {
  it("标准链接渲染为 <a>，label 与 href 正确", () => {
    // Arrange
    const source = "[官网](https://example.com)";

    // Act
    const { container } = render(<Markdown source={source} />);

    // Assert
    const link = container.querySelector("a");
    expect(link).toBeInTheDocument();
    expect(link).toHaveTextContent("官网");
    expect(link).toHaveAttribute("href", "https://example.com");
  });

  it("外部 http(s) 链接添加 target=_blank 与 rel=noopener noreferrer", () => {
    // Arrange
    const source = "[外部](https://external.com)";

    // Act
    const { container } = render(<Markdown source={source} />);

    // Assert
    const link = container.querySelector("a");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("内部路径（/开头）不设置 target=_blank", () => {
    // Arrange
    const source = "[内部](/dashboard)";

    // Act
    const { container } = render(<Markdown source={source} />);

    // Assert
    const link = container.querySelector("a");
    expect(link).toHaveAttribute("href", "/dashboard");
    expect(link).not.toHaveAttribute("target", "_blank");
  });

  it("锚点链接（#开头）保留 href", () => {
    // Arrange
    const source = "[章节](#section-1)";

    // Act
    const { container } = render(<Markdown source={source} />);

    // Assert
    const link = container.querySelector("a");
    expect(link).toHaveAttribute("href", "#section-1");
  });

  it("非白名单协议（javascript:）的 href 被替换为 #（防注入）", () => {
    // Arrange
    const source = "[恶意](javascript:alert(1))";

    // Act
    const { container } = render(<Markdown source={source} />);

    // Assert
    const link = container.querySelector("a");
    expect(link).toHaveAttribute("href", "#");
  });
});

describe("Markdown 组件 - 列表渲染", () => {
  it("无序列表（- 前缀）渲染为 <ul> 含多个 <li>", () => {
    // Arrange
    const source = "- 项目一\n- 项目二\n- 项目三";

    // Act
    const { container } = render(<Markdown source={source} />);

    // Assert
    const ul = container.querySelector("ul");
    expect(ul).toBeInTheDocument();
    const items = ul?.querySelectorAll("li");
    expect(items).toHaveLength(3);
    expect(ul).toHaveTextContent("项目一");
    expect(ul).toHaveTextContent("项目二");
    expect(ul).toHaveTextContent("项目三");
  });

  it("无序列表（* 前缀）同样渲染为 <ul>", () => {
    // Arrange
    const source = "* 星号项一\n* 星号项二";

    // Act
    const { container } = render(<Markdown source={source} />);

    // Assert
    const ul = container.querySelector("ul");
    expect(ul).toBeInTheDocument();
    expect(ul).toHaveTextContent("星号项一");
    expect(ul).toHaveTextContent("星号项二");
  });

  it("无序列表（+ 前缀）同样渲染为 <ul>", () => {
    // Arrange
    const source = "+ 加号项一\n+ 加号项二";

    // Act
    const { container } = render(<Markdown source={source} />);

    // Assert
    const ul = container.querySelector("ul");
    expect(ul).toBeInTheDocument();
    expect(ul).toHaveTextContent("加号项一");
    expect(ul).toHaveTextContent("加号项二");
  });

  it("有序列表（数字. 前缀）渲染为 <ul> 含序号", () => {
    // Arrange
    const source = "1. 第一\n2. 第二\n3. 第三";

    // Act
    const { container } = render(<Markdown source={source} />);

    // Assert：组件统一用 <ul>，序号在 span 中
    const ul = container.querySelector("ul");
    expect(ul).toBeInTheDocument();
    const items = ul?.querySelectorAll("li");
    expect(items).toHaveLength(3);
    expect(ul).toHaveTextContent("第一");
    expect(ul).toHaveTextContent("第二");
    expect(ul).toHaveTextContent("第三");
    // 序号标记
    expect(ul).toHaveTextContent("1.");
    expect(ul).toHaveTextContent("2.");
    expect(ul).toHaveTextContent("3.");
  });

  it("列表项内可包含行内格式", () => {
    // Arrange
    const source = "- **加粗** 列表项\n- `代码` 列表项";

    // Act
    const { container } = render(<Markdown source={source} />);

    // Assert
    const ul = container.querySelector("ul");
    expect(ul?.querySelector("strong")).toBeInTheDocument();
    expect(ul?.querySelector("code")).toBeInTheDocument();
  });
});

describe("Markdown 组件 - @提及处理", () => {
  it("@提及作为纯文本渲染在段落中（无特殊转换）", () => {
    // Arrange
    const source = "通知 @张三 查看任务";

    // Act
    const { container } = render(<Markdown source={source} />);

    // Assert：@张三 原样出现在段落文本中
    const p = container.querySelector("p");
    expect(p).toBeInTheDocument();
    expect(p).toHaveTextContent("通知 @张三 查看任务");
  });

  it("多个 @提及均原样保留", () => {
    // Arrange
    const source = "@alice 和 @bob 讨论方案";

    // Act
    const { container } = render(<Markdown source={source} />);

    // Assert
    const p = container.querySelector("p");
    expect(p).toHaveTextContent("@alice 和 @bob 讨论方案");
  });

  it("@提及不渲染为链接（无 <a> 标签）", () => {
    // Arrange
    const source = "提到 @user";

    // Act
    const { container } = render(<Markdown source={source} />);

    // Assert
    expect(container.querySelector("a")).not.toBeInTheDocument();
  });

  it("@提及在列表项中同样原样保留", () => {
    // Arrange
    const source = "- 分配给 @alice\n- 评审 @bob";

    // Act
    const { container } = render(<Markdown source={source} />);

    // Assert
    const ul = container.querySelector("ul");
    expect(ul).toHaveTextContent("分配给 @alice");
    expect(ul).toHaveTextContent("评审 @bob");
  });
});

describe("Markdown 组件 - 行内格式", () => {
  it("行内代码渲染为 <code>", () => {
    // Arrange & Act
    const { container } = render(<Markdown source="使用 `console.log` 输出" />);

    // Assert
    const code = container.querySelector("p code");
    expect(code).toBeInTheDocument();
    expect(code).toHaveTextContent("console.log");
  });

  it("加粗渲染为 <strong>", () => {
    // Arrange & Act
    const { container } = render(<Markdown source="这是 **加粗** 文本" />);

    // Assert
    const strong = container.querySelector("p strong");
    expect(strong).toBeInTheDocument();
    expect(strong).toHaveTextContent("加粗");
  });

  it("斜体渲染为 <em>", () => {
    // Arrange & Act
    const { container } = render(<Markdown source="这是 *斜体* 文本" />);

    // Assert
    const em = container.querySelector("p em");
    expect(em).toBeInTheDocument();
    expect(em).toHaveTextContent("斜体");
  });

  it("混合行内格式正确渲染", () => {
    // Arrange
    const source = "**加粗** 和 *斜体* 和 `代码`";

    // Act
    const { container } = render(<Markdown source={source} />);

    // Assert
    expect(container.querySelector("strong")).toHaveTextContent("加粗");
    expect(container.querySelector("em")).toHaveTextContent("斜体");
    expect(container.querySelector("code")).toHaveTextContent("代码");
  });
});

describe("Markdown 组件 - 引用与分隔线", () => {
  it("引用（> 前缀）渲染为 <blockquote>", () => {
    // Arrange & Act
    const { container } = render(<Markdown source="> 这是引用内容" />);

    // Assert
    const quote = container.querySelector("blockquote");
    expect(quote).toBeInTheDocument();
    expect(quote).toHaveTextContent("这是引用内容");
  });

  it("多行引用合并为单个 <blockquote>", () => {
    // Arrange
    const source = "> 第一行\n> 第二行";

    // Act
    const { container } = render(<Markdown source={source} />);

    // Assert
    const quotes = container.querySelectorAll("blockquote");
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toHaveTextContent("第一行");
    expect(quotes[0]).toHaveTextContent("第二行");
  });

  it("分隔线（---）渲染为 <hr>", () => {
    // Arrange & Act：JSX 属性字符串不处理 \n 转义，需用 {} 包裹 JS 字符串
    const { container } = render(<Markdown source={"上\n\n---\n\n下"} />);

    // Assert
    const hr = container.querySelector("hr");
    expect(hr).toBeInTheDocument();
  });

  it("分隔线（***）同样渲染为 <hr>", () => {
    // Arrange & Act
    const { container } = render(<Markdown source={"上\n\n***\n\n下"} />);

    // Assert
    const hr = container.querySelector("hr");
    expect(hr).toBeInTheDocument();
  });
});

describe("Markdown 组件 - 段落与边界", () => {
  it("普通文本渲染为 <p>", () => {
    // Arrange & Act
    const { container } = render(<Markdown source="这是一段普通文本" />);

    // Assert
    const p = container.querySelector("p");
    expect(p).toBeInTheDocument();
    expect(p).toHaveTextContent("这是一段普通文本");
  });

  it("空字符串不渲染任何内容", () => {
    // Arrange & Act
    const { container } = render(<Markdown source="" />);

    // Assert
    expect(container).toBeEmptyDOMElement();
  });

  it("连续非空行合并为单个段落", () => {
    // Arrange
    const source = "第一行\n第二行\n第三行";

    // Act
    const { container } = render(<Markdown source={source} />);

    // Assert
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]).toHaveTextContent("第一行 第二行 第三行");
  });

  it("空行分隔的两个段落", () => {
    // Arrange
    const source = "第一段\n\n第二段";

    // Act
    const { container } = render(<Markdown source={source} />);

    // Assert
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).toHaveTextContent("第一段");
    expect(paragraphs[1]).toHaveTextContent("第二段");
  });

  it("CRLF 换行被正确处理（\r\n → \n）", () => {
    // Arrange
    const source = "# 标题\r\n\r\n段落内容";

    // Act
    const { container } = render(<Markdown source={source} />);

    // Assert
    expect(container.querySelector("h1")).toHaveTextContent("标题");
    expect(container.querySelector("p")).toHaveTextContent("段落内容");
  });
});
