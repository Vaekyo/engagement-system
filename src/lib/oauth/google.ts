import { createHash } from "node:crypto";
import { randomToken } from "../crypto";
import type { FetchLike } from "../platforms/youtube";

// Google OAuth 2.0 for web server apps, with PKCE.
// https://developers.google.com/identity/protocols/oauth2/web-server
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

// youtube.force-ssl is the scope the Data API documents for commentThreads.insert
// and comments.insert; youtube.readonly covers listing. Re-verify on changes.
export const YOUTUBE_SCOPES = ["https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/youtube.force-ssl"];

export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface PendingAuthorization {
  state: string;
  codeVerifier: string;
  url: string;
}

export function codeChallengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function createAuthorization(config: OAuthClientConfig): PendingAuthorization {
  const state = randomToken(24);
  const codeVerifier = randomToken(48);
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: YOUTUBE_SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
    code_challenge: codeChallengeFor(codeVerifier),
    code_challenge_method: "S256",
  });
  return { state, codeVerifier, url: `${GOOGLE_AUTH_URL}?${params}` };
}

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  scopes: string[];
}

export class OAuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

async function tokenRequest(body: URLSearchParams, fetchImpl: FetchLike): Promise<TokenResponse> {
  const res = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    // Never include the request body or tokens in the error.
    throw new OAuthError(json.error_description ?? "Token request failed", json.error ?? `http_${res.status}`);
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(Date.now() + (json.expires_in ?? 3600) * 1000),
    scopes: json.scope?.split(" ") ?? [],
  };
}

export function exchangeCode(config: OAuthClientConfig, code: string, codeVerifier: string, fetchImpl: FetchLike = fetch) {
  return tokenRequest(
    new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }),
    fetchImpl,
  );
}

export function refreshAccessToken(config: OAuthClientConfig, refreshToken: string, fetchImpl: FetchLike = fetch) {
  return tokenRequest(
    new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    fetchImpl,
  );
}

export async function revokeToken(token: string, fetchImpl: FetchLike = fetch): Promise<boolean> {
  const res = await fetchImpl(GOOGLE_REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
  return res.ok;
}

// Constant-time-ish comparison of the state returned by Google with the one
// stored in the user's cookie. Missing values never match.
export function stateMatches(expected: string | undefined, received: string | null): boolean {
  if (!expected || !received || expected.length !== received.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  return diff === 0;
}
