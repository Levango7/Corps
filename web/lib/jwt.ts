import jwt from "jsonwebtoken";

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "dev-access-secret-change-in-production";
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "dev-refresh-secret-change-in-production";
const ISSUER = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

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
  return jwt.sign(payload, ACCESS_SECRET, {
    issuer: ISSUER,
    expiresIn: "15m",
  });
}

export async function signRefreshToken(payload: Omit<RefreshTokenPayload, "iat" | "exp">): Promise<string> {
  return jwt.sign(payload, REFRESH_SECRET, {
    expiresIn: "7d",
  });
}

export async function verifyAccessToken(token: string): Promise<JWTPayload | null> {
  try {
    return jwt.verify(token, ACCESS_SECRET, { issuer: ISSUER }) as JWTPayload;
  } catch {
    return null;
  }
}

export async function verifyRefreshToken(token: string): Promise<RefreshTokenPayload | null> {
  try {
    return jwt.verify(token, REFRESH_SECRET) as RefreshTokenPayload;
  } catch {
    return null;
  }
}
