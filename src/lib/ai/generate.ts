import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { Platform } from "@prisma/client";
import type { z } from "zod";
import { env } from "../env";
import { classifyComment } from "../comments/classify";
import { analysisPrompt, replyPrompt, SYSTEM_PROMPT } from "./prompts";
import { ContentAnalysis, ReplySuggestions } from "./schema";

export class AiGenerationError extends Error {
  constructor(
    message: string,
    readonly code: "refusal" | "invalid_output" | "rate_limited" | "api_error" | "not_configured",
  ) {
    super(message);
  }
}

export interface Generated<T> {
  output: T;
  modelVersion: string;
}

let client: Anthropic | undefined;
function anthropic(): Anthropic {
  client ??= new Anthropic({ apiKey: env().ANTHROPIC_API_KEY });
  return client;
}

export const isAiConfigured = () => Boolean(env().ANTHROPIC_API_KEY);

async function callClaude<S extends z.ZodType>(schema: S, prompt: string): Promise<Generated<z.infer<S>>> {
  const model = env().ANTHROPIC_MODEL;
  let response;
  try {
    response = await anthropic().beta.messages.parse({
      model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
      output_config: { effort: "medium", format: betaZodOutputFormat(schema) },
      // Server-side fallback if a safety classifier declines the request.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) throw new AiGenerationError("Claude API rate limit; coba lagi nanti.", "rate_limited");
    if (error instanceof Anthropic.AuthenticationError) throw new AiGenerationError("ANTHROPIC_API_KEY tidak valid.", "not_configured");
    if (error instanceof Anthropic.APIError) throw new AiGenerationError(`Claude API error ${error.status}`, "api_error");
    throw error;
  }
  if (response.stop_reason === "refusal") {
    throw new AiGenerationError("Model menolak permintaan ini. Tinjau materi konten.", "refusal");
  }
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new AiGenerationError("Output model tidak lengkap atau tidak valid.", "invalid_output");
  }
  return { output: response.parsed_output as z.infer<S>, modelVersion: response.model };
}

export interface AnalysisInput {
  platform: Platform;
  title?: string | null;
  caption?: string | null;
  creatorNotes?: string | null;
  transcript?: string | null;
}

export async function generateAnalysis(input: AnalysisInput): Promise<Generated<ContentAnalysis>> {
  if (!isAiConfigured()) return { output: mockAnalysis(input), modelVersion: "mock" };
  const result = await callClaude(ContentAnalysis, analysisPrompt(input));
  if (result.output.starter_comments.length < 3) {
    throw new AiGenerationError("Model menghasilkan kurang dari tiga draf komentar.", "invalid_output");
  }
  return result;
}

export async function generateReplies(input: { platform: Platform; contentSummary: string; comment: string }): Promise<Generated<ReplySuggestions>> {
  if (!isAiConfigured()) return { output: mockReplies(input.comment), modelVersion: "mock" };
  return callClaude(ReplySuggestions, replyPrompt(input));
}

// ---------------------------------------------------------------------------
// Deterministic stand-ins used when ANTHROPIC_API_KEY is not set, so the full
// workflow can be exercised locally. Labelled model_version "mock" in the UI.

function topicOf(input: AnalysisInput): string {
  const source = input.title || input.caption || input.creatorNotes || "video ini";
  return source.split(/[.!?\n]/)[0].slice(0, 80).trim() || "video ini";
}

export function mockAnalysis(input: AnalysisInput): ContentAnalysis {
  const topic = topicOf(input);
  return {
    summary: `[MOCK] Ringkasan otomatis untuk "${topic}". Set ANTHROPIC_API_KEY untuk analisis sungguhan.`,
    themes: [topic],
    hooks: [`Pembukaan tentang ${topic}`],
    discussion_moments: ["Bagian akhir video", "Proses di balik layar"],
    risks: [],
    starter_comments: [
      {
        text: `Menurut kalian, bagian mana dari "${topic}" yang paling menarik? Aku penasaran sama perspektif kalian.`,
        rationale: "Pertanyaan terbuka tentang konten spesifik.",
        risk_labels: [],
      },
      {
        text: `Aku paling lama ngerjain bagian ending "${topic}". Ada yang notice detail kecil di sana?`,
        rationale: "Membagikan detail di balik layar dan mengajak penonton memperhatikan.",
        risk_labels: [],
      },
      {
        text: `Kalau mau lihat proses pembuatan "${topic}", bagian apa yang paling pengin dibahas selanjutnya?`,
        rationale: "Mengajak audiens menentukan konten berikutnya.",
        risk_labels: [],
      },
    ],
  };
}

export function mockReplies(comment: string): ReplySuggestions {
  const intent = classifyComment(comment);
  const replies =
    intent === "question"
      ? [
          { text: "Pertanyaan bagus! Aku cek dulu detailnya dan kabari di sini ya.", rationale: "Jujur bila jawaban belum pasti.", risk_labels: [] },
          { text: "Makasih udah nanya! Ini bisa jadi bahan video berikutnya — mau dibahas lebih dalam?", rationale: "Mengajak diskusi lanjutan.", risk_labels: [] },
        ]
      : [
          { text: "Makasih udah nonton dan cerita! Bagian mana yang paling relate buat kamu?", rationale: "Menanggapi dan memperpanjang percakapan.", risk_labels: [] },
          { text: "Senang banget dengarnya. Ada ide buat video selanjutnya?", rationale: "Mengundang masukan.", risk_labels: [] },
        ];
  return { intent, replies };
}
