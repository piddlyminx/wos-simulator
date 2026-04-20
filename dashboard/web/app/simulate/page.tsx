"use client";

import { useMemo, useState } from "react";
import SimulateOutcomeChart from "@/components/SimulateOutcomeChart";
import UploadReportModal, {
  UploadReportSubmission,
} from "@/components/UploadReportModal";
import {
  HEROES,
  Skill4Stat,
  TROOP_TIERS,
  TroopCategory,
  heroesForCategory,
  skillSlotEnabled,
  skill4ActiveForSide,
  skill4PercentAt,
  getHero,
} from "@/lib/heroes-catalogue";

type Side = "attacker" | "defender";
const CATEGORIES: TroopCategory[] = ["infantry", "lancer", "marksman"];
const STAT_NAMES: ("attack" | "defense" | "lethality" | "health")[] = [
  "attack",
  "defense",
  "lethality",
  "health",
];
const JOINER_COUNT = 4;

interface HeroSlotState {
  name: string | null;
  skills: [number, number, number, number];
}

interface JoinerSlotState {
  name: string | null;
}

interface SideState {
  troops: Record<TroopCategory, number>;
  tiers: Record<TroopCategory, string>;
  heroes: Record<TroopCategory, HeroSlotState>;
  joiners: JoinerSlotState[]; // always length JOINER_COUNT
  // stats: 3 unit categories x 4 stats, stored as percentage numbers
  stats: Record<TroopCategory, Record<string, number>>;
}

interface ApiResult {
  replicates: number;
  summary: {
    mean: number;
    std: number;
    best: { value: number; winner: "attacker" | "defender" | "draw" };
    worst: { value: number; winner: "attacker" | "defender" | "draw" };
    attacker_win_rate: number;
    avg_skill_activations: number;
    avg_skill_kills: number;
    avg_attacker_activations: number;
    avg_defender_activations: number;
    avg_attacker_kills: number;
    avg_defender_kills: number;
  };
  outcomes: number[];
  per_side_skills: {
    attacker: { name: string; avg_activations: number; avg_kills: number }[];
    defender: { name: string; avg_activations: number; avg_kills: number }[];
  };
}

function defaultSide(): SideState {
  return {
    troops: { infantry: 1000, lancer: 1000, marksman: 1000 },
    tiers: { infantry: "t6", lancer: "t6", marksman: "t6" },
    heroes: {
      infantry: { name: null, skills: [0, 0, 0, 0] },
      lancer: { name: null, skills: [0, 0, 0, 0] },
      marksman: { name: null, skills: [0, 0, 0, 0] },
    },
    joiners: Array.from({ length: JOINER_COUNT }, () => ({ name: null })),
    stats: {
      infantry: { attack: 100, defense: 100, lethality: 100, health: 100 },
      lancer: { attack: 100, defense: 100, lethality: 100, health: 100 },
      marksman: { attack: 100, defense: 100, lethality: 100, health: 100 },
    },
  };
}

function toApiPayload(
  attacker: SideState,
  defender: SideState,
  replicates: number,
  rallyMode: boolean,
) {
  const mkSide = (s: SideState) => ({
    troops: s.troops,
    troop_types: {
      infantry: `infantry_${s.tiers.infantry}`,
      lancer: `lancer_${s.tiers.lancer}`,
      marksman: `marksman_${s.tiers.marksman}`,
    },
    heroes: {
      infantry: { name: s.heroes.infantry.name, skills: s.heroes.infantry.skills },
      lancer: { name: s.heroes.lancer.name, skills: s.heroes.lancer.skills },
      marksman: { name: s.heroes.marksman.name, skills: s.heroes.marksman.skills },
    },
    joiners: rallyMode
      ? s.joiners.filter((j) => j.name).map((j) => ({ name: j.name, skill_1: 5 }))
      : [],
    stats: {
      inf: [
        s.stats.infantry.attack,
        s.stats.infantry.defense,
        s.stats.infantry.lethality,
        s.stats.infantry.health,
      ],
      lanc: [
        s.stats.lancer.attack,
        s.stats.lancer.defense,
        s.stats.lancer.lethality,
        s.stats.lancer.health,
      ],
      mark: [
        s.stats.marksman.attack,
        s.stats.marksman.defense,
        s.stats.marksman.lethality,
        s.stats.marksman.health,
      ],
    },
  });
  return {
    attacker: mkSide(attacker),
    defender: mkSide(defender),
    replicates,
    rally_mode: rallyMode,
  };
}

function compactNumber(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(Math.round(v));
}

function signedSurvivors(value: number): string {
  if (value === 0) return "0 (draw)";
  const who = value > 0 ? "attacker" : "defender";
  return `${compactNumber(Math.abs(value))} (${who})`;
}

/**
 * Decide new skill levels when hero selection changes:
 * - Preserve the user's custom level unless the slot has to be disabled.
 * - If previous level was the default 5 (or 0), update to match spec defaults.
 */
function deriveSkillsForHero(
  prevName: string | null,
  prevSkills: [number, number, number, number],
  newName: string | null,
  rallyMode: boolean,
): [number, number, number, number] {
  const newHero = getHero(newName);
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let slot = 1; slot <= 4; slot++) {
    const idx = (slot - 1) as 0 | 1 | 2 | 3;
    const enabledNow = skillSlotEnabled(newHero, slot as 1 | 2 | 3 | 4, rallyMode);
    if (!enabledNow) {
      out[idx] = 0;
      continue;
    }
    const prev = prevSkills[idx];
    const prevEnabled = skillSlotEnabled(
      getHero(prevName),
      slot as 1 | 2 | 3 | 4,
      rallyMode,
    );
    // Keep user-set custom value (anything other than 5) when slot stays enabled.
    if (prevEnabled && prev !== 5 && prev !== 0) {
      out[idx] = prev;
    } else {
      out[idx] = 5;
    }
  }
  return out;
}

function statLabel(cat: TroopCategory, stat: string): string {
  const prefix = cat === "marksman" ? "Marksman" : cat[0].toUpperCase() + cat.slice(1);
  return `${prefix} ${stat[0].toUpperCase()}${stat.slice(1)}`;
}

/**
 * Sum of skill_4 bonus percents applied to a given stat on a side, from
 * the three main heroes (one per troop type). Skill_4 affects all troop
 * types, so the sum is the same across categories.
 */
function sideSkill4BonusPercent(
  side: SideState,
  which: Side,
  stat: Skill4Stat,
  rallyMode: boolean,
): number {
  if (!rallyMode) return 0;
  let total = 0;
  for (const cat of CATEGORIES) {
    const slot = side.heroes[cat];
    const hero = getHero(slot.name);
    if (!hero?.skill4) continue;
    if (hero.skill4.stat !== stat) continue;
    if (!skill4ActiveForSide(hero, which)) continue;
    const level = slot.skills[3];
    total += skill4PercentAt(level);
  }
  return total;
}

/**
 * Merge OCR output + manually-picked heroes into an existing side.
 * Fields the OCR didn't parse (null/undefined) leave the existing value untouched.
 * Hero selection resets the skills to the spec defaults (same logic used in the
 * main form when picking a hero).
 *
 * When rally mode is on and skill4Levels is provided, the OCR stat values are
 * scaled down by the total skill_4 bonus for that stat+side (since the screenshot
 * already includes the skill_4 boost). The scaled value feeds the main form,
 * so the simulator doesn't double-count the bonus when it reapplies skill_4.
 */
function mergeSideFromOcr(
  prev: SideState,
  ocrSide: {
    troops: Record<TroopCategory, number | null>;
    stats: Record<TroopCategory, Record<string, number | null>>;
  },
  heroes: Record<TroopCategory, string | null>,
  rallyMode: boolean,
  which: Side,
  skill4Levels: Record<TroopCategory, number>,
): SideState {
  const nextTroops = { ...prev.troops };
  const nextStats: SideState["stats"] = {
    infantry: { ...prev.stats.infantry },
    lancer: { ...prev.stats.lancer },
    marksman: { ...prev.stats.marksman },
  };

  // Build per-stat skill_4 scaling factor from the ABOUT-TO-BE-APPLIED hero
  // choices (what the user picked in the modal) and their skill_4 levels.
  const scaleByStat: Record<string, number> = {
    attack: 0,
    defense: 0,
    lethality: 0,
    health: 0,
  };
  if (rallyMode) {
    for (const cat of CATEGORIES) {
      const heroName = heroes[cat];
      const hero = getHero(heroName);
      if (!hero?.skill4) continue;
      if (!skill4ActiveForSide(hero, which)) continue;
      const level = skill4Levels[cat] ?? 0;
      const pct = skill4PercentAt(level);
      if (pct > 0) {
        scaleByStat[hero.skill4.stat] += pct;
      }
    }
  }

  for (const cat of CATEGORIES) {
    const troop = ocrSide.troops?.[cat];
    if (typeof troop === "number" && !isNaN(troop)) {
      nextTroops[cat] = troop;
    }
    const statRow = ocrSide.stats?.[cat] ?? {};
    for (const stat of STAT_NAMES) {
      const v = statRow[stat];
      if (typeof v === "number" && !isNaN(v)) {
        const bonus = scaleByStat[stat] ?? 0;
        // Image value = base * (1 + bonus/100) → base = image / (1 + bonus/100).
        // Round to one decimal to match input precision.
        const scaled = bonus > 0 ? v / (1 + bonus / 100) : v;
        nextStats[cat][stat] = Math.round(scaled * 10) / 10;
      }
    }
  }

  const nextHeroes: SideState["heroes"] = {
    infantry: prev.heroes.infantry,
    lancer: prev.heroes.lancer,
    marksman: prev.heroes.marksman,
  };
  for (const cat of CATEGORIES) {
    const chosen = heroes[cat];
    const currentSlot = prev.heroes[cat];
    const chosenHero = getHero(chosen);
    const newSkills = deriveSkillsForHero(
      currentSlot.name,
      currentSlot.skills,
      chosen,
      rallyMode,
    );
    // If rally mode and user picked a skill_4 level, honor it.
    if (rallyMode && chosenHero?.skill4 && skillSlotEnabled(chosenHero, 4, true)) {
      const lvl = skill4Levels[cat] ?? 0;
      if (lvl > 0) newSkills[3] = lvl;
    }
    nextHeroes[cat] = { name: chosen, skills: newSkills };
  }
  return { ...prev, troops: nextTroops, heroes: nextHeroes, stats: nextStats };
}

export default function SimulatePage() {
  const [attacker, setAttacker] = useState<SideState>(() => defaultSide());
  const [defender, setDefender] = useState<SideState>(() => defaultSide());
  const [replicates, setReplicates] = useState<number>(100);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadWarnings, setUploadWarnings] = useState<string[]>([]);
  const [rallyMode, setRallyMode] = useState(false);

  const setSide = (side: Side) =>
    side === "attacker" ? setAttacker : setDefender;

  function applyUpload(submission: UploadReportSubmission) {
    const { ocr, heroes, rallyMode: modalRally, skill4Levels } = submission;
    // Align main-page rally toggle with the modal's choice so the user sees a
    // consistent state (main form already handles rally layout on its own).
    if (modalRally !== rallyMode) setRallyMode(modalRally);
    setAttacker((prev) =>
      mergeSideFromOcr(
        prev,
        ocr.attacker,
        heroes.attacker,
        modalRally,
        "attacker",
        skill4Levels.attacker,
      ),
    );
    setDefender((prev) =>
      mergeSideFromOcr(
        prev,
        ocr.defender,
        heroes.defender,
        modalRally,
        "defender",
        skill4Levels.defender,
      ),
    );
    setUploadWarnings(ocr.warnings ?? []);
  }

  async function runSimulation() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const payload = toApiPayload(attacker, defender, replicates, rallyMode);
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `Request failed with ${res.status}`);
      } else {
        setResult(data as ApiResult);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const summaryCards = useMemo(() => {
    if (!result) return null;
    const s = result.summary;
    return [
      { label: "Mean survivors", value: signedSurvivors(s.mean) },
      { label: "Std dev", value: compactNumber(s.std) },
      { label: "Attacker winrate", value: `${(s.attacker_win_rate * 100).toFixed(1)}%` },
      { label: "Best outcome", value: signedSurvivors(s.best.value) },
      { label: "Worst outcome", value: signedSurvivors(s.worst.value) },
      { label: "Avg activations / battle", value: s.avg_skill_activations.toFixed(1) },
      { label: "Avg skill kills / battle", value: s.avg_skill_kills.toFixed(1) },
    ];
  }, [result]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <h2
          className="text-lg font-bold"
          style={{ color: "var(--sidebar-active)" }}
        >
          Simulate Battle
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <label
            className="flex items-center gap-2 text-xs px-3 py-2 rounded cursor-pointer font-bold"
            style={{
              border: `1px solid ${rallyMode ? "var(--sidebar-active)" : "var(--border-color)"}`,
              backgroundColor: rallyMode
                ? "rgba(137, 180, 250, 0.15)"
                : "var(--sidebar-bg)",
              color: rallyMode ? "var(--sidebar-active)" : "var(--main-text)",
            }}
            title="Enable Rally mode: each army gets up to 4 joiner heroes and main heroes' skill 4 is active."
          >
            <input
              type="checkbox"
              checked={rallyMode}
              onChange={(e) => setRallyMode(e.target.checked)}
              aria-label="Rally mode"
            />
            Rally mode
          </label>
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className="text-xs px-3 py-2 rounded font-bold"
            style={{
              border: "1px solid var(--border-color)",
              backgroundColor: "var(--sidebar-bg)",
              color: "var(--sidebar-active)",
            }}
          >
            Upload report
          </button>
        </div>
      </div>

      {uploadWarnings.length > 0 && (
        <div
          className="rounded px-3 py-2 mb-4 text-xs font-mono"
          style={{
            border: "1px solid var(--border-color)",
            backgroundColor: "var(--sidebar-bg)",
            color: "#f9e2af",
          }}
        >
          OCR warnings (unparsed fields kept their previous values):
          <ul className="list-disc list-inside mt-1">
            {uploadWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <SidePanel
          title="Attacker"
          which="attacker"
          state={attacker}
          setState={setSide("attacker") as (updater: (prev: SideState) => SideState) => void}
          rallyMode={rallyMode}
        />
        <SidePanel
          title="Defender"
          which="defender"
          state={defender}
          setState={setSide("defender") as (updater: (prev: SideState) => SideState) => void}
          rallyMode={rallyMode}
        />
      </div>

      <div
        className="rounded p-4 mb-6 flex flex-wrap items-end gap-4"
        style={{
          border: "1px solid var(--border-color)",
          backgroundColor: "var(--sidebar-bg)",
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider opacity-60">
            Replicates
          </span>
          <input
            type="number"
            min={1}
            max={1000}
            value={replicates}
            onChange={(e) => setReplicates(Math.max(1, Math.min(1000, parseInt(e.target.value || "1", 10))))}
            className="w-28 rounded px-2 py-1 font-mono text-sm"
            style={{
              backgroundColor: "var(--main-bg)",
              border: "1px solid var(--border-color)",
              color: "var(--main-text)",
            }}
          />
        </label>
        <button
          onClick={runSimulation}
          disabled={loading}
          className="px-4 py-2 rounded font-bold text-sm"
          style={{
            backgroundColor: "var(--sidebar-active)",
            color: "#1e1e2e",
            opacity: loading ? 0.5 : 1,
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "Simulating…" : "Simulate"}
        </button>
        {error && (
          <span className="text-xs" style={{ color: "#f38ba8" }}>
            {error}
          </span>
        )}
      </div>

      <UploadReportModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onApply={applyUpload}
        initialRallyMode={rallyMode}
      />

      {result && (
        <div
          className="rounded p-4 mb-6"
          style={{
            border: "1px solid var(--border-color)",
            backgroundColor: "var(--sidebar-bg)",
          }}
        >
          <h3 className="text-sm uppercase tracking-wider opacity-60 mb-3 font-bold">
            Results ({result.replicates} replicates)
          </h3>
          <div className="flex flex-wrap gap-3 mb-4">
            {summaryCards?.map((c) => (
              <div
                key={c.label}
                className="rounded px-3 py-2 flex flex-col gap-0.5 min-w-40"
                style={{
                  border: "1px solid var(--border-color)",
                  backgroundColor: "var(--main-bg)",
                }}
              >
                <span className="text-xs uppercase tracking-wider opacity-50">
                  {c.label}
                </span>
                <span
                  className="font-mono text-sm font-bold"
                  style={{ color: "var(--sidebar-active)" }}
                >
                  {c.value}
                </span>
              </div>
            ))}
          </div>
          <h4 className="text-xs uppercase tracking-wider opacity-60 mb-2 font-bold">
            Survivor distribution
          </h4>
          <p className="text-xs opacity-60 mb-2">
            Positive = attacker wins with that many survivors; negative = defender wins.
          </p>
          <SimulateOutcomeChart outcomes={result.outcomes} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <SkillUseTable title="Attacker skills" entries={result.per_side_skills.attacker} />
            <SkillUseTable title="Defender skills" entries={result.per_side_skills.defender} />
          </div>
        </div>
      )}
    </div>
  );
}

function SidePanel({
  title,
  which,
  state,
  setState,
  rallyMode,
}: {
  title: string;
  which: Side;
  state: SideState;
  setState: (updater: (prev: SideState) => SideState) => void;
  rallyMode: boolean;
}) {
  return (
    <div
      className="rounded p-4"
      style={{
        border: "1px solid var(--border-color)",
        backgroundColor: "var(--sidebar-bg)",
      }}
    >
      <h3
        className="text-sm uppercase tracking-wider mb-4 font-bold"
        style={{ color: "var(--sidebar-active)" }}
      >
        {title}
      </h3>

      <div className="grid grid-cols-3 gap-3 mb-5">
        {CATEGORIES.map((cat) => (
          <TroopColumn
            key={cat}
            cat={cat}
            which={which}
            state={state}
            setState={setState}
            rallyMode={rallyMode}
          />
        ))}
      </div>

      {rallyMode && (
        <div className="mb-5">
          <h4 className="text-xs uppercase tracking-wider opacity-60 mb-2 font-bold">
            Joiner Heroes (skill 1 @ lvl 5)
          </h4>
          <div className="grid grid-cols-2 gap-2">
            {state.joiners.map((slot, i) => (
              <label key={i} className="flex items-center gap-2 text-xs">
                <span className="opacity-60 w-10">#{i + 1}</span>
                <select
                  value={slot.name ?? ""}
                  onChange={(e) => {
                    const next = e.target.value || null;
                    setState((prev) => {
                      const joiners = prev.joiners.map((j, idx) =>
                        idx === i ? { name: next } : j,
                      );
                      return { ...prev, joiners };
                    });
                  }}
                  className="rounded px-2 py-1 font-mono text-xs flex-1"
                  style={{
                    backgroundColor: "var(--main-bg)",
                    border: "1px solid var(--border-color)",
                    color: "var(--main-text)",
                  }}
                  aria-label={`${which} joiner ${i + 1}`}
                >
                  <option value="">— None —</option>
                  {HEROES.map((h) => (
                    <option key={h.name} value={h.name}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}

      <h4 className="text-xs uppercase tracking-wider opacity-60 mb-2 font-bold">
        Stat Bonuses (%)
      </h4>
      <div className="grid grid-cols-3 gap-3">
        {CATEGORIES.map((cat) => (
          <div key={cat} className="flex flex-col gap-1">
            <span className="text-xs opacity-60">
              {cat === "marksman" ? "Marksman" : cat[0].toUpperCase() + cat.slice(1)}
            </span>
            {STAT_NAMES.map((stat) => {
              const bonus = sideSkill4BonusPercent(state, which, stat as Skill4Stat, rallyMode);
              return (
                <label key={stat} className="flex items-center justify-between gap-1 text-xs">
                  <span className="opacity-60">{stat[0].toUpperCase() + stat.slice(1)}</span>
                  <div className="flex items-center gap-1">
                    {bonus > 0 && (
                      <span
                        className="text-[10px] font-mono"
                        style={{ color: "#a6e3a1" }}
                        title={`Skill 4 will add +${bonus.toFixed(1)}% to this stat before battle.`}
                      >
                        +{bonus.toFixed(1)}%
                      </span>
                    )}
                    <input
                      type="number"
                      step="0.1"
                      value={state.stats[cat][stat]}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        setState((prev) => ({
                          ...prev,
                          stats: {
                            ...prev.stats,
                            [cat]: { ...prev.stats[cat], [stat]: isNaN(v) ? 0 : v },
                          },
                        }));
                      }}
                      className="w-20 rounded px-1.5 py-0.5 font-mono text-xs text-right"
                      style={{
                        backgroundColor: "var(--main-bg)",
                        border: "1px solid var(--border-color)",
                        color: "var(--main-text)",
                      }}
                      aria-label={statLabel(cat, stat)}
                    />
                  </div>
                </label>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function TroopColumn({
  cat,
  which,
  state,
  setState,
  rallyMode,
}: {
  cat: TroopCategory;
  which: Side;
  state: SideState;
  setState: (updater: (prev: SideState) => SideState) => void;
  rallyMode: boolean;
}) {
  const heroSlot = state.heroes[cat];
  const hero = getHero(heroSlot.name);
  const heroOptions = heroesForCategory(cat);
  const skill4 = hero?.skill4;
  const skill4Level = heroSlot.skills[3];
  const skill4Active = rallyMode && skill4 && skill4ActiveForSide(hero, which);
  const skill4Pct = skill4Active ? skill4PercentAt(skill4Level) : 0;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs uppercase tracking-wider opacity-70 font-mono">
        {cat === "marksman" ? "Marksman" : cat[0].toUpperCase() + cat.slice(1)}
      </span>
      <input
        type="number"
        min={0}
        value={state.troops[cat]}
        onChange={(e) => {
          const v = parseInt(e.target.value || "0", 10);
          setState((prev) => ({
            ...prev,
            troops: { ...prev.troops, [cat]: isNaN(v) ? 0 : Math.max(0, v) },
          }));
        }}
        className="rounded px-2 py-1 font-mono text-sm"
        style={{
          backgroundColor: "var(--main-bg)",
          border: "1px solid var(--border-color)",
          color: "var(--main-text)",
        }}
        aria-label={`${cat} troop count`}
      />
      <select
        value={state.tiers[cat]}
        onChange={(e) => {
          const v = e.target.value;
          setState((prev) => ({
            ...prev,
            tiers: { ...prev.tiers, [cat]: v },
          }));
        }}
        className="rounded px-2 py-1 font-mono text-xs"
        style={{
          backgroundColor: "var(--main-bg)",
          border: "1px solid var(--border-color)",
          color: "var(--main-text)",
        }}
        aria-label={`${cat} troop tier`}
      >
        {TROOP_TIERS.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <select
        value={heroSlot.name ?? ""}
        onChange={(e) => {
          const newName = e.target.value || null;
          setState((prev) => {
            const newSkills = deriveSkillsForHero(
              prev.heroes[cat].name,
              prev.heroes[cat].skills,
              newName,
              rallyMode,
            );
            return {
              ...prev,
              heroes: {
                ...prev.heroes,
                [cat]: { name: newName, skills: newSkills },
              },
            };
          });
        }}
        className="rounded px-2 py-1 font-mono text-xs"
        style={{
          backgroundColor: "var(--main-bg)",
          border: "1px solid var(--border-color)",
          color: "var(--main-text)",
        }}
        aria-label={`${cat} hero`}
      >
        <option value="">— None —</option>
        {heroOptions.map((h) => (
          <option key={h.name} value={h.name}>
            {h.name}
          </option>
        ))}
      </select>

      <div className="flex flex-col gap-0.5 mt-1">
        <span className="text-[10px] uppercase tracking-wider opacity-50">
          Skills
        </span>
        {[1, 2, 3, 4].map((slot) => {
          const enabled = skillSlotEnabled(hero, slot as 1 | 2 | 3 | 4, rallyMode);
          return (
            <div key={slot} className="flex flex-col">
              <label className="flex items-center justify-between gap-1 text-[11px]">
                <span className="opacity-60">Skill {slot}</span>
                <select
                  value={heroSlot.skills[slot - 1]}
                  disabled={!enabled}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    setState((prev) => {
                      const skills = [...prev.heroes[cat].skills] as [
                        number,
                        number,
                        number,
                        number,
                      ];
                      skills[slot - 1] = isNaN(v) ? 0 : v;
                      return {
                        ...prev,
                        heroes: {
                          ...prev.heroes,
                          [cat]: { ...prev.heroes[cat], skills },
                        },
                      };
                    });
                  }}
                  className="rounded px-1.5 py-0.5 font-mono text-[11px] w-14"
                  style={{
                    backgroundColor: "var(--main-bg)",
                    border: "1px solid var(--border-color)",
                    color: "var(--main-text)",
                    opacity: enabled ? 1 : 0.4,
                  }}
                  aria-label={`${cat} skill ${slot}`}
                >
                  {[0, 1, 2, 3, 4, 5].map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              {slot === 4 && rallyMode && skill4 && (
                <span
                  className="text-[10px] font-mono text-right mt-0.5"
                  style={{
                    color: skill4Active ? "#a6e3a1" : "#6c7086",
                    opacity: skill4Active ? 1 : 0.6,
                  }}
                  title={
                    skill4Active
                      ? `Active: skill 4 grants +${skill4Pct.toFixed(1)}% ${skill4.stat} to all troops.`
                      : `Inactive on this side: this hero's skill 4 only works on ${skill4.role}.`
                  }
                >
                  {skill4Active
                    ? `+${skill4Pct.toFixed(1)}% ${skill4.stat}`
                    : `(${skill4.role}-only)`}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SkillUseTable({
  title,
  entries,
}: {
  title: string;
  entries: { name: string; avg_activations: number; avg_kills: number }[];
}) {
  if (entries.length === 0) {
    return (
      <div>
        <h4 className="text-xs uppercase tracking-wider opacity-60 mb-2 font-bold">
          {title}
        </h4>
        <p className="text-xs opacity-50">No skill activations.</p>
      </div>
    );
  }
  return (
    <div>
      <h4 className="text-xs uppercase tracking-wider opacity-60 mb-2 font-bold">
        {title}
      </h4>
      <table className="w-full text-xs font-mono">
        <thead>
          <tr
            className="text-left uppercase tracking-wider opacity-50"
            style={{ borderBottom: "1px solid var(--border-color)" }}
          >
            <th className="pb-1 pr-2">Skill</th>
            <th className="pb-1 pr-2 text-right">Avg Trig</th>
            <th className="pb-1 text-right">Avg Kills</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr
              key={e.name}
              style={{ borderBottom: "1px solid var(--border-color)" }}
            >
              <td className="py-1 pr-2 opacity-80">{e.name}</td>
              <td className="py-1 pr-2 text-right">{e.avg_activations.toFixed(1)}</td>
              <td className="py-1 text-right">{e.avg_kills.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
