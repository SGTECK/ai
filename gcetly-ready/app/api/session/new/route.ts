import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { checkRateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

/**
 * Fresh session id for rate-limit bucketing. No server conversation store.
 */
export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const { allowed } = await checkRateLimit(`session:${ip}`);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  return NextResponse.json({ sessionId: randomUUID() });
}
