import { NextRequest, NextResponse } from "next/server";
import { saveFeedback } from "@/lib/feedbackStore";
import { checkRateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

/**
 * The thumbs up/down buttons on each answer post here. Storage itself is
 * in lib/feedbackStore.ts -- swappable between a local file (self-hosted)
 * and Upstash Redis (serverless/Vercel), same pattern as lib/rateLimit.ts.
 * See that file for the full reasoning and the honest Upstash caveat.
 */

const MAX_FIELD_LENGTH = 4000;

interface FeedbackBody {
  question?: string;
  answer?: string;
  rating?: "up" | "down";
  sessionId?: string;
}

export async function POST(req: NextRequest) {
  const ct = req.headers.get("content-type") || "";
  if (!ct.toLowerCase().includes("application/json")) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  let body: FeedbackBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.rating !== "up" && body.rating !== "down") {
    return NextResponse.json({ error: "rating must be 'up' or 'down'" }, { status: 400 });
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const { allowed } = await checkRateLimit(`feedback:${ip}`);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const clean = (s: string) =>
    s.replace(/\0/g, "").replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").slice(0, MAX_FIELD_LENGTH);

  const entry = {
    timestamp: new Date().toISOString(),
    rating: body.rating,
    question: typeof body.question === "string" ? clean(body.question) : "",
    answer: typeof body.answer === "string" ? clean(body.answer) : "",
    sessionId:
      typeof body.sessionId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(body.sessionId)
        ? body.sessionId
        : undefined,
  };

  const result = await saveFeedback(entry);
  if (!result.ok) {
    // Reported honestly, not swallowed -- see lib/feedbackStore.ts for the
    // serverless-filesystem / Upstash caveats.
    return NextResponse.json(
      { error: "Could not persist feedback. See lib/feedbackStore.ts.", detail: result.error },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
