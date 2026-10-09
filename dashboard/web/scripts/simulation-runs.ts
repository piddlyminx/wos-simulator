import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { importSimulationRuns } from "../lib/simulation-run-import";
import { cleanupSimulationRuns, simulationRunPool, withSimulationRunTransaction } from "../lib/simulation-store";

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "migrate") {
    const { values } = parseArgs({ args: process.argv.slice(3), options: { schema: { type: "string" } } });
    const sql = await readFile(values.schema ?? path.resolve(process.cwd(), "../postgres/schema.sql"), "utf8");
    await withSimulationRunTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(1936289138, 1)");
      await client.query(sql);
    });
    console.log(JSON.stringify({ migrated: true, table: "saved_simulation_runs" }));
  } else if (command === "import") {
    const { values } = parseArgs({
      args: process.argv.slice(3), options: {
        "input-dir": { type: "string" }, "verify-only": { type: "boolean", default: false },
      },
    });
    if (!values["input-dir"]) throw new Error("--input-dir is required");
    const start = performance.now();
    const report = await importSimulationRuns({ inputDir: values["input-dir"], verifyOnly: values["verify-only"] });
    console.log(JSON.stringify({ ...report, elapsed_ms: Math.round(performance.now() - start) }));
  } else if (command === "cleanup") {
    const { values } = parseArgs({ args: process.argv.slice(3), options: {
      "retention-days": { type: "string" }, "max-storage-mb": { type: "string" },
    } });
    for (const [name, raw] of Object.entries(values)) {
      if (raw !== undefined && (raw.trim() === "" || !Number.isFinite(Number(raw)) || Number(raw) < 0)) {
        throw new Error(`Invalid --${name}`);
      }
    }
    console.log(JSON.stringify(await cleanupSimulationRuns({
      retentionDays: values["retention-days"] === undefined ? undefined : Number(values["retention-days"]),
      maxStorageBytes: values["max-storage-mb"] === undefined ? undefined : Number(values["max-storage-mb"]) * 1024 * 1024,
    })));
  } else {
    throw new Error("Usage: simulation-runs.ts migrate [--schema PATH] | import --input-dir PATH [--verify-only] | cleanup [--retention-days N] [--max-storage-mb N]");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(async () => {
  if (process.env.DATABASE_URL) await simulationRunPool().end();
});
