/**
 * Pure retry-decision logic, deliberately kept free of any SDK import so it
 * can be unit-tested in isolation (see tests/test-questions.ts) without
 * needing a live model connection. lib/ollama.ts
 * imports these and does the actual I/O.
 */

export const MAX_RETRIES = 3;
export const BASE_DELAY_MS = 1500;

/** HTTP statuses worth retrying. 429 = rate limit, 5xx = transient server-side. */
export function isRetryableStatus(status: number | undefined): boolean {
  if (status === 429) return true;
  if (status !== undefined && status >= 500 && status < 600) return true;
  return false;
}

/** Duck-typed status extraction -- works for Anthropic.APIError instances
 * (which carry a `.status` property at runtime) without needing to import
 * the SDK's class just to do an `instanceof` check here. */
export function extractStatusCode(err: unknown): number | undefined {
  const status = (err as any)?.status;
  return typeof status === "number" ? status : undefined;
}

/** Network-level errors (fetch/connection failing before a response
 * exists) are retryable; explicit auth/config errors are not -- retrying
 * those just wastes time and delays a clear error message. */
export function isRetryableError(err: unknown): boolean {
  const status = extractStatusCode(err);
  if (status !== undefined) return isRetryableStatus(status);
  const name = (err as any)?.name ?? "";
  return name.includes("Connection") || name.includes("Timeout");
}

/** Exponential backoff with jitter: 1.5s/3s/6s base, +/- up to 30% jitter so
 * concurrent retrying clients don't all retry in lockstep. */
export function backoffDelayMs(attempt: number): number {
  const base = BASE_DELAY_MS * Math.pow(2, attempt - 1);
  const jitter = base * 0.3 * (Math.random() * 2 - 1); // +/- 30%
  return Math.max(200, Math.round(base + jitter));
}
