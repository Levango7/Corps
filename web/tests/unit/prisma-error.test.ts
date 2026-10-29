// @vitest-environment node
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { classifyPrismaError, handlePrismaError } from "@/lib/prisma-error";
import { API_MESSAGES } from "@/lib/api-messages";

/**
 * Prisma 错误分类（lib/prisma-error.ts）的契约。
 *
 * 这是所有 API route 的统一错误出口：把 Prisma 异常映射成
 * {status, code, msgKey} 三元组，再由 handlePrismaError 组装响应体。
 * 契约重点是：任何输入（包括非 Prisma 错误）都要有归属，
 * 不能让未知异常 500 之外还泄露英文堆栈给前端。
 */

describe("classifyPrismaError —— 连接类错误 → 503", () => {
  it("P1001/P1002/P1003/P1008/P2024 → 503 prismaConnectionFailed", () => {
    for (const code of ["P1001", "P1002", "P1003", "P1008", "P2024"]) {
      const err = new Prisma.PrismaClientKnownRequestError(`db error ${code}`, {
        code,
        clientVersion: "6.0.0",
      });
      const cls = classifyPrismaError(err);
      expect(cls.status).toBe(503);
      expect(cls.msgKey).toBe("prismaConnectionFailed");
    }
  });
});

describe("classifyPrismaError —— 约束冲突", () => {
  it("P2002/P2027 唯一约束 → 409 prismaUniqueConstraint", () => {
    for (const code of ["P2002", "P2027"]) {
      const err = new Prisma.PrismaClientKnownRequestError("unique", {
        code,
        clientVersion: "6.0.0",
      });
      const cls = classifyPrismaError(err);
      expect(cls.status).toBe(409);
      expect(cls.msgKey).toBe("prismaUniqueConstraint");
    }
  });

  it("P2003 外键约束 → 409 prismaForeignKeyViolation", () => {
    const err = new Prisma.PrismaClientKnownRequestError("fk", {
      code: "P2003",
      clientVersion: "6.0.0",
    });
    const cls = classifyPrismaError(err);
    expect(cls.status).toBe(409);
    expect(cls.msgKey).toBe("prismaForeignKeyViolation");
  });

  it("P2025/P2018 记录不存在 → 404 prismaRecordNotFound", () => {
    for (const code of ["P2025", "P2018"]) {
      const err = new Prisma.PrismaClientKnownRequestError("nf", {
        code,
        clientVersion: "6.0.0",
      });
      const cls = classifyPrismaError(err);
      expect(cls.status).toBe(404);
      expect(cls.msgKey).toBe("prismaRecordNotFound");
    }
  });

  it("P2026 约束失败 → 400 prismaConstraintFailed", () => {
    const err = new Prisma.PrismaClientKnownRequestError("c", {
      code: "P2026",
      clientVersion: "6.0.0",
    });
    const cls = classifyPrismaError(err);
    expect(cls.status).toBe(400);
    expect(cls.msgKey).toBe("prismaConstraintFailed");
  });
});

describe("classifyPrismaError —— 其他已知码 → 500", () => {
  it("未列举的 P 码 → 500 internalError", () => {
    const err = new Prisma.PrismaClientKnownRequestError("other", {
      code: "P2009",
      clientVersion: "6.0.0",
    });
    const cls = classifyPrismaError(err);
    expect(cls.status).toBe(500);
    expect(cls.msgKey).toBe("internalError");
  });
});

describe("classifyPrismaError —— 未知 Prisma 错误类型", () => {
  it("PrismaClientValidationError → 400 prismaConstraintFailed", () => {
    const err = new Prisma.PrismaClientValidationError("validation", {
      clientVersion: "6.0.0",
    });
    const cls = classifyPrismaError(err);
    expect(cls.status).toBe(400);
    expect(cls.msgKey).toBe("prismaConstraintFailed");
  });

  it("PrismaClientInitializationError → 503（连接层失败）", () => {
    const err = new Prisma.PrismaClientInitializationError("init", "6.0.0");
    const cls = classifyPrismaError(err);
    expect(cls.status).toBe(503);
  });

  it("PrismaClientUnknownRequestError → 500", () => {
    const err = new Prisma.PrismaClientUnknownRequestError("unknown", {
      clientVersion: "6.0.0",
    });
    const cls = classifyPrismaError(err);
    expect(cls.status).toBe(500);
  });

  it("普通 Error（非 Prisma）→ 500 UNKNOWN", () => {
    const cls = classifyPrismaError(new Error("boom"));
    expect(cls.status).toBe(500);
    expect(cls.code).toBe("UNKNOWN");
  });

  it("null/undefined 输入不 throw（兜底为 500）", () => {
    expect(() => classifyPrismaError(null as never)).not.toThrow();
    expect(() => classifyPrismaError(undefined as never)).not.toThrow();
  });
});

describe("handlePrismaError —— 响应体组装", () => {
  it("无 req 时回退 API_MESSAGES 英文文案（API 契约 data:null）", async () => {
    const err = new Prisma.PrismaClientKnownRequestError("nf", {
      code: "P2025",
      clientVersion: "6.0.0",
    });
    const res = handlePrismaError(err);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({
      code: 404,
      prismaCode: "P2025",
      data: null,
    });
    expect(body.message).toBe(API_MESSAGES.prismaRecordNotFound.en);
  });

  it("有 req 时走 apiMsg 返回请求语言文案", async () => {
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://localhost/api/v1/x", {
      headers: { "accept-language": "zh-CN" },
    });
    const err = new Prisma.PrismaClientKnownRequestError("nf", {
      code: "P2025",
      clientVersion: "6.0.0",
    });
    const res = handlePrismaError(err, req);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe(404);
    expect(body.prismaCode).toBe("P2025");
    expect(typeof body.message).toBe("string");
    expect(body.message.length).toBeGreaterThan(0);
  });

  it("唯一约束冲突响应 status=409 且 prismaCode 透传", async () => {
    const err = new Prisma.PrismaClientKnownRequestError("dup", {
      code: "P2002",
      clientVersion: "6.0.0",
    });
    const res = handlePrismaError(err);
    expect(res.status).toBe(409);
    expect((await res.json()).prismaCode).toBe("P2002");
  });

  it("非 Prisma 错误也能产出 500 响应体（不泄露 message 原文）", async () => {
    const res = handlePrismaError(new Error("INTERNAL_SECRET_PATH"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.message).not.toContain("INTERNAL_SECRET_PATH");
    expect(body.prismaCode).toBe("UNKNOWN");
  });
});
