// Seeds a demo workspace with mock data so the dashboard can be explored
// without any platform credentials. Refuses to run unless MOCK_MODE=true.
import { PrismaClient, type AuthorType, type CommentCategory, type Platform } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";
import { classifyComment } from "../src/lib/comments/classify";
import { hashAuthorId } from "../src/lib/crypto";

const prisma = new PrismaClient();
const HOUR = 3600_000;
const DAY = 24 * HOUR;

async function main() {
  if (process.env.MOCK_MODE !== "true") throw new Error("Seed hanya untuk MOCK_MODE=true.");
  if (await prisma.creator.count()) {
    console.log("Workspace sudah ada — seed dilewati. Jalankan `npm run db:reset` untuk mengulang.");
    return;
  }
  const password = process.env.SEED_PASSWORD ?? "demo-password-123";
  const creator = await prisma.creator.create({
    data: { displayName: "Studio Rani (demo)", passwordHash: await hashPassword(password), settings: { retentionDays: 365 } },
  });

  const account = (platform: Platform, handle: string, connectionStatus: "connected" | "manual" | "permission_required", platformUserId?: string) =>
    prisma.platformAccount.create({ data: { creatorId: creator.id, platform, handle, connectionStatus, platformUserId, accountType: "official" } });
  const yt = await account("youtube", "studiorani", "connected", "UCmock_studiorani");
  const ig = await account("instagram", "studiorani", "permission_required");
  const tt = await account("tiktok", "studiorani", "manual");
  await prisma.affiliatedAuthor.create({ data: { creatorId: creator.id, platform: "youtube", externalAuthorId: "UCmock_editor", label: "Editor — Dimas" } });

  const now = Date.now();
  const items: {
    account: typeof yt;
    videoId: string | null;
    url: string;
    title: string;
    caption: string;
    notes: string;
    daysAgo: number;
    group: "seeded" | "control" | null;
    views: [number, number, number];
    comments: { text: string; author: string; type?: AuthorType; replyTo?: number }[];
  }[] = [
    {
      account: yt,
      videoId: "mockShort001",
      url: "https://www.youtube.com/shorts/mockShort001",
      title: "Bikin lampu tidur dari toples bekas",
      caption: "Upcycle toples kaca jadi lampu tidur hangat. Bahan < 50 ribu!",
      notes: "Proses 3 langkah: amplas toples, pasang lampu LED fairy, tutup pakai kain linen. Bagian tersulit: merapikan kabel di tutup.",
      daysAgo: 9,
      group: "seeded",
      views: [400, 5200, 11800],
      comments: [
        { text: "Lampunya pakai baterai atau colokan USB?", author: "Nadia" },
        { text: "Keren banget hasilnya 😍", author: "Fajar" },
        { text: "Pakai baterai AA, tahan sekitar seminggu kalau nyala tiap malam.", author: "studiorani", type: "creator", replyTo: 0 },
        { text: "Saran: next video coba pakai toples warna amber", author: "Sinta" },
        { text: "Aku juga bikin, kabelnya susah dirapihin haha", author: "Bayu", replyTo: 1 },
      ],
    },
    {
      account: yt,
      videoId: "mockShort002",
      url: "https://www.youtube.com/shorts/mockShort002",
      title: "Rak dinding dari palet kayu",
      caption: "Rak minimalis dari palet bekas, cuma butuh 2 jam.",
      notes: "Fokus video: teknik mengamplas palet supaya tidak ada serpihan, dan cara cari stud di dinding.",
      daysAgo: 8,
      group: "control",
      views: [350, 4100, 9300],
      comments: [
        { text: "Kayunya dicat atau dipernis?", author: "Rina" },
        { text: "Mantap", author: "Doni" },
        { text: "Behind the scenes footage nyusul ya!", author: "Dimas (editor)", type: "team" },
      ],
    },
    {
      account: ig,
      videoId: "Cmock_reel01",
      url: "https://www.instagram.com/reel/Cmock_reel01/",
      title: "3 ide dekor meja kerja",
      caption: "Dekor meja kerja tanpa bor. Mana favoritmu: 1, 2, atau 3?",
      notes: "Ide 1: pegboard tempel, ide 2: lampu clamp, ide 3: tanaman gantung mini.",
      daysAgo: 5,
      group: "seeded",
      views: [600, 7300, 15200],
      comments: [
        { text: "Nomor 2! Beli lampunya di mana?", author: "ayu.desk" },
        { text: "Tolong bikin versi budget dong", author: "kevin_w" },
      ],
    },
    {
      account: tt,
      videoId: "7300000000000000001",
      url: "https://www.tiktok.com/@studiorani/video/7300000000000000001",
      title: "Restorasi kursi rotan nenek",
      caption: "Kursi rotan 30 tahun, dibikin kinclong lagi ✨",
      notes: "Pakai sabun minyak kelapa, sikat gigi bekas, dan pernis berbasis air. Satu bagian rotan putus disambung ulang.",
      daysAgo: 3,
      group: "control",
      views: [900, 12400, 0],
      comments: [
        { text: "Pernisnya merk apa kak?", author: "lala" },
        { text: "Ini scam, pasti beli baru", author: "anon123" },
        { text: "Ya ampun jadi inget kursi di rumah nenek", author: "putri" },
      ],
    },
  ];

  for (const item of items) {
    const publishedAt = new Date(now - item.daysAgo * DAY);
    const content = await prisma.content.create({
      data: {
        platformAccountId: item.account.id,
        externalVideoId: item.videoId,
        url: item.url,
        title: item.title,
        caption: item.caption,
        creatorNotes: item.notes,
        publishedAt,
        source: "mock",
        syncStatus: "mock",
        experimentGroup: item.group,
      },
    });
    const [v0, v24, v7] = item.views;
    const snapshots = [
      { capturedAt: new Date(publishedAt.getTime() + HOUR), views: v0 },
      { capturedAt: new Date(publishedAt.getTime() + DAY + HOUR), views: v24 },
      ...(item.daysAgo >= 7 ? [{ capturedAt: new Date(publishedAt.getTime() + 7 * DAY + HOUR), views: v7 }] : []),
    ];
    for (const s of snapshots) {
      await prisma.engagementSnapshot.create({
        data: { contentId: content.id, capturedAt: s.capturedAt, views: s.views, likes: Math.round(s.views * 0.06), commentsCount: item.comments.length, source: "mock" },
      });
    }
    const ids: string[] = [];
    for (const [i, c] of item.comments.entries()) {
      const type = c.type ?? "audience";
      const category: CommentCategory = type === "audience" ? classifyComment(c.text) : "other";
      const row = await prisma.comment.create({
        data: {
          contentId: content.id,
          externalCommentId: item.account.platform === "youtube" ? `mockc_${item.videoId}_${i}` : null,
          parentId: c.replyTo !== undefined ? ids[c.replyTo] : null,
          text: c.text,
          authorDisplayName: c.author,
          authorIdHash: type === "audience" && item.account.platform === "youtube" ? hashAuthorId("youtube", `UCmock_${c.author}`) : null,
          authorType: type,
          category,
          source: "mock",
          publishedAt: new Date(publishedAt.getTime() + (i + 1) * 2 * HOUR),
        },
      });
      ids.push(row.id);
      if (c.replyTo !== undefined) await prisma.comment.update({ where: { id: ids[c.replyTo] }, data: { replyCount: { increment: 1 } } });
    }
  }

  await prisma.auditLog.create({ data: { action: "workspace.seeded", actor: "system:seed", targetType: "creator", targetId: creator.id } });
  console.log(`Workspace demo dibuat. Masuk dengan kata sandi: ${password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
