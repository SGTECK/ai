import type { Language } from "./types";

const TAMIL_RE = /[\u0B80-\u0BFF]/;
const LATIN_RE = /[A-Za-z]/;

export function detectLanguage(text: string): Language {
  const hasTamil = TAMIL_RE.test(text);
  const hasLatin = LATIN_RE.test(text);
  if (hasTamil && hasLatin) return "mixed";
  if (hasTamil) return "ta";
  return "en";
}

export function isTamil(text: string): boolean {
  return TAMIL_RE.test(text);
}
