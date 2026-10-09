import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import { runWorkerTick } from "@/lib/jobs/runner";

// Scheduled worker entry point (e.g. Vercel Cron or any scheduler):
//   POST /api/jobs/run  with  Authorization: Bearer $CRON_SECRET
async function handle(request: NextRequest) {
  const secret = env().CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(header, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runWorkerTick();
  return NextResponse.json(result);
}

export const POST = handle;
// Vercel Cron issues GET requests with the same Authorization header.
export const GET = handle;
