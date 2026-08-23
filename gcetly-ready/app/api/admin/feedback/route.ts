import { NextRequest, NextResponse } from "next/server";
import { loadFeedback, feedbackBackendName } from "@/lib/feedbackStore";
import { rejectUnlessAdmin } from "@/lib/adminGuard";

export const runtime = "nodejs";

/**
 * Admin-only feedback dump. Auth via ADMIN_ACCESS_TOKEN (Bearer).
 * Unset token → deny (never open by default).
 */
export async function GET(req: NextRequest) {
  const denied = await rejectUnlessAdmin(req);
  if (denied) return denied;

  const entries = await loadFeedback(500);
  const up = entries.filter((e) => e.rating === "up").length;
  const down = entries.filter((e) => e.rating === "down").length;

  return NextResponse.json({
    backend: feedbackBackendName(),
    total: entries.length,
    up,
    down,
    entries,
  });
}
