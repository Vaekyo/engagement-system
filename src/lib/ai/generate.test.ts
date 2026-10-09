import { describe, expect, it } from "vitest";
import { generateAnalysis, generateReplies, isAiConfigured } from "./generate";
import { checkDraft, extractKeywords, hasBlockingFlag } from "./guardrails";
import { ContentAnalysis } from "./schema";

describe("mock generation (no ANTHROPIC_API_KEY)", () => {
  it("is used when no key is configured", () => {
    expect(isAiConfigured()).toBe(false);
  });

  it("produces at least three schema-valid starters that pass guardrails", async () => {
    const input = { platform: "youtube" as const, title: "Bikin lampu tidur dari toples bekas", caption: "Upcycle toples" };
    const { output, modelVersion } = await generateAnalysis(input);
    expect(modelVersion).toBe("mock");
    expect(ContentAnalysis.parse(output)).toBeTruthy();
    expect(output.starter_comments.length).toBeGreaterThanOrEqual(3);
    for (const s of output.starter_comments) {
      const flags = checkDraft(s.text, { platform: "youtube", draftType: "starter", contentKeywords: extractKeywords(input.title, input.caption) });
      expect(hasBlockingFlag(flags), s.text).toBe(false);
    }
  });

  it("classifies the comment intent for replies", async () => {
    const { output } = await generateReplies({ platform: "youtube", contentSummary: "x", comment: "Pakai lampu apa?" });
    expect(output.intent).toBe("question");
    expect(output.replies.length).toBeGreaterThanOrEqual(2);
  });
});
