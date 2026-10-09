import { prisma } from "../db";
import { isMockMode } from "../env";
import { processDueJobs, recoverStaleJobs } from "../publishing/service";
import { purgeExpiredAudienceData, syncAccount } from "./sync";

const SYNC_INTERVAL_MS = 15 * 60 * 1000;

// One scheduled-worker tick. Safe to run concurrently: job claims are atomic.
export async function runWorkerTick() {
  const recovered = await recoverStaleJobs();
  const publishing = await processDueJobs();

  let synced = 0;
  if (!isMockMode()) {
    const due = await prisma.platformAccount.findMany({
      where: {
        connectionStatus: "connected",
        OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: new Date(Date.now() - SYNC_INTERVAL_MS) } }],
      },
    });
    for (const account of due) {
      const res = await syncAccount(account);
      if (res.synced) synced++;
    }
  }
  const purged = await purgeExpiredAudienceData();
  return { recovered, publishing, synced, purged };
}
