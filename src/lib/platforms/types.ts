import type { Platform } from "@prisma/client";

// Every adapter call resolves to one of these. Unsupported capabilities must
// say so explicitly; an adapter never reports success it did not achieve.
export type AdapterResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      status: "unsupported" | "permission_required" | "token_expired" | "rate_limited" | "policy_error" | "not_found" | "error";
      message: string;
      // True only when the platform definitively rejected the request before
      // acting on it, so retrying cannot create a duplicate.
      retryable: boolean;
    };

export type AdapterFailure = Extract<AdapterResult<never>, { ok: false }>;

export interface ConnectionStatusInfo {
  status: "connected" | "manual" | "permission_required" | "expired" | "revoked" | "error";
  detail: string;
  capabilities: Capabilities;
}

export interface Capabilities {
  listRecentContent: boolean;
  listComments: boolean;
  publishComment: boolean;
  replyToComment: boolean;
  getMetrics: boolean;
}

export interface ContentItem {
  externalVideoId: string;
  url: string;
  title?: string;
  caption?: string;
  publishedAt?: Date;
}

export interface CommentItem {
  externalCommentId: string;
  externalParentId?: string;
  text: string;
  authorDisplayName?: string;
  externalAuthorId?: string;
  publishedAt: Date;
  replyCount: number;
}

export interface PublishResult {
  externalCommentId: string;
}

export interface MetricsSnapshot {
  views?: number;
  likes?: number;
  commentsCount?: number;
}

export interface PlatformAdapter {
  readonly platform: Platform;
  readonly capabilities: Capabilities;
  getConnectionStatus(): Promise<ConnectionStatusInfo>;
  listRecentContent(): Promise<AdapterResult<ContentItem[]>>;
  listComments(contentId: string): Promise<AdapterResult<CommentItem[]>>;
  publishComment(contentId: string, text: string): Promise<AdapterResult<PublishResult>>;
  replyToComment(commentId: string, text: string): Promise<AdapterResult<PublishResult>>;
  getMetrics(contentId: string): Promise<AdapterResult<MetricsSnapshot>>;
}

export const unsupported = (message: string): AdapterFailure => ({ ok: false, status: "unsupported", message, retryable: false });
export const permissionRequired = (message: string): AdapterFailure => ({
  ok: false,
  status: "permission_required",
  message,
  retryable: false,
});

export const NO_CAPABILITIES: Capabilities = {
  listRecentContent: false,
  listComments: false,
  publishComment: false,
  replyToComment: false,
  getMetrics: false,
};

// Per-platform comment length limits used by guardrails.
export const COMMENT_MAX_LENGTH: Record<Platform, number> = {
  youtube: 10000,
  instagram: 2200,
  tiktok: 150,
};
