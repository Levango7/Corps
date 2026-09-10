/**
 * Prisma 统一错误处理（DL-14，P3：错误处理不统一）。
 *
 * 背景：API 路由中 Prisma 错误处理散落各处（grep PrismaClientKnownRequestError
 * 命中 9 处），每处自行 `if (error.code === "P2025") return 404`，导致：
 *  - 错误码映射不一致（有的 P2025→404，有的 P2025→500）
 *  - 文案不统一（有的用 apiMsg，有的裸中文）
 *  - 新增错误码需逐处修改
 *
 * 本模块提供统一入口 `handlePrismaError(error, req?)`，按 Prisma 错误码
 * 映射到标准 HTTP 状态码与 i18n 文案，返回 NextResponse。
 *
 * 支持的 Prisma 错误码：
 *  - P1001：Can't reach database server → 503 Service Unavailable
 *  - P1002：Database kind wrong → 503
 *  - P1003：Database does not exist → 503
 *  - P2002：Unique constraint failed → 409 Conflict
 *  - P2003：Foreign key constraint failed → 409 Conflict
 *  - P2025：Record not found → 404 Not Found
 *  - P2026：The provided value for the column is too long → 400
 *  - P2027：Unique constraint evaluation failure → 409
 *  - 其他 PrismaClientKnownRequestError → 500
 *  - PrismaClientValidationError（参数校验）→ 400
 *  - PrismaClientUnknownRequestError → 500
 *  - PrismaClientInitializationError → 503
 *
 * 用法：
 * ```ts
 * try {
 *   await prisma.task.delete({ where: { id } });
 * } catch (error) {
 *   return handlePrismaError(error, req);
 * }
 * ```
 *
 * 不传 req 时回退英文文案（适用于非路由上下文，如 cron / 脚本）。
 *
 * 注意：本工具是新增代码，不强制重构现有路由——现有路由的 P2025 处理
 * 可继续保留，新路由 / 重构时优先使用本工具。后续 P2 周期可统一收口。
 */
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { apiMsg, API_MESSAGES } from "@/lib/api-messages";

/** Prisma 错误分类结果（不含 i18n 文案，便于测试断言） */
export interface PrismaErrorClass {
  /** HTTP 状态码 */
  status: number;
  /** 错误码（Prisma code 或 "UNKNOWN"） */
  code: string;
  /** api-messages 键 */
  msgKey: keyof typeof API_MESSAGES;
}

/**
 * 将 Prisma 错误分类为标准 HTTP 状态码 + 消息键。
 * 纯函数，无 IO，便于单元测试。
 */
export function classifyPrismaError(error: unknown): PrismaErrorClass {
  // 已知请求错误（最常见，按错误码细分）
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      // 连接级错误 → 503
      case "P1001": // Can't reach database server
      case "P1002": // Database kind wrong
      case "P1003": // Database does not exist
      case "P1008": // Operations timed out
        return { status: 503, code: error.code, msgKey: "prismaConnectionFailed" };

      // 唯一约束冲突 → 409
      case "P2002": // Unique constraint failed
      case "P2027": // Unique constraint evaluation failure
        return { status: 409, code: error.code, msgKey: "prismaUniqueConstraint" };

      // 外键约束冲突 → 409（关联数据不存在）
      case "P2003":
        return { status: 409, code: error.code, msgKey: "prismaForeignKeyViolation" };

      // 记录不存在 → 404
      case "P2025": // Record not found
      case "P2018": // The required connected records were not found
      case "P2024": // Operations timed out（事务超时，归 503 更准但 P2024 文档归 transaction）
        // P2024 实际是事务超时，归 503
        if (error.code === "P2024") {
          return { status: 503, code: error.code, msgKey: "prismaConnectionFailed" };
        }
        return { status: 404, code: error.code, msgKey: "prismaRecordNotFound" };

      // 数据校验类 → 400
      case "P2026": // The provided value for the column is too long
        return { status: 400, code: error.code, msgKey: "prismaConstraintFailed" };

      // 其他已知请求错误 → 500（保守归 500，避免误判）
      default:
        return { status: 500, code: error.code, msgKey: "internalError" };
    }
  }

  // 参数校验错误（Prisma 查询参数非法）→ 400
  if (error instanceof Prisma.PrismaClientValidationError) {
    return { status: 400, code: "VALIDATION_ERROR", msgKey: "prismaConstraintFailed" };
  }

  // 初始化错误（连接配置错误等）→ 503
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return { status: 503, code: "INIT_ERROR", msgKey: "prismaConnectionFailed" };
  }

  // 未知请求错误 → 500
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return { status: 500, code: "UNKNOWN_REQUEST", msgKey: "internalError" };
  }

  // 非 Prisma 错误 → 500
  return { status: 500, code: "UNKNOWN", msgKey: "internalError" };
}

/**
 * 统一 Prisma 错误处理：分类 + i18n 文案 + NextResponse。
 *
 * @param error - catch 块捕获的错误
 * @param req - NextRequest（用于 i18n 语言协商）；不传则回退英文
 * @returns NextResponse（已设置正确状态码与 JSON body）
 *
 * 响应 body 格式与现有路由一致：`{ code: number, message: string }`
 * 额外包含 `prismaCode?: string` 便于客户端按 Prisma 错误码做精细处理。
 */
export function handlePrismaError(
  error: unknown,
  req?: NextRequest,
): NextResponse {
  const { status, code, msgKey } = classifyPrismaError(error);
  const message = req
    ? apiMsg(req, msgKey)
    : API_MESSAGES[msgKey].en; // 非路由上下文回退英文
  return NextResponse.json({ code: status, message, prismaCode: code, data: null }, { status });
}