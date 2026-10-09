import { describe, expect, it, vi } from "vitest";
import { codeChallengeFor, createAuthorization, exchangeCode, OAuthError, refreshAccessToken, stateMatches, YOUTUBE_SCOPES } from "./google";

const config = { clientId: "client-id", clientSecret: "client-secret", redirectUri: "http://localhost:3000/api/oauth/youtube/callback" };

describe("Google OAuth", () => {
  it("builds an authorization URL with state, PKCE and offline access", () => {
    const auth = createAuthorization(config);
    const url = new URL(auth.url);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("state")).toBe(auth.state);
    expect(url.searchParams.get("code_challenge")).toBe(codeChallengeFor(auth.codeVerifier));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toBe(YOUTUBE_SCOPES.join(" "));
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(auth.url).not.toContain("client-secret");
  });

  it("generates a fresh state for every authorization", () => {
    expect(createAuthorization(config).state).not.toBe(createAuthorization(config).state);
  });

  it("matches state only when identical", () => {
    expect(stateMatches("abc123", "abc123")).toBe(true);
    expect(stateMatches("abc123", "abc124")).toBe(false);
    expect(stateMatches("abc123", "abc12")).toBe(false);
    expect(stateMatches(undefined, "abc123")).toBe(false);
    expect(stateMatches("abc123", null)).toBe(false);
    expect(stateMatches("", "")).toBe(false);
  });

  it("exchanges the code with the PKCE verifier", async () => {
    const fetchMock = vi.fn(async () => Response.json({ access_token: "at", refresh_token: "rt", expires_in: 3600, scope: YOUTUBE_SCOPES.join(" ") }));
    const token = await exchangeCode(config, "the-code", "the-verifier", fetchMock);
    expect(token.accessToken).toBe("at");
    expect(token.refreshToken).toBe("rt");
    expect(token.scopes).toEqual(YOUTUBE_SCOPES);
    const body = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams;
    expect(body.get("code_verifier")).toBe("the-verifier");
    expect(body.get("grant_type")).toBe("authorization_code");
  });

  it("raises a typed error without leaking secrets", async () => {
    const fetchMock = vi.fn(async () => Response.json({ error: "invalid_grant", error_description: "Bad Request" }, { status: 400 }));
    const err = await refreshAccessToken(config, "secret-refresh-token", fetchMock).catch((e) => e);
    expect(err).toBeInstanceOf(OAuthError);
    expect(err.code).toBe("invalid_grant");
    expect(String(err.message)).not.toContain("secret-refresh-token");
  });
});
