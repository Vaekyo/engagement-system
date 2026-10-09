import { z } from "zod";

export const RiskLabel = z.object({
  label: z.string().describe("Short risk label, e.g. unverified_claim, sensitive_info, misleading"),
  detail: z.string(),
});

export const DraftOption = z.object({
  text: z.string().describe("Comment text exactly as it would be posted by the creator's official account"),
  rationale: z.string().describe("Why this sparks genuine discussion about this specific content"),
  risk_labels: z.array(RiskLabel),
});

export const ContentAnalysis = z.object({
  summary: z.string(),
  themes: z.array(z.string()),
  hooks: z.array(z.string()),
  discussion_moments: z.array(z.string()),
  risks: z.array(RiskLabel),
  starter_comments: z.array(DraftOption),
});

export const ReplySuggestions = z.object({
  intent: z.enum(["question", "feedback", "positive", "needs_review", "other"]),
  replies: z.array(DraftOption),
});

export type ContentAnalysis = z.infer<typeof ContentAnalysis>;
export type ReplySuggestions = z.infer<typeof ReplySuggestions>;
export type DraftOption = z.infer<typeof DraftOption>;

// Limits on what we send to the model (data minimisation + cost). Inputs over
// these are rejected at the form, not silently truncated.
export const INPUT_LIMITS = {
  caption: 5000,
  creatorNotes: 5000,
  transcript: 20000,
  comment: 2000,
};
