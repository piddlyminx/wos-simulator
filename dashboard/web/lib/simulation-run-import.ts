import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual, promisify } from "node:util";
import { gunzip } from "node:zlib";
import { buildSimulationRunTitle, isSavedSimulationKind, type SavedSimulationRunDocument } from "./simulate-run";
import {
  assertSavedSimulationDoc, assertSimulationRunId, assertSimulationRunOwner,
  decodeSimulationRun, gzipDocument, withSimulationRunTransaction,
} from "./simulation-store";

type LegacyIndexRecord = {
  id: string; kind: string; created_at: string; title: string; kept: boolean; owner_hash?: string;
};
export interface SimulationRunImportOptions {
  inputDir: string;
  verifyOnly?: boolean;
}
export interface SimulationRunImportReport {
  source_runs: number;
  normalized_legacy_runs: number;
  imported_runs: number;
  matched_runs: number;
  verified_runs: number;
  kept_runs: number;
  owned_runs: number;
  kinds: Record<string, number>;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is malformed`);
  return value as Record<string, unknown>;
}

const gunzipLegacy = promisify(gunzip);

function importedKind(kind: unknown): unknown {
  return kind === "surface_sweep" ? "ratio_explorer" : kind;
}

export async function importSimulationRuns(options: SimulationRunImportOptions): Promise<SimulationRunImportReport> {
  const inputDir = path.resolve(options.inputDir);
  const entries = await readdir(inputDir, { withFileTypes: true });
  const sources = new Map<string, string>();
  const sidecars = new Map<string, string>();
  const keptIds = new Set<string>();
  for (const entry of entries) {
    const match = /^(.*?)\.(json\.gz|meta\.json|json|keep)$/.exec(entry.name);
    if (!match || entry.name.startsWith(".")) continue;
    if (!entry.isFile()) throw new Error(`Legacy source is not a regular file: ${entry.name}`);
    const [, id, extension] = match;
    assertSimulationRunId(id);
    if (extension === "keep") keptIds.add(id);
    else if (extension === "meta.json") sidecars.set(id, entry.name);
    else if (extension === "json.gz" || !sources.has(id)) sources.set(id, entry.name);
  }
  for (const id of [...sidecars.keys(), ...keptIds]) {
    if (!sources.has(id)) throw new Error(`Legacy metadata has no document: ${id}`);
  }
  const index = new Map<string, LegacyIndexRecord>();
  if (entries.some((entry) => entry.name === ".runs-index.json")) {
    const parsed = object(JSON.parse(await readFile(path.join(inputDir, ".runs-index.json"), "utf8")), "Legacy index");
    if (parsed.version !== 1 || !Array.isArray(parsed.runs)) throw new Error("Legacy index is malformed");
    for (const value of parsed.runs) {
      const record = object(value, "Legacy index record");
      if (typeof record.id !== "string") throw new Error("Legacy index record has no id");
      assertSimulationRunId(record.id);
      if (index.has(record.id)) throw new Error(`Duplicate legacy index id: ${record.id}`);
      if (!sources.has(record.id)) throw new Error(`Legacy index has no document: ${record.id}`);
      record.kind = importedKind(record.kind);
      if (!isSavedSimulationKind(record.kind) || typeof record.created_at !== "string" ||
          typeof record.title !== "string" || typeof record.kept !== "boolean") {
        throw new Error(`Legacy index record is malformed: ${record.id}`);
      }
      if (record.owner_hash !== undefined && typeof record.owner_hash !== "string") throw new Error(`Invalid legacy owner: ${record.id}`);
      assertSimulationRunOwner(record.owner_hash as string | undefined);
      index.set(record.id, record as LegacyIndexRecord);
    }
  }
  const report: SimulationRunImportReport = {
    source_runs: sources.size, normalized_legacy_runs: 0, imported_runs: 0, matched_runs: 0, verified_runs: 0,
    kept_runs: 0, owned_runs: 0, kinds: {},
  };
  // One document at a time bounds both FS concurrency and decompressed payload memory.
  // In particular no Promise.all over thousands of SSHFS files can starve libuv workers.
  for (const [id, filename] of sources) {
    const bytes = await readFile(path.join(inputDir, filename));
    const raw = object(JSON.parse(
      (filename.endsWith(".gz") ? await gunzipLegacy(bytes) : bytes).toString("utf8"),
    ), `Legacy document ${filename}`);
    const normalizedKind = raw.kind === "surface_sweep";
    raw.kind = importedKind(raw.kind);
    const doc = assertSavedSimulationDoc(raw);
    if (doc.id !== id) throw new Error(`Legacy filename/document identity mismatch: ${filename}`);
    const indexed = index.get(id);
    const kept = keptIds.has(id);
    let ownerHash: string | undefined;
    const embeddedOwner = (doc as SavedSimulationRunDocument & { owner_hash?: unknown }).owner_hash;
    if (embeddedOwner !== undefined && typeof embeddedOwner !== "string") throw new Error(`Invalid embedded owner: ${id}`);
    assertSimulationRunOwner(embeddedOwner as string | undefined);
    ownerHash = embeddedOwner as string | undefined;
    const sidecar = sidecars.get(id);
    if (sidecar) {
      const meta = object(JSON.parse(await readFile(path.join(inputDir, sidecar), "utf8")), `Legacy sidecar ${id}`);
      meta.kind = importedKind(meta.kind);
      if (meta.version !== doc.version || meta.id !== id || meta.kind !== doc.kind ||
          meta.created_at !== doc.created_at || !isDeepStrictEqual(meta.request, doc.request)) {
        throw new Error(`Legacy sidecar/document mismatch: ${id}`);
      }
      if (meta.owner_hash !== undefined && typeof meta.owner_hash !== "string") throw new Error(`Invalid legacy owner: ${id}`);
      assertSimulationRunOwner(meta.owner_hash as string | undefined);
      if (ownerHash !== undefined && ownerHash !== meta.owner_hash) throw new Error(`Legacy owner mismatch: ${id}`);
      ownerHash = meta.owner_hash as string | undefined;
    }
    if (indexed) {
      if (indexed.kind !== doc.kind || indexed.created_at !== doc.created_at || indexed.kept !== kept ||
          ((sidecar || ownerHash !== undefined) && indexed.owner_hash !== ownerHash)) {
        throw new Error(`Legacy index/document metadata mismatch: ${id}`);
      }
      ownerHash ??= indexed.owner_hash;
    }
    const title = indexed?.title ?? buildSimulationRunTitle(doc.request, doc.kind);
    const payload = normalizedKind
      ? await gzipDocument(Buffer.from(JSON.stringify(doc), "utf8"))
      : filename.endsWith(".gz") ? bytes : await gzipDocument(bytes);
    await withSimulationRunTransaction(async (client) => {
      let inserted = false;
      if (!options.verifyOnly) {
        const result = await client.query(
          `INSERT INTO saved_simulation_runs
           (id, kind, created_at, created_at_text, title, kept, owner_hash, payload, payload_size)
           VALUES ($1, $2, $3::text::timestamptz, $3::text, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
          [id, doc.kind, doc.created_at, title, kept, ownerHash ?? null, payload, payload.length],
        );
        inserted = result.rowCount === 1;
      }
      const result = await client.query<{
        kind: string; created_at_text: string; created_matches: boolean; title: string; kept: boolean;
        owner_hash: string | null; payload: Buffer; payload_size: string;
      }>(
        `SELECT kind, created_at_text, created_at = created_at_text::timestamptz AS created_matches,
         title, kept, owner_hash, payload, payload_size FROM saved_simulation_runs WHERE id = $1 FOR UPDATE`, [id],
      );
      const row = result.rows[0];
      if (!row) throw new Error(`Missing database run: ${id}`);
      const storedDoc = await decodeSimulationRun(row.payload);
      if (!isDeepStrictEqual(storedDoc, doc) || row.kind !== doc.kind || row.created_at_text !== doc.created_at ||
          !row.created_matches || row.title !== title ||
          row.owner_hash !== (ownerHash ?? null) || Number(row.payload_size) !== row.payload.length) {
        throw new Error(`Database document/metadata conflict: ${id}`);
      }
      if (row.kept !== kept) throw new Error(`Database kept flag conflict: ${id}`);
      if (inserted) report.imported_runs++;
      else report.matched_runs++;
      report.verified_runs++;
    });
    report.normalized_legacy_runs += Number(normalizedKind);
    report.kept_runs += Number(kept);
    report.owned_runs += Number(ownerHash !== undefined);
    report.kinds[doc.kind] = (report.kinds[doc.kind] ?? 0) + 1;
  }
  return report;
}
