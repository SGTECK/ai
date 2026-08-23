import { createHash, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

/**
 * Shared admin auth helper. Single shared secret (ADMIN_ACCESS_TOKEN)
 * compared via SHA-256 + timing-safe equality. Unset token → always deny.
 */
export function isAdminAuthorized(req: NextRequest): boolean {
  const configured = process.env.ADMIN_ACCESS_TOKEN;
  if (!configured) return false;

  const header = req.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!provided) return false;

  const hashA = createHash("sha256").update(provided).digest();
  const hashB = createHash("sha256").update(configured).digest();
  return timingSafeEqual(hashA, hashB);
}

export function adminNotConfiguredResponse() {
  return {
    error:
      "Admin is not configured. Set ADMIN_ACCESS_TOKEN in your environment to enable it.",
    status: 503 as const,
  };
}
