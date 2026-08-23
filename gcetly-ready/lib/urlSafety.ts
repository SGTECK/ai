/**
 * Citation-link safety — only allow http(s) public links.
 * Blocks javascript:, data:, file:, and embedded credentials.
 */
export function isSafeUrl(s: string): boolean {
  if (!s || typeof s !== "string" || s.length > 2048) return false;
  try {
    const u = new URL(s.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (u.username || u.password) return false;
    const host = u.hostname.toLowerCase();
    // Block obvious local / metadata targets if a bad citation ever appears
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.endsWith(".local") ||
      host.startsWith("169.254.") ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
