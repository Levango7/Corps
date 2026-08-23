import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import jwt from "jsonwebtoken";

/**
 * JWT 工具单元测试
 *
 * 覆盖 web/lib/jwt.ts 的 signAccessToken / verifyAccessToken：
 *  - 签发 token 后能正确验证
 *  - 过期 token 验证失败
 *  - 无效 token 验证失败
 *  - payload 正确包含 sub / wid / role
 *
 * 注意：jwt.ts 通过 requireSecret 读取 JWT_ACCESS_SECRET 环境变量，
 * 缺失时直接抛错（不回退弱密钥）。测试在 beforeAll 中注入临时密钥，
 * afterAll 中恢复原值，避免污染其他测试。
 */

// 被测模块在首次 import 时即读取 ISSUER 常量，需在 import 前设置环境变量。
// Vitest 中模块按需加载，故先设环境变量再动态 import 被测模块。
const TEST_SECRET = "test-jwt-access-secret-unit-only-DO-NOT-USE-IN-PROD";
const ORIGINAL_SECRET = process.env.JWT_ACCESS_SECRET;
const ORIGINAL_APP_URL = process.env.NEXT_PUBLIC_APP_URL;

process.env.JWT_ACCESS_SECRET = TEST_SECRET;
// 固定 ISSUER 以便构造过期 token 时对齐 issuer 声明
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

// 动态导入被测模块，确保上述环境变量在模块初始化时已就位
const { signAccessToken, verifyAccessToken } = await import("@/lib/jwt");

const ISSUER = "http://localhost:3000";

describe("JWT 工具 - signAccessToken / verifyAccessToken", () => {
  beforeAll(() => {
    // 双保险：确保测试期间密钥就位
    process.env.JWT_ACCESS_SECRET = TEST_SECRET;
  });

  afterAll(() => {
    // 恢复原始环境变量，避免泄漏到其他测试文件
    if (ORIGINAL_SECRET === undefined) {
      delete process.env.JWT_ACCESS_SECRET;
    } else {
      process.env.JWT_ACCESS_SECRET = ORIGINAL_SECRET;
    }
    if (ORIGINAL_APP_URL === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL;
    } else {
      process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_APP_URL;
    }
  });

  describe("签发与验证的往返一致性", () => {
    it("签发 token 后能正确验证并返回原始 payload", async () => {
      // Arrange
      const payload = { sub: "user-123", wid: "ws-456", role: "owner" };

      // Act
      const token = await signAccessToken(payload);
      const verified = await verifyAccessToken(token);

      // Assert
      expect(verified).not.toBeNull();
      expect(verified!.sub).toBe("user-123");
      expect(verified!.wid).toBe("ws-456");
      expect(verified!.role).toBe("owner");
    });

    it("签发的 token 是三段式 JWT 字符串", async () => {
      // Arrange
      const payload = { sub: "u1", wid: "w1", role: "member" };

      // Act
      const token = await signAccessToken(payload);

      // Assert：JWT 由 header.payload.signature 三段组成，以 . 分隔
      expect(typeof token).toBe("string");
      expect(token.split(".")).toHaveLength(3);
    });
  });

  describe("payload 字段完整性", () => {
    it("验证结果包含 sub / wid / role 三个业务字段", async () => {
      // Arrange
      const payload = { sub: "sub-001", wid: "wid-002", role: "admin" };

      // Act
      const token = await signAccessToken(payload);
      const verified = await verifyAccessToken(token);

      // Assert
      expect(verified).not.toBeNull();
      expect(verified).toHaveProperty("sub", "sub-001");
      expect(verified).toHaveProperty("wid", "wid-002");
      expect(verified).toHaveProperty("role", "admin");
    });

    it("验证结果包含 iat 与 exp 标准声明", async () => {
      // Arrange
      const payload = { sub: "u2", wid: "w2", role: "member" };

      // Act
      const token = await signAccessToken(payload);
      const verified = await verifyAccessToken(token);

      // Assert
      expect(verified).not.toBeNull();
      expect(typeof verified!.iat).toBe("number");
      expect(typeof verified!.exp).toBe("number");
      // exp 应在 iat 之后（15 分钟有效期）
      expect(verified!.exp).toBeGreaterThan(verified!.iat);
    });

    it("不同 role 值（owner/admin/member/viewer）均能正确签发与验证", async () => {
      // Arrange
      const roles = ["owner", "admin", "member", "viewer"];

      for (const role of roles) {
        // Act
        const token = await signAccessToken({ sub: "u", wid: "w", role });
        const verified = await verifyAccessToken(token);

        // Assert
        expect(verified).not.toBeNull();
        expect(verified!.role).toBe(role);
      }
    });
  });

  describe("过期 token 验证失败", () => {
    it("已过期的 token 验证返回 null", async () => {
      // Arrange：手动构造一个 exp 已过去的 token（10 秒前过期）
      const expiredToken = jwt.sign(
        {
          sub: "u-expired",
          wid: "w1",
          role: "owner",
          exp: Math.floor(Date.now() / 1000) - 10,
        },
        TEST_SECRET,
        { issuer: ISSUER },
      );

      // Act
      const verified = await verifyAccessToken(expiredToken);

      // Assert
      expect(verified).toBeNull();
    });

    it("即将过期的 token 在当前时间点仍可验证（边界条件）", async () => {
      // Arrange：exp 设为当前时间 + 5 秒，仍有余量
      const nearExpiryToken = jwt.sign(
        {
          sub: "u-near",
          wid: "w1",
          role: "owner",
          exp: Math.floor(Date.now() / 1000) + 5,
        },
        TEST_SECRET,
        { issuer: ISSUER },
      );

      // Act
      const verified = await verifyAccessToken(nearExpiryToken);

      // Assert
      expect(verified).not.toBeNull();
      expect(verified!.sub).toBe("u-near");
    });
  });

  describe("无效 token 验证失败", () => {
    it("随机字符串验证返回 null", async () => {
      // Arrange
      const invalidToken = "not-a-valid-jwt-token";

      // Act
      const verified = await verifyAccessToken(invalidToken);

      // Assert
      expect(verified).toBeNull();
    });

    it("用错误密钥签发的 token 验证返回 null", async () => {
      // Arrange：用另一个密钥签发，验证时用 TEST_SECRET，签名不匹配
      const wrongKeyToken = jwt.sign(
        { sub: "u1", wid: "w1", role: "owner" },
        "a-completely-different-secret-key",
        { issuer: ISSUER, expiresIn: "15m" },
      );

      // Act
      const verified = await verifyAccessToken(wrongKeyToken);

      // Assert
      expect(verified).toBeNull();
    });

    it("篡改 payload 后的 token 验证返回 null", async () => {
      // Arrange：先签发合法 token，再篡改 payload 段
      const token = await signAccessToken({ sub: "u1", wid: "w1", role: "member" });
      const parts = token.split(".");
      // 解码 payload，修改 role 后重新编码（不更新签名 → 签名失效）
      const payloadJson = JSON.parse(
        Buffer.from(parts[1], "base64url").toString("utf-8"),
      ) as Record<string, unknown>;
      payloadJson.role = "owner"; // 篡改：member → owner
      parts[1] = Buffer.from(JSON.stringify(payloadJson), "utf-8").toString("base64url");
      const tamperedToken = parts.join(".");

      // Act
      const verified = await verifyAccessToken(tamperedToken);

      // Assert
      expect(verified).toBeNull();
    });

    it("空字符串 token 验证返回 null", async () => {
      // Arrange
      const emptyToken = "";

      // Act
      const verified = await verifyAccessToken(emptyToken);

      // Assert
      expect(verified).toBeNull();
    });

    it("issuer 不匹配的 token 验证返回 null", async () => {
      // Arrange：用不同 issuer 签发
      const wrongIssuerToken = jwt.sign(
        { sub: "u1", wid: "w1", role: "owner" },
        TEST_SECRET,
        { issuer: "https://wrong-issuer.example.com", expiresIn: "15m" },
      );

      // Act
      const verified = await verifyAccessToken(wrongIssuerToken);

      // Assert
      expect(verified).toBeNull();
    });
  });

  describe("密钥缺失时的安全行为", () => {
    it("JWT_ACCESS_SECRET 缺失时 signAccessToken 抛错（不回退弱密钥）", async () => {
      // Arrange：临时删除密钥
      const saved = process.env.JWT_ACCESS_SECRET;
      delete process.env.JWT_ACCESS_SECRET;

      // Act & Assert
      await expect(signAccessToken({ sub: "u", wid: "w", role: "owner" })).rejects.toThrow(
        /Missing required env var: JWT_ACCESS_SECRET/,
      );

      // Cleanup
      process.env.JWT_ACCESS_SECRET = saved;
    });

    it("JWT_ACCESS_SECRET 缺失时 verifyAccessToken 抛错（不静默返回 null）", async () => {
      // Arrange：临时删除密钥
      const saved = process.env.JWT_ACCESS_SECRET;
      delete process.env.JWT_ACCESS_SECRET;

      // Act & Assert：requireSecret 在 jwt.verify 之前调用，缺失即抛错
      await expect(verifyAccessToken("any-token")).rejects.toThrow(
        /Missing required env var: JWT_ACCESS_SECRET/,
      );

      // Cleanup
      process.env.JWT_ACCESS_SECRET = saved;
    });
  });
});

// 抑制 vi 未使用的 lint 警告（保留 import 以便未来扩展 mock 用例）
void vi;