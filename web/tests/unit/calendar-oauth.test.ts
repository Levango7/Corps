// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  exchangeCodeForToken,
  refreshAccessToken,
  revokeToken,
  fetchGoogleUserInfo,
  fetchOutlookUserInfo,
} from "@/lib/calendar/oauth";

/**
 * 日历 OAuth2 token 交换契约（lib/calendar/oauth.ts）：
 *  - 请求体正确性：PKCE code_verifier 必须发出；client_secret 有才带
 *  - 错误面：非 2xx 抛带 status 的错；响应缺 access_token 抛错；clientId 未配置抛错
 *  - revokeToken：Google 有撤销端点（POST 且 token 编码进 query）；Outlook 无端点=空操作；
 *    网络错误被吞（不阻塞本地记录删除）
 *  - userinfo：Google 缺 email 抛错；Outlook mail 缺失时回退 userPrincipalName，两者都缺才抛
 *
 * 全部经 global fetch mock，不发真实网络请求。
 */

const ENV_KEYS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "OUTLOOK_CLIENT_ID",
  "OUTLOOK_CLIENT_SECRET",
  "OUTLOOK_REDIRECT_URI",
];

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  for (const k of ENV_KEYS) vi.stubEnv(k, "");
  vi.stubEnv("GOOGLE_CLIENT_ID", "g-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "g-secret");
  vi.stubEnv("GOOGLE_REDIRECT_URI", "https://app.example.com/api/auth/calendar/google/callback");
  vi.stubEnv("OUTLOOK_CLIENT_ID", "o-client");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const tokenBody = (call: unknown[]) => new URLSearchParams(String((call[1] as RequestInit).body));

describe("exchangeCodeForToken", () => {
  it("POST token 端点：PKCE verifier + redirect_uri + client_secret 都在请求体", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ access_token: "at", expires_in: 3600, token_type: "Bearer" }), {
        status: 200,
      }),
    );
    const res = await exchangeCodeForToken("google", "the-code", "the-verifier");
    expect(res.access_token).toBe("at");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://oauth2.googleapis.com/token");
    expect((init as RequestInit).method).toBe("POST");
    const body = tokenBody(fetchMock.mock.calls[0]);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("the-code");
    expect(body.get("code_verifier")).toBe("the-verifier");
    expect(body.get("client_id")).toBe("g-client");
    expect(body.get("client_secret")).toBe("g-secret");
    expect(body.get("redirect_uri")).toContain("/google/callback");
  });

  it("Outlook（未配 client_secret）不携带 client_secret", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ access_token: "at", expires_in: 3600, token_type: "Bearer" }), {
        status: 200,
      }),
    );
    await exchangeCodeForToken("outlook", "c", "v");
    const body = tokenBody(fetchMock.mock.calls[0]);
    expect(body.get("client_id")).toBe("o-client");
    expect(body.get("client_secret")).toBeNull();
  });

  it("非 2xx：抛出含状态码的错（附响应文本）", async () => {
    fetchMock.mockResolvedValue(new Response("bad_verifier", { status: 400 }));
    await expect(exchangeCodeForToken("google", "c", "v")).rejects.toThrow(
      /token 交换失败 \(400\): bad_verifier/,
    );
  });

  it("响应缺 access_token：抛错", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ expires_in: 1 }), { status: 200 }));
    await expect(exchangeCodeForToken("google", "c", "v")).rejects.toThrow(/缺少 access_token/);
  });

  it("clientId 未配置：不发请求直接抛（防呆）", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    await expect(exchangeCodeForToken("google", "c", "v")).rejects.toThrow(/未配置/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("refreshAccessToken", () => {
  it("grant_type=refresh_token + refresh_token + client_id 发出", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ access_token: "new", expires_in: 3600, token_type: "Bearer" }),
        {
          status: 200,
        },
      ),
    );
    const res = await refreshAccessToken("google", "rt-1");
    expect(res.access_token).toBe("new");
    const body = tokenBody(fetchMock.mock.calls[0]);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt-1");
    expect(body.get("client_secret")).toBe("g-secret");
  });

  it("非 2xx：抛含状态码的错；缺 access_token：抛错", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 401 }));
    await expect(refreshAccessToken("google", "rt")).rejects.toThrow(/token 刷新失败 \(401\)/);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    await expect(refreshAccessToken("google", "rt")).rejects.toThrow(/刷新响应缺少 access_token/);
  });
});

describe("revokeToken", () => {
  it("Google：POST 撤销端点，token 编码进 query", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    await revokeToken("google", "at/with+special");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://oauth2.googleapis.com/revoke?token=at%2Fwith%2Bspecial");
    expect((init as RequestInit).method).toBe("POST");
  });

  it("Outlook（无撤销端点）：空操作，不发请求", async () => {
    await revokeToken("outlook", "at");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("网络错误：被吞（不阻塞本地记录删除）", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(revokeToken("google", "at")).resolves.toBeUndefined();
  });
});

describe("userinfo", () => {
  it("Google：Bearer 头 + 返回 json；非 2xx 抛错；缺 email 抛错", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "1", email: "a@b.c" }), { status: 200 }),
    );
    await expect(fetchGoogleUserInfo("tok")).resolves.toEqual({ id: "1", email: "a@b.c" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("googleapis.com");
    expect((init as RequestInit).headers).toEqual({ Authorization: "Bearer tok" });

    fetchMock.mockResolvedValueOnce(new Response("oops", { status: 403 }));
    await expect(fetchGoogleUserInfo("tok")).rejects.toThrow(/Google userinfo 失败 \(403\)/);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: "1" }), { status: 200 }));
    await expect(fetchGoogleUserInfo("tok")).rejects.toThrow(/缺少 email/);
  });

  it("Outlook：mail 缺失回退 userPrincipalName；两者都缺抛错", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "u1", userPrincipalName: "u@corp.onmicrosoft.com" }), {
        status: 200,
      }),
    );
    await expect(fetchOutlookUserInfo("tok")).resolves.toMatchObject({ id: "u1" });

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: "u1" }), { status: 200 }));
    await expect(fetchOutlookUserInfo("tok")).rejects.toThrow(/缺少 mail\/userPrincipalName/);
  });
});
