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
const RUN_INDEX_VERSION = 1;
const RUN_INDEX_FILE = ".runs-index.json";
const AUTO_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_MAX_STORAGE_MB = 500;
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

let autoCleanupPromise: Promise<void> | null = null;
let runIndexCache: {
  ino: number;
  modifiedAt: number;
  size: number;
  index: SimulationRunIndex;
} | null = null;

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

interface SimulationRunIndexRecord {
  id: string;
  kind: SavedSimulationKind;
  created_at: string;
  title: string;
  kept: boolean;
  storage: "gzip" | "json";
  modified_at_ms: number;
  size_bytes: number;
}

interface SimulationRunIndex {
  version: typeof RUN_INDEX_VERSION;
  runs: SimulationRunIndexRecord[];
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

function runIndexPath(): string {
  return path.join(SIM_RUNS_DIR, RUN_INDEX_FILE);
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

function assertSimulationRunIndex(value: unknown): SimulationRunIndex {
  if (!value || typeof value !== "object") {
    throw new Error("Saved-run index is missing");
  }
  const index = value as Partial<SimulationRunIndex>;
  if (index.version !== RUN_INDEX_VERSION || !Array.isArray(index.runs)) {
    throw new Error("Saved-run index is malformed");
  }
  for (const record of index.runs) {
    if (
      !record ||
      typeof record !== "object" ||
      typeof record.id !== "string" ||
      !ID_RE.test(record.id) ||
      !isSavedSimulationKind(record.kind) ||
      typeof record.created_at !== "string" ||
      typeof record.title !== "string" ||
      typeof record.kept !== "boolean" ||
      (record.storage !== "gzip" && record.storage !== "json") ||
      typeof record.modified_at_ms !== "number" ||
      !Number.isFinite(record.modified_at_ms) ||
      typeof record.size_bytes !== "number" ||
      !Number.isFinite(record.size_bytes) ||
      record.size_bytes < 0
    ) {
      throw new Error("Saved-run index is malformed");
    }
  }
  return index as SimulationRunIndex;
}

function sortIndexRecords(
  records: SimulationRunIndexRecord[],
): SimulationRunIndexRecord[] {
  return records.sort(
    (a, b) =>
      b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
  );
}

function recordToListItem(
  record: SimulationRunIndexRecord,
): SavedSimulationRunListItem {
  return {
    id: record.id,
    kind: record.kind,
    created_at: record.created_at,
    kept: record.kept,
    share_url: buildSimulationShareUrl(record.id, record.kind),
    title: record.title,
  };
}

function candidateForRecord(record: SimulationRunIndexRecord): RunCandidate {
  const compressed = record.storage === "gzip";
  return {
    id: record.id,
    headerPath: compressed ? metadataPath(record.id) : legacyRunPath(record.id),
    dataPath: compressed
      ? compressedRunPath(record.id)
      : legacyRunPath(record.id),
    modifiedAt: record.modified_at_ms,
    compressed,
  };
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

async function readSimulationRunIndex(): Promise<SimulationRunIndex | null> {
  try {
    const stats = await fs.stat(runIndexPath());
    if (
      runIndexCache?.ino === stats.ino &&
      runIndexCache.modifiedAt === stats.mtimeMs &&
      runIndexCache.size === stats.size
    ) {
      return runIndexCache.index;
    }
    const index = assertSimulationRunIndex(
      JSON.parse(await fs.readFile(runIndexPath(), "utf8")),
    );
    runIndexCache = {
      ino: stats.ino,
      modifiedAt: stats.mtimeMs,
      size: stats.size,
      index,
    };
    return index;
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr?.code === "ENOENT" || err instanceof SyntaxError) return null;
    if (err instanceof Error && err.message.startsWith("Saved-run index is ")) {
      return null;
    }
    throw err;
  }
}

async function writeSimulationRunIndex(index: SimulationRunIndex): Promise<void> {
  sortIndexRecords(index.runs);
  const serialized = `${JSON.stringify(index)}\n`;
  await writeAtomic(runIndexPath(), serialized);
  const stats = await fs.stat(runIndexPath());
  runIndexCache = {
    ino: stats.ino,
    modifiedAt: stats.mtimeMs,
    size: stats.size,
    index,
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

async function buildSimulationRunIndexUnlocked(): Promise<SimulationRunIndex> {
  const { candidates, keptIds } = await collectRunCandidates();
  const records: SimulationRunIndexRecord[] = [];
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
          return {
            id: item.id,
            kind: item.kind,
            created_at: item.created_at,
            title: item.title,
            kept: item.kept,
            storage: candidate.compressed ? "gzip" as const : "json" as const,
            modified_at_ms: candidate.modifiedAt,
            size_bytes: await candidateSize(candidate),
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
  return { version: RUN_INDEX_VERSION, runs: sortIndexRecords(records) };
}

async function loadOrBuildSimulationRunIndex(): Promise<SimulationRunIndex> {
  const existing = await readSimulationRunIndex();
  if (existing) return existing;
  mkdirSync(SIM_RUNS_DIR, { recursive: true });
  return withDirectoryLock(SIM_RUNS_DIR, async () => {
    const current = await readSimulationRunIndex();
    if (current) return current;
    const built = await buildSimulationRunIndexUnlocked();
    await writeSimulationRunIndex(built);
    return built;
  });
}

export async function rebuildSimulationRunIndex(): Promise<number> {
  mkdirSync(SIM_RUNS_DIR, { recursive: true });
  return withDirectoryLock(SIM_RUNS_DIR, async () => {
    const built = await buildSimulationRunIndexUnlocked();
    await writeSimulationRunIndex(built);
    return built.runs.length;
  });
}

async function updateExistingSimulationRunIndex(
  update: (records: SimulationRunIndexRecord[]) => SimulationRunIndexRecord[],
): Promise<void> {
  const index = await readSimulationRunIndex();
  if (!index) return;
  await writeSimulationRunIndex({
    version: RUN_INDEX_VERSION,
    runs: update([...index.runs]),
  });
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
      const stats = await fs.stat(metadataPath(id));
      await updateExistingSimulationRunIndex((records) => [
        {
          id,
          kind,
          created_at: doc.created_at,
          title: buildSimulationRunTitle(request, kind),
          kept: false,
          storage: "gzip",
          modified_at_ms: stats.mtimeMs,
          size_bytes: compressed.length + Buffer.byteLength(metadata),
        },
        ...records.filter((record) => record.id !== id),
      ]);
    } catch (err) {
      await Promise.all([
        fs.rm(compressedRunPath(id), { force: true }),
        fs.rm(metadataPath(id), { force: true }),
      ]);
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
    const index = await readSimulationRunIndex();
    const indexed = index?.runs.find((record) => record.id === id);
    const exists = indexed
      ? true
      : (await fileExists(compressedRunPath(id))) ||
        (await fileExists(legacyRunPath(id)));
    if (!exists) return null;
    let previousMarkerSize = 0;
    try {
      previousMarkerSize = (await fs.stat(keepPath(id))).size;
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr?.code !== "ENOENT") throw err;
    }
    if (kept) {
      await writeAtomic(
        keepPath(id),
        `${JSON.stringify({ kept_at: new Date().toISOString() })}\n`,
      );
    } else {
      await fs.rm(keepPath(id), { force: true });
    }
    if (indexed) {
      const markerSize = kept ? (await fs.stat(keepPath(id))).size : 0;
      await updateExistingSimulationRunIndex((records) =>
        records.map((record) =>
          record.id === id
            ? {
                ...record,
                kept,
                size_bytes: Math.max(
                  0,
                  record.size_bytes + markerSize - previousMarkerSize,
                ),
              }
            : record,
        ),
      );
    }
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
  const index = await loadOrBuildSimulationRunIndex();
  const matching = kindSet
    ? index.runs.filter((record) => kindSet.has(record.kind))
    : index.runs;
  const pageRecords = matching.slice(offset, offset + limit);
  scheduleSimulationRunCleanup();
  return {
    runs: pageRecords.map(recordToListItem),
    has_more: matching.length > offset + pageRecords.length,
    next_offset: offset + pageRecords.length,
  };
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

async function removeIndexRecord(record: SimulationRunIndexRecord): Promise<void> {
  const candidate = candidateForRecord(record);
  await Promise.all([
    fs.rm(candidate.dataPath, { force: true }),
    fs.rm(metadataPath(record.id), { force: true }),
    fs.rm(keepPath(record.id), { force: true }),
  ]);
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
    const index =
      (await readSimulationRunIndex()) ??
      (await buildSimulationRunIndexUnlocked());
    const oldestFirst = [...index.runs].sort((a, b) => {
      const aCreated = Date.parse(a.created_at);
      const bCreated = Date.parse(b.created_at);
      return (
        (Number.isFinite(aCreated) ? aCreated : a.modified_at_ms) -
        (Number.isFinite(bCreated) ? bCreated : b.modified_at_ms)
      );
    });

    let remainingBytes = oldestFirst.reduce(
      (sum, record) => sum + record.size_bytes,
      0,
    );
    let deletedBytes = 0;
    let deletedRuns = 0;
    const deletedIds = new Set<string>();
    for (const record of oldestFirst) {
      if (record.kept) continue;
      const createdAt = Date.parse(record.created_at);
      const effectiveCreatedAt = Number.isFinite(createdAt)
        ? createdAt
        : record.modified_at_ms;
      const expired = retentionDays > 0 && effectiveCreatedAt < cutoff;
      const overLimit = maxStorageBytes > 0 && remainingBytes > maxStorageBytes;
      if (!expired && !overLimit) continue;
      await removeIndexRecord(record);
      deletedIds.add(record.id);
      remainingBytes -= record.size_bytes;
      deletedBytes += record.size_bytes;
      deletedRuns += 1;
    }
    const remainingRecords = index.runs.filter(
      (record) => !deletedIds.has(record.id),
    );
    await writeSimulationRunIndex({
      version: RUN_INDEX_VERSION,
      runs: remainingRecords,
    });

    return {
      deleted_runs: deletedRuns,
      deleted_bytes: deletedBytes,
      kept_runs: remainingRecords.filter((record) => record.kept).length,
      remaining_runs: remainingRecords.length,
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
