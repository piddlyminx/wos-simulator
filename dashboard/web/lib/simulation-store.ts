import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import { Pool, type PoolClient } from "pg";

import {
  buildSimulationShareUrl,
  buildSimulationRunTitle,
  isSavedSimulationKind,
  type SavedSimulationKind,
  type SavedSimulationRequest,
  type SavedSimulationResult,
  type SavedSimulationRunListItem,
  type SavedSimulationRunDocument,
  type SavedSimulationRunResponse,
} from "./simulate-run";

const ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
const OWNER_HASH_RE = /^[a-f0-9]{64}$/;
export const gzipDocument = promisify(gzip);
const gunzipDocument = promisify(gunzip);

// Next route bundles and HMR share one pool per connection string.
const poolState = globalThis as typeof globalThis & {
  simulationRunPools?: Map<string, Pool>;
};
export function simulationRunPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for saved simulation runs");
  const pools = (poolState.simulationRunPools ??= new Map());
  let pool = pools.get(url);
  if (!pool) {
    pool = new Pool({ connectionString: url, max: 10 });
    pool.on("error", (error: Error) => console.error("Saved-run PostgreSQL pool error", error));
    pools.set(url, pool);
  }
  return pool;
}

export async function withSimulationRunTransaction<T>(
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await simulationRunPool().connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export interface SimulationRunListOptions {
  limit?: number;
  offset?: number;
  kinds?: readonly SavedSimulationKind[];
  ownerHash?: string;
  kept?: boolean;
}
export interface SimulationRunListPage {
  runs: SavedSimulationRunListItem[];
  has_more: boolean;
  next_offset: number;
}
export interface SimulationRunCleanupOptions {
  retentionDays?: number;
  maxStorageBytes?: number;
  now?: number;
}
export interface SimulationRunCleanupResult {
  deleted_runs: number;
  deleted_bytes: number;
  kept_runs: number;
  remaining_runs: number;
  remaining_bytes: number;
}

export function assertSimulationRunId(id: string): void {
  if (!ID_RE.test(id)) throw new Error("Invalid saved simulation id");
}
export function assertSimulationRunOwner(ownerHash: string | undefined): void {
  if (ownerHash !== undefined && !OWNER_HASH_RE.test(ownerHash)) {
    throw new Error("Invalid saved simulation owner hash");
  }
}
export function assertSavedSimulationDoc(value: unknown): SavedSimulationRunDocument {
  if (!value || typeof value !== "object") throw new Error("Saved simulation document is missing");
  const doc = value as Partial<SavedSimulationRunDocument>;
  if (
    doc.version !== 1 || typeof doc.id !== "string" || !ID_RE.test(doc.id) ||
    !isSavedSimulationKind(doc.kind) || typeof doc.created_at !== "string" ||
    !Number.isFinite(Date.parse(doc.created_at)) || doc.request === undefined ||
    !doc.result || typeof doc.result !== "object"
  ) throw new Error("Saved simulation document is malformed");
  return doc as SavedSimulationRunDocument;
}
export async function decodeSimulationRun(payload: Buffer): Promise<SavedSimulationRunDocument> {
  return assertSavedSimulationDoc(JSON.parse((await gunzipDocument(payload)).toString("utf8")));
}
function withShareUrl(doc: SavedSimulationRunDocument, kept = false): SavedSimulationRunResponse {
  // Ownership is private indexed metadata, never part of the HTTP document.
  const publicDoc = { ...doc } as SavedSimulationRunDocument & { owner_hash?: string };
  delete publicDoc.owner_hash;
  return { ...publicDoc, kept, share_url: buildSimulationShareUrl(doc.id, doc.kind) };
}

export async function saveSimulationRun(
  kind: SavedSimulationKind,
  request: SavedSimulationRequest,
  result: SavedSimulationResult,
  ownerHash?: string,
): Promise<SavedSimulationRunResponse> {
  assertSimulationRunOwner(ownerHash);
  const doc = assertSavedSimulationDoc({
    version: 1, id: randomUUID(), kind, created_at: new Date().toISOString(), request, result,
  });
  const payload = await gzipDocument(Buffer.from(JSON.stringify(doc), "utf8"));
  // A single INSERT commits payload and all listing/authorization metadata atomically.
  await simulationRunPool().query(
    `INSERT INTO saved_simulation_runs
      (id, kind, created_at, created_at_text, title, kept, owner_hash, payload, payload_size)
     VALUES ($1, $2, $3::text::timestamptz, $3::text, $4, false, $5, $6, $7)`,
    [doc.id, kind, doc.created_at, buildSimulationRunTitle(request, kind), ownerHash ?? null, payload, payload.length],
  );
  return withShareUrl(doc);
}

export async function readSimulationRun(id: string): Promise<SavedSimulationRunResponse | null> {
  assertSimulationRunId(id);
  const result = await simulationRunPool().query<{ payload: Buffer; kept: boolean }>(
    "SELECT payload, kept FROM saved_simulation_runs WHERE id = $1", [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  const doc = await decodeSimulationRun(row.payload);
  if (doc.id !== id) throw new Error("Saved simulation document identity mismatch");
  return withShareUrl(doc, row.kept);
}

export async function setSimulationRunKept(
  id: string, kept: boolean, ownerHash?: string,
): Promise<boolean | null | undefined> {
  assertSimulationRunOwner(ownerHash);
  assertSimulationRunId(id);
  return withSimulationRunTransaction(async (client) => {
    // Acquire the write table lock before the row lock: maintenance must not race
    // an authorization check or force a row-lock/table-lock upgrade deadlock.
    await client.query("LOCK TABLE saved_simulation_runs IN ROW EXCLUSIVE MODE");
    const result = await client.query<{ owner_hash: string | null }>(
      "SELECT owner_hash FROM saved_simulation_runs WHERE id = $1 FOR UPDATE", [id],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (ownerHash !== undefined && row.owner_hash !== ownerHash) return undefined;
    await client.query("UPDATE saved_simulation_runs SET kept = $2 WHERE id = $1", [id, kept]);
    return kept;
  });
}

export async function listSimulationRuns(limit = 20): Promise<SavedSimulationRunListItem[]> {
  return (await listSimulationRunsPage({ limit })).runs;
}
export async function listSimulationRunsPage(options: SimulationRunListOptions = {}): Promise<SimulationRunListPage> {
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 20)));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const params: unknown[] = [];
  const filters: string[] = [];
  if (options.kinds?.length) {
    params.push(options.kinds);
    filters.push(`kind = ANY($${params.length}::text[])`);
  }
  if (options.ownerHash !== undefined) {
    params.push(options.ownerHash);
    filters.push(`owner_hash = $${params.length}`);
  }
  if (options.kept !== undefined) {
    params.push(options.kept);
    filters.push(`kept = $${params.length}`);
  }
  params.push(limit + 1, offset);
  const result = await simulationRunPool().query<Omit<SavedSimulationRunListItem, "share_url">>(
    `SELECT id, kind, created_at_text AS created_at, title, kept FROM saved_simulation_runs
     ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
     ORDER BY saved_simulation_runs.created_at DESC, id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params,
  );
  const runs = result.rows.slice(0, limit).map((row) => ({
    ...row, share_url: buildSimulationShareUrl(row.id, row.kind),
  }));
  return { runs, has_more: result.rows.length > limit, next_offset: offset + runs.length };
}

function numericEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
export function simulationRunRetentionPolicy(): { retentionDays: number; maxStorageBytes: number } {
  return {
    retentionDays: numericEnv("SIM_RUNS_RETENTION_DAYS", 30),
    maxStorageBytes: numericEnv("SIM_RUNS_MAX_STORAGE_MB", 500) * 1024 * 1024,
  };
}

export async function cleanupSimulationRuns(options: SimulationRunCleanupOptions = {}): Promise<SimulationRunCleanupResult> {
  const policy = simulationRunRetentionPolicy();
  const retentionDays = options.retentionDays ?? policy.retentionDays;
  const maxStorageBytes = options.maxStorageBytes ?? policy.maxStorageBytes;
  const now = options.now ?? Date.now();
  if (![retentionDays, maxStorageBytes, now].every(Number.isFinite) || retentionDays < 0 || maxStorageBytes < 0) {
    throw new Error("Invalid saved-run cleanup policy");
  }
  return withSimulationRunTransaction(async (client) => {
    // Explicit maintenance serializes with inserts/keeps from every process. Reads remain available.
    await client.query("LOCK TABLE saved_simulation_runs IN SHARE ROW EXCLUSIVE MODE");
    const result = await client.query<{ id: string; kept: boolean; created_ms: string; payload_size: string }>(
      "SELECT id, kept, extract(epoch FROM created_at) * 1000 AS created_ms, payload_size FROM saved_simulation_runs ORDER BY created_at, id",
    );
    let remainingBytes = result.rows.reduce((sum, row) => sum + Number(row.payload_size), 0);
    let deletedBytes = 0;
    const deletedIds: string[] = [];
    for (const row of result.rows) {
      if (row.kept) continue;
      const expired = retentionDays > 0 && Number(row.created_ms) < now - retentionDays * 86400000;
      if (!expired && !(maxStorageBytes > 0 && remainingBytes > maxStorageBytes)) continue;
      deletedIds.push(row.id);
      remainingBytes -= Number(row.payload_size);
      deletedBytes += Number(row.payload_size);
    }
    if (deletedIds.length) {
      await client.query("DELETE FROM saved_simulation_runs WHERE id = ANY($1::text[]) AND NOT kept", [deletedIds]);
    }
    return {
      deleted_runs: deletedIds.length, deleted_bytes: deletedBytes,
      kept_runs: result.rows.filter((row) => row.kept).length,
      remaining_runs: result.rows.length - deletedIds.length, remaining_bytes: remainingBytes,
    };
  });
}
