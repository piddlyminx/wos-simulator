import { avgMargin, winRate } from "./pools";
import { teamBuildKey } from "./teamGeneration";
import type { Score, Team } from "./types";

export interface ObservedBuild {
  team: Team;
  winRate: number;
  margin: number;
  games: number;
  rows: number;
}

export interface HeroPresence {
  name: string;
  count: number;
  mains: number;
  joiners: number;
}

export interface JoinerChoice {
  name: string;
  copies: number;
  count: number;
  minWinRate: number;
  maxWinRate: number;
}

export interface FormationRecipe {
  formation: string;
  builds: ObservedBuild[];
  strong: ObservedBuild[];
  core: JoinerChoice[];
  flexible: JoinerChoice[];
}

export interface LineupFamily {
  mains: Team["mains"];
  builds: ObservedBuild[];
  formations: FormationRecipe[];
}

export interface TeamHeuristics {
  inputRows: number;
  duplicateRows: number;
  builds: ObservedBuild[];
  leaders: ObservedBuild[];
  heroes: HeroPresence[];
  ratios: Array<{ formation: string; count: number }>;
  families: LineupFamily[];
}

function compareBuilds(a: ObservedBuild, b: ObservedBuild): number {
  return b.winRate - a.winRate || b.margin - a.margin;
}

export function analyzeTeamHeuristics(scores: Score[]): TeamHeuristics {
  const observations = new Map<string, ObservedBuild>();
  for (const score of scores) {
    if (score.games <= 0 || score.matches <= 0) continue;
    const key = teamBuildKey(score.team);
    const wins = winRate(score) * score.games;
    const margin = avgMargin(score) * score.games;
    const previous = observations.get(key);
    if (previous) {
      const games = previous.games + score.games;
      previous.winRate = (previous.winRate * previous.games + wins) / games;
      previous.margin = (previous.margin * previous.games + margin) / games;
      previous.games = games;
      previous.rows += 1;
    } else {
      observations.set(key, { team: score.team, winRate: wins / score.games, margin: margin / score.games, games: score.games, rows: 1 });
    }
  }
  const builds = [...observations.values()].sort(compareBuilds);
  const leaders = builds.slice(0, 100);
  const heroes = new Map<string, HeroPresence>();
  const ratios = new Map<string, number>();
  for (const { team } of leaders) {
    ratios.set(team.ratioLabel, (ratios.get(team.ratioLabel) ?? 0) + 1);
    const mains = new Set(team.mains);
    const joiners = new Set(team.joiners);
    for (const name of new Set([...mains, ...joiners])) {
      const hero = heroes.get(name) ?? { name, count: 0, mains: 0, joiners: 0 };
      hero.count += 1;
      hero.mains += Number(mains.has(name));
      hero.joiners += Number(joiners.has(name));
      heroes.set(name, hero);
    }
  }
  const grouped = new Map<string, LineupFamily>();
  for (const build of builds) {
    const key = JSON.stringify(build.team.mains);
    let family = grouped.get(key);
    if (!family) {
      family = { mains: build.team.mains, builds: [], formations: [] };
      grouped.set(key, family);
    }
    family.builds.push(build);
  }
  for (const family of grouped.values()) {
    const formations = new Map<string, ObservedBuild[]>();
    for (const build of family.builds) {
      const group = formations.get(build.team.ratioLabel) ?? [];
      group.push(build);
      formations.set(build.team.ratioLabel, group);
    }
    family.formations = [...formations].map(([formation, candidates]) => {
      const strong = candidates.filter(build => build.winRate >= candidates[0].winRate - 0.03 - 1e-12);
      const choices = new Map<string, { name: string; copies: number; builds: ObservedBuild[] }>();
      for (const build of strong) {
        const counts = new Map<string, number>();
        for (const name of build.team.joiners) counts.set(name, (counts.get(name) ?? 0) + 1);
        for (const [name, count] of counts) {
          for (let copies = 1; copies <= count; copies += 1) {
            const key = JSON.stringify([name, copies]);
            const choice = choices.get(key) ?? { name, copies, builds: [] };
            choice.builds.push(build);
            choices.set(key, choice);
          }
        }
      }
      const supported = [...choices.values()].map(choice => ({
        name: choice.name, copies: choice.copies, count: choice.builds.length,
        minWinRate: choice.builds[choice.builds.length - 1].winRate,
        maxWinRate: choice.builds[0].winRate
      })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name) || a.copies - b.copies);
      return {
        formation, builds: candidates, strong,
        core: strong.length < 3 ? [] : supported.filter(choice => choice.count / strong.length >= 0.8),
        flexible: strong.length < 3 ? [] : supported.filter(choice => choice.count / strong.length >= 0.3 && choice.count / strong.length < 0.8)
      };
    });
  }
  return {
    inputRows: scores.length,
    duplicateRows: builds.reduce((sum, build) => sum + build.rows - 1, 0),
    builds, leaders,
    heroes: [...heroes.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    ratios: [...ratios].map(([formation, count]) => ({ formation, count })).sort((a, b) => b.count - a.count),
    families: [...grouped.values()]
  };
}

const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
const range = (builds: ObservedBuild[]) => `${percent(builds[builds.length - 1].winRate)}–${percent(builds[0].winRate)}`;
const label = (choice: JoinerChoice) => choice.copies === 1 ? choice.name : `${choice.name} ×${choice.copies}`;

export function summarizeTeamHeuristics(scores: Score[], role: "offense" | "defense"): string {
  const report = analyzeTeamHeuristics(scores);
  const lines = [`# ${role === "offense" ? "Attacker" : "Defender"} lineup heuristics`, ""];
  if (!report.builds.length) return `${lines.join("\n")}No evaluated builds.\n`;
  lines.push(
    `${report.builds.length} distinct evaluated builds; ${report.duplicateRows} duplicate rows combined by game-weighted results.`,
    "These are informed heuristics from this shortlisted population against its benchmark, not causal skill estimates or universal win probabilities.",
    "Duplicate pooling removes repeated entries from these summaries, but cannot undo any distortion of the original opponent panel.",
    "", "## What keeps appearing", "",
    `Among the top ${report.leaders.length} distinct builds:`,
    `- Formations: ${report.ratios.map(ratio => `${ratio.formation}: ${ratio.count}/${report.leaders.length}`).join("; ")}.`,
    `- Most common heroes anywhere: ${report.heroes.slice(0, 8).map(hero => `${hero.name} ${hero.count}/${report.leaders.length} (${hero.mains} main, ${hero.joiners} joiner)`).join("; ")}.`,
    "",
    "## Main-lineup families", "",
    "| Main heroes | Distinct builds | Observed win-rate range | Best formation | Best joiners | Recurring joiners in best formation's strong band |",
    "| --- | ---: | --- | --- | --- | --- |"
  );
  for (const family of report.families) {
    const best = family.builds[0];
    const recipe = family.formations[0];
    const core = recipe.core.map(choice => `${label(choice)} ${choice.count}/${recipe.strong.length}`).join(", ");
    lines.push(`| ${family.mains.join(" / ")} | ${family.builds.length} | ${range(family.builds)} | ${best.team.ratioLabel} | ${best.team.joiners.join(", ")} | ${core || "Insufficient support for a common core"} |`);
  }
  lines.push(
    "", "## Practical recipes", "",
    "Detailed recipes cover up to eight main-lineup families whose best result is within 5 percentage points of the overall best; alternatives remain in the table above.",
    "For each formation, the strong band includes tested builds within 3 percentage points of that formation's best result. These cutoffs describe the data, not statistical significance.",
    "Core = a joiner appears in at least 80% of strong variants; flexible = 30% to below 80%. At least three strong variants are required to infer either. Counts are per distinct build, not per hero slot.",
    "Flex choices describe observed successful combinations, not a promise that any arbitrary four will work. The examples retain actual combinations and their game counts. ×2 means at least two copies.",
    ""
  );
  const detailed = report.families.filter(family => family.builds[0].winRate >= report.builds[0].winRate - 0.05 - 1e-12).slice(0, 8);
  for (const family of detailed) {
    lines.push(`### ${family.mains.join(" / ")}`, "");
    for (const recipe of family.formations) {
      lines.push(`**${recipe.formation}: ${range(recipe.strong)} across ${recipe.strong.length} strong variants** (${recipe.builds.length} tested variants total).`);
      const showChoice = (choice: JoinerChoice) => `${label(choice)} ${choice.count}/${recipe.strong.length}, ${percent(choice.minWinRate)}–${percent(choice.maxWinRate)} observed with it`;
      if (recipe.strong.length < 3) {
        lines.push("Too few strong variants to infer a stable core/flex recipe; use the tested examples.");
      } else {
        lines.push(`- Core: ${recipe.core.map(showChoice).join("; ") || "no individual joiner reaches the 80% threshold"}.`);
        lines.push(`- Flexible support: ${recipe.flexible.map(showChoice).join("; ") || "no additional joiner reaches the 30% threshold"}.`);
      }
      lines.push("- Best observed combinations:");
      for (const build of recipe.builds.slice(0, 3)) {
        lines.push(`  - ${build.team.joiners.join(" + ")}: **${percent(build.winRate)}**, mean survivor margin ${Math.round(build.margin).toLocaleString("en-US")}, ${build.games} games.`);
      }
      lines.push("");
    }
  }
  return `${lines.join("\n")}\n`;
}
