import { describe, it, expect } from "vitest";
import { buildCsp } from "@/lib/csp";

/**
 * CSP 构建单元测试（TC-CFG-02 修复回归，渗透报告 P2-5）
 *
 * 覆盖 lib/csp.ts 的 buildCsp(nonce, isProd)：
 *  - 生产：script-src/style-src 均为纯 nonce（无 unsafe-inline），含 style-src-attr
 *  - 开发：保留 unsafe-inline（HMR/dev 内联脚本兼容）
 *  - 其余指令两环境一致且不被破坏
 */

const NONCE = "dGVzdC1ub25jZQ==";

/** 从 CSP 字符串中提取指定指令的 source list */
function directiveOf(csp: string, name: string): string {
  const part = csp.split("; ").find((d) => d.startsWith(`${name} `));
  expect(part, `缺少指令 ${name}`).toBeDefined();
  return part!;
}

describe("buildCsp 生产环境（isProd=true）", () => {
  const csp = buildCsp(NONCE, true);

  it("script-src 不含 unsafe-inline 且含 nonce", () => {
    const d = directiveOf(csp, "script-src");
    expect(d).toBe(`script-src 'self' 'nonce-${NONCE}'`);
    expect(d).not.toContain("unsafe-inline");
    expect(d).toContain(`'nonce-${NONCE}'`);
  });

  it("style-src 不含 unsafe-inline 且含 nonce", () => {
    const d = directiveOf(csp, "style-src");
    expect(d).toBe(`style-src 'self' 'nonce-${NONCE}'`);
    expect(d).not.toContain("unsafe-inline");
    expect(d).toContain(`'nonce-${NONCE}'`);
  });

  it("新增 style-src-attr 'unsafe-inline' 单独放行内联样式属性", () => {
    const d = directiveOf(csp, "style-src-attr");
    expect(d).toBe("style-src-attr 'unsafe-inline'");
  });

  it("整条 CSP 中 script-src/style-src 指令范围内无 unsafe-inline", () => {
    // 防止未来重构把 unsafe-inline 塞回 script/style 主指令
    for (const name of ["script-src", "style-src"]) {
      expect(directiveOf(csp, name)).not.toContain("unsafe-inline");
    }
  });

  it("其余指令与收紧前保持一致", () => {
    expect(directiveOf(csp, "default-src")).toBe("default-src 'self'");
    expect(directiveOf(csp, "img-src")).toBe("img-src 'self' data: https:");
    expect(directiveOf(csp, "font-src")).toBe("font-src 'self' data:");
    expect(directiveOf(csp, "connect-src")).toBe("connect-src 'self'");
    expect(directiveOf(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directiveOf(csp, "base-uri")).toBe("base-uri 'self'");
    expect(directiveOf(csp, "form-action")).toBe("form-action 'self'");
  });
});

describe("buildCsp 开发环境（isProd=false）", () => {
  const csp = buildCsp(NONCE, false);

  it("script-src 保留 unsafe-inline（HMR/dev 内联脚本兼容）", () => {
    const d = directiveOf(csp, "script-src");
    expect(d).toBe(`script-src 'self' 'unsafe-inline' 'nonce-${NONCE}'`);
    expect(d).toContain("'unsafe-inline'");
  });

  it("style-src 保留 unsafe-inline", () => {
    const d = directiveOf(csp, "style-src");
    expect(d).toBe(`style-src 'self' 'unsafe-inline' 'nonce-${NONCE}'`);
    expect(d).toContain("'unsafe-inline'");
  });

  it("开发环境不需要 style-src-attr（style-src 已含 unsafe-inline）", () => {
    expect(csp).not.toContain("style-src-attr");
  });
});