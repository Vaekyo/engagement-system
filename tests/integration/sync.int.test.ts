import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { purgeExpiredAudienceData, upsertComments } from "@/lib/jobs/sync";
import { makeWorkspace, resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("comment ingestion", () => {
  it("separates creator, team and audience comments and hashes audience IDs", async () => {
    const { account, content, creator } = await makeWorkspace();
    await prisma.affiliatedAuthor.create({ data: { creatorId: creator.id, platform: "youtube", externalAuthorId: "UCeditor", label: "Editor" } });
    const items = [
      { externalCommentId: "c1", text: "Pakai baterai?", externalAuthorId: "UCviewer", publishedAt: new Date(), replyCount: 1 },
      { externalCommentId: "c2", externalParentId: "c1", text: "AA", externalAuthorId: "UCtest", publishedAt: new Date(), replyCount: 0 },
      { externalCommentId: "c3", text: "BTS nyusul", externalAuthorId: "UCeditor", publishedAt: new Date(), replyCount: 0 },
    ];
    await upsertComments(content.id, account, items, new Set(["UCeditor"]));
    await upsertComments(content.id, account, items, new Set(["UCeditor"])); // idempotent re-sync
    const rows = await prisma.comment.findMany({ orderBy: { externalCommentId: "asc" } });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.authorType)).toEqual(["audience", "creator", "team"]);
    expect(rows[0].category).toBe("question");
    expect(rows[0].authorIdHash).toBeTruthy();
    expect(rows[0].authorIdHash).not.toContain("UCviewer");
    expect(rows[1].parentId).toBe(rows[0].id);
  });

  it("anonymises audience comments past the retention window", async () => {
    const { content, creator } = await makeWorkspace();
    await prisma.creator.update({ where: { id: creator.id }, data: { settings: { retentionDays: 30 } } });
    await prisma.comment.createMany({
      data: [
        { contentId: content.id, text: "old", authorDisplayName: "A", authorIdHash: "h", authorType: "audience", publishedAt: new Date(Date.now() - 40 * 86400_000) },
        { contentId: content.id, text: "new", authorDisplayName: "B", authorType: "audience", publishedAt: new Date() },
        { contentId: content.id, text: "mine", authorDisplayName: "me", authorType: "creator", publishedAt: new Date(Date.now() - 40 * 86400_000) },
      ],
    });
    expect(await purgeExpiredAudienceData()).toBe(1);
    const rows = await prisma.comment.findMany({ orderBy: { text: "asc" } });
    const old = rows.find((r) => r.authorDisplayName === null)!;
    expect(old.authorIdHash).toBeNull();
    expect(old.text).toMatch(/retensi/);
    expect(rows.some((r) => r.text === "new")).toBe(true);
    expect(rows.some((r) => r.text === "mine")).toBe(true);
  });
});
