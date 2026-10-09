import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { prisma } from "../db";
import { requireSecret } from "../env";
import { SESSION_TTL_SECONDS, signSession, verifySession } from "./session-token";

const COOKIE = "ee_session";

export async function startSession(creatorId: string) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const token = signSession({ creatorId, exp }, requireSecret("SESSION_SECRET"));
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

export async function currentCreator() {
  // Session checks depend on the current time and the request: always render
  // at request time, never in a prerender or runtime prefetch.
  await connection();
  const payload = verifySession((await cookies()).get(COOKIE)?.value, requireSecret("SESSION_SECRET"));
  if (!payload) return null;
  return prisma.creator.findUnique({
    where: { id: payload.creatorId },
    select: { id: true, displayName: true, settings: true },
  });
}

// Use at the top of every page data component and Server Action.
export async function requireCreator() {
  const creator = await currentCreator();
  if (!creator) {
    const exists = await prisma.creator.count();
    redirect(exists ? "/login" : "/setup");
  }
  return creator;
}

export const actorFor = (creatorId: string) => `creator:${creatorId}`;
