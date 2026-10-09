import { hmac, safeEqual } from "../crypto";

// Stateless signed session: base64url(JSON payload).signature
export interface SessionPayload {
  creatorId: string;
  exp: number; // unix seconds
}

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export function signSession(payload: SessionPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmac(body, secret)}`;
}

export function verifySession(token: string | undefined, secret: string, now = Date.now()): SessionPayload | null {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature || !safeEqual(signature, hmac(body, secret))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (typeof payload.creatorId !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp * 1000 < now) return null;
    return payload;
  } catch {
    return null;
  }
}
