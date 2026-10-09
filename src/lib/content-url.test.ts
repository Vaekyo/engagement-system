import { describe, expect, it } from "vitest";
import { parseContentUrl } from "./content-url";

describe("parseContentUrl", () => {
  it("parses YouTube Shorts, watch and youtu.be URLs", () => {
    expect(parseContentUrl("https://www.youtube.com/shorts/abc123DEF_-")).toEqual({ platform: "youtube", externalVideoId: "abc123DEF_-", url: "https://www.youtube.com/shorts/abc123DEF_-" });
    expect(parseContentUrl("https://youtube.com/watch?v=abc123DEF")?.externalVideoId).toBe("abc123DEF");
    expect(parseContentUrl("https://youtu.be/abc123DEF")?.externalVideoId).toBe("abc123DEF");
  });

  it("parses Instagram reels and TikTok videos", () => {
    expect(parseContentUrl("https://www.instagram.com/reel/C9xYz12/")).toMatchObject({ platform: "instagram", externalVideoId: "C9xYz12" });
    expect(parseContentUrl("https://www.tiktok.com/@akun/video/7300000000000000001?lang=id")).toMatchObject({ platform: "tiktok", externalVideoId: "7300000000000000001" });
  });

  it("rejects unknown hosts and non-http URLs", () => {
    expect(parseContentUrl("https://example.com/video/1")).toBeNull();
    expect(parseContentUrl("javascript:alert(1)")).toBeNull();
    expect(parseContentUrl("not a url")).toBeNull();
  });
});
