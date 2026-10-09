import type { Platform } from "@prisma/client";
import { randomToken } from "../crypto";
import type { AdapterResult, Capabilities, CommentItem, ConnectionStatusInfo, MetricsSnapshot, PlatformAdapter, PublishResult } from "./types";

// Development-only adapter used when MOCK_MODE=true. It never contacts a
// platform. Its external IDs are prefixed "mock_" and the UI labels them, so
// mock "publishing" can't be mistaken for a real post.
export class MockAdapter implements PlatformAdapter {
  readonly capabilities: Capabilities = {
    listRecentContent: false,
    listComments: false,
    publishComment: true,
    replyToComment: true,
    getMetrics: true,
  };

  constructor(readonly platform: Platform) {}

  async getConnectionStatus(): Promise<ConnectionStatusInfo> {
    return { status: "connected", detail: "Mock mode — tidak terhubung ke platform asli", capabilities: this.capabilities };
  }
  async listRecentContent(): Promise<AdapterResult<never[]>> {
    return { ok: true, data: [] };
  }
  async listComments(): Promise<AdapterResult<CommentItem[]>> {
    return { ok: true, data: [] };
  }
  async publishComment(): Promise<AdapterResult<PublishResult>> {
    return { ok: true, data: { externalCommentId: `mock_${randomToken(8)}` } };
  }
  async replyToComment(): Promise<AdapterResult<PublishResult>> {
    return { ok: true, data: { externalCommentId: `mock_${randomToken(8)}` } };
  }
  async getMetrics(): Promise<AdapterResult<MetricsSnapshot>> {
    return { ok: false, status: "unsupported", message: "Mock mode does not generate metrics", retryable: false };
  }
}
