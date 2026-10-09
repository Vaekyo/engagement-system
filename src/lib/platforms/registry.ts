import type { PlatformAccount } from "@prisma/client";
import { audit } from "../audit";
import { decryptSecret, encryptSecret } from "../crypto";
import { prisma } from "../db";
import { isMockMode } from "../env";
import { OAuthError, refreshAccessToken } from "../oauth/google";
import { googleOAuthConfig } from "../oauth/config";
import { instagramAdapter, ManualAdapter, tiktokAdapter, youtubeManualAdapter } from "./manual";
import { MockAdapter } from "./mock";
import { permissionRequired, type PlatformAdapter } from "./types";
import { YouTubeAdapter } from "./youtube";

const REFRESH_MARGIN_MS = 2 * 60 * 1000;

// Cancels queued publishing for an account whose authorization is gone, so
// no job keeps retrying against a revoked token (blueprint section 11).
export async function haltAccountJobs(accountId: string, reason: string) {
  const jobs = await prisma.publishJob.findMany({
    where: { platformAccountId: accountId, state: { in: ["queued", "retry_scheduled"] } },
    select: { id: true, draftId: true },
  });
  for (const job of jobs) {
    await prisma.$transaction([
      prisma.publishJob.update({ where: { id: job.id }, data: { state: "cancelled", errorCode: reason, completedAt: new Date() } }),
      prisma.aiDraft.update({ where: { id: job.draftId }, data: { status: "manual_action_required" } }),
    ]);
  }
  if (jobs.length) {
    await audit({ action: "publish_jobs.halted", actor: "system", targetType: "platform_account", targetId: accountId, metadata: { reason, count: jobs.length } });
  }
}

async function validYouTubeAccessToken(account: PlatformAccount): Promise<string | null> {
  if (!account.encryptedAccessToken) return null;
  const notExpiring = account.tokenExpiresAt && account.tokenExpiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS;
  if (notExpiring) return decryptSecret(account.encryptedAccessToken);

  const config = googleOAuthConfig();
  if (!account.encryptedRefreshToken || !config) {
    await prisma.platformAccount.update({ where: { id: account.id }, data: { connectionStatus: "expired" } });
    return null;
  }
  try {
    const token = await refreshAccessToken(config, decryptSecret(account.encryptedRefreshToken));
    await prisma.platformAccount.update({
      where: { id: account.id },
      data: {
        encryptedAccessToken: encryptSecret(token.accessToken),
        tokenExpiresAt: token.expiresAt,
        connectionStatus: "connected",
        lastError: null,
      },
    });
    return token.accessToken;
  } catch (error) {
    const code = error instanceof OAuthError ? error.code : "refresh_failed";
    // invalid_grant: the user revoked access or the refresh token expired.
    const status = code === "invalid_grant" ? "revoked" : "expired";
    await prisma.platformAccount.update({ where: { id: account.id }, data: { connectionStatus: status, lastError: code } });
    await haltAccountJobs(account.id, `token_${status}`);
    return null;
  }
}

export async function adapterFor(account: PlatformAccount): Promise<PlatformAdapter> {
  switch (account.platform) {
    case "instagram":
      return instagramAdapter();
    case "tiktok":
      return tiktokAdapter();
    case "youtube": {
      if (isMockMode()) return new MockAdapter("youtube");
      if (account.connectionStatus === "revoked" || !account.encryptedAccessToken) return youtubeManualAdapter();
      const token = await validYouTubeAccessToken(account);
      if (!token) {
        return new ManualAdapter("youtube", permissionRequired("Token YouTube kedaluwarsa atau dicabut. Hubungkan ulang akun."));
      }
      return new YouTubeAdapter(token, account.platformUserId);
    }
  }
}
