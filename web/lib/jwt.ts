import jwt from "jsonwebtoken";

const ISSUER = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

/**
 * 密钥缺失时直接抛错（不回退到默认值）：
 * 生产环境若未配置 JWT 密钥，宁可启动失败也不能用可知的弱密钥签署令牌。
 */
function requireSecret(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export interface JWTPayload {
  sub: string;
  wid: string;
  role: string;
  iat: number;
  exp: number;
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  iat: number;
  exp: number;
}

export async function signAccessToken(payload: Omit<JWTPayload, "iat" | "exp">): Promise<string> {
  return jwt.sign(payload, requireSecret("JWT_ACCESS_SECRET"), {
    issuer: ISSUER,
    expiresIn: "15m",
  });
}

export async function signRefreshToken(payload: Omit<RefreshTokenPayload, "iat" | "exp">): Promise<string> {
  return jwt.sign(payload, requireSecret("JWT_REFRESH_SECRET"), {
    expiresIn: "7d",
  });
}

export async function verifyAccessToken(token: string): Promise<JWTPayload | null> {
  try {
    return jwt.verify(token, requireSecret("JWT_ACCESS_SECRET"), { issuer: ISSUER }) as JWTPayload;
  } catch {
    return null;
  }
}

export async function verifyRefreshToken(token: string): Promise<RefreshTokenPayload | null> {
  try {
    return jwt.verify(token, requireSecret("JWT_REFRESH_SECRET")) as RefreshTokenPayload;
  } catch {
    return null;
  }
}
