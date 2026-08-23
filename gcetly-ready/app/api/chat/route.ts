import type { NextRequest } from "next/server";
import type { ChatRequestBody, SourceRef, RetrievedItem } from "@/lib/types";
import { scoreToConfidence } from "@/lib/types";
import { detectLanguage } from "@/lib/language";
import { classifySmallTalk, needsCurrentInfo, isDeepResearchRequest } from "@/lib/retrieval";
import { hybridRetrieve } from "@/lib/hybridRetrieve";
import { trackEvent } from "@/lib/analytics";
import { buildSystemPrompt, smallTalkReplyFor, fallbackFor } from "@/lib/systemPrompt";
import { streamChat } from "@/lib/llm";
import { checkRateLimit } from "@/lib/rateLimit";
import { getFollowUps } from "@/lib/followUps";
import {
  liveWebSearch,
  formatWebResultsForPrompt,
  webResultsToSources,
  isWebSearchConfigured,
} from "@/lib/webSearch";
import { routeQuery, shouldRunWebSearch } from "@/lib/queryRouter";
import { getCachedAnswer, setCachedAnswer } from "@/lib/answerCache";
import {
  sanitizeHistory,
  validateChatMessage,
  isValidSessionId,
  requireJsonContentType,
} from "@/lib/requestSecurity";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// SESSION ISOLATION BY DESIGN, NOT BY POLICY:
// This route holds NO server-side conversation store of any kind. The only
// state it ever sees is exactly what THIS request's body contains --
// `history` is whatever the calling browser tab currently has in its own
// React state (see components/ChatWindow.tsx). There is no database table,
// cache, or in-memory map keyed by session/user that persists messages
// across requests. That means:
//   - A brand new chat (fresh page load / "New Chat" click, which resets
//     the client's `history` array to []) is structurally guaranteed to
//     start with zero prior context -- there is nothing on the server that
//     COULD leak in, not just a rule telling the model not to use it.
//   - Two different browser tabs/users can never influence each other,
//     because their requests never touch shared mutable state.
// `sessionId` below is used ONLY as a rate-limit bucket key -- never to
// look up or store any message content.
// ---------------------------------------------------------------------------

function sseEncode(obj: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`);
}

export async function POST(req: NextRequest) {
  // --- Security: reject non-JSON posts (stops casual form/CSRF-style noise) ---
  if (!requireJsonContentType(req.headers.get("content-type"))) {
    return new Response(JSON.stringify({ error: "Content-Type must be application/json" }), {
      status: 415,
    });
  }

  let body: ChatRequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const validated = validateChatMessage(body.message);
  if (!validated.ok) {
    return new Response(JSON.stringify({ error: validated.error }), {
      status: validated.status,
    });
  }
  const message = validated.message;

  const rawSession = typeof body.sessionId === "string" ? body.sessionId.trim() : "anonymous";
  const sessionId = isValidSessionId(rawSession) ? rawSession : "anonymous";

  // History is client-supplied — validate role/content or ignore junk
  const history = sanitizeHistory(body.history);

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  // Dual key: per-session (fair UX) + per-IP (abuse from many session ids)
  const sessionLimit = await checkRateLimit(`chat:session:${sessionId}`);
  const ipLimit = await checkRateLimit(`chat:ip:${ip}`);
  if (!sessionLimit.allowed || !ipLimit.allowed) {
    return new Response(
      JSON.stringify({ error: "You're sending messages a bit fast -- please wait a moment and try again." }),
      { status: 429 }
    );
  }

  const language = detectLanguage(message);
  const isFirstMessage = history.length === 0;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const close = (payload: {
        text: string;
        sources?: SourceRef[];
        followUps?: string[];
        confidence?: string;
        topScore?: number;
      }) => {
        controller.enqueue(sseEncode({ type: "text", text: payload.text }));
        controller.enqueue(
          sseEncode({
            type: "done",
            sources: payload.sources ?? [],
            language,
            followUps: payload.followUps ?? [],
            confidence: payload.confidence ?? "none",
            topScore: payload.topScore ?? 0,
          })
        );
        controller.close();
      };

      // --- Small talk: zero-cost canned reply, never touches retrieval or the fallback gate ---
      const smallTalk = classifySmallTalk(message);
      if (smallTalk) {
        close({
          text: smallTalkReplyFor(smallTalk, language, isFirstMessage),
          followUps: getFollowUps(undefined, message),
          confidence: "high",
          topScore: 99,
        });
        return;
      }

      // FREE_MODE: fewer docs + shorter history = less CPU/RAM work (zero cost).
      const freeMode = process.env.FREE_MODE === "1" || process.env.FREE_MODE === "true";
      const topK = freeMode ? 4 : 6;
      const historyTrim = freeMode ? 4 : 8;
      const slimHistory = history.slice(-historyTrim);

      // P0: FAQ-style repeat answers (no LLM) when history is empty
      if (slimHistory.length === 0) {
        const cached = getCachedAnswer(message);
        if (cached) {
          close({
            text: cached.text,
            sources: cached.sources as SourceRef[],
            followUps: getFollowUps(undefined, message),
            confidence: (cached.confidence as "high" | "medium" | "low" | "none") || "medium",
            topScore: cached.topScore ?? 0,
          });
          return;
        }
      }

function isFaqFastMatch(message: string, top: RetrievedItem): boolean {
  if (top.kind !== "faq") return false;
  const msgWords = message.toLowerCase().match(/[\w\u0B80-\u0BFF]+/gu) || [];
  const stopwords = new Set([
    "the", "is", "a", "an", "of", "to", "in", "for", "and", "or", "on", "at",
    "what", "how", "who", "when", "which", "are", "do", "does", "i",
    "can", "you", "me", "my", "please", "tell", "about", "will", "it", "this",
    "that", "with", "be", "there", "number", "from", "by", "as", "if",
    "was", "were", "been", "being", "have", "has", "had", "did", "done",
    "என்ன", "எப்படி", "எங்கே", "யார்", "எப்போது", "இருக்கிறது", "உள்ளது",
  ]);
  const queryTokens = msgWords.filter((w) => w.length > 1 && !stopwords.has(w));
  if (queryTokens.length === 0) return false;

  const titleWords = (top.title + " " + top.text.slice(0, 120)).toLowerCase().match(/[\w\u0B80-\u0BFF]+/gu) || [];
  const titleSet = new Set(titleWords);

  let matched = 0;
  for (const t of queryTokens) {
    if (titleSet.has(t)) matched++;
  }

  const coverage = matched / queryTokens.length;
  return coverage >= 0.65;
}

      const { items: retrieved, topScore } = await hybridRetrieve(message, slimHistory, topK);
      trackEvent("chat_query", message.slice(0, 120));
      let confidence = scoreToConfidence(topScore);

      // FAQ_FAST_PATH: high-confidence FAQ hit → answer without LLM (seconds → ms)
      // Fixes multi-minute waits on "who is the principal" when Ollama is cold/slow.
      const top = retrieved[0];
      const faqFast =
        process.env.FAQ_FAST_PATH !== "0" &&
        retrieved.length > 0 &&
        top?.kind === "faq" &&
        topScore >= Number(process.env.FAQ_FAST_MIN_SCORE ?? 4) &&
        isFaqFastMatch(message, top);
      if (faqFast && top) {
        // FAQ retrieve text is "Q: ...\nA: ..."
        let answer = top.text;
        const aIdx = answer.indexOf("\nA:");
        if (aIdx >= 0) answer = answer.slice(aIdx + 3).trim();
        const sources: SourceRef[] = top.source
          ? [{ url: top.source, title: top.title }]
          : [];
        setCachedAnswer(message, {
          text: answer,
          sources,
          confidence: "high",
          topScore,
        });
        close({
          text: answer,
          sources,
          followUps: getFollowUps(top.category, message),
          confidence: "high",
          topScore,
        });
        return;
      }
      const mayNeedCurrentInfo = needsCurrentInfo(message);
      const explicitSearchRequest = isDeepResearchRequest(message);
      const webSearchAvailable = isWebSearchConfigured();

      const route = routeQuery(message, { topScore, freeMode });
      const shouldSearch =
        webSearchAvailable &&
        (explicitSearchRequest || shouldRunWebSearch(route));

      let webContextBlock = "";
      let webSources: SourceRef[] = [];
      let webSearchAttempted = false;

      if (shouldSearch) {
        webSearchAttempted = true;
        // Prefer official site + college name in the query for better results
        const searchQuery = message.toLowerCase().includes("gcetly") ||
          message.toLowerCase().includes("gce tirunelveli") ||
          message.toLowerCase().includes("government college of engineering")
          ? message
          : `${message} GCE Tirunelveli OR gcetly.ac.in`;

        const web = await liveWebSearch(searchQuery, { signal: req.signal });
        if (web.results.length > 0) {
          webContextBlock = formatWebResultsForPrompt(web.results);
          webSources = webResultsToSources(web.results);
          // If local was "none" but web found something, promote confidence
          // so we don't hard-refuse; the model still has to ground in CONTEXT.
          if (confidence === "none") confidence = "low";
        }
      }

      // Hard refusal only when BOTH local and web have nothing useful
      // (and user did not explicitly ask for deep research).
      if (confidence === "none" && webSources.length === 0 && !explicitSearchRequest) {
        close({
          text: fallbackFor(language),
          sources: [],
          followUps: getFollowUps(undefined, message),
          confidence: "none",
          topScore,
        });
        return;
      }

      const systemPrompt = buildSystemPrompt({
        retrieved,
        language,
        mayNeedCurrentInfo,
        explicitSearchRequest,
        webContextBlock,
        webSearchAttempted,
        webSearchAvailable,
      });
      const llmMessages = [...slimHistory, { role: "user" as const, content: message }];
      const localSources: SourceRef[] = Array.from(
        new Map(retrieved.map((r) => [r.source, { url: r.source, title: r.title }])).values()
      );
      const followUps = getFollowUps(retrieved[0]?.category, message);

      try {
        let assembled = "";
        for await (const event of streamChat({
          systemPrompt,
          messages: llmMessages,
          useWebSearch: false, // search already done above; ollama client ignores this
          abortSignal: req.signal,
        })) {
          if (event.type === "text") {
            assembled += event.text;
            controller.enqueue(sseEncode({ type: "text", text: event.text }));
          } else if (event.type === "retrying") {
            controller.enqueue(
              sseEncode({
                type: "retrying",
                attempt: event.attempt,
                maxAttempts: event.maxAttempts,
                delayMs: event.delayMs,
              })
            );
          } else if (event.type === "done") {
            const merged = new Map<string, SourceRef>();
            for (const s of [...localSources, ...webSources, ...event.webSources]) {
              if (!merged.has(s.url)) merged.set(s.url, s);
            }
            const sources = Array.from(merged.values());
            if (assembled.trim() && slimHistory.length === 0) {
              setCachedAnswer(message, {
                text: assembled,
                sources,
                confidence,
                topScore,
              });
            }
            controller.enqueue(
              sseEncode({
                type: "done",
                sources,
                language,
                followUps,
                confidence,
                topScore,
              })
            );
          } else if (event.type === "aborted") {
            controller.enqueue(sseEncode({ type: "aborted" }));
          } else if (event.type === "error") {
            // Graceful degradation: surface a clear message when Ollama is unreachable
            const msg =
              event.error.includes("ECONNREFUSED") ||
              event.error.includes("fetch failed") ||
              event.error.toLowerCase().includes("ollama")
                ? "The local AI model is currently unavailable. Please try again in a moment, or visit https://gcetly.ac.in for official information."
                : event.error;
            controller.enqueue(sseEncode({ type: "error", error: msg, retryable: event.retryable }));
          }
        }
      } catch (err) {
        const raw = err instanceof Error ? err.message : "Unknown server error";
        const msg =
          raw.includes("ECONNREFUSED") || raw.includes("fetch failed")
            ? "The local AI model is currently unavailable. Please try again in a moment, or visit https://gcetly.ac.in for official information."
            : raw;
        controller.enqueue(sseEncode({ type: "error", error: msg, retryable: false }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
