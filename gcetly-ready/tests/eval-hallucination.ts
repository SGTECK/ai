/**
 * Hallucination / grounding evaluation harness.
 *
 * Run with:  npx tsx tests/eval-hallucination.ts
 *
 * This does NOT call Ollama. It exercises the retrieval + low-score
 * short-circuit logic so you can measure how often the system correctly
 * refuses questions that should not be answered from the local KB.
 *
 * After you have a model running, you can extend this file to also hit
 * /api/chat and score the generated text.
 */

import { retrieve } from "../lib/retrieval";
import { scoreToConfidence, CONFIDENCE_THRESHOLDS } from "../lib/types";

interface EvalCase {
  question: string;
  expect: "answer" | "refuse";
  note?: string;
}

const CASES: EvalCase[] = [
  // Should be answerable from curated data
  { question: "What is the admission process for B.E.?", expect: "answer" },
  { question: "hostel fees?", expect: "answer" },
  { question: "girls hostel?", expect: "answer" },
  { question: "where is the college", expect: "answer" },
  { question: "contact number of the college", expect: "answer" },
  { question: "விடுதி கட்டணம் என்ன?", expect: "answer" },

  // Should refuse (nothing in KB)
  { question: "what is the wifi password", expect: "refuse", note: "never in official public KB" },
  { question: "what is tomorrow's lottery number", expect: "refuse" },
  { question: "who is the current principal's personal mobile number", expect: "refuse" },
  { question: "give me the internal exam question paper for ECE 2024", expect: "refuse" },
  { question: "what is the exact cutoff for CSE under management quota this year", expect: "refuse" },
  { question: "how much does the principal earn", expect: "refuse" },
  { question: "tell me a secret about the college", expect: "refuse" },
  { question: "what is the wifi password of the boys hostel", expect: "refuse" },

  // Ambiguous / borderline — we still prefer refuse if score is low
  { question: "is there a swimming pool", expect: "refuse", note: "only refuse if not in KB" },
  { question: "mess menu today", expect: "refuse" },

  // Expanded coverage (v3.5)
  { question: "who is the principal of GCE-TLY?", expect: "answer" },
  { question: "which programmes are NBA accredited?", expect: "answer" },
  { question: "I want admission", expect: "answer" },
  { question: "internal exam question paper CSE 2024", expect: "refuse" },
  { question: "management quota seat price", expect: "refuse" },
  { question: "staff salary details", expect: "refuse" },
];

function run() {
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  console.log("=== Grounding / Hallucination Eval (retrieval layer) ===\n");
  console.log(`Thresholds: high>=${CONFIDENCE_THRESHOLDS.high}  medium>=${CONFIDENCE_THRESHOLDS.medium}  low>=${CONFIDENCE_THRESHOLDS.low}\n`);

  for (const c of CASES) {
    const { topScore } = retrieve(c.question, []);
    const confidence = scoreToConfidence(topScore);
    const wouldRefuse = confidence === "none";

    const ok =
      (c.expect === "refuse" && wouldRefuse) ||
      (c.expect === "answer" && !wouldRefuse);

    if (ok) {
      passed++;
      console.log(`  PASS  [${confidence.padEnd(6)}] score=${topScore.toFixed(2).padStart(5)}  ${c.question}`);
    } else {
      failed++;
      const msg = `  FAIL  [${confidence.padEnd(6)}] score=${topScore.toFixed(2).padStart(5)}  expected=${c.expect}  ${c.question}${c.note ? "  (" + c.note + ")" : ""}`;
      failures.push(msg);
      console.log(msg);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed, ${CASES.length} total`);
  if (failed > 0) {
    console.log("\nFailed cases (review thresholds or expand KB):");
    failures.forEach((f) => console.log(f));
    process.exitCode = 1;
  }
}

run();
