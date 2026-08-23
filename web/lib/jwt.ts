import jwt, { type JwtPayload, type VerifyOptions } from "jsonwebtoken";

const ISSUER = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

/** access token 有效期：15 分钟（与 refresh token 的 7d 配合，平衡安全与可用性） */
const ACCESS_TOKEN_TTL = "15m" as const;
/** refresh token 有效期：7 天 */
const REFRESH_TOKEN_TTL = "7d" as const;

/** 环境变量名常量，避免魔法字符串散落 */
const ENV_JWT_ACCESS_SECRET = "JWT_ACCESS_SECRET";
const ENV_JWT_REFRESH_SECRET = "JWT_REFRESH_SECRET";

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

/**
 * 类型守卫：收窄 jwt.verify 的返回值（JwtPayload | string）到 JwtPayload。
 * jwt.verify 在签名有效但 payload 为字符串时返回 string，此时视为非法业务 token。
 */
function isJwtPayload(decoded: unknown): decoded is JwtPayload {
  return typeof decoded === "object" && decoded !== null;
}

export async function signAccessToken(payload: Omit<JWTPayload, "iat" | "exp">): Promise<string> {
  return jwt.sign(payload, requireSecret(ENV_JWT_ACCESS_SECRET), {
    issuer: ISSUER,
    expiresIn: ACCESS_TOKEN_TTL,
  });
}

export async function signRefreshToken(
  payload: Omit<RefreshTokenPayload, "iat" | "exp">,
): Promise<string> {
  return jwt.sign(payload, requireSecret(ENV_JWT_REFRESH_SECRET), {
    expiresIn: REFRESH_TOKEN_TTL,
  });
}

/**
 * 低层助手：验证 token 并以类型安全方式收窄到目标 payload 形状。
 * 验证失败（签名/过期/格式/issuer 不匹配）统一返回 null，调用方据此判定身份。
 */
function verifyToken<T extends JwtPayload>(
  token: string,
  secret: string,
  options?: VerifyOptions,
): T | null {
  try {
    const decoded = jwt.verify(token, secret, options);
    return isJwtPayload(decoded) ? (decoded as T) : null;
  } catch {
    return null;
  }
}

export async function verifyAccessToken(token: string): Promise<JWTPayload | null> {
  return verifyToken<JWTPayload>(token, requireSecret(ENV_JWT_ACCESS_SECRET), {
    issuer: ISSUER,
  });
}

export async function verifyRefreshToken(token: string): Promise<RefreshTokenPayload | null> {
  return verifyToken<RefreshTokenPayload>(token, requireSecret(ENV_JWT_REFRESH_SECRET));
}
