import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthorized, adminNotConfiguredResponse } from "./adminAuth";
import { checkRateLimit } from "./rateLimit";

export type AdminGateOptions = {
  /** Default true. Set false to match routes that only checked the Bearer token. */
  rateLimit?: boolean;
};

/**
 * Shared admin gate: token configured + Bearer valid + optional IP rate limit.
 * Returns a Response to return immediately, or null if the request may proceed.
 */
export async function rejectUnlessAdmin(
  req: NextRequest,
  options: AdminGateOptions = {}
): Promise<NextResponse | null> {
  const { rateLimit = true } = options;

  if (!process.env.ADMIN_ACCESS_TOKEN) {
    const { error, status } = adminNotConfiguredResponse();
    return NextResponse.json({ error }, { status });
  }
  if (!isAdminAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (rateLimit) {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "admin";
    const { allowed } = await checkRateLimit(`admin:${ip}`);
    if (!allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
  }
  return null;
}
