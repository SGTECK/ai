import { NextRequest, NextResponse } from "next/server";
import { warmModel, getOllamaConfigSummary } from "@/lib/ollama";
import { isAdminAuthorized, adminNotConfiguredResponse } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Load Ollama model into memory. Protected in production.
 * Unauthenticated public warm endpoints can be abused for CPU burn.
 */
export async function POST(req: NextRequest) {
  if (process.env.ADMIN_ACCESS_TOKEN) {
    if (!isAdminAuthorized(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    const { error, status } = adminNotConfiguredResponse();
    return NextResponse.json(
      { error: "Warm endpoint disabled in production without ADMIN_ACCESS_TOKEN", detail: error },
      { status }
    );
  }

  const result = await warmModel();
  return NextResponse.json(
    { ...result, config: getOllamaConfigSummary() },
    { status: result.ok ? 200 : 503 }
  );
}

export async function GET(req: NextRequest) {
  return POST(req);
}
