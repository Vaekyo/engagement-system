import { describe, expect, it } from "vitest";
import { checkDraft, extractKeywords, hasBlockingFlag, type GuardrailContext } from "./guardrails";

const ctx: GuardrailContext = { platform: "youtube", draftType: "starter", contentKeywords: extractKeywords("Bikin lampu tidur dari toples bekas") };
const codes = (text: string, c = ctx) => checkDraft(text, c).map((f) => f.code);

describe("guardrails", () => {
  it("accepts a specific question from the creator", () => {
    const flags = checkDraft("Menurut kalian, bagian toples mana yang paling susah dirapikan? Aku penasaran.", ctx);
    expect(flags).toEqual([]);
  });

  it("blocks impersonation of independent viewers", () => {
    for (const text of [
      "Sebagai fans, aku suka banget lampu toples ini!",
      "I'm not affiliated, just found this channel and the lampu is great",
      "Baru nemu channel ini, toples-nya keren",
      "Pertama kali nonton dan langsung suka lampu ini",
    ]) {
      const flags = checkDraft(text, ctx);
      expect(flags.map((f) => f.code), text).toContain("impersonation");
      expect(hasBlockingFlag(flags)).toBe(true);
    }
  });

  it("blocks fake testimonials", () => {
    expect(codes("Aku udah beli dan lampu toples ini awet banget")).toContain("fake_testimonial");
  });

  it("warns on unverified popularity claims without blocking", () => {
    const flags = checkDraft("Semua orang suka lampu toples ini, kalian setuju?", ctx);
    expect(flags.map((f) => f.code)).toContain("unverified_claim");
    expect(hasBlockingFlag(flags)).toBe(false);
  });

  it("flags generic praise", () => {
    expect(codes("Keren banget!")).toContain("generic");
    expect(codes("Great video")).toContain("generic");
  });

  it("flags starter comments that ignore the content", () => {
    expect(codes("Jangan lupa subscribe ya teman-teman")).toContain("generic");
  });

  it("blocks personal data", () => {
    expect(codes("Hubungi aku di rani@example.com soal toples")).toContain("privacy");
    expect(codes("WA 0812 3456 7890 buat order lampu")).toContain("privacy");
  });

  it("enforces platform length limits", () => {
    const long = "toples ".repeat(30);
    expect(codes(long, { ...ctx, platform: "tiktok" })).toContain("too_long");
    expect(codes(long, ctx)).not.toContain("too_long");
  });

  it("blocks empty text", () => {
    expect(codes("   ")).toEqual(["empty"]);
  });
});
