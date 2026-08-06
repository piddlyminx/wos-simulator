import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { loadSimulatorConfig } from "../simulator/src/config-node";
import type { SkillFile } from "../simulator/src/types";

const require = createRequire(import.meta.url);

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_DB_PATH = resolve(REPO_ROOT, "test_results", "dashboard.sqlite");
const MIGRATIONS_DIR = resolve(REPO_ROOT, "dashboard", "migrations");

const SIMULATOR_PATH_PREFIXES = [
  "simulator/config/",
  "simulator/src/",
  "shared/fighters_data/",
  "testcases/",
] as const;

const SIMULATOR_ROOT_FILES = new Set([
  "simulator/package.json",
  "simulator/package-lock.json",
  "simulator/tsconfig.json",
]);

const KNOWN_ISSUE_WAIVERS: Record<string, { expected_bias_pct: number; tolerance_pct: number }> = {
  "testcases/heroes_unittests/Alonso_tc.json::daut_viper_1": {
    expected_bias_pct: -1.67,
    tolerance_pct: 0.75,
  },
  "testcases/heroes_unittests/Alonso_tc.json::daut_viper_2": {
    expected_bias_pct: 0.88,
    tolerance_pct: 0.75,
  },
};

type DatabaseInstance = {
  close(): void;
  exec(sql: string): void;
  pragma(sql: string): unknown;
  prepare(sql: string): {
    all(...args: unknown[]): unknown[];
    get(...args: unknown[]): unknown;
    run(...args: unknown[]): unknown;
  };
  transaction<T extends (...args: unknown[]) => unknown>(fn: T): T;
};

type DatabaseCtor = new (path: string, options?: Record<string, unknown>) => DatabaseInstance;

export interface DirtyState {
  patchBlobId: string | null;
  untrackedBlobId: string | null;
  snapshotBlobId: string | null;
  patchContentGzip: Buffer | null;
  untrackedContentGzip: Buffer | null;
  snapshotContentGzip: Buffer | null;
  commitSubject: string | null;
  commitAuthor: string | null;
  commitDate: string | null;
}

export interface IngestedRunSummary {
  id: string;
  started_at: string | null;
  finished_at: string | null;
  overall_avg_error_pct: number | null;
  bh_sig_count: number | null;
  total?: number;
  passing?: number;
  failing?: number;
  report_file?: string | null;
  report_path?: string | null;
}

export function openDashboardDb(dbPath = process.env.DB_PATH ?? DEFAULT_DB_PATH): DatabaseInstance {
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const Database = loadBetterSqlite3();
  const db = new Database(dbPath);
  if (dbPath !== ":memory:") db.pragma("journal_mode = DELETE");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  return db;
}

export function ingestReport(
  reportPath: string,
  options: { repoRoot?: string; dbPath?: string; dirtyState?: DirtyState | null } = {},
): IngestedRunSummary | null {
  const repoRoot = resolve(options.repoRoot ?? REPO_ROOT);
  const payload = JSON.parse(readFileSync(reportPath, "utf8")) as Record<string, unknown>;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`Report at ${reportPath} is not a JSON object`);
  }

  payload.git_sha ??= gitSha(repoRoot);
  payload.dirty ??= gitDirty(repoRoot);
  payload.report_file ??= basename(reportPath);
  payload.report_path ??= relativePathOrAbsolute(repoRoot, reportPath);

  const dirtyState = options.dirtyState === undefined ? tryCaptureDirtyState(repoRoot) : options.dirtyState;
  const db = openDashboardDb(options.dbPath);
  try {
    const runId = recordRun(payload, repoRoot, dirtyState, db);
    if (!runId) return latestRun(db);
    return runSummary(db, runId);
  } finally {
    db.close();
  }
}

export function latestRun(dbOrPath: DatabaseInstance | string = process.env.DB_PATH ?? DEFAULT_DB_PATH): IngestedRunSummary | null {
  const ownDb = typeof dbOrPath === "string";
  const db = ownDb ? openDashboardDb(dbOrPath) : dbOrPath;
  try {
    const row = db.prepare(`
      SELECT id, started_at, finished_at, overall_avg_error_pct, bh_sig_count
      FROM runs
      ORDER BY
        CASE WHEN started_at IS NULL THEN 1 ELSE 0 END,
        started_at DESC,
        rowid DESC
      LIMIT 1
    `).get() as IngestedRunSummary | undefined;
    return row ?? null;
  } finally {
    if (ownDb) db.close();
  }
}

export function recordRun(
  runDoc: Record<string, unknown>,
  repoRoot = REPO_ROOT,
  dirtyState: DirtyState | null = null,
  db: DatabaseInstance = openDashboardDb(),
): string | null {
  const finishedAt = runFinishedAt(runDoc);
  if (!finishedAt) throw new Error("run_doc missing 'finished_at'");

  const existing = db.prepare("SELECT id FROM runs WHERE finished_at = ?").get(finishedAt) as { id: string } | undefined;
  if (existing) return null;

  const testcases = objectRecord(runDoc.testcases);
  let absBiasSum = 0;
  let absBiasCount = 0;
  let bhSigCount = 0;
  let passing = 0;
  let failing = 0;
  let waived = 0;
  const distinctFiles = new Set<string>();
  const waivedFlags = new Map<string, boolean>();

  for (const [key, rawTc] of Object.entries(testcases)) {
    const tc = objectRecord(rawTc);
    const metric = gameMetric(tc);
    const biasPct = numberOrNull(metric.bias_pct);
    if (biasPct !== null) {
      absBiasSum += Math.abs(biasPct);
      absBiasCount += 1;
    }

    const q = numberOrNull(metric.q);
    if (q !== null && q <= 0.05) bhSigCount += 1;

    const filePath = stringOrEmpty(tc.file);
    const testcaseId = stringOrEmpty(tc.testcase_id);
    const waiver = KNOWN_ISSUE_WAIVERS[`${filePath}::${testcaseId}`];
    const isWaived = !!waiver && biasPct !== null && Math.abs(biasPct - waiver.expected_bias_pct) <= waiver.tolerance_pct;
    waivedFlags.set(key, isWaived);

    if (isWaived) waived += 1;
    else if (truthy(metric.passes)) passing += 1;
    else failing += 1;

    if (filePath) distinctFiles.add(filePath);
  }

  const overallAvgErrorPct = absBiasCount ? absBiasSum / absBiasCount : null;
  const skipped = Array.isArray(runDoc.skipped) ? runDoc.skipped : [];
  const summary = {
    total: Object.keys(testcases).length,
    passing,
    failing,
    waived,
    skipped_count: skipped.length,
    skipped,
  };
  const runId = cryptoRandomUuid();

  const insert = db.transaction(() => {
    if (dirtyState?.patchBlobId && dirtyState.patchContentGzip) {
      db.prepare("INSERT OR IGNORE INTO blobs(id, kind, content_gzip) VALUES (?, ?, ?)")
        .run(dirtyState.patchBlobId, "patch", dirtyState.patchContentGzip);
    }
    if (dirtyState?.untrackedBlobId && dirtyState.untrackedContentGzip) {
      db.prepare("INSERT OR IGNORE INTO blobs(id, kind, content_gzip) VALUES (?, ?, ?)")
        .run(dirtyState.untrackedBlobId, "untracked_manifest", dirtyState.untrackedContentGzip);
    }
    if (dirtyState?.snapshotBlobId && dirtyState.snapshotContentGzip) {
      db.prepare("INSERT OR IGNORE INTO blobs(id, kind, content_gzip) VALUES (?, ?, ?)")
        .run(dirtyState.snapshotBlobId, "simulator_snapshot", dirtyState.snapshotContentGzip);
    }

    db.prepare(`
      INSERT INTO runs (
        id, started_at, finished_at, git_sha, dirty,
        baseline_git_sha, cli_args_json, thresholds_json,
        overall_avg_error_pct, bh_sig_count, summary_json,
        patch_blob_id, untracked_blob_id, snapshot_blob_id,
        commit_subject, commit_author, commit_date,
        report_file, report_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      runId,
      runStartedAt(runDoc),
      finishedAt,
      stringOrEmpty(runDoc.git_sha),
      truthy(runDoc.dirty) ? 1 : 0,
      stringOrNull(runDoc.baseline_git_sha),
      JSON.stringify(runCliArgs(runDoc)),
      JSON.stringify(objectRecord(runDoc.thresholds)),
      overallAvgErrorPct,
      bhSigCount,
      JSON.stringify(summary),
      dirtyState?.patchBlobId ?? null,
      dirtyState?.untrackedBlobId ?? null,
      dirtyState?.snapshotBlobId ?? null,
      dirtyState?.commitSubject ?? null,
      dirtyState?.commitAuthor ?? null,
      dirtyState?.commitDate ?? null,
      stringOrNull(runDoc.report_file),
      stringOrNull(runDoc.report_path),
    );

    const insertTc = db.prepare(`
      INSERT INTO run_testcases (
        run_id, file, testcase_id, idx,
        n_sim, n_game, mu_sim, mu_game, bias_pct,
        t, q, passes, stat_type, waived_bool,
        stat_adjustment_value, stat_adjustment_mode,
        stat_adjustment_unadjusted_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const [key, rawTc] of Object.entries(testcases)) {
      const tc = objectRecord(rawTc);
      const metric = gameMetric(tc);
      const adjustment = objectOrNull(tc.gameStatAdjustment);
      insertTc.run(
        runId,
        stringOrEmpty(tc.file),
        stringOrEmpty(tc.testcase_id),
        numberOrDefault(tc.idx, 0),
        metricValue(metric, "n_candidate", "n_sim", 0),
        metricValue(metric, "n_reference", "n_game", 0),
        metricValue(metric, "mu_candidate", "mu_sim", null),
        metricValue(metric, "mu_reference", "mu_game", null),
        numberOrNull(metric.bias_pct),
        metricValue(metric, "stat", "t", null),
        numberOrNull(metric.q),
        truthy(metric.passes) ? 1 : 0,
        stringOrEmpty(metric.stat_type),
        waivedFlags.get(key) ? 1 : 0,
        adjustment ? numberOrNull(adjustment.value) : null,
        adjustment ? stringOrNull(adjustment.mode) : null,
        adjustment && adjustment.unadjusted !== undefined ? JSON.stringify(adjustment.unadjusted) : null,
      );
    }

    const available = Array.isArray(runDoc.available_testcase_files)
      ? runDoc.available_testcase_files.filter((value): value is string => typeof value === "string")
      : [...distinctFiles];
    const allFiles = [...new Set([...available, ...distinctFiles])].sort();
    const insertFile = db.prepare("INSERT INTO run_testcase_files(run_id, file_path, sha256, included) VALUES (?, ?, ?, ?)");
    for (const filePath of allFiles) {
      const sha = sha256File(resolve(repoRoot, filePath));
      if (!sha) continue;
      insertFile.run(runId, filePath, sha, distinctFiles.has(filePath) ? 1 : 0);
    }

    snapshotCoverage(runId, db, repoRoot);
  });

  insert();
  return runId;
}

export function captureDirtyState(repoRoot = REPO_ROOT): DirtyState {
  const status = porcelainStatus(repoRoot);
  const patch = status.hasTrackedChanges ? capturePatch(repoRoot) : null;
  const untracked = status.isDirty ? captureUntracked(repoRoot, status.untrackedPaths) : null;
  const snapshot = captureSimulatorSnapshot(repoRoot);
  const commit = captureCommitMetadata(repoRoot);
  return {
    patchBlobId: patch?.id ?? null,
    untrackedBlobId: untracked?.id ?? null,
    snapshotBlobId: snapshot.id,
    patchContentGzip: patch?.content ?? null,
    untrackedContentGzip: untracked?.content ?? null,
    snapshotContentGzip: snapshot.content,
    commitSubject: commit.subject,
    commitAuthor: commit.author,
    commitDate: commit.date,
  };
}

function tryCaptureDirtyState(repoRoot: string): DirtyState | null {
  try {
    return captureDirtyState(repoRoot);
  } catch {
    return null;
  }
}

function loadBetterSqlite3(): DatabaseCtor {
  for (const candidate of ["better-sqlite3", resolve(REPO_ROOT, "dashboard/web/node_modules/better-sqlite3")]) {
    try {
      const loaded = require(candidate) as { default?: DatabaseCtor } | DatabaseCtor;
      return ("default" in loaded ? loaded.default : loaded) as DatabaseCtor;
    } catch {
      // Try the next resolution root.
    }
  }
  throw new Error("Could not load better-sqlite3. Run npm install in dashboard/web or rebuild the Docker image.");
}

function applyMigrations(db: DatabaseInstance): void {
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT)");
  const applied = new Set((db.prepare("SELECT name FROM _migrations").all() as { name: string }[]).map((row) => row.name));
  for (const name of readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql")).sort()) {
    if (applied.has(name)) continue;
    const sql = readFileSync(resolve(MIGRATIONS_DIR, name), "utf8");
    db.pragma("foreign_keys = OFF");
    try {
      const tx = db.transaction(() => {
        for (const statement of splitSql(sql)) db.exec(statement);
        db.prepare("INSERT INTO _migrations(name, applied_at) VALUES (?, datetime('now'))").run(name);
      });
      tx();
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }
}

function splitSql(sql: string): string[] {
  return sql.split(";").map((statement) => statement.trim()).filter(Boolean);
}

function activeTestcaseFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const files: string[] = [];
  for (const name of readdirSync(directory).sort()) {
    const filePath = resolve(directory, name);
    const stats = statSync(filePath);
    if (stats.isDirectory()) files.push(...activeTestcaseFiles(filePath));
    else if (stats.isFile() && name.endsWith(".json")) files.push(filePath);
  }
  return files;
}

export function snapshotCoverage(
  runId: string,
  db: DatabaseInstance,
  repoRoot: string,
  heroDefinitions: Readonly<Record<string, SkillFile>> =
    loadSimulatorConfig().heroDefinitions,
): void {
  const testcaseDir = resolve(repoRoot, "testcases");
  if (!existsSync(testcaseDir)) return;

  const skills: Array<{ hero: string; skillNum: number; skillName: string }> = [];
  for (const [hero, definition] of Object.entries(heroDefinitions)) {
    let skillNum = 1;
    for (const skillName of Object.keys(definition.skills ?? {})) {
      skills.push({ hero, skillNum, skillName });
      skillNum += 1;
    }
  }

  const heroes = [...new Set(skills.map((skill) => skill.hero))].sort();
  const skillsByHero = new Map<string, typeof skills>();
  for (const hero of heroes) {
    skillsByHero.set(hero, skills.filter((skill) => skill.hero === hero));
  }
  const skillTestcaseCount = new Map(skills.map((skill) => [`${skill.hero}:${skill.skillNum}`, 0]));
  const skillOutcomeCount = new Map(skills.map((skill) => [`${skill.hero}:${skill.skillNum}`, 0]));

  for (const filePath of activeTestcaseFiles(testcaseDir)) {
    let entries: unknown;
    try {
      entries = JSON.parse(readFileSync(filePath, "utf8"));
    } catch {
      continue;
    }
    const list = Array.isArray(entries) ? entries : [entries];
    for (const rawEntry of list) {
      const entry = objectRecord(rawEntry);
      const entryOutcomeCount = arrayLength(entry.game_report_result);
      for (const hero of heroes) {
        if (!heroInEntry(entry, hero)) continue;
        for (const skill of skillsByHero.get(hero) ?? []) {
          const key = `${hero}:${skill.skillNum}`;
          if (!skillCoveredInEntry(entry, hero, skill.skillNum)) continue;
          skillTestcaseCount.set(key, (skillTestcaseCount.get(key) ?? 0) + 1);
          skillOutcomeCount.set(key, (skillOutcomeCount.get(key) ?? 0) + entryOutcomeCount);
        }
      }
    }
  }

  const insert = db.prepare(`
    INSERT INTO coverage_snapshots
      (run_id, hero, skill_num, skill_name, skill_id, testcase_count, battle_outcome_count, covered_bool)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const skill of skills.sort((a, b) => a.hero.localeCompare(b.hero) || a.skillNum - b.skillNum)) {
    insert.run(
      runId,
      skill.hero,
      skill.skillNum,
      skill.skillName,
      String(skill.skillNum),
      skillTestcaseCount.get(`${skill.hero}:${skill.skillNum}`) ?? 0,
      skillOutcomeCount.get(`${skill.hero}:${skill.skillNum}`) ?? 0,
      (skillTestcaseCount.get(`${skill.hero}:${skill.skillNum}`) ?? 0) > 0 ? 1 : 0,
    );
  }
}

function porcelainStatus(repoRoot: string): { hasTrackedChanges: boolean; untrackedPaths: string[]; isDirty: boolean } {
  const raw = runGit(repoRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const entries = raw.toString("utf8").split("\0").filter(Boolean);
  const untrackedPaths: string[] = [];
  let hasTrackedChanges = false;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? "";
    const xy = entry.slice(0, 2);
    const path = entry.slice(3);
    if (xy === "??") untrackedPaths.push(path);
    else {
      hasTrackedChanges = true;
      if (xy[0] === "R" || xy[0] === "C") index += 1;
    }
  }
  return { hasTrackedChanges, untrackedPaths, isDirty: hasTrackedChanges || untrackedPaths.length > 0 };
}

function capturePatch(repoRoot: string): { id: string; content: Buffer } | null {
  const diff = runGit(repoRoot, ["diff", "HEAD", "--binary", "--", ...gitPathspecArgs()]);
  if (diff.length === 0) return null;
  const content = gzipSync(diff);
  return { id: sha256Id(content), content };
}

function captureUntracked(repoRoot: string, paths: string[]): { id: string; content: Buffer } | null {
  const scoped = paths.filter(isSimulatorPath);
  if (scoped.length === 0) return null;
  const content = gzipTar(repoRoot, scoped);
  return { id: sha256Id(content), content };
}

function captureSimulatorSnapshot(repoRoot: string): { id: string; content: Buffer } {
  const raw = runGit(repoRoot, ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...gitPathspecArgs()]);
  const paths = raw.toString("utf8").split("\0").filter(Boolean).filter(isSimulatorPath);
  const content = gzipTar(repoRoot, paths);
  return { id: sha256Id(content), content };
}

function captureCommitMetadata(repoRoot: string): { subject: string | null; author: string | null; date: string | null } {
  try {
    const text = runGit(repoRoot, ["log", "-1", "--pretty=%s%x1f%an%x1f%cI"]).toString("utf8").trim();
    const [subject, author, date] = text.split("\x1f");
    return { subject: subject || null, author: author || null, date: date || null };
  } catch {
    return { subject: null, author: null, date: null };
  }
}

function runGit(repoRoot: string, args: string[]): Buffer {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "buffer", stdio: ["ignore", "pipe", "ignore"] });
}

function gzipTar(repoRoot: string, relPaths: string[]): Buffer {
  const chunks: Buffer[] = [];
  for (const rel of [...relPaths].sort()) {
    const abs = resolve(repoRoot, rel);
    let data: Buffer;
    try {
      if (!statSync(abs).isFile()) continue;
      data = readFileSync(abs);
    } catch {
      continue;
    }
    chunks.push(tarHeader(rel, data.length));
    chunks.push(data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) chunks.push(Buffer.alloc(pad));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks));
}

function tarHeader(path: string, size: number): Buffer {
  const header = Buffer.alloc(512, 0);
  const { name, prefix } = splitTarPath(path);
  writeString(header, name, 0, 100);
  writeOctal(header, 0o644, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, size, 124, 12);
  writeOctal(header, 0, 136, 12);
  header.fill(0x20, 148, 156);
  writeString(header, "0", 156, 1);
  writeString(header, "ustar", 257, 6);
  writeString(header, "00", 263, 2);
  writeString(header, prefix, 345, 155);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeChecksum(header, checksum);
  return header;
}

function splitTarPath(path: string): { name: string; prefix: string } {
  const normalized = path.split(sep).join("/");
  if (Buffer.byteLength(normalized) <= 100) return { name: normalized, prefix: "" };
  const parts = normalized.split("/");
  for (let index = parts.length - 1; index > 0; index -= 1) {
    const name = parts.slice(index).join("/");
    const prefix = parts.slice(0, index).join("/");
    if (Buffer.byteLength(name) <= 100 && Buffer.byteLength(prefix) <= 155) return { name, prefix };
  }
  throw new Error(`Path is too long for ustar snapshot: ${path}`);
}

function writeString(buf: Buffer, value: string, offset: number, length: number): void {
  buf.write(value, offset, Math.min(Buffer.byteLength(value), length), "utf8");
}

function writeOctal(buf: Buffer, value: number, offset: number, length: number): void {
  const octal = Math.trunc(value).toString(8).padStart(length - 1, "0");
  buf.write(`${octal.slice(-(length - 1))}\0`, offset, length, "ascii");
}

function writeChecksum(buf: Buffer, value: number): void {
  const octal = value.toString(8).padStart(6, "0");
  buf.write(`${octal}\0 `, 148, 8, "ascii");
}

function gitPathspecArgs(): string[] {
  return [...SIMULATOR_PATH_PREFIXES, ...[...SIMULATOR_ROOT_FILES].sort()];
}

function isSimulatorPath(relPath: string): boolean {
  const normalized = relPath.replace(/^[ab]\//, "");
  return SIMULATOR_ROOT_FILES.has(normalized) || SIMULATOR_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function runSummary(db: DatabaseInstance, runId: string): IngestedRunSummary | null {
  const row = db.prepare(`
    SELECT id, started_at, finished_at, overall_avg_error_pct,
           bh_sig_count, summary_json, report_file, report_path
    FROM runs
    WHERE id = ?
  `).get(runId) as (IngestedRunSummary & { summary_json?: string }) | undefined;
  if (!row) return null;
  const summary = row.summary_json ? JSON.parse(row.summary_json) as Record<string, unknown> : {};
  return {
    id: row.id,
    started_at: row.started_at,
    finished_at: row.finished_at,
    overall_avg_error_pct: row.overall_avg_error_pct,
    bh_sig_count: row.bh_sig_count,
    total: numberOrUndefined(summary.total),
    passing: numberOrUndefined(summary.passing),
    failing: numberOrUndefined(summary.failing),
    report_file: row.report_file,
    report_path: row.report_path,
  };
}

function relativePathOrAbsolute(root: string, target: string): string {
  const rel = relative(root, resolve(target)).split(sep).join("/");
  return rel.startsWith("..") ? resolve(target) : rel;
}

function gitSha(repoRoot: string): string {
  try {
    return runGit(repoRoot, ["rev-parse", "HEAD"]).toString("utf8").trim();
  } catch {
    return "";
  }
}

function gitDirty(repoRoot: string): boolean {
  try {
    return runGit(repoRoot, ["status", "--porcelain"]).toString("utf8").trim().length > 0;
  } catch {
    return false;
  }
}

function sha256File(path: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
}

function sha256Id(content: Buffer): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function cryptoRandomUuid(): string {
  return randomUUID();
}

function runStartedAt(runDoc: Record<string, unknown>): string | null {
  return stringOrNull(runDoc.started_at) ?? stringOrNull(runDoc.createdAt);
}

function runFinishedAt(runDoc: Record<string, unknown>): string | null {
  return stringOrNull(runDoc.finished_at) ?? stringOrNull(runDoc.createdAt);
}

function runCliArgs(runDoc: Record<string, unknown>): Record<string, unknown> {
  const cliArgs = objectOrNull(runDoc.cli_args);
  if (cliArgs) return cliArgs;
  return objectRecord(runDoc.options);
}

function gameMetric(tc: Record<string, unknown>): Record<string, unknown> {
  return objectOrNull(tc.game) ?? tc;
}

function metricValue(metric: Record<string, unknown>, newKey: string, oldKey: string, fallback: unknown): unknown {
  return metric[oldKey] ?? metric[newKey] ?? fallback;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function arrayLength(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  return value && typeof value === "object" ? 1 : 0;
}

function truthy(value: unknown): boolean {
  return value === true || value === 1;
}

function heroInEntry(entry: Record<string, unknown>, hero: string): boolean {
  for (const key of ["heroes", "joiner_heroes"]) {
    for (const side of ["attacker", "defender"]) {
      if (hero in objectRecord(objectRecord(entry[side])[key])) return true;
    }
  }
  return false;
}

function skillCoveredInEntry(entry: Record<string, unknown>, hero: string, skillNum: number): boolean {
  const skillKey = `skill_${skillNum}`;
  for (const key of ["heroes", "joiner_heroes"]) {
    for (const side of ["attacker", "defender"]) {
      const heroDict = objectRecord(objectRecord(objectRecord(entry[side])[key])[hero]);
      if (numberOrDefault(heroDict[skillKey], 0) > 0) return true;
    }
  }
  return false;
}
