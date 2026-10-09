import type { CommentCategory } from "@prisma/client";

const QUESTION = /\?|^(?:apa|apakah|gimana|bagaimana|kenapa|mengapa|kapan|dimana|di mana|siapa|berapa|how|what|why|when|where|who|which|can you|could you|is it|do you|bisa|boleh)\b/i;
const NEEDS_REVIEW = /\b(?:scam|penipu|tipu|bohong|hoax|lapor|report|bodoh|goblok|anjing|bangsat|kontol|fuck|shit|idiot|stupid|bunuh|kill)\b|https?:\/\//i;
const FEEDBACK = /\b(?:saran|sebaiknya|harusnya|mending|kurang|tolong|request|coba bikin|bikin dong|next video|lain kali|should|suggest|please make|would be better|audio|suaranya|terlalu)\b/i;
const POSITIVE = /\b(?:keren|mantap|bagus|suka|love|great|nice|amazing|awesome|keren banget|top|lucu|gokil|inspiratif|makasih|terima kasih|thanks)\b|[❤️😍🔥👏🥰]/iu;

// Lightweight heuristic triage for the inbox. Claude's reply suggestions also
// return an intent, which overrides this when available.
export function classifyComment(text: string): CommentCategory {
  const t = text.trim();
  if (NEEDS_REVIEW.test(t)) return "needs_review";
  if (QUESTION.test(t)) return "question";
  if (FEEDBACK.test(t)) return "feedback";
  if (POSITIVE.test(t)) return "positive";
  return "other";
}

export const CATEGORY_LABELS: Record<CommentCategory, string> = {
  question: "Pertanyaan",
  feedback: "Masukan",
  positive: "Positif",
  needs_review: "Perlu ditinjau",
  other: "Lainnya",
};
