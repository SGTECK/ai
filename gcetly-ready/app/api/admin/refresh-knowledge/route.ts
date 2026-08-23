import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import { rejectUnlessAdmin } from "@/lib/adminGuard";
import { invalidateRetrievalCache } from "@/lib/retrieval";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Admin-only: rebuild data/gcetly-knowledge.auto.json from the last crawl
 * output (scripts/update-knowledge.ts), then invalidate the in-memory
 * retrieval cache so the next chat request picks up the new entries.
 *
 * This does NOT start a full multi-site web crawl (that can take many
 * minutes and belongs in CI / CLI: `npm run crawl -- --with-recommended-sites`).
 * It only reprocesses whatever is already under data/crawled/.
 */
export async function POST(req: NextRequest) {
  const denied = await rejectUnlessAdmin(req, { rateLimit: false });
  if (denied) return denied;

  const projectRoot = process.cwd();
  const script = path.join(projectRoot, "scripts", "update-knowledge.ts");

  try {
    const result = await runUpdateKnowledge(script, projectRoot);
    // Force retrieval layer to re-read knowledge files on next request
    invalidateRetrievalCache();

    return NextResponse.json({
      ok: true,
      message: "Knowledge base rebuilt from last crawl and retrieval cache cleared.",
      stdout: result.stdout.slice(-2000),
      stderr: result.stderr.slice(-1000),
      exitCode: result.code,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Refresh failed",
      },
      { status: 500 }
    );
  }
}

function runUpdateKnowledge(
  scriptPath: string,
  cwd: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", scriptPath], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("update-knowledge timed out after 90s"));
    }, 90_000);

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}
