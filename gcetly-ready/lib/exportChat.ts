import type { PersistedMessage } from "./localHistory";

/**
 * v2.0 feature: "download this conversation." Pure string-building function
 * so it's unit-testable without touching the DOM -- the actual file
 * download (Blob + object URL) happens in the component, since that part
 * genuinely needs the browser.
 */
export function exportChatAsMarkdown(messages: PersistedMessage[], exportedAt: Date = new Date()): string {
  const lines: string[] = [
    "# GCE-TLY AI Assistant — Conversation",
    "",
    `Exported: ${exportedAt.toISOString().replace("T", " ").slice(0, 19)} UTC`,
    "",
    "---",
    "",
  ];

  for (const m of messages) {
    if (!m.content.trim()) continue;
    lines.push(m.role === "user" ? "**You:**" : "**GCE-TLY AI Assistant:**");
    lines.push(m.content.trim());
    if (m.role === "assistant" && m.sources && m.sources.length > 0) {
      lines.push("");
      lines.push("*Sources:*");
      for (const s of m.sources) {
        lines.push(`- ${s.title ? `${s.title} — ` : ""}${s.url}`);
      }
    }
    lines.push("");
  }

  lines.push("---", "", "Developed by SG TECK · Not an official substitute for gcetly.ac.in");
  return lines.join("\n");
}

export function downloadFile(filename: string, content: string, mimeType = "text/markdown"): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
