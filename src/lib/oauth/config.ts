import { env } from "../env";
import type { OAuthClientConfig } from "./google";

export function googleOAuthConfig(): OAuthClientConfig | null {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_URL } = env();
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return null;
  return {
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri: `${APP_URL}/api/oauth/youtube/callback`,
  };
}
