import { describe, expect, it, vi } from "vitest";
import { mapYouTubeError, YouTubeAdapter } from "./youtube";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("mapYouTubeError", () => {
  it("maps auth, quota and permission errors", () => {
    expect(mapYouTubeError(401, {}).status).toBe("token_expired");
    expect(mapYouTubeError(403, { error: { errors: [{ reason: "quotaExceeded" }] } })).toMatchObject({ status: "rate_limited", retryable: true });
    expect(mapYouTubeError(403, { error: { errors: [{ reason: "commentsDisabled" }] } }).status).toBe("permission_required");
    expect(mapYouTubeError(403, { error: { errors: [{ reason: "insufficientPermissions" }] } }).status).toBe("permission_required");
    expect(mapYouTubeError(404, {}).status).toBe("not_found");
    expect(mapYouTubeError(503, {})).toMatchObject({ status: "error", retryable: true });
  });
});

describe("YouTubeAdapter", () => {
  it("flattens comment threads and replies", async () => {
    const fetchMock = vi.fn(async () =>
      json({
        items: [
          {
            id: "t1",
            snippet: {
              totalReplyCount: 1,
              topLevelComment: { id: "c1", snippet: { textOriginal: "Pakai baterai?", authorDisplayName: "Nadia", authorChannelId: { value: "UCn" }, publishedAt: "2026-10-01T00:00:00Z" } },
            },
            replies: { comments: [{ id: "c2", snippet: { textOriginal: "AA", authorChannelId: { value: "UCme" }, publishedAt: "2026-10-01T01:00:00Z" } }] },
          },
        ],
      }),
    );
    const adapter = new YouTubeAdapter("token", "UCme", fetchMock);
    const res = await adapter.listComments("vid1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toHaveLength(2);
    expect(res.data[0]).toMatchObject({ externalCommentId: "c1", text: "Pakai baterai?", externalAuthorId: "UCn", replyCount: 1 });
    expect(res.data[1]).toMatchObject({ externalCommentId: "c2", externalParentId: "c1", externalAuthorId: "UCme" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/commentThreads?");
    expect(url).toContain("videoId=vid1");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token");
  });

  it("publishes a top-level comment with commentThreads.insert", async () => {
    const fetchMock = vi.fn(async () => json({ id: "newThread" }));
    const res = await new YouTubeAdapter("token", "UCme", fetchMock).publishComment("vid1", "Halo!");
    expect(res).toEqual({ ok: true, data: { externalCommentId: "newThread" } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://www.googleapis.com/youtube/v3/commentThreads?part=snippet");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ snippet: { videoId: "vid1", channelId: "UCme", topLevelComment: { snippet: { textOriginal: "Halo!" } } } });
  });

  it("replies with comments.insert", async () => {
    const fetchMock = vi.fn(async () => json({ id: "r1" }));
    await new YouTubeAdapter("token", "UCme", fetchMock).replyToComment("c1", "Makasih!");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://www.googleapis.com/youtube/v3/comments?part=snippet");
    expect(JSON.parse(init.body as string)).toEqual({ snippet: { parentId: "c1", textOriginal: "Makasih!" } });
  });

  it("does not mark network failures on writes as retryable", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("socket hang up");
    });
    const res = await new YouTubeAdapter("token", "UCme", fetchMock).publishComment("vid1", "Halo!");
    expect(res).toMatchObject({ ok: false, retryable: false });
  });

  it("parses video statistics", async () => {
    const fetchMock = vi.fn(async () => json({ items: [{ statistics: { viewCount: "1200", likeCount: "80", commentCount: "14" } }] }));
    const res = await new YouTubeAdapter("token", null, fetchMock).getMetrics("vid1");
    expect(res).toEqual({ ok: true, data: { views: 1200, likes: 80, commentsCount: 14 } });
  });
});
