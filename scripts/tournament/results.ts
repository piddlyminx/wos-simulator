import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { avgMargin, Pool, winRate } from "./pools";
import { parseRatio } from "./teamGeneration";
import type { Score, Team } from "./types";

const RESULTS_DIR_TIMESTAMP_RE = /^\d{8}-\d{6}$/;
const CSV_FIELDS = ["rank", "win_rate", "avg_margin", "matches", "formation", "hero_1", "hero_2", "hero_3", "joiner_1", "joiner_2", "joiner_3", "joiner_4"];

export function deriveResultsLabel(source: string): string {
  const name = basename(source);
  if (!name.startsWith("ds_")) return name;
  const candidate = name.slice(3);
  const split = candidate.lastIndexOf("_");
  if (split < 0) return candidate;
  const prefix = candidate.slice(0, split);
  const suffix = candidate.slice(split + 1);
  return RESULTS_DIR_TIMESTAMP_RE.test(suffix) ? prefix : candidate;
}

export function loadAllRankedTeamsFromCsv(csvPath: string, total: number): Team[] {
  const rows = parseCsv(readFileSync(csvPath, "utf8"));
  return rows.map((row, id) => ({
    id,
    mains: [row.hero_1, row.hero_2, row.hero_3],
    joiners: [row.joiner_1, row.joiner_2, row.joiner_3, row.joiner_4],
    ratioLabel: row.formation,
    troops: parseRatio(row.formation.replace(/-/g, ","), total)
  }));
}

export function loadRankedTeamsFromCsv(csvPath: string, topM: number, total: number): Team[] {
  const teams = loadAllRankedTeamsFromCsv(csvPath, total);
  if (teams.length < topM) throw new Error(`${csvPath} contains only ${teams.length} rows, but ${topM} were requested`);
  return teams.slice(0, topM);
}

export function copyQualifierCsvs(sourceDir: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  for (const name of ["swiss_off.csv", "swiss_def.csv"]) {
    copyFileSync(join(sourceDir, name), join(destDir, name));
  }
}

export function writeResultsCsv(pathPrefix: string, attackerPool: Pool, defenderPool: Pool, topN: number, offenseTeams?: Team[], defenseTeams?: Team[]): void {
  writeOneCsv(`${pathPrefix}_off.csv`, filterScores(attackerPool, offenseTeams).slice(0, topN));
  writeOneCsv(`${pathPrefix}_def.csv`, filterScores(defenderPool, defenseTeams).slice(0, topN));
}

function filterScores(pool: Pool, allowedTeams?: Team[]): Score[] {
  const scores = pool.scoresFinal.length > 0 ? pool.scoresFinal : pool.finalScoresOrdered;
  if (!allowedTeams) return scores;
  const allowed = new Set(allowedTeams.map((team) => team.id));
  return scores.filter((score) => allowed.has(score.team.id));
}

function writeOneCsv(path: string, scores: Score[]): void {
  mkdirSync(dirname(path), { recursive: true });
  if (scores.length === 0) {
    writeFileSync(path, "");
    return;
  }
  const lines = [CSV_FIELDS.join(",")];
  scores.forEach((score, index) => {
    const team = score.team;
    lines.push(
      [
        String(index + 1),
        winRate(score).toFixed(4),
        avgMargin(score).toFixed(2),
        String(score.matches),
        team.ratioLabel,
        ...team.mains,
        ...team.joiners
      ]
        .map(csvEscape)
        .join(",")
    );
  });
  writeFileSync(path, `${lines.join("\n")}\n`);
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === ",") {
      values.push(current);
      current = "";
    } else if (char === '"') {
      quoted = true;
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}
