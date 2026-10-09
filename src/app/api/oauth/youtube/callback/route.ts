import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { actorFor, currentCreator } from "@/lib/auth/session";
import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { exchangeCode, OAuthError, stateMatches, YOUTUBE_SCOPES } from "@/lib/oauth/google";
import { googleOAuthConfig } from "@/lib/oauth/config";
import { YouTubeAdapter } from "@/lib/platforms/youtube";

const OAUTH_COOKIE = "ee_oauth_youtube";

function back(message: string, kind: "ok" | "error" = "error") {
  return NextResponse.redirect(new URL(`/accounts?${kind}=${encodeURIComponent(message)}`, env().APP_URL));
}

export async function GET(request: NextRequest) {
  const jar = await cookies();
  const raw = jar.get(OAUTH_COOKIE)?.value;
  jar.delete({ name: OAUTH_COOKIE, path: "/api/oauth/youtube" });

  const creator = await currentCreator();
  if (!creator) return NextResponse.redirect(new URL("/login", env().APP_URL));

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return back(`Google menolak otorisasi: ${params.get("error")}`);

  let pending: { state?: string; verifier?: string; creatorId?: string } = {};
  try {
    pending = raw ? JSON.parse(raw) : {};
  } catch {
    pending = {};
  }
  if (!stateMatches(pending.state, params.get("state")) || pending.creatorId !== creator.id || !pending.verifier) {
    await audit({ action: "oauth.state_mismatch", actor: actorFor(creator.id), targetType: "platform_account" });
    return back("Sesi OAuth tidak valid atau kedaluwarsa. Coba hubungkan lagi.");
  }
  const code = params.get("code");
  const config = googleOAuthConfig();
  if (!code || !config) return back("Kode otorisasi tidak ada.");

  try {
    const token = await exchangeCode(config, code, pending.verifier);
    const missing = YOUTUBE_SCOPES.filter((s) => !token.scopes.includes(s));
    const channel = await new YouTubeAdapter(token.accessToken, null).getOwnChannel();
    if (!channel.ok) return back(`Tidak bisa membaca channel: ${channel.message}`);

    const existing = await prisma.platformAccount.findFirst({
      where: { creatorId: creator.id, platform: "youtube", OR: [{ platformUserId: channel.data.id }, { handle: channel.data.title }] },
    });
    const data = {
      platformUserId: channel.data.id,
      handle: channel.data.title,
      encryptedAccessToken: encryptSecret(token.accessToken),
      // Google only returns a refresh token on first consent; keep the old one otherwise.
      ...(token.refreshToken ? { encryptedRefreshToken: encryptSecret(token.refreshToken) } : {}),
      tokenExpiresAt: token.expiresAt,
      scopes: token.scopes,
      connectionStatus: missing.length ? ("permission_required" as const) : ("connected" as const),
      lastError: missing.length ? `Scope belum diberikan: ${missing.join(", ")}` : null,
    };
    const account = existing
      ? await prisma.platformAccount.update({ where: { id: existing.id }, data })
      : await prisma.platformAccount.create({ data: { ...data, creatorId: creator.id, platform: "youtube", accountType: "official" } });

    await audit({
      action: existing ? "account.reconnected" : "account.connected",
      actor: actorFor(creator.id),
      targetType: "platform_account",
      targetId: account.id,
      metadata: { platform: "youtube", channel: channel.data.title, scopes: token.scopes },
    });
    return back(missing.length ? "Terhubung, tetapi sebagian izin tidak diberikan." : `YouTube "${channel.data.title}" terhubung.`, missing.length ? "error" : "ok");
  } catch (error) {
    const code = error instanceof OAuthError ? error.code : "unknown";
    await audit({ action: "oauth.exchange_failed", actor: actorFor(creator.id), targetType: "platform_account", metadata: { code } });
    return back(`Gagal menukar kode OAuth (${code}).`);
  }
}
