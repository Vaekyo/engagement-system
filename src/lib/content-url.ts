import type { Platform } from "@prisma/client";

export interface ParsedContentUrl {
  platform: Platform;
  externalVideoId: string | null;
  url: string;
}

// Recognises public URLs of short-form videos so creators can register
// content manually on platforms that aren't connected through an API.
export function parseContentUrl(raw: string): ParsedContentUrl | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.replace(/^www\.|^m\./, "");
  const parts = url.pathname.split("/").filter(Boolean);

  if (host === "youtube.com" || host === "youtu.be") {
    let id: string | null = null;
    if (host === "youtu.be") id = parts[0] ?? null;
    else if (parts[0] === "shorts" || parts[0] === "live") id = parts[1] ?? null;
    else if (parts[0] === "watch") id = url.searchParams.get("v");
    if (!id || !/^[\w-]{6,20}$/.test(id)) return { platform: "youtube", externalVideoId: null, url: url.toString() };
    return { platform: "youtube", externalVideoId: id, url: `https://www.youtube.com/shorts/${id}` };
  }
  if (host === "instagram.com") {
    const idx = parts.findIndex((p) => p === "reel" || p === "reels" || p === "p");
    const code = idx >= 0 ? parts[idx + 1] : undefined;
    return { platform: "instagram", externalVideoId: code ?? null, url: url.toString() };
  }
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    const idx = parts.indexOf("video");
    const id = idx >= 0 ? parts[idx + 1] : undefined;
    return { platform: "tiktok", externalVideoId: id && /^\d+$/.test(id) ? id : null, url: url.toString() };
  }
  return null;
}

export const PLATFORM_LABELS: Record<Platform, string> = {
  youtube: "YouTube Shorts",
  instagram: "Instagram Reels",
  tiktok: "TikTok",
};
