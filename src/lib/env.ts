import { z } from "zod";

// Server-side environment. Never import this module from a Client Component:
// it reads secrets.
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
  // 32+ random bytes (hex or base64) used to sign dashboard sessions.
  SESSION_SECRET: z.string().min(32).optional(),
  // 32 random bytes, base64. Encrypts OAuth tokens at rest (AES-256-GCM).
  TOKEN_ENCRYPTION_KEY: z.string().min(1).optional(),
  // Shared secret for POST /api/jobs/run (scheduled worker trigger).
  CRON_SECRET: z.string().min(16).optional(),
  // "true" seeds and uses the mock adapter instead of live platform APIs.
  MOCK_MODE: z.enum(["true", "false"]).default("true"),
  // Publishing through official APIs stays off until endpoints, permissions
  // and the approval flow have been verified (blueprint section 15, step 10).
  ENABLE_LIVE_PUBLISHING: z.enum(["true", "false"]).default("false"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(
        `Invalid environment: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`,
      );
    }
    cached = parsed.data;
  }
  return cached;
}

export function requireSecret(name: "SESSION_SECRET" | "TOKEN_ENCRYPTION_KEY" | "CRON_SECRET"): string {
  const value = env()[name];
  if (!value) throw new Error(`${name} is not set. See .env.example.`);
  return value;
}

export const isMockMode = () => env().MOCK_MODE === "true";
export const isLivePublishingEnabled = () => env().ENABLE_LIVE_PUBLISHING === "true";
export const isYouTubeOAuthConfigured = () =>
  Boolean(env().GOOGLE_CLIENT_ID && env().GOOGLE_CLIENT_SECRET);

// For tests only.
export function resetEnvCache() {
  cached = undefined;
}
