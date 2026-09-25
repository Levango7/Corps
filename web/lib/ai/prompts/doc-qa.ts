// AI 文档问答 prompt 模板——基于检索到的项目文档（Wiki 页面）回答用户问题。
//
// RAG 简化版：调用方先检索相关 WikiPage，再将文档片段作为上下文注入 user prompt，
// 让 AI 基于文档内容回答并引用来源。回答末尾以"## 来源"段落列出引用的文档标题，
// 供前端解析展示来源文档列表。

import { appendFeedbackShot } from "./feedback-shot";
import type { FeedbackExample } from "@/lib/ai/feedback";

/**
 * 文档问答系统 prompt：定义 AI 角色、回答规则。
 *
 * 指示 AI 只基于提供的文档内容回答，不编造；
 * 如果文档中没有相关信息，明确告知用户；
 * 回答时引用来源文档，并在末尾以"## 来源"段落列出引用的文档标题。
 */
export function buildDocQaSystemPrompt(feedbackExamples?: FeedbackExample[]): string {
  return appendFeedbackShot(
    `你是项目文档问答助手，基于检索到的项目文档（Wiki 页面）回答用户问题。
回答规则：
1. 只基于提供的文档内容回答，不要编造不存在的信息
2. 如果文档中没有相关信息，明确告知用户"文档中未找到相关内容"，并建议用户补充文档或换个问题
3. 回答用 Markdown 格式，结构清晰
4. 引用来源文档时，在回答正文中使用加粗标题标注，如 **文档标题**
5. 回答末尾必须包含"## 来源"段落，列出引用的所有文档标题（每行一个 \`- 文档标题\`）
6. 如果未引用任何文档（如未检索到相关文档），不输出"## 来源"段落
7. 中文回答

## 推理步骤
回答前请依次分析：
1. 用户问题的核心意图是什么？（查询流程 / 了解规范 / 寻找方案）
2. 问题涉及哪些文档？从提供的文档片段中定位相关内容
3. 文档中是否有足够信息回答？若不足，明确指出缺失部分
4. 如何组织回答结构使其清晰易读？引用哪些来源文档？

## 输出格式
使用标准 Markdown 语法，标题使用 # / ## / ### 层级，不要使用 HTML 标签。引用文档时使用加粗标题。回答末尾用"## 来源"段落列出引用的文档标题（每行 \`- 文档标题\`）。如果文档中无相关内容，明确告知而非编造。不要输出 JSON 或用代码块包裹 Markdown。

## 示例
输入：部署流程是什么？
输出：
根据文档 **生产环境部署规范**，部署流程如下：
1. 部署前需通过预发环境验证
2. 通过 CI 构建镜像并推送至仓库
3. 在生产环境执行滚动更新

## 来源
- 生产环境部署规范`,
    feedbackExamples,
  );
}

/**
 * 文档问答用户 prompt：拼接用户问题与检索到的相关文档片段。
 *
 * @param question 用户问题（已由调用方校验长度）
 * @param documents 检索到的相关文档列表（title + content）
 */
export function buildDocQaUserPrompt(
  question: string,
  documents: { title: string; content: string }[],
): string {
  if (documents.length === 0) {
    return `## 用户问题
${question}

## 检索到的文档
未检索到相关文档。

请告知用户文档中未找到相关内容，并建议补充文档或换个问题。`;
  }

  // 每篇文档内容截取前 2000 字符，避免 prompt 膨胀超出模型上下文窗口
  const formattedDocs = documents
    .map(
      (doc, i) =>
        `### 文档 ${i + 1}：${doc.title}\n${doc.content.slice(0, 2000) + (doc.content.length > 2000 ? "\n\n[文档内容已截断]" : "")}`,
    )
    .join("\n\n");

  return `## 用户问题
${question}

## 检索到的相关文档
${formattedDocs}

请基于上述文档回答用户问题，并在回答中引用来源文档标题。`;
}
