import { getDb } from "../lib/db";
import { indexApprovedDocument } from "../lib/documentProcess";
import { invalidateRetrievalCache } from "../lib/retrieval";

async function main() {
  const rows = getDb()
    .prepare(`SELECT id, title FROM documents WHERE verification_status = 'verified'`)
    .all() as { id: string; title: string }[];
  console.log(`Reindexing ${rows.length} verified documents...`);
  for (const r of rows) {
    const result = await indexApprovedDocument(r.id);
    console.log(r.title, result);
  }
  invalidateRetrievalCache();
  console.log("Done.");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
