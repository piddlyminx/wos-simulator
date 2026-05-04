import { expect, test } from "@playwright/test";
import { promises as fs } from "fs";
import path from "path";
import {
  listPlayerStatPresets,
  resolveStatPresetsFile,
  savePlayerStatPreset,
  updatePlayerStatPreset,
} from "../lib/stat-presets";
import {
  resolveRuntimeStoreDir,
  resolveSimulatorRoot,
} from "../lib/simulator-root";

test("default player stat preset store resolves to simulator tmp", () => {
  const cwd = process.cwd();
  const repoRoot = cwd.endsWith("dashboard/web")
    ? path.resolve(cwd, "../..")
    : cwd.endsWith("dashboard")
      ? path.resolve(cwd, "..")
      : cwd;

  expect(resolveSimulatorRoot(process.cwd())).toBe(repoRoot);
  expect(resolveSimulatorRoot(`${repoRoot}/dashboard/web`)).toBe(repoRoot);
  expect(resolveSimulatorRoot(`${repoRoot}/dashboard`)).toBe(repoRoot);
});

test("default player stat preset store follows persistent simulation store override", () => {
  const oldRunsDir = process.env.SIM_RUNS_DIR;
  const oldPresetsFile = process.env.STAT_PRESETS_FILE;
  try {
    delete process.env.STAT_PRESETS_FILE;
    process.env.SIM_RUNS_DIR = "/data/simulations";

    expect(resolveRuntimeStoreDir()).toBe("/data/simulations");
    expect(resolveStatPresetsFile()).toBe(
      "/data/simulations/player-stat-presets.json",
    );
  } finally {
    if (oldRunsDir === undefined) {
      delete process.env.SIM_RUNS_DIR;
    } else {
      process.env.SIM_RUNS_DIR = oldRunsDir;
    }
    if (oldPresetsFile === undefined) {
      delete process.env.STAT_PRESETS_FILE;
    } else {
      process.env.STAT_PRESETS_FILE = oldPresetsFile;
    }
  }
});

test("player stat preset store saves, updates, and sorts by update time", async () => {
  expect(process.env.STAT_PRESETS_FILE).toBeTruthy();
  await fs.rm(process.env.STAT_PRESETS_FILE!, { force: true });

  const stats = {
    infantry: { attack: 101, defense: 102, lethality: 103, health: 104 },
    lancer: { attack: 111, defense: 112, lethality: 113, health: 114 },
    marksman: { attack: 121, defense: 122, lethality: 123, health: 124 },
  };

  const saved = await savePlayerStatPreset({
    name: "  Main base   stats  ",
    stats,
  });
  expect(saved.name).toBe("Main base stats");
  expect(saved.stats.infantry.attack).toBe(101);

  const updated = await updatePlayerStatPreset(saved.id, {
    name: "Updated base",
    stats: {
      ...stats,
      infantry: { ...stats.infantry, attack: 201.126 },
    },
  });
  expect(updated.name).toBe("Updated base");
  expect(updated.stats.infantry.attack).toBe(201.13);

  await savePlayerStatPreset({ name: "Second", stats });
  const all = await listPlayerStatPresets();
  expect(all.map((p) => p.name)).toEqual(["Second", "Updated base"]);

  await fs.rm(process.env.STAT_PRESETS_FILE!, { force: true });
});
