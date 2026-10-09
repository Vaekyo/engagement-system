import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import type { AdapterResult, PlatformAdapter, PublishResult } from "@/lib/platforms/types";

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "audit_logs", "engagement_snapshots", "publish_jobs", "ai_drafts", "comments", "content", "affiliated_authors", "platform_accounts", "creator" CASCADE`,
  );
}

export async function makeWorkspace() {
  const creator = await prisma.creator.create({ data: { displayName: "Test", passwordHash: "x" } });
  const account = await prisma.platformAccount.create({
    data: {
      creatorId: creator.id,
      platform: "youtube",
      handle: "testchannel",
      platformUserId: "UCtest",
      connectionStatus: "connected",
      encryptedAccessToken: encryptSecret("access-token"),
      tokenExpiresAt: new Date(Date.now() + 3600_000),
    },
  });
  const content = await prisma.content.create({
    data: { platformAccountId: account.id, externalVideoId: "vid1", url: "https://www.youtube.com/shorts/vid1", title: "Lampu toples", source: "api" },
  });
  return { creator, account, content };
}

export async function makeDraft(contentId: string, text = "Menurut kalian bagian lampu toples mana yang paling susah?") {
  return prisma.aiDraft.create({ data: { contentId, draftType: "starter", text, originalText: text, modelVersion: "test", riskFlags: [] } });
}

// Scriptable fake platform adapter that records every publish call.
export function fakeAdapter(results: AdapterResult<PublishResult>[]) {
  const calls: { contentId: string; text: string }[] = [];
  const adapter: PlatformAdapter = {
    platform: "youtube",
    capabilities: { listRecentContent: false, listComments: false, publishComment: true, replyToComment: true, getMetrics: false },
    getConnectionStatus: async () => ({ status: "connected", detail: "fake", capabilities: adapter.capabilities }),
    listRecentContent: async () => ({ ok: true, data: [] }),
    listComments: async () => ({ ok: true, data: [] }),
    getMetrics: async () => ({ ok: true, data: {} }),
    publishComment: async (contentId, text) => {
      calls.push({ contentId, text });
      return results.shift() ?? { ok: true, data: { externalCommentId: `ext_${calls.length}` } };
    },
    replyToComment: async (contentId, text) => {
      calls.push({ contentId, text });
      return results.shift() ?? { ok: true, data: { externalCommentId: `ext_${calls.length}` } };
    },
  };
  return { adapter, calls, adapterFor: async () => adapter };
}
