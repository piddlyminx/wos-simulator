import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import { after, before, beforeEach, test } from "node:test";
import { Pool } from "pg";

import * as store from "./simulation-store";
import { importSimulationRuns } from "./simulation-run-import";

import type {
  BearOptimizeRatioRequestPayload,
  BearOptimizeRatioResult,
  BearSimRequestPayload,
  BearSimResult,
  ReportImportRequest,
  SimulateRequestPayload,
  SimulateApiResult,
} from "@/lib/simulate-run";
import type { SurfaceSweepPayload, SurfaceSweepResult } from "@/lib/simulator/surface";
import type { TournamentRequestPayload, TournamentResult } from "@/lib/tournament";
import {
  buildSimulationRunTitle,
  buildSimulationShareUrl,
} from "@/lib/simulate-run";
import { POST as completeReportPost } from "../app/api/simulate/runs/[id]/complete/route";
import { POST as saveRunPost } from "../app/api/simulate/runs/route";

const side = {
  troops: { infantry: 100, lancer: 50, marksman: 25 },
  troop_types: {
    infantry: "infantry_t6",
    lancer: "lancer_t6",
    marksman: "marksman_t6",
  },
  heroes: {
    infantry: { name: "Jeronimo", skills: [5, 5, 5, 5] },
    lancer: { name: "Mia", skills: [5, 5, 5, 5] },
    marksman: { name: "Bradley", skills: [5, 5, 5, 5] },
  },
  joiners: [{ name: "Jasser", skill_1: 5 }],
  stats: {
    inf: [100, 100, 100, 100],
    lanc: [100, 100, 100, 100],
    mark: [100, 100, 100, 100],
  },
} satisfies SimulateRequestPayload["attacker"];

const pvpRequest: SimulateRequestPayload = {
  attacker: side,
  defender: { ...side, heroes: { ...side.heroes, infantry: { name: "Logan", skills: [5, 5, 5, 5] } } },
  replicates: 1,
  rally_mode: true,
};

const pvpResult: SimulateApiResult = {
  replicates: 1,
  summary: {
    mean: 0,
    std: 0,
    best: { value: 0, winner: "draw" },
    worst: { value: 0, winner: "draw" },
    attacker_win_rate: 0,
    avg_rounds: 1,
    avg_skill_activations: 0,
    avg_skill_kills: 0,
    avg_attacker_activations: 0,
    avg_defender_activations: 0,
    avg_attacker_kills: 0,
    avg_defender_kills: 0,
  },
  outcomes: [0],
  per_side_skills: { attacker: [], defender: [] },
};

const bearRequest: BearSimRequestPayload = {
  player: side,
  replicates: 1,
};

const bearResult: BearSimResult = {
  replicates: 1,
  summary: {
    mean: 123,
    std: 0,
    best: { value: 123 },
    worst: { value: 123 },
    avg_skill_activations: 0,
    avg_skill_damage: 0,
  },
  scores: [123],
  skills: [],
};

const bearOptimizeRequest: BearOptimizeRatioRequestPayload = {
  ...bearRequest,
  grid_step: 10,
  search_replicates: 1,
  infantry_min_pct: 0,
  infantry_max_pct: 100,
  top_n: 10,
  search_mode: "grid",
};

const bearOptimizeResult: BearOptimizeRatioResult = {
  total_troops: 175,
  grid_step: 10,
  compositions_tested: 1,
  projected_battles: 1,
  replicates_per_ratio: 1,
  infantry_min_pct: 0,
  infantry_max_pct: 100,
  best: {
    infantry_count: 100,
    lancer_count: 50,
    marksman_count: 25,
    infantry_pct: 57,
    lancer_pct: 29,
    marksman_pct: 14,
    avg_score: 123,
  },
  top_results: [],
  points: [],
};

const surfaceRequest: SurfaceSweepPayload = {
  attacker: pvpRequest.attacker,
  defender: pvpRequest.defender,
  pointsPerEdge: 6,
  attackerTotal: 100_000,
  defenderTotal: 100_000,
  replicates: 2,
  rallyMode: false,
  jobs: 1,
};

const surfaceResult: SurfaceSweepResult = {
  points: [
    { inf: 100_000, lanc: 0, mark: 0 },
    { inf: 0, lanc: 100_000, mark: 0 },
  ],
  winrateMatrix: [0.5, 0.75, 0.25, 0.5],
};

const tournamentRequest: TournamentRequestPayload = {
  groups: [{
    label: "Test batch",
    infantryMains: ["Hector"],
    lancerMains: ["Mia"],
    marksmanMains: ["Bradley"],
    joiners: ["Jessie", "Seo-yoon", "Lumak", "Ling"],
    ratios: ["50,20,30"],
    allowRepeatedJoiners: false,
    excludeMainHeroesFromJoiners: true,
  }],
  totalTroops: 100_000,
  rounds: 2,
  seedRounds: 1,
  reps: 1,
  jobs: 1,
  seed: 1234,
  freezeRate: 0.2,
  freezeLossesGte: null,
  startFreezeRound: 2,
  minPoolSize: 2,
  topN: 10,
  finalsTopM: 0,
  finalsReps: 1,
  finalsMaxSameMainLineup: 10,
};

const tournamentResult: TournamentResult = {
  generatedTeams: 2,
  swiss: {
    offense: { rows: [], totalRows: 0 },
    defense: { rows: [], totalRows: 0 },
  },
};

const reportImport: ReportImportRequest = {
  report_import: {
    attacker: {
      name: "Imported attacker",
      heroes: { Jeronimo: { skill_1: 5, skill_2: 5 } },
      troops: { infantry_t6: 100, lancer_t6: 50, marksman_t6: 25 },
      stats: { infantry: { attack: 250, health: 310 } },
    },
    defender: {
      name: "Imported defender",
      troops: { infantry_t6: 75 },
    },
  },
  replicates: 1,
  rally_mode: true,
  source_report: {
    reference: "partial-report",
    report: { unknownHero: 9999, preserved: { fight: [1, 2, 3] } },
    raw_report_base64: "AAEC/w==",
    warnings: ["Attacker infantry defense unavailable; using neutral 0%.", "Unsupported hero 9999 omitted."],
  },
};


test("completed report decoding preserves usable inputs and evidence and requires a result", async () => {
  const request: SimulateRequestPayload = {
    ...pvpRequest,
    attacker: {
      ...side,
      troop_composition: { infantry_t6: 100, infantry_t6_fc5: 50, lancer_t6: 50, marksman_t6: 25 },
      stats: { inf: [250, 0, 0, 310], lanc: [0, 0, 0, 0], mark: [0, 0, 0, 0] },
    },
    source_report: {
      reference: "partial-report",
      report: { unknownHero: 9999 },
      raw_report_base64: "AAEC/w==",
      warnings: ["Attacker infantry defense unavailable; using neutral 0%.", "Unsupported hero 9999 omitted."],
    },
  };
  const doc = {
    version: 1, id: "partial-report-run", kind: "simulate",
    created_at: "2026-10-10T12:00:00.000Z", request, result: pvpResult,
  };
  const decoded = await store.decodeSimulationRun(
    await store.gzipDocument(Buffer.from(JSON.stringify(doc))),
  );
  assert.deepEqual(decoded, doc);
  for (const kind of ["simulate", "optimize_ratio", "bear_simulate", "bear_optimize_ratio", "ratio_explorer", "tournament"]) {
    assert.throws(() => store.assertSavedSimulationDoc({ ...doc, kind, result: null }), /malformed/);
    assert.throws(() => store.assertSavedSimulationDoc({ ...doc, kind, result: undefined }), /malformed/);
  }
});

const testUrl = process.env.TEST_DATABASE_URL;
const databaseTest = { skip: !testUrl ? "Set TEST_DATABASE_URL to run isolated real PostgreSQL storage tests" : false };
const schema = `saved_runs_test_${randomUUID().replaceAll("-", "")}`;
let admin: Pool;
before(async () => {
  if (!testUrl) return;
  admin = new Pool({ connectionString: testUrl });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(testUrl);
  url.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.toString();
  await store.simulationRunPool().query(await readFile(path.resolve("../postgres/schema.sql"), "utf8"));
});
beforeEach(async () => {
  if (testUrl) await store.simulationRunPool().query("TRUNCATE saved_simulation_runs");
});
after(async () => {
  if (!testUrl) return;
  await store.simulationRunPool().end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

test("all saved run kinds round trip and list in separate histories", databaseTest, async () => {
  const fixtures = [
    ["simulate", pvpRequest, pvpResult],
    ["optimize_ratio", pvpRequest, pvpResult],
    ["bear_simulate", bearRequest, bearResult],
    ["bear_optimize_ratio", bearOptimizeRequest, bearOptimizeResult],
    ["ratio_explorer", surfaceRequest, surfaceResult],
    ["tournament", tournamentRequest, tournamentResult],
  ] as const;
  for (const [kind, request, result] of fixtures) {
    const saved = await store.saveSimulationRun(kind, request, result);
    assert.deepEqual(await store.readSimulationRun(saved.id), saved);
    const page = await store.listSimulationRunsPage({ kinds: [kind] });
    assert.deepEqual(page.runs, [{
      id: saved.id, kind, created_at: saved.created_at,
      title: buildSimulationRunTitle(request, kind), kept: false, share_url: saved.share_url,
    }]);
  }
  const page = await store.listSimulationRunsPage({ limit: 1, kinds: ["bear_simulate", "bear_optimize_ratio"] });
  assert.equal(page.has_more, true);
  const second = await store.listSimulationRunsPage({ limit: 1, offset: page.next_offset, kinds: ["bear_simulate", "bear_optimize_ratio"] });
  assert.equal(second.has_more, false);
  assert.notEqual(second.runs[0].id, page.runs[0].id);
  assert.equal(second.next_offset, 2);
});

test("completed report runs save and reload usable inputs, warnings and source bytes", databaseTest, async () => {
  const request: SimulateRequestPayload = {
    ...pvpRequest,
    attacker: { ...side, stats: { inf: [250, 0, 0, 310], lanc: [0, 0, 0, 0], mark: [0, 0, 0, 0] } },
    source_report: {
      reference: "partial-report",
      report: { unknownHero: 9999 },
      raw_report_base64: "AAEC/w==",
      warnings: ["Attacker infantry defense unavailable; using neutral 0%.", "Unsupported hero 9999 omitted."],
    },
  };
  const saved = await store.saveSimulationRun("simulate", request, pvpResult);
  const loaded = await store.readSimulationRun(saved.id);
  assert.deepEqual(loaded?.result, pvpResult);
  assert.deepEqual(loaded?.request, request);
  assert.equal((await store.listSimulationRunsPage()).runs[0].id, saved.id);
});

test("imported links complete publicly under the same UID while preserving evidence and private metadata", databaseTest, async () => {
  const importBefore = structuredClone(reportImport);
  const pending = await store.saveReportImport(reportImport);
  assert.equal(pending.result, null);
  assert.equal(pending.kind, "simulate");
  assert.deepEqual((await store.readSimulationRun(pending.id))?.request, reportImport);
  const ownerHash = "e".repeat(64);
  await store.simulationRunPool().query(
    "UPDATE saved_simulation_runs SET owner_hash = $2, title = $3 WHERE id = $1",
    [pending.id, ownerHash, "Preserved imported title"],
  );
  await store.setSimulationRunKept(pending.id, true, ownerHash);
  const input: SimulateRequestPayload = {
    ...pvpRequest,
    source_report: {
      reference: "must-not-replace-reference",
      report: { mustNotReplace: true },
      raw_report_base64: "must-not-replace-bytes",
      warnings: ["Unsupported hero 9999 omitted.", "Defender health unavailable; using neutral 0%."],
    },
  };
  const response = await completeReportPost(new Request(
    `http://localhost/api/simulate/runs/${pending.id}/complete`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request: input, result: pvpResult }) },
  ), { params: Promise.resolve({ id: pending.id }) });
  assert.equal(response.status, 200);
  const completed = await response.json();
  assert.equal(completed.id, pending.id);
  assert.equal(completed.created_at, pending.created_at);
  assert.equal(completed.share_url, pending.share_url);
  assert.equal(completed.kept, true);
  assert.deepEqual(completed.result, pvpResult);
  assert.deepEqual(completed.request, {
    ...pvpRequest,
    source_report: {
      ...reportImport.source_report,
      warnings: [...reportImport.source_report.warnings, "Defender health unavailable; using neutral 0%."],
    },
  });
  assert.deepEqual(await store.readSimulationRun(pending.id), completed);
  assert.equal("owner_hash" in completed, false);
  const owned = await store.listSimulationRunsPage({ ownerHash, kept: true });
  assert.deepEqual(owned.runs, [{
    id: pending.id, kind: pending.kind, created_at: pending.created_at,
    kept: true, share_url: pending.share_url, title: "Preserved imported title",
  }]);
  assert.equal(await store.setSimulationRunKept(pending.id, false, "f".repeat(64)), undefined);
  assert.deepEqual(reportImport, importBefore);
});

test("completed imported and ordinary snapshots cannot be overwritten by later completions", databaseTest, async () => {
  const pending = await store.saveReportImport(reportImport);
  const first = await store.completeReportSimulation(pending.id, pvpRequest, pvpResult);
  const differentRequest = { ...pvpRequest, rally_mode: false };
  const differentResult = { ...pvpResult, outcomes: [1], summary: { ...pvpResult.summary, mean: 1 } };
  assert.deepEqual(await store.completeReportSimulation(pending.id, differentRequest, differentResult), first);
  assert.deepEqual(await store.readSimulationRun(pending.id), first);
  const ordinary = await store.saveSimulationRun("simulate", pvpRequest, pvpResult);
  assert.deepEqual(await store.completeReportSimulation(ordinary.id, differentRequest, differentResult), ordinary);
  assert.deepEqual(await store.readSimulationRun(ordinary.id), ordinary);
  assert.equal(await store.completeReportSimulation("missing-run-123", pvpRequest, pvpResult), null);
  const bear = await store.saveSimulationRun("bear_simulate", bearRequest, bearResult);
  await assert.rejects(store.completeReportSimulation(bear.id, pvpRequest, pvpResult), /Only report-import/);
  assert.deepEqual(await store.readSimulationRun(bear.id), bear);
});

test("concurrent imported completions return the first committed winner without replacing its result", databaseTest, async () => {
  const pending = await store.saveReportImport(reportImport);
  const results = [
    { ...pvpResult, outcomes: [1], summary: { ...pvpResult.summary, mean: 1 } },
    { ...pvpResult, outcomes: [-1], summary: { ...pvpResult.summary, mean: -1 } },
  ];
  const client = await store.simulationRunPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM saved_simulation_runs WHERE id = $1 FOR UPDATE", [pending.id]);
    const completions = results.map((result) => store.completeReportSimulation(pending.id, pvpRequest, result));
    await client.query("COMMIT");
    const [first, second] = await Promise.all(completions);
    assert.deepEqual(second, first);
    assert.ok(first);
    assert.equal(first.id, pending.id);
    const winningResult = first.result as SimulateApiResult;
    assert.ok(winningResult.summary.mean === 1 || winningResult.summary.mean === -1);
    assert.deepEqual(winningResult, winningResult.summary.mean === 1 ? results[0] : results[1]);
    assert.deepEqual(await store.readSimulationRun(pending.id), first);
    const losingResult = winningResult.summary.mean === 1 ? results[1] : results[0];
    assert.deepEqual(await store.completeReportSimulation(pending.id, pvpRequest, losingResult), first);
  } finally {
    client.release();
  }
});

test("only dedicated validated report imports can persist null results, and invalid completion leaves them pending", databaseTest, async () => {
  for (const kind of ["simulate", "optimize_ratio", "bear_simulate", "bear_optimize_ratio", "ratio_explorer", "tournament"] as const) {
    await assert.rejects(store.saveSimulationRun(kind, reportImport, null as unknown as SimulateApiResult), /completed simulation result/);
    if (kind !== "simulate") {
      assert.throws(() => store.assertSavedSimulationDoc({
        version: 1, id: "invalid-pending-run", kind, created_at: new Date().toISOString(),
        request: reportImport, result: null,
      }), /malformed/);
    }
  }
  const pending = await store.saveReportImport(reportImport);
  for (const invalid of [
    { ...reportImport, replicates: 0 },
    { ...reportImport, replicates: 5001 },
    { ...reportImport, replicates: 1.5 },
    { ...reportImport, report_import: { ...reportImport.report_import, attacker: { troops: { infantry_t6: 0 } } } },
    { ...reportImport, report_import: { ...reportImport.report_import, defender: { troops: { infantry_t6: -1 } } } },
  ]) {
    await assert.rejects(store.saveReportImport(invalid), /Invalid report import/);
  }
  await assert.rejects(store.completeReportSimulation(pending.id, pvpRequest, { ...pvpResult, outcomes: [] }), /completed simulation result/);
  await assert.rejects(store.completeReportSimulation(pending.id, {
    ...pvpRequest, attacker: { ...side, troops: { infantry: 0, lancer: 0, marksman: 0 } },
  }, pvpResult), /normalized simulation request/);
  assert.deepEqual(await store.readSimulationRun(pending.id), pending);
  const collection = await saveRunPost(new Request("http://localhost/api/simulate/runs", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "simulate", request: reportImport, result: null }),
  }));
  assert.equal(collection.status, 400);
  assert.deepEqual((await store.listSimulationRuns()).map((run) => run.id), [pending.id]);
});

test("owner authorization preserves kept, denied and missing outcomes without leaking ownership", databaseTest, async () => {
  const ownerA = "a".repeat(64);
  const ownerB = "b".repeat(64);
  const ownedA = await store.saveSimulationRun("simulate", pvpRequest, pvpResult, ownerA);
  const unowned = await store.saveSimulationRun("simulate", pvpRequest, pvpResult);
  const ownedB = await store.saveSimulationRun("simulate", pvpRequest, pvpResult, ownerB);
  assert.deepEqual((await store.listSimulationRunsPage({ ownerHash: ownerA })).runs.map((run) => run.id), [ownedA.id]);
  assert.equal(await store.setSimulationRunKept(ownedA.id, true, ownerB), undefined);
  assert.equal(await store.setSimulationRunKept(unowned.id, true, ownerA), undefined);
  assert.equal((await store.readSimulationRun(ownedA.id))?.kept, false);
  assert.equal(await store.setSimulationRunKept("missing-run-123", true, ownerA), null);
  assert.equal(await store.setSimulationRunKept(ownedA.id, true, ownerA), true);
  assert.deepEqual((await store.listSimulationRunsPage({ ownerHash: ownerA, kept: true })).runs.map((run) => run.id), [ownedA.id]);
  assert.equal(await store.setSimulationRunKept(ownedA.id, false, ownerA), false);
  assert.equal(await store.setSimulationRunKept(unowned.id, true), true);
  assert.equal("owner_hash" in (await store.readSimulationRun(ownedA.id))!, false);
  assert.deepEqual(new Set((await store.listSimulationRuns()).map((run) => run.id)), new Set([ownedA.id, unowned.id, ownedB.id]));
  await assert.rejects(store.saveSimulationRun("simulate", pvpRequest, pvpResult, "invalid"), /owner hash/);
  await assert.rejects(store.readSimulationRun("../bad"), /id/);
});

test("explicit cleanup enforces age and size but never deletes kept records", databaseTest, async () => {
  const disposable = await store.saveSimulationRun("simulate", pvpRequest, pvpResult);
  const kept = await store.saveSimulationRun("bear_simulate", bearRequest, bearResult);
  await store.setSimulationRunKept(kept.id, true);
  const cleanup = await store.cleanupSimulationRuns({ retentionDays: 30, maxStorageBytes: 0, now: Date.now() + 31 * 86400000 });
  assert.equal(cleanup.deleted_runs, 1);
  assert.equal(cleanup.kept_runs, 1);
  assert.equal(await store.readSimulationRun(disposable.id), null);
  assert.equal((await store.readSimulationRun(kept.id))?.kept, true);
  const overLimit = await store.saveSimulationRun("simulate", pvpRequest, pvpResult);
  assert.equal((await store.cleanupSimulationRuns({ retentionDays: 0, maxStorageBytes: 1 })).deleted_runs, 1);
  assert.equal(await store.readSimulationRun(overLimit.id), null);
  await store.setSimulationRunKept(kept.id, false);
  assert.equal((await store.cleanupSimulationRuns({ retentionDays: 30, maxStorageBytes: 0, now: Date.now() + 31 * 86400000 })).deleted_runs, 1);
});

test("cleanup observes a concurrent committed keep rather than deleting its stale snapshot", databaseTest, async () => {
  const saved = await store.saveSimulationRun("simulate", pvpRequest, pvpResult);
  const client = await store.simulationRunPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE saved_simulation_runs SET kept = true WHERE id = $1", [saved.id]);
    const cleanup = store.cleanupSimulationRuns({ retentionDays: 0, maxStorageBytes: 1 });
    await client.query("COMMIT");
    assert.equal((await cleanup).deleted_runs, 0);
    assert.equal((await store.readSimulationRun(saved.id))?.kept, true);
  } finally {
    client.release();
  }
});

test("independent processes see each other's saves and kept updates", databaseTest, async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", "--eval", `
    const store = require('./lib/simulation-store.ts');
    (async () => {
      const saved = await store.saveSimulationRun('simulate', ${JSON.stringify(pvpRequest)}, ${JSON.stringify(pvpResult)}, '${"a".repeat(64)}');
      await store.setSimulationRunKept(saved.id, true);
      console.log(saved.id);
      await store.simulationRunPool().end();
    })().catch(e => { console.error(e); process.exitCode = 1; });
  `], { env: process.env });
  const saved = await store.readSimulationRun(stdout.trim());
  assert.deepEqual(saved?.result, pvpResult);
  assert.equal(saved?.kept, true);
  assert.deepEqual((await store.listSimulationRunsPage({ ownerHash: "a".repeat(64), kept: true })).runs.map((run) => run.id), [saved?.id]);
});

test("legacy import preserves documents, owners, titles and markers; resumes only exact duplicates", databaseTest, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "wos-import-"));
  try {
    const ownerHash = "c".repeat(64);
    const first = { version: 1, id: "legacy-run-0001", kind: "simulate", created_at: "2020-01-01T00:00:00+00:00", request: pvpRequest, result: pvpResult };
    const second = { ...first, id: "legacy-run-0002", kind: "bear_simulate", request: bearRequest, result: bearResult };
    await writeFile(path.join(dir, `${first.id}.json`), "obsolete duplicate is intentionally ignored");
    await writeFile(path.join(dir, `${first.id}.json.gz`), await promisify(gzip)(JSON.stringify(first)));
    await writeFile(path.join(dir, `${second.id}.json`), JSON.stringify(second, null, 2));
    await writeFile(path.join(dir, `${first.id}.meta.json`), JSON.stringify({ ...first, result: undefined, owner_hash: ownerHash }));
    await writeFile(path.join(dir, `${first.id}.keep`), "{}");
    await writeFile(path.join(dir, ".runs-index.json"), JSON.stringify({ version: 1, runs: [
      { id: first.id, kind: first.kind, created_at: first.created_at, title: "Preserved title", kept: true, owner_hash: ownerHash },
      { id: second.id, kind: second.kind, created_at: second.created_at, title: "Bear title", kept: false },
    ] }));
    const filesBefore = await readdir(dir);
    const imported = await importSimulationRuns({ inputDir: dir });
    assert.deepEqual(imported, { source_runs: 2, normalized_legacy_runs: 0, imported_runs: 2, matched_runs: 0, verified_runs: 2, kept_runs: 1, owned_runs: 1, kinds: { simulate: 1, bear_simulate: 1 } });
    assert.deepEqual(await store.readSimulationRun(first.id), { ...first, kept: true, share_url: buildSimulationShareUrl(first.id, "simulate") });
    assert.deepEqual((await store.listSimulationRuns()).map((run) => run.id), [second.id, first.id]);
    assert.equal((await store.listSimulationRunsPage({ ownerHash })).runs[0].title, "Preserved title");
    const resumed = await importSimulationRuns({ inputDir: dir });
    assert.equal(resumed.imported_runs, 0);
    assert.equal(resumed.matched_runs, 2);
    assert.equal((await importSimulationRuns({ inputDir: dir, verifyOnly: true })).verified_runs, 2);
    assert.deepEqual(await readdir(dir), filesBefore);
    await store.simulationRunPool().query("UPDATE saved_simulation_runs SET title = 'conflict' WHERE id = $1", [first.id]);
    await assert.rejects(importSimulationRuns({ inputDir: dir }), /conflict/);
    await assert.rejects(importSimulationRuns({ inputDir: dir, verifyOnly: true }), /conflict/);
    await store.simulationRunPool().query("UPDATE saved_simulation_runs SET title = 'Preserved title', payload = $2, payload_size = $3 WHERE id = $1", [first.id, Buffer.from("broken gzip"), 11]);
    await assert.rejects(importSimulationRuns({ inputDir: dir, verifyOnly: true }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("legacy surface runs migrate to the current explorer kind without losing payloads or ownership", databaseTest, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "wos-import-surface-"));
  try {
    const plain = { version: 1, id: "legacy-surface-plain", kind: "surface_sweep", created_at: "2020-01-01T00:00:00+00:00", request: surfaceRequest, result: surfaceResult };
    const compressed = { ...plain, id: "legacy-surface-gzip" };
    const ownerHash = "d".repeat(64);
    const plainBytes = JSON.stringify(plain, null, 2);
    const gzipBytes = await promisify(gzip)(JSON.stringify(compressed));
    await writeFile(path.join(dir, `${plain.id}.json`), plainBytes);
    await writeFile(path.join(dir, `${compressed.id}.json.gz`), gzipBytes);
    await writeFile(path.join(dir, `${compressed.id}.meta.json`), JSON.stringify({ ...compressed, result: undefined, owner_hash: ownerHash }));
    await writeFile(path.join(dir, `${compressed.id}.keep`), "{}");
    await writeFile(path.join(dir, ".runs-index.json"), JSON.stringify({ version: 1, runs: [
      { id: compressed.id, kind: compressed.kind, created_at: compressed.created_at, title: "Original surface title", kept: true, owner_hash: ownerHash },
    ] }));
    const imported = await importSimulationRuns({ inputDir: dir });
    assert.equal(imported.normalized_legacy_runs, 2);
    assert.deepEqual(await store.readSimulationRun(plain.id), { ...plain, kind: "ratio_explorer", kept: false, share_url: buildSimulationShareUrl(plain.id, "ratio_explorer") });
    assert.deepEqual(await store.readSimulationRun(compressed.id), { ...compressed, kind: "ratio_explorer", kept: true, share_url: buildSimulationShareUrl(compressed.id, "ratio_explorer") });
    assert.deepEqual((await store.listSimulationRunsPage({ ownerHash, kinds: ["ratio_explorer"], kept: true })).runs.map((run) => [run.id, run.title]), [[compressed.id, "Original surface title"]]);
    assert.equal((await importSimulationRuns({ inputDir: dir, verifyOnly: true })).verified_runs, 2);
    assert.equal((await importSimulationRuns({ inputDir: dir })).matched_runs, 2);
    assert.equal(await readFile(path.join(dir, `${plain.id}.json`), "utf8"), plainBytes);
    assert.deepEqual(await readFile(path.join(dir, `${compressed.id}.json.gz`)), gzipBytes);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("legacy import rejects filename identity and sidecar/index ownership inconsistencies", databaseTest, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "wos-import-invalid-"));
  try {
    const doc = { version: 1, id: "legacy-run-good", kind: "simulate", created_at: "2020-01-01T00:00:00.000Z", request: pvpRequest, result: pvpResult };
    const file = path.join(dir, "legacy-run-bad.json");
    await writeFile(file, JSON.stringify(doc));
    await assert.rejects(importSimulationRuns({ inputDir: dir }), /identity mismatch/);
    await rm(file);
    await writeFile(path.join(dir, `${doc.id}.json`), JSON.stringify(doc));
    await writeFile(path.join(dir, `${doc.id}.meta.json`), JSON.stringify({ ...doc, result: undefined, owner_hash: "a".repeat(64) }));
    await writeFile(path.join(dir, ".runs-index.json"), JSON.stringify({ version: 1, runs: [{ id: doc.id, kind: doc.kind, created_at: doc.created_at, title: "title", kept: false, owner_hash: "b".repeat(64) }] }));
    await assert.rejects(importSimulationRuns({ inputDir: dir }), /metadata mismatch/);
    assert.equal(await store.readSimulationRun(doc.id), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
