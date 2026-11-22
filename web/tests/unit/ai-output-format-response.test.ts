// @vitest-environment node
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { aiOutputFormatResponse } from "@/lib/ai/shared";

/**
 * aiOutputFormatResponse 契约（lib/ai/shared.ts）：
 *  1. JSON.parse 的 SyntaxError → 502 + aiOutputFormatError 词条（明确可重试，非 500 误导）
 *  2. 非语法类错误（配额/网络/业务）→ null（继续走原 catch 的 500 / quotaGuard 分支）
 *  3. message 走 api-messages（zh/en 两侧齐备）
 */

function req(): NextRequest {
  return new NextRequest("http://localhost:3000/api/v1/ai/task-breakdown", { method: "POST" });
}

describe("aiOutputFormatResponse", () => {
  it("SyntaxError（JSON 解析失败）→ 502 + 可重试文案", () => {
    let syntaxErr: SyntaxError | null = null;
    try {
      JSON.parse("{not-json");
    } catch (e) {
      syntaxErr = e as SyntaxError;
    }
    expect(syntaxErr).toBeInstanceOf(SyntaxError);
    const res = aiOutputFormatResponse(req(), syntaxErr);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(502);
  });

  it("直接 new SyntaxError 同样命中", () => {
    const res = aiOutputFormatResponse(req(), new SyntaxError("Unexpected token"));
    expect(res?.status).toBe(502);
  });

  it("非 SyntaxError（配额/网络/业务错误）→ null 不劫持", () => {
    expect(aiOutputFormatResponse(req(), new Error("boom"))).toBeNull();
    expect(aiOutputFormatResponse(req(), new TypeError("x is not a function"))).toBeNull();
    expect(aiOutputFormatResponse(req(), null)).toBeNull();
    expect(aiOutputFormatResponse(req(), undefined)).toBeNull();
  });
});
