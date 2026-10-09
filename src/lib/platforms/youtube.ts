import type { Platform } from "@prisma/client";
import type {
  AdapterFailure,
  AdapterResult,
  Capabilities,
  CommentItem,
  ConnectionStatusInfo,
  ContentItem,
  MetricsSnapshot,
  PlatformAdapter,
  PublishResult,
} from "./types";

const API = "https://www.googleapis.com/youtube/v3";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface YouTubeErrorBody {
  error?: { code?: number; message?: string; errors?: { reason?: string }[] };
}

// Maps a YouTube Data API error to an adapter failure. Reasons are listed at
// https://developers.google.com/youtube/v3/docs/errors — re-verify on changes.
export function mapYouTubeError(status: number, body: YouTubeErrorBody): AdapterFailure {
  const reason = body.error?.errors?.[0]?.reason ?? "";
  const message = body.error?.message ?? `YouTube API error ${status}`;
  if (status === 401) return { ok: false, status: "token_expired", message, retryable: false };
  if (reason === "quotaExceeded" || reason === "rateLimitExceeded" || status === 429) {
    return { ok: false, status: "rate_limited", message, retryable: true };
  }
  if (["insufficientPermissions", "forbidden", "commentsDisabled", "channelNotFound"].includes(reason)) {
    return { ok: false, status: "permission_required", message, retryable: false };
  }
  if (status === 403) return { ok: false, status: "policy_error", message, retryable: false };
  if (status === 404) return { ok: false, status: "not_found", message, retryable: false };
  // 5xx: the request may or may not have been applied, so it is not marked
  // retryable for writes; the publishing service decides per operation.
  return { ok: false, status: "error", message, retryable: status >= 500 };
}

export class YouTubeAdapter implements PlatformAdapter {
  readonly platform: Platform = "youtube";
  readonly capabilities: Capabilities = {
    listRecentContent: true,
    listComments: true,
    publishComment: true,
    replyToComment: true,
    getMetrics: true,
  };

  constructor(
    private readonly accessToken: string,
    private readonly channelId: string | null,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private async call<T>(path: string, init?: RequestInit): Promise<AdapterResult<T>> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${API}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: "application/json",
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...init?.headers,
        },
      });
    } catch (error) {
      // Network failure before a response: for reads this is safe to retry.
      return { ok: false, status: "error", message: `Network error: ${(error as Error).message}`, retryable: !init?.method };
    }
    const body = (await res.json().catch(() => ({}))) as T & YouTubeErrorBody;
    if (!res.ok) return mapYouTubeError(res.status, body);
    return { ok: true, data: body };
  }

  async getConnectionStatus(): Promise<ConnectionStatusInfo> {
    const res = await this.call<{ items?: unknown[] }>("/channels?part=id&mine=true");
    if (res.ok) return { status: "connected", detail: "YouTube Data API reachable", capabilities: this.capabilities };
    const status = res.status === "token_expired" ? "expired" : res.status === "permission_required" ? "permission_required" : "error";
    return { status, detail: res.message, capabilities: this.capabilities };
  }

  async getOwnChannel(): Promise<AdapterResult<{ id: string; title: string; uploadsPlaylistId?: string }>> {
    const res = await this.call<{
      items?: { id: string; snippet?: { title?: string }; contentDetails?: { relatedPlaylists?: { uploads?: string } } }[];
    }>("/channels?part=snippet,contentDetails&mine=true");
    if (!res.ok) return res;
    const channel = res.data.items?.[0];
    if (!channel) return { ok: false, status: "not_found", message: "No YouTube channel on this Google account", retryable: false };
    return {
      ok: true,
      data: {
        id: channel.id,
        title: channel.snippet?.title ?? channel.id,
        uploadsPlaylistId: channel.contentDetails?.relatedPlaylists?.uploads,
      },
    };
  }

  async listRecentContent(): Promise<AdapterResult<ContentItem[]>> {
    const channel = await this.getOwnChannel();
    if (!channel.ok) return channel;
    if (!channel.data.uploadsPlaylistId) return { ok: true, data: [] };
    const res = await this.call<{
      items?: { snippet?: { title?: string; description?: string }; contentDetails?: { videoId?: string; videoPublishedAt?: string } }[];
    }>(`/playlistItems?part=snippet,contentDetails&maxResults=25&playlistId=${encodeURIComponent(channel.data.uploadsPlaylistId)}`);
    if (!res.ok) return res;
    return {
      ok: true,
      data: (res.data.items ?? [])
        .filter((item) => item.contentDetails?.videoId)
        .map((item) => {
          const videoId = item.contentDetails!.videoId!;
          return {
            externalVideoId: videoId,
            url: `https://www.youtube.com/shorts/${videoId}`,
            title: item.snippet?.title,
            caption: item.snippet?.description,
            publishedAt: item.contentDetails?.videoPublishedAt ? new Date(item.contentDetails.videoPublishedAt) : undefined,
          };
        }),
    };
  }

  async listComments(videoId: string): Promise<AdapterResult<CommentItem[]>> {
    type Snippet = {
      textDisplay?: string;
      textOriginal?: string;
      authorDisplayName?: string;
      authorChannelId?: { value?: string };
      publishedAt?: string;
      parentId?: string;
    };
    const res = await this.call<{
      items?: {
        id: string;
        snippet?: { totalReplyCount?: number; topLevelComment?: { id: string; snippet?: Snippet } };
        replies?: { comments?: { id: string; snippet?: Snippet }[] };
      }[];
    }>(`/commentThreads?part=snippet,replies&maxResults=100&order=time&textFormat=plainText&videoId=${encodeURIComponent(videoId)}`);
    if (!res.ok) return res;

    const toItem = (id: string, s: Snippet | undefined, replyCount: number, parentId?: string): CommentItem => ({
      externalCommentId: id,
      externalParentId: parentId,
      text: s?.textOriginal ?? s?.textDisplay ?? "",
      authorDisplayName: s?.authorDisplayName,
      externalAuthorId: s?.authorChannelId?.value,
      publishedAt: s?.publishedAt ? new Date(s.publishedAt) : new Date(),
      replyCount,
    });

    const items: CommentItem[] = [];
    for (const thread of res.data.items ?? []) {
      const top = thread.snippet?.topLevelComment;
      if (!top) continue;
      items.push(toItem(top.id, top.snippet, thread.snippet?.totalReplyCount ?? 0));
      for (const reply of thread.replies?.comments ?? []) {
        items.push(toItem(reply.id, reply.snippet, 0, top.id));
      }
    }
    return { ok: true, data: items };
  }

  async publishComment(videoId: string, text: string): Promise<AdapterResult<PublishResult>> {
    const snippet: Record<string, unknown> = { videoId, topLevelComment: { snippet: { textOriginal: text } } };
    if (this.channelId) snippet.channelId = this.channelId;
    const res = await this.call<{ id?: string }>("/commentThreads?part=snippet", {
      method: "POST",
      body: JSON.stringify({ snippet }),
    });
    if (!res.ok) return res;
    if (!res.data.id) return { ok: false, status: "error", message: "YouTube returned no comment ID", retryable: false };
    return { ok: true, data: { externalCommentId: res.data.id } };
  }

  async replyToComment(parentCommentId: string, text: string): Promise<AdapterResult<PublishResult>> {
    const res = await this.call<{ id?: string }>("/comments?part=snippet", {
      method: "POST",
      body: JSON.stringify({ snippet: { parentId: parentCommentId, textOriginal: text } }),
    });
    if (!res.ok) return res;
    if (!res.data.id) return { ok: false, status: "error", message: "YouTube returned no comment ID", retryable: false };
    return { ok: true, data: { externalCommentId: res.data.id } };
  }

  async getMetrics(videoId: string): Promise<AdapterResult<MetricsSnapshot>> {
    const res = await this.call<{ items?: { statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }[] }>(
      `/videos?part=statistics&id=${encodeURIComponent(videoId)}`,
    );
    if (!res.ok) return res;
    const stats = res.data.items?.[0]?.statistics;
    if (!stats) return { ok: false, status: "not_found", message: "Video not found", retryable: false };
    const num = (v?: string) => (v === undefined ? undefined : Number(v));
    return { ok: true, data: { views: num(stats.viewCount), likes: num(stats.likeCount), commentsCount: num(stats.commentCount) } };
  }
}
