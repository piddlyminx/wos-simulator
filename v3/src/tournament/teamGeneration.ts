import type { MainHeroRole, Team } from "./types.js";

export const MAIN_POOL: Record<string, MainHeroRole> = {
  Hector: "inf",
  Edith: "inf",
  Mia: "lanc",
  Philly: "lanc",
  Gordon: "lanc",
  Bradley: "mark",
  Greg: "mark",
  Wayne: "mark"
};

export const JOINER_POOL = [
  "Jessie",
  "Seo-yoon",
  "Lumak",
  "Ling",
  "Patrick",
  "Mia",
  "Reina",
  "Renee",
  "Ahmose",
  "Norah",
  "Philly",
  "Wayne",
  "Wu Ming"
] as const;

export function parseRatio(text: string, total: number): Team["troops"] {
  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length !== 3) throw new Error("ratio must be 'inf,lanc,mark'");
  const values = parts.map((part) => Number(part));
  if (values.some((value) => !Number.isFinite(value))) throw new Error("ratio components must be numeric");
  const sum = values[0] + values[1] + values[2];
  if (sum <= 0) throw new Error("ratio sum must be greater than zero");
  const infantry = Math.round((total * values[0]) / sum);
  const lancer = Math.round((total * values[1]) / sum);
  return {
    infantry_t10: infantry,
    lancer_t10: lancer,
    marksman_t10: total - infantry - lancer
  };
}

export function generateTeams(ratios: Array<[string, Team["troops"]]>, allowRepeatedJoiners = false): Team[] {
  const teams: Team[] = [];
  const infantry = heroesForRole("inf");
  const lancer = heroesForRole("lanc");
  const marksman = heroesForRole("mark");
  const joinerCombos = allowRepeatedJoiners ? combinationsWithReplacement([...JOINER_POOL], 4) : combinations([...JOINER_POOL], 4);
  let id = 0;
  for (const [ratioLabel, troops] of ratios) {
    for (const inf of infantry) {
      for (const lanc of lancer) {
        for (const mark of marksman) {
          for (const joiners of joinerCombos) {
            teams.push({
              id,
              mains: [inf, lanc, mark],
              joiners: joiners as Team["joiners"],
              ratioLabel,
              troops
            });
            id += 1;
          }
        }
      }
    }
  }
  return teams;
}

export function selectFinalsTeamsByMainLineup(teams: Team[], topM: number, maxSameMainLineup: number): Team[] {
  if (maxSameMainLineup <= 0) return teams.slice(0, topM);
  const selected: Team[] = [];
  const counts = new Map<string, number>();
  for (const team of teams) {
    if (selected.length >= topM) break;
    const key = team.mains.join("\u0000");
    const count = counts.get(key) ?? 0;
    if (count >= maxSameMainLineup) continue;
    selected.push(team);
    counts.set(key, count + 1);
  }
  return selected;
}

function heroesForRole(role: MainHeroRole): string[] {
  return Object.entries(MAIN_POOL)
    .filter(([, value]) => value === role)
    .map(([name]) => name);
}

function combinations<T>(items: T[], size: number): T[][] {
  const output: T[][] = [];
  function visit(start: number, current: T[]): void {
    if (current.length === size) {
      output.push([...current]);
      return;
    }
    for (let index = start; index <= items.length - (size - current.length); index += 1) {
      current.push(items[index]);
      visit(index + 1, current);
      current.pop();
    }
  }
  visit(0, []);
  return output;
}

function combinationsWithReplacement<T>(items: T[], size: number): T[][] {
  const output: T[][] = [];
  function visit(start: number, current: T[]): void {
    if (current.length === size) {
      output.push([...current]);
      return;
    }
    for (let index = start; index < items.length; index += 1) {
      current.push(items[index]);
      visit(index, current);
      current.pop();
    }
  }
  visit(0, []);
  return output;
}
