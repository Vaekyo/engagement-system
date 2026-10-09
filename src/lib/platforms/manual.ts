import type { Platform } from "@prisma/client";
import {
  NO_CAPABILITIES,
  permissionRequired,
  unsupported,
  type AdapterFailure,
  type ConnectionStatusInfo,
  type PlatformAdapter,
} from "./types";

// Adapter for platforms (or accounts) without an approved API integration.
// Every capability reports why it is unavailable so the UI can offer the
// manual fallback: paste URLs, log comments by hand, copy text to post.
export class ManualAdapter implements PlatformAdapter {
  readonly capabilities = NO_CAPABILITIES;

  constructor(
    readonly platform: Platform,
    private readonly reason: AdapterFailure,
  ) {}

  async getConnectionStatus(): Promise<ConnectionStatusInfo> {
    return {
      status: this.reason.status === "permission_required" ? "permission_required" : "manual",
      detail: this.reason.message,
      capabilities: this.capabilities,
    };
  }
  async listRecentContent() {
    return this.reason;
  }
  async listComments() {
    return this.reason;
  }
  async publishComment() {
    return this.reason;
  }
  async replyToComment() {
    return this.reason;
  }
  async getMetrics() {
    return this.reason;
  }
}

// Instagram: comment read/reply on media owned by a Professional account
// requires a Meta app with approved permissions. Until that integration is
// built and approved, every capability is permission_required.
export const instagramAdapter = () =>
  new ManualAdapter(
    "instagram",
    permissionRequired(
      "Instagram API access belum dikonfigurasi. Butuh akun Professional dan Meta app dengan izin komentar yang disetujui. Gunakan input manual.",
    ),
  );

// TikTok: do not assume the Display API can read or write comments. Treat
// comment management as unsupported until an eligible API product is verified.
export const tiktokAdapter = () =>
  new ManualAdapter(
    "tiktok",
    unsupported(
      "Manajemen komentar TikTok belum tersedia untuk aplikasi ini. Gunakan workflow manual: salin teks lalu posting dari aplikasi TikTok.",
    ),
  );

export const youtubeManualAdapter = () =>
  new ManualAdapter("youtube", permissionRequired("Akun YouTube belum terhubung lewat OAuth. Hubungkan akun atau gunakan input manual."));
