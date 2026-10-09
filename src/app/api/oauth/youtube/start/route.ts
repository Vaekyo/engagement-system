import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { currentCreator } from "@/lib/auth/session";
import { createAuthorization } from "@/lib/oauth/google";
import { googleOAuthConfig } from "@/lib/oauth/config";
import { env } from "@/lib/env";

const OAUTH_COOKIE = "ee_oauth_youtube";

// Starts the Google OAuth flow. Platform passwords are never requested; the
// creator signs in on Google's own consent screen.
export async function GET() {
  const creator = await currentCreator();
  const appUrl = env().APP_URL;
  if (!creator) return NextResponse.redirect(new URL("/login", appUrl));
  const config = googleOAuthConfig();
  if (!config) {
    return NextResponse.redirect(new URL("/accounts?error=" + encodeURIComponent("GOOGLE_CLIENT_ID/SECRET belum diatur."), appUrl));
  }
  const auth = createAuthorization(config);
  (await cookies()).set(OAUTH_COOKIE, JSON.stringify({ state: auth.state, verifier: auth.codeVerifier, creatorId: creator.id }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/oauth/youtube",
    maxAge: 600,
  });
  return NextResponse.redirect(auth.url);
}
