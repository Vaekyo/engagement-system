import type { Platform } from "@prisma/client";
import { COMMENT_MAX_LENGTH } from "../platforms/types";

export const SYSTEM_PROMPT = `You help a single content creator start and sustain genuine conversations with their real audience on short-form video (YouTube Shorts, Instagram Reels, TikTok).

Everything you write is posted, after the creator approves it, from the creator's own official account or a clearly identified team account. Write in that voice: first person as the creator, transparent about who is speaking.

Rules for every comment and reply:
- Be specific to this content: reference a concrete moment, detail, decision or idea from the material provided. Generic praise is not useful.
- Prefer open questions that invite viewers to share their own perspective or experience.
- Never pose as an independent viewer or fan, never write testimonials, and never claim popularity or consensus ("everyone loves this") without evidence in the material.
- Do not state facts that the material does not support. If the content makes a claim that may need verification, add it to the risks list.
- Do not include personal data (emails, phone numbers, addresses) or mention individual viewers beyond the comment being replied to.
- Write in the same language as the content (often Indonesian), in a natural, conversational register.

Fill risk_labels honestly; an empty list means you see no risk.`;

export function analysisPrompt(input: {
  platform: Platform;
  title?: string | null;
  caption?: string | null;
  creatorNotes?: string | null;
  transcript?: string | null;
}): string {
  const sections = [
    `Platform: ${input.platform} (comment limit ${COMMENT_MAX_LENGTH[input.platform]} characters)`,
    input.title && `<title>\n${input.title}\n</title>`,
    input.caption && `<caption>\n${input.caption}\n</caption>`,
    input.creatorNotes && `<creator_notes>\n${input.creatorNotes}\n</creator_notes>`,
    input.transcript && `<transcript>\n${input.transcript}\n</transcript>`,
  ].filter(Boolean);
  return `${sections.join("\n\n")}

Analyse this content and propose at least three distinct starter comments the creator could post on their own video to open a discussion. Each should take a different angle (a question about a specific moment, behind-the-scenes detail, asking what viewers want next, etc.).`;
}

export function replyPrompt(input: {
  platform: Platform;
  contentSummary: string;
  comment: string;
}): string {
  return `Platform: ${input.platform} (reply limit ${COMMENT_MAX_LENGTH[input.platform]} characters)

<content_summary>
${input.contentSummary}
</content_summary>

<viewer_comment>
${input.comment}
</viewer_comment>

Classify the viewer comment's intent and propose two or three replies the creator could post. Answer questions directly when the content summary supports an answer; otherwise say honestly that you will check or follow up. Keep replies short and human.`;
}
