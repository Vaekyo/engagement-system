import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

type Db = Pick<Prisma.TransactionClient, "auditLog">;

const SECRET_KEYS = /token|secret|password|authorization|code_verifier/i;

// Strips anything that looks like a credential before it reaches the log.
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEYS.test(k) ? "[redacted]" : redact(v)]),
    );
  }
  return value;
}

export async function audit(
  entry: { action: string; actor: string; targetType: string; targetId?: string | null; metadata?: Record<string, unknown> },
  db: Db = prisma,
) {
  await db.auditLog.create({
    data: {
      action: entry.action,
      actor: entry.actor,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      metadata: (redact(entry.metadata ?? {}) ?? {}) as Prisma.InputJsonValue,
    },
  });
}
