import type { Platform } from "@prisma/client";
import { COMMENT_MAX_LENGTH } from "../platforms/types";

export type RiskSeverity = "block" | "warn";

export interface RiskFlag {
  code: "impersonation" | "fake_testimonial" | "unverified_claim" | "generic" | "privacy" | "too_long" | "empty" | "model_flag";
  severity: RiskSeverity;
  message: string;
}

// Phrases that present the poster as an unrelated, independent viewer. Starter
// comments come from the creator's official or clearly-labelled team account,
// so these are always blocked (blueprint sections 1 and 9).
const IMPERSONATION = [
  /\bas an? (?:random |long[- ]time |new )?(?:fan|viewer|subscriber)\b/i,
  /\bi(?:'m| am) (?:not|in no way) (?:affiliated|related|sponsored)\b/i,
  /\bjust (?:found|discovered) (?:this|your) (?:channel|account|page)\b/i,
  /\bfirst time (?:watching|here)\b/i,
  /\bsebagai (?:fans?|penonton|penggemar|subscriber)\b/i,
  /\b(?:aku|saya|gue|gw) (?:bukan|ga|gak|tidak) (?:dibayar|di-?endorse|kenal)\b/i,
  /\bbaru (?:nemu|menemukan|tahu) (?:channel|akun) (?:ini|kamu)\b/i,
  /\bpertama kali nonton\b/i,
];

const FAKE_TESTIMONIAL = [
  /\b(?:this|it) (?:changed|saved) my life\b/i,
  /\bi (?:bought|tried|used) (?:it|this) and\b/i,
  /\b(?:aku|saya|gue) (?:udah|sudah) (?:beli|coba|pakai) dan\b/i,
];

const UNVERIFIED_CLAIM = [
  /\beveryone (?:loves|is loving|agrees)\b/i,
  /\bsemua orang (?:suka|setuju|bilang)\b/i,
  /\b(?:#1|number one|nomor satu|terbaik di dunia|paling viral)\b/i,
  /\b(?:guaranteed|dijamin|pasti berhasil|terbukti|100%)\b/i,
];

const GENERIC_PRAISE = /^(?:\W*)(?:great|nice|amazing|awesome|cool|love (?:it|this)|good|keren|mantap|mantul|bagus|gokil|top|sip|wow|lucu)(?:\s+(?:video|content|konten|banget|bgt|sekali|parah|abis|ini|nya|bro|kak|guys))*\W*$/i;

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
const PHONE = /(?:\+?\d[\s-]?){9,}/;

export interface GuardrailContext {
  platform: Platform;
  // Words from the content's caption/notes; a starter comment sharing none of
  // them is likely generic rather than specific to this video.
  contentKeywords?: string[];
  draftType: "starter" | "reply";
}

export function extractKeywords(...texts: (string | null | undefined)[]): string[] {
  const stop = new Set(
    "yang dan di ke dari ini itu untuk dengan atau juga ada aku kamu kalian the a an and or of to in on for with is are this that you your my video".split(" "),
  );
  const words = texts
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4 && !stop.has(w));
  return [...new Set(words)];
}

export function checkDraft(text: string, ctx: GuardrailContext): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const trimmed = text.trim();

  if (!trimmed) {
    return [{ code: "empty", severity: "block", message: "Teks komentar kosong." }];
  }
  if (trimmed.length > COMMENT_MAX_LENGTH[ctx.platform]) {
    flags.push({
      code: "too_long",
      severity: "block",
      message: `Melebihi batas ${COMMENT_MAX_LENGTH[ctx.platform]} karakter untuk ${ctx.platform}.`,
    });
  }
  if (IMPERSONATION.some((re) => re.test(trimmed))) {
    flags.push({
      code: "impersonation",
      severity: "block",
      message: "Terdengar seperti penonton independen. Komentar harus jelas berasal dari akun kreator/tim.",
    });
  }
  if (FAKE_TESTIMONIAL.some((re) => re.test(trimmed))) {
    flags.push({ code: "fake_testimonial", severity: "block", message: "Terlihat seperti testimoni pengguna. Jangan membuat testimoni palsu." });
  }
  if (UNVERIFIED_CLAIM.some((re) => re.test(trimmed))) {
    flags.push({ code: "unverified_claim", severity: "warn", message: "Mengandung klaim yang belum terverifikasi (mis. \"semua orang suka\")." });
  }
  if (EMAIL.test(trimmed) || PHONE.test(trimmed)) {
    flags.push({ code: "privacy", severity: "block", message: "Mengandung email atau nomor telepon." });
  }
  const isGenericPraise = GENERIC_PRAISE.test(trimmed);
  const keywords = ctx.contentKeywords ?? [];
  const lower = trimmed.toLowerCase();
  const mentionsContent = keywords.length === 0 || keywords.some((k) => lower.includes(k));
  if (isGenericPraise || (ctx.draftType === "starter" && !mentionsContent && !trimmed.includes("?"))) {
    flags.push({ code: "generic", severity: "warn", message: "Terlalu generik. Sebutkan detail spesifik dari konten atau ajukan pertanyaan." });
  }
  return flags;
}

export const hasBlockingFlag = (flags: RiskFlag[]) => flags.some((f) => f.severity === "block");

export function parseFlags(value: unknown): RiskFlag[] {
  return Array.isArray(value) ? (value as RiskFlag[]) : [];
}
