import { randomUUID } from "crypto";
import { mkdirSync, promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import { gunzip, gzip } from "zlib";

import { withDirectoryLock } from "@/lib/file-lock";
import { resolveSimulatorRoot } from "@/lib/simulator-root";
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
} from "@/lib/simulate-run";

const ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
const LIST_READ_BATCH_SIZE = 32;
const LIST_HEADER_CHUNK_SIZE = 64 * 1024;
const LIST_HEADER_LIMIT = 256 * 1024;
const RESULT_FIELD_MARKER = /,\r?\n  "result":/;
const AUTO_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_MAX_STORAGE_MB = 500;
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

const listItemCache = new Map<
  string,
  { modifiedAt: number; kept: boolean; item: SavedSimulationRunListItem }
>();

let autoCleanupPromise: Promise<void> | null = null;

export const SIM_RUNS_DIR =
  process.env.SIM_RUNS_DIR ??
  path.join(resolveSimulatorRoot(), "tmp", "simulate-runs");

export interface SimulationRunListOptions {
  limit?: number;
  offset?: number;
  kinds?: readonly SavedSimulationKind[];
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

interface RunCandidate {
  id: string;
  headerPath: string;
  dataPath: string;
  modifiedAt: number;
  compressed: boolean;
}

function assertRunId(id: string): void {
  if (!ID_RE.test(id)) {
    throw new Error(`Invalid saved simulation id: ${id}`);
  }
}

function legacyRunPath(id: string): string {
  assertRunId(id);
  return path.join(SIM_RUNS_DIR, `${id}.json`);
}

function compressedRunPath(id: string): string {
  assertRunId(id);
  return path.join(SIM_RUNS_DIR, `${id}.json.gz`);
}

function metadataPath(id: string): string {
  assertRunId(id);
  return path.join(SIM_RUNS_DIR, `${id}.meta.json`);
}

function keepPath(id: string): string {
  assertRunId(id);
  return path.join(SIM_RUNS_DIR, `${id}.keep`);
}

function withShareUrl(
  doc: SavedSimulationRunDocument,
): SavedSimulationRunResponse {
  return {
    ...doc,
    kept: doc.kept ?? false,
    share_url: buildSimulationShareUrl(doc.id, doc.kind),
  };
}

function assertSavedSimulationDoc(
  value: unknown,
): SavedSimulationRunDocument {
  if (!value || typeof value !== "object") {
    throw new Error("Saved simulation document is missing");
  }
  const doc = value as Partial<SavedSimulationRunDocument>;
  if (
    doc.version !== 1 ||
    typeof doc.id !== "string" ||
    !ID_RE.test(doc.id) ||
    !isSavedSimulationKind(doc.kind) ||
    typeof doc.created_at !== "string" ||
    doc.request === undefined ||
    doc.result === undefined
  ) {
    throw new Error("Saved simulation document is malformed");
  }
  return doc as SavedSimulationRunDocument;
}

function assertSavedSimulationListDoc(
  value: unknown,
): Omit<SavedSimulationRunDocument, "result"> {
  if (!value || typeof value !== "object") {
    throw new Error("Saved simulation document is missing");
  }
  const doc = value as Partial<SavedSimulationRunDocument>;
  if (
    doc.version !== 1 ||
    typeof doc.id !== "string" ||
    !ID_RE.test(doc.id) ||
    !isSavedSimulationKind(doc.kind) ||
    typeof doc.created_at !== "string" ||
    doc.request === undefined
  ) {
    throw new Error("Saved simulation document is malformed");
  }
  return doc as Omit<SavedSimulationRunDocument, "result">;
}

async function readSimulationRunListItem(
  candidate: RunCandidate,
  kept: boolean,
): Promise<SavedSimulationRunListItem> {
  if (candidate.compressed) {
    const value = JSON.parse(await fs.readFile(candidate.headerPath, "utf8"));
    const doc = assertSavedSimulationListDoc(value);
    return {
      id: doc.id,
      kind: doc.kind,
      created_at: doc.created_at,
      kept,
      share_url: buildSimulationShareUrl(doc.id, doc.kind),
      title: buildSimulationRunTitle(doc.request, doc.kind),
    };
  }

  const handle = await fs.open(candidate.headerPath, "r");
  const chunks: Buffer[] = [];
  let bytesReadTotal = 0;
  let raw = "";

  try {
    while (bytesReadTotal < LIST_HEADER_LIMIT) {
      const chunk = Buffer.allocUnsafe(LIST_HEADER_CHUNK_SIZE);
      const { bytesRead } = await handle.read(
        chunk,
        0,
        chunk.length,
        bytesReadTotal,
      );
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      bytesReadTotal += bytesRead;
      raw = Buffer.concat(chunks).toString("utf8");
      if (RESULT_FIELD_MARKER.test(raw)) break;
    }
  } finally {
    await handle.close();
  }

  const marker = raw.match(RESULT_FIELD_MARKER);
  const value = marker
    ? JSON.parse(`${raw.slice(0, marker.index)}\n}`)
    : JSON.parse(await fs.readFile(candidate.headerPath, "utf8"));
  const doc = assertSavedSimulationListDoc(value);
  return {
    id: doc.id,
    kind: doc.kind,
    created_at: doc.created_at,
    kept,
    share_url: buildSimulationShareUrl(doc.id, doc.kind),
    title: buildSimulationRunTitle(doc.request, doc.kind),
  };
}

async function collectRunCandidates(): Promise<{
  candidates: RunCandidate[];
  keptIds: Set<string>;
}> {
  let entries;
  try {
    entries = await fs.readdir(SIM_RUNS_DIR, { withFileTypes: true });
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr?.code !== "ENOENT") throw err;
    return { candidates: [], keptIds: new Set() };
  }

  const fileNames = new Set(
    entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
  );
  const keptIds = new Set<string>();
  for (const name of fileNames) {
    if (!name.endsWith(".keep")) continue;
    const id = name.slice(0, -".keep".length);
    if (ID_RE.test(id)) keptIds.add(id);
  }

  const descriptors: Array<{
    id: string;
    headerPath: string;
    dataPath: string;
    compressed: boolean;
  }> = [];
  const compressedIds = new Set<string>();
  for (const name of fileNames) {
    if (!name.endsWith(".meta.json")) continue;
    const id = name.slice(0, -".meta.json".length);
    if (!ID_RE.test(id) || !fileNames.has(`${id}.json.gz`)) continue;
    compressedIds.add(id);
    descriptors.push({
      id,
      headerPath: path.join(SIM_RUNS_DIR, name),
      dataPath: compressedRunPath(id),
      compressed: true,
    });
  }
  for (const name of fileNames) {
    if (!name.endsWith(".json") || name.endsWith(".meta.json")) continue;
    const id = name.slice(0, -".json".length);
    if (!ID_RE.test(id) || compressedIds.has(id)) continue;
    const filePath = path.join(SIM_RUNS_DIR, name);
    descriptors.push({
      id,
      headerPath: filePath,
      dataPath: filePath,
      compressed: false,
    });
  }

  const candidates = (
    await Promise.all(
      descriptors.map(async (candidate) => {
        try {
          const stats = await fs.stat(candidate.headerPath);
          return { ...candidate, modifiedAt: stats.mtimeMs };
        } catch {
          return null;
        }
      }),
    )
  ).filter((candidate) => candidate !== null);
  return { candidates, keptIds };
}

async function writeAtomic(filePath: string, data: string | Buffer): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await fs.writeFile(tempPath, data);
  await fs.rename(tempPath, filePath);
}

export async function saveSimulationRun(
  kind: SavedSimulationKind,
  request: SavedSimulationRequest,
  result: SavedSimulationResult,
): Promise<SavedSimulationRunResponse> {
  const id = randomUUID();
  const doc: SavedSimulationRunDocument = {
    version: 1,
    id,
    kind,
    created_at: new Date().toISOString(),
    request,
    result,
  };

  mkdirSync(SIM_RUNS_DIR, { recursive: true });
  const serialized = Buffer.from(JSON.stringify(doc), "utf8");
  const compressed = await gzipAsync(serialized);
  const metadata = `${JSON.stringify({
    version: doc.version,
    id: doc.id,
    kind: doc.kind,
    created_at: doc.created_at,
    request: doc.request,
  })}\n`;
  await withDirectoryLock(SIM_RUNS_DIR, async () => {
    await writeAtomic(compressedRunPath(id), compressed);
    try {
      await writeAtomic(metadataPath(id), metadata);
    } catch (err) {
      await fs.rm(compressedRunPath(id), { force: true });
      throw err;
    }
  });
  scheduleSimulationRunCleanup();
  return withShareUrl(doc);
}

export async function readSimulationRun(
  id: string,
): Promise<SavedSimulationRunResponse | null> {
  assertRunId(id);
  try {
    let raw: string;
    try {
      const compressed = await fs.readFile(compressedRunPath(id));
      raw = (await gunzipAsync(compressed)).toString("utf8");
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr?.code !== "ENOENT") throw err;
      raw = await fs.readFile(legacyRunPath(id), "utf8");
    }
    const doc = assertSavedSimulationDoc(JSON.parse(raw));
    doc.kept = await fileExists(keepPath(id));
    return withShareUrl(doc);
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr?.code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function setSimulationRunKept(
  id: string,
  kept: boolean,
): Promise<boolean | null> {
  assertRunId(id);
  mkdirSync(SIM_RUNS_DIR, { recursive: true });
  return withDirectoryLock(SIM_RUNS_DIR, async () => {
    if (!(await readSimulationRun(id))) return null;
    if (kept) {
      await writeAtomic(
        keepPath(id),
        `${JSON.stringify({ kept_at: new Date().toISOString() })}\n`,
      );
    } else {
      await fs.rm(keepPath(id), { force: true });
    }
    listItemCache.delete(id);
    return kept;
  });
}

export async function listSimulationRuns(
  limit = 20,
): Promise<SavedSimulationRunListItem[]> {
  return (await listSimulationRunsPage({ limit })).runs;
}

export async function listSimulationRunsPage(
  options: SimulationRunListOptions = {},
): Promise<SimulationRunListPage> {
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 20)));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const kindSet =
    options.kinds && options.kinds.length > 0
      ? new Set(options.kinds)
      : null;
  const { candidates, keptIds } = await collectRunCandidates();
  candidates
    .sort(
      (a, b) =>
        b.modifiedAt - a.modifiedAt || b.id.localeCompare(a.id),
    );

  const requiredCount = offset + limit + 1;
  const matchingRuns: SavedSimulationRunListItem[] = [];
  let start = 0;
  while (start < candidates.length && matchingRuns.length < requiredCount) {
    const batchSize = Math.min(
      LIST_READ_BATCH_SIZE,
      requiredCount - matchingRuns.length,
    );
    const batch = candidates.slice(start, start + batchSize);
    start += batch.length;
    const batchRuns = await Promise.all(
      batch.map(async (candidate) => {
        const kept = keptIds.has(candidate.id);
        const cached = listItemCache.get(candidate.id);
        if (
          cached?.modifiedAt === candidate.modifiedAt &&
          cached.kept === kept
        ) return cached.item;
        try {
          const item = await readSimulationRunListItem(candidate, kept);
          listItemCache.set(candidate.id, {
            modifiedAt: candidate.modifiedAt,
            kept,
            item,
          });
          return item;
        } catch {
          // Ignore partial or stale scratch files so one bad save does not
          // break the recent-run picker.
          return null;
        }
      }),
    );
    for (const run of batchRuns) {
      if (run && (!kindSet || kindSet.has(run.kind))) matchingRuns.push(run);
    }
  }

  const sorted = matchingRuns.sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
  const pageRuns = sorted.slice(offset, offset + limit);
  const page = {
    runs: pageRuns,
    has_more: sorted.length > offset + pageRuns.length,
    next_offset: offset + pageRuns.length,
  };
  scheduleSimulationRunCleanup();
  return page;
}

function numericEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function simulationRunRetentionPolicy(): {
  retentionDays: number;
  maxStorageBytes: number;
} {
  return {
    retentionDays: numericEnv("SIM_RUNS_RETENTION_DAYS", DEFAULT_RETENTION_DAYS),
    maxStorageBytes:
      numericEnv("SIM_RUNS_MAX_STORAGE_MB", DEFAULT_MAX_STORAGE_MB) * 1024 * 1024,
  };
}

async function candidateSize(candidate: RunCandidate): Promise<number> {
  const paths = candidate.compressed
    ? [candidate.dataPath, candidate.headerPath, keepPath(candidate.id)]
    : [candidate.dataPath, keepPath(candidate.id)];
  const sizes = await Promise.all(
    paths.map(async (filePath) => {
      try {
        return (await fs.stat(filePath)).size;
      } catch {
        return 0;
      }
    }),
  );
  return sizes.reduce((sum, size) => sum + size, 0);
}

async function removeCandidate(candidate: RunCandidate): Promise<void> {
  await Promise.all([
    fs.rm(candidate.dataPath, { force: true }),
    fs.rm(metadataPath(candidate.id), { force: true }),
    fs.rm(keepPath(candidate.id), { force: true }),
  ]);
  listItemCache.delete(candidate.id);
}

export async function cleanupSimulationRuns(
  options: SimulationRunCleanupOptions = {},
): Promise<SimulationRunCleanupResult> {
  mkdirSync(SIM_RUNS_DIR, { recursive: true });
  return withDirectoryLock(SIM_RUNS_DIR, async () => {
    const policy = simulationRunRetentionPolicy();
    const retentionDays = options.retentionDays ?? policy.retentionDays;
    const maxStorageBytes = options.maxStorageBytes ?? policy.maxStorageBytes;
    const now = options.now ?? Date.now();
    const cutoff = retentionDays > 0
      ? now - retentionDays * 24 * 60 * 60 * 1000
      : Number.NEGATIVE_INFINITY;
    const { candidates, keptIds } = await collectRunCandidates();
    const records: Array<{
      candidate: RunCandidate;
      kept: boolean;
      createdAt: number;
      size: number;
    }> = [];
    for (
      let start = 0;
      start < candidates.length;
      start += LIST_READ_BATCH_SIZE
    ) {
      const batch = candidates.slice(start, start + LIST_READ_BATCH_SIZE);
      const batchRecords = await Promise.all(
        batch.map(async (candidate) => {
          try {
            const item = await readSimulationRunListItem(
              candidate,
              keptIds.has(candidate.id),
            );
            const createdAt = Date.parse(item.created_at);
            return {
              candidate,
              kept: keptIds.has(candidate.id),
              createdAt: Number.isFinite(createdAt)
                ? createdAt
                : candidate.modifiedAt,
              size: await candidateSize(candidate),
            };
          } catch {
            return null;
          }
        }),
      );
      for (const record of batchRecords) {
        if (record) records.push(record);
      }
    }
    records.sort((a, b) => a.createdAt - b.createdAt);

    let remainingBytes = records.reduce((sum, record) => sum + record.size, 0);
    let remainingRuns = records.length;
    let deletedBytes = 0;
    let deletedRuns = 0;
    for (const record of records) {
      if (record.kept) continue;
      const expired = retentionDays > 0 && record.createdAt < cutoff;
      const overLimit = maxStorageBytes > 0 && remainingBytes > maxStorageBytes;
      if (!expired && !overLimit) continue;
      await removeCandidate(record.candidate);
      remainingBytes -= record.size;
      remainingRuns -= 1;
      deletedBytes += record.size;
      deletedRuns += 1;
    }

    return {
      deleted_runs: deletedRuns,
      deleted_bytes: deletedBytes,
      kept_runs: records.filter((record) => record.kept).length,
      remaining_runs: remainingRuns,
      remaining_bytes: remainingBytes,
    };
  });
}

function scheduleSimulationRunCleanup(): void {
  if (autoCleanupPromise) return;
  autoCleanupPromise = (async () => {
    mkdirSync(SIM_RUNS_DIR, { recursive: true });
    const stampPath = path.join(SIM_RUNS_DIR, ".cleanup-stamp");
    try {
      const stats = await fs.stat(stampPath);
      if (Date.now() - stats.mtimeMs < AUTO_CLEANUP_INTERVAL_MS) return;
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr?.code !== "ENOENT") throw err;
      await writeAtomic(stampPath, `${new Date().toISOString()}\n`);
      return;
    }
    await cleanupSimulationRuns();
    await writeAtomic(stampPath, `${new Date().toISOString()}\n`);
  })()
    .catch((err) => {
      console.error("Saved-run cleanup failed", err);
    })
    .finally(() => {
      autoCleanupPromise = null;
    });
}
