"use client";

import Image from "next/image";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEventHandler,
  type ReactNode,
} from "react";
import { EditableNumberInput } from "@/components/EditableNumberInput";
import { ExperimentalBadge } from "@/components/ExperimentalBadge";
import { TroopRatioInput } from "@/components/simulate/TroopRatioInput";
import {
  snapTroopPercentages,
  troopCountsForPercentages,
  troopPercentagesForCounts,
} from "@/lib/simulate/troop-ratio";
import {
  HEROES,
  Skill4Stat,
  TROOP_TIERS,
  TroopCategory,
  getHero,
  heroesForCategory,
  skill4ActiveForSide,
  skill4PercentAt,
  skillSlotEnabled,
  troopTypeForSelection,
} from "@/lib/heroes-catalogue";
import { HeroBaseStats, heroBaseStats } from "@/lib/hero-base-stats";
import {
  CATEGORIES,
  PET_BUFF_MAX,
  PET_DEBUFF_NAMES,
  PET_DEFAULT_DEBUFF_MAX,
  PET_DEFENSE_DEBUFF_MAX,
  PET_MODIFIER_LABELS,
  PET_MODIFIER_NAMES,
  STAT_MODIFIER_LABELS,
  STAT_MODIFIER_NAMES,
  STAT_MODIFIER_OPTIONS,
  STAT_NAMES,
  STAT_SHORT_LABELS,
  applyStatBonusGroups,
  defaultPetModifiers,
  deriveSkillsForHero,
  effectiveStatBonusGroups,
  effectiveStatPreview,
  manualStatModifierGroups,
  petModifierMax,
  petStatModifierGroups,
  sideSkill4BonusPercent,
  signedPercent,
  statLabel,
  statModifierDescription,
  troopCategoryLabel,
  type PetModifierName,
  type PetModifierState,
  type Side,
  type SideState,
  type SimRoleSectionId,
  type StatModifierName,
  type StatModifierState,
} from "@/lib/simulate/form-state";
import deployStyles from "./DeployArmyPanel.module.css";

export { RecentRunsModal } from "./RecentRunsModal";
export { ProgressBar, ResultCard } from "./ProgressPrimitives";
export {
  StatSyncToastBanner,
  type StatSyncToast,
} from "./StatSyncToastBanner";
export { BattleTraceDetails, SkillUseTable } from "./BattleTraceDetails";

const STAT_NAMES_ORDERED: (keyof HeroBaseStats)[] = [
  "attack",
  "defense",
  "lethality",
  "health",
];

type StatSyncHandler = (info: {
  which: Side;
  cat: TroopCategory;
  oldHeroName: string | null;
  newHeroName: string | null;
  prevStats: Record<string, number>;
  deltas: HeroBaseStats;
}) => void;

interface SidePanelProps {
  title: string;
  which: Side;
  state: SideState;
  opponent: SideState;
  setState: (updater: (prev: SideState) => SideState) => void;
  rallyMode: boolean;
  syncStatsOnHeroChange: boolean;
  onStatSync: StatSyncHandler;
  loadedPresetName: string | null;
  onOpenPreset: () => void;
  variant?: "dashboard" | "deploy";
}

function StatBonusInput({
  value,
  onValueChange,
  ariaLabel,
  name,
}: {
  value: number;
  onValueChange: (value: number) => void;
  ariaLabel: string;
  name: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(String(value));
    }
  }, [value]);

  return (
    <input
      type="text"
      name={name}
      inputMode="decimal"
      pattern="[0-9]*[.,]?[0-9]*"
      value={draft}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={() => {
        focusedRef.current = false;
        const parsed = parseStatBonusDraft(draft);
        const normalized = Number.isNaN(parsed) ? 0 : parsed;
        onValueChange(normalized);
        setDraft(String(normalized));
      }}
      onChange={(e) => {
        focusedRef.current = true;
        const next = e.target.value;
        if (!/^\d*[.,]?\d*$/.test(next)) return;
        setDraft(next);
        const parsed = parseStatBonusDraft(next);
        if (!Number.isNaN(parsed)) {
          onValueChange(parsed);
        }
      }}
      className="simulate-stat-input sim-input h-8 px-1 py-1 text-center font-mono text-[11px] tabular-nums sm:h-9 sm:text-xs"
      aria-label={ariaLabel}
    />
  );
}

function parseStatBonusDraft(value: string): number {
  return parseFloat(value.replace(",", "."));
}

function RoleSection({
  id,
  title,
  summary,
  preview,
  activeSection,
  onActivate,
  children,
  testid,
}: {
  id: SimRoleSectionId;
  title: string;
  summary: string;
  preview?: ReactNode;
  activeSection: SimRoleSectionId | null;
  onActivate: (id: SimRoleSectionId | null) => void;
  children: ReactNode;
  testid?: string;
}) {
  const open = activeSection === id;
  const pointerToggledRef = useRef(false);
  const toggle = () => onActivate(open ? null : id);

  return (
    <section
      data-testid={testid}
      className="sim-section-card p-3 lg:p-3.5"
      data-open={open}
    >
      <button
        type="button"
        onPointerDown={(event) => {
          if (event.pointerType === "mouse" || event.pointerType === "touch") {
            pointerToggledRef.current = true;
            toggle();
          }
        }}
        onClick={() => {
          if (pointerToggledRef.current) {
            pointerToggledRef.current = false;
            return;
          }
          toggle();
        }}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-left"
        aria-expanded={open}
      >
          <span
            className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold"
            style={{
              backgroundColor: "rgba(166, 227, 161, 0.16)",
              color: "var(--sim-green)",
            }}
            aria-hidden="true"
          >
          ✓
        </span>
        <span className="min-w-0">
            <span className="block text-xs font-bold" style={{ color: "var(--sim-blue)" }}>
            {title}
          </span>
          <span className="mt-0.5 block truncate text-[10px] opacity-60">
            {summary}
          </span>
        </span>
          <span
            className="sim-edit-chip px-2 py-1 text-[10px] font-bold"
          >
          {open ? "Close" : "Open"}
        </span>
      </button>
      {open ? <div className="mt-3">{children}</div> : preview}
    </section>
  );
}

function TroopSetupPreview({ state }: { state: SideState }) {
  return (
    <div className="sim-summary-table sim-summary-table-troops" aria-hidden="true">
      {CATEGORIES.map((cat) => (
        <div key={cat} className="sim-summary-row sim-summary-row-troops">
          <span className="sim-summary-name">
            {troopCategoryLabel(cat)}
          </span>
          <span className="font-mono tabular-nums">
            {state.troops[cat].toLocaleString()}
          </span>
          <span className="font-mono">{state.tiers[cat]}</span>
          <span className="truncate">{state.heroes[cat].name ?? "None"}</span>
        </div>
      ))}
    </div>
  );
}

function formattedEffectiveStat(
  baseValue: number,
  bonusGroups: { up: number; down: number },
) {
  const effectiveNumber = applyStatBonusGroups(
    baseValue,
    bonusGroups.up,
    bonusGroups.down,
  );
  const hasModifier = bonusGroups.up !== 0 || bonusGroups.down !== 0;
  const modifierSummary = [
    bonusGroups.up !== 0 ? signedPercent(bonusGroups.up) : null,
    bonusGroups.down !== 0 ? `-${bonusGroups.down.toFixed(1)}%` : null,
  ]
    .filter(Boolean)
    .join(" / ");
  const value = effectiveStatPreview(baseValue, bonusGroups.up, bonusGroups.down);
  const effectiveDelta = effectiveNumber - baseValue;
  const tone =
    !hasModifier || Math.abs(effectiveDelta) < 0.05
      ? "neutral"
      : effectiveDelta > 0
        ? "up"
        : "down";
  return {
    value,
    modifierText: hasModifier ? ` (${modifierSummary})` : "",
    tone,
  };
}

function troopSummaryInitial(cat: TroopCategory): string {
  if (cat === "infantry") return "I";
  if (cat === "lancer") return "L";
  return "M";
}

function StatSetupPreview({
  state,
  opponent,
  which,
  rallyMode,
}: {
  state: SideState;
  opponent: SideState;
  which: Side;
  rallyMode: boolean;
}) {
  return (
    <div
      className="sim-summary-table sim-stat-summary-matrix"
      data-testid="stat-bonus-summary-matrix"
      aria-hidden="true"
    >
      <div className="sim-summary-row sim-stat-summary-row sim-summary-head">
        <span />
        {STAT_NAMES.map((stat) => (
          <span key={stat}>{STAT_SHORT_LABELS[stat]}</span>
        ))}
      </div>
      {CATEGORIES.map((cat) => (
        <div key={cat} className="sim-summary-row sim-stat-summary-row">
          <span className="sim-summary-name" title={troopCategoryLabel(cat)}>
            {troopSummaryInitial(cat)}
          </span>
          {STAT_NAMES.map((stat) => {
            const statValue = formattedEffectiveStat(
              state.stats[cat][stat],
              effectiveStatBonusGroups(state, opponent, which, stat, rallyMode),
            );
            return (
              <span
                key={stat}
                data-testid={`stat-summary-${which}-${cat}-${stat}`}
                className={`sim-summary-stat-value ${
                  statValue.tone === "up"
                    ? "sim-value-up"
                    : statValue.tone === "down"
                      ? "sim-value-down"
                      : ""
                }`}
              >
                <span>{statValue.value}</span>
                {statValue.modifierText ? (
                  <span className="sim-summary-modifier">
                    {statValue.modifierText.trim()}
                  </span>
                ) : null}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function JoinerSetupPreview({ state }: { state: SideState }) {
  const names = state.joiners.map((slot) => slot.name).filter(Boolean);
  return (
    <p className="sim-summary-line" aria-hidden="true">
      {names.length > 0 ? names.join(" · ") : "No joiners selected"}
    </p>
  );
}

function ModifierSetupPreview({ state }: { state: SideState }) {
  const cityActive = STAT_MODIFIER_NAMES.filter(
    (name) => state.statModifiers[name] !== 0,
  ).length;
  const petActive = PET_MODIFIER_NAMES.filter(
    (name) => state.petModifiers[name] !== 0,
  ).length;
  return (
    <p className="sim-summary-line" aria-hidden="true">
      City {cityActive} active · Pets {petActive} active
    </p>
  );
}

function DashboardSidePanel({
  title,
  which,
  state,
  opponent,
  setState,
  rallyMode,
  syncStatsOnHeroChange,
  onStatSync,
  loadedPresetName,
  onOpenPreset,
}: SidePanelProps) {
  const [activeSection, setActiveSection] =
    useState<SimRoleSectionId | null>("troops");
  const troopCountRefs = useRef<Record<TroopCategory, HTMLInputElement | null>>(
    {
      infantry: null,
      lancer: null,
      marksman: null,
    },
  );

  const handleTroopCountTab =
    (cat: TroopCategory): KeyboardEventHandler<HTMLInputElement> =>
    (event) => {
      if (
        event.key !== "Tab" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        (typeof window !== "undefined" &&
          !window.matchMedia("(min-width: 640px)").matches)
      ) {
        return;
      }
      const currentIndex = CATEGORIES.indexOf(cat);
      const nextCat = CATEGORIES[currentIndex + (event.shiftKey ? -1 : 1)];
      if (!nextCat) return;
      event.preventDefault();
      troopCountRefs.current[nextCat]?.focus();
    };

  const totalTroops = CATEGORIES.reduce((sum, cat) => sum + state.troops[cat], 0);
  const heroSummary = CATEGORIES.map((cat) => state.heroes[cat].name ?? "None").join(" / ");
  const tierSummary = CATEGORIES.map((cat) => state.tiers[cat].toUpperCase()).join(" / ");
  const activeJoiners = state.joiners.filter((slot) => slot.name).length;
  const cityActive = STAT_MODIFIER_NAMES.filter(
    (name) => state.statModifiers[name] !== 0,
  ).length;
  const petActive = PET_MODIFIER_NAMES.filter(
    (name) => state.petModifiers[name] !== 0,
  ).length;
  return (
    <div className="sim-role-panel min-w-0" data-tour={`side-panel-${which}`}>
      <div className="flex flex-col gap-2 lg:gap-3">
        <div
          className="sim-role-header p-2.5"
          data-testid={`side-section-${which}-preset`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-xs font-bold" style={{ color: "var(--sim-blue)" }}>
                {title}
              </h3>
              <p className="mt-0.5 truncate text-[10px] opacity-60">
                {loadedPresetName
                  ? `${loadedPresetName} loaded`
                  : "No role preset loaded"}
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenPreset}
              className="sim-profile-button font-bold"
              aria-label={`${which} player profile`}
              data-tour={which === "attacker" ? "stat-presets" : undefined}
            >
              Load / Save
            </button>
          </div>
        </div>

        <RoleSection
          id="troops"
          title="Troops, tiers, heroes"
          summary={`${totalTroops.toLocaleString()} troops · ${heroSummary} · ${tierSummary}`}
          preview={<TroopSetupPreview state={state} />}
          activeSection={activeSection}
          onActivate={setActiveSection}
          testid={`side-section-${which}-troops`}
        >
          <div className="grid grid-cols-1 gap-2">
            <TroopRatioInput
              counts={state.troops}
              onChange={(troops) => {
                setState((prev) => ({ ...prev, troops }));
              }}
              label={title}
              testId={`troop-ratio-${which}`}
            />
            {CATEGORIES.map((cat) => (
              <TroopColumn
                key={cat}
                cat={cat}
                which={which}
                state={state}
                setState={setState}
                rallyMode={rallyMode}
                syncStatsOnHeroChange={syncStatsOnHeroChange}
                onStatSync={onStatSync}
                countInputRef={(node) => {
                  troopCountRefs.current[cat] = node;
                }}
                onCountKeyDown={handleTroopCountTab(cat)}
              />
            ))}
          </div>
        </RoleSection>

        <RoleSection
          id="stats"
          title="Stat bonuses"
          summary="3 troop types × 4 stats"
          preview={
            <StatSetupPreview
              state={state}
              opponent={opponent}
              which={which}
              rallyMode={rallyMode}
            />
          }
          activeSection={activeSection}
          onActivate={setActiveSection}
          testid={`side-section-${which}-stats`}
        >
          <div
            className="sim-stat-edit-matrix"
            data-testid="stat-bonus-edit-matrix"
          >
            <div className="sim-stat-edit-row sim-stat-edit-head">
              <span />
              {STAT_NAMES.map((stat) => (
                <span key={stat}>{STAT_SHORT_LABELS[stat]}</span>
              ))}
            </div>
            {CATEGORIES.map((cat) => (
              <div
                key={cat}
                className="sim-stat-edit-row"
              >
                <span className="sim-summary-name" title={troopCategoryLabel(cat)}>
                  {troopSummaryInitial(cat)}
                </span>
                {STAT_NAMES.map((stat) => {
                  const skill4Bonus = sideSkill4BonusPercent(
                    state,
                    which,
                    stat as Skill4Stat,
                    rallyMode,
                  );
                  const manualGroups = manualStatModifierGroups(
                    state.statModifiers,
                    opponent.statModifiers,
                    stat,
                  );
                  const petGroups = petStatModifierGroups(
                    state.petModifiers,
                    opponent.petModifiers,
                    stat,
                  );
                  const bonusGroups = effectiveStatBonusGroups(
                    state,
                    opponent,
                    which,
                    stat,
                    rallyMode,
                  );
                  const baseValue = state.stats[cat][stat];
                  const hasBonus =
                    bonusGroups.up !== 0 || bonusGroups.down !== 0;
                  const previewValue = hasBonus
                    ? effectiveStatPreview(
                        baseValue,
                        bonusGroups.up,
                        bonusGroups.down,
                      )
                    : null;
                  const previewNumber = hasBonus
                    ? applyStatBonusGroups(
                        baseValue,
                        bonusGroups.up,
                        bonusGroups.down,
                      )
                    : baseValue;
                  const modifierSummary = [
                    bonusGroups.up !== 0 ? signedPercent(bonusGroups.up) : null,
                    bonusGroups.down !== 0
                      ? `-${bonusGroups.down.toFixed(1)}%`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" / ");
                  const sourceText = [
                    skill4Bonus !== 0
                      ? `skill 4 ${signedPercent(skill4Bonus)}`
                      : null,
                    manualGroups.up !== 0
                      ? `manual ${signedPercent(manualGroups.up)}`
                      : null,
                    manualGroups.down !== 0
                      ? `manual -${manualGroups.down.toFixed(1)}%`
                      : null,
                    petGroups.up !== 0
                      ? `pet ${signedPercent(petGroups.up)}`
                      : null,
                    petGroups.down !== 0
                      ? `pet -${petGroups.down.toFixed(1)}%`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <label
                      key={stat}
                      className="sim-stat-edit-cell"
                    >
                      <span className="sr-only">{STAT_SHORT_LABELS[stat]}</span>
                      <StatBonusInput
                        value={baseValue}
                        onValueChange={(v) => {
                          setState((prev) => ({
                            ...prev,
                            stats: {
                              ...prev.stats,
                              [cat]: {
                                ...prev.stats[cat],
                                [stat]: isNaN(v) ? 0 : v,
                              },
                            },
                          }));
                        }}
                        ariaLabel={statLabel(cat, stat)}
                        name={`${which}.stats.${cat}.${stat}`}
                      />
                      {previewValue ? (
                        <span
                          className="min-h-[1.7rem] text-center font-mono text-[8px] leading-tight sm:text-[9px]"
                          style={{
                            color:
                              previewNumber >= baseValue ? "#a6e3a1" : "#f38ba8",
                          }}
                        >
                          <span
                            title={`${sourceText || "Manual modifiers"} apply before battle, for an effective stat of ${previewValue}.`}
                            data-testid={`stat-preview-${which}-${cat}-${stat}`}
                          >
                            <span className="block truncate">[{previewValue}]</span>
                            <span className="block truncate">{modifierSummary}</span>
                          </span>
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
        </RoleSection>

        {rallyMode && (
          <RoleSection
            id="joiners"
            title="Joiners"
            summary={`${activeJoiners}/4 selected`}
            preview={<JoinerSetupPreview state={state} />}
            activeSection={activeSection}
            onActivate={setActiveSection}
            testid={`side-section-${which}-joiners`}
          >
            <div className="grid grid-cols-1 gap-2">
              {state.joiners.map((slot, i) => (
                <label key={i} className="flex items-center gap-2 text-xs">
                  <span className="w-10 flex-shrink-0 opacity-60">#{i + 1}</span>
	                  <select
	                    name={`${which}.joiners.${i}.hero`}
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
                    className="min-h-[40px] min-w-0 flex-1 rounded px-2 py-2 font-mono text-xs"
                    style={{
                      backgroundColor: "var(--sim-field)",
                      border: "1px solid var(--sim-line)",
                      color: "var(--sim-text)",
                    }}
                    aria-label={`${which} joiner ${i + 1}`}
                  >
                    <option value="">— None —</option>
                    {HEROES.map((h) => (
                      <option key={h.name} value={h.name}>
                        {h.experimental ? "🔮 " : ""}{h.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </RoleSection>
        )}

        <RoleSection
          id="buffs"
          title="Buffs and debuffs"
          summary={`City ${cityActive} active · Pets ${petActive} active`}
          preview={<ModifierSetupPreview state={state} />}
          activeSection={activeSection}
          onActivate={setActiveSection}
          testid={`side-section-${which}-buffs`}
        >
          <StatModifierControls
            which={which}
            modifiers={state.statModifiers}
            petModifiers={state.petModifiers}
            onChange={(name, value) => {
              setState((prev) => ({
                ...prev,
                statModifiers: {
                  ...prev.statModifiers,
                  [name]: value,
                },
              }));
            }}
            onPetChange={(name, value) => {
              setState((prev) => ({
                ...prev,
                petModifiers: {
                  ...prev.petModifiers,
                  [name]: value,
                },
              }));
            }}
            onCityPreset={(value) => {
              setState((prev) => ({
                ...prev,
                statModifiers: STAT_MODIFIER_NAMES.reduce(
                  (next, name) => ({ ...next, [name]: value }),
                  {} as StatModifierState,
                ),
              }));
            }}
            onPetPreset={(enabled) => {
              setState((prev) => ({
                ...prev,
                petModifiers: enabled
                  ? {
                      attack: PET_BUFF_MAX,
                      defense: PET_BUFF_MAX,
                      lethality: PET_BUFF_MAX,
                      health: PET_BUFF_MAX,
                      enemy_defense: PET_DEFENSE_DEBUFF_MAX,
                      enemy_lethality: PET_DEFAULT_DEBUFF_MAX,
                      enemy_health: PET_DEFAULT_DEBUFF_MAX,
                    }
                  : defaultPetModifiers(),
              }));
            }}
          />
        </RoleSection>
      </div>
    </div>
  );
}

const DEPLOY_CATEGORY_GLYPHS: Record<TroopCategory, string> = {
  infantry: "◆",
  lancer: "➤",
  marksman: "⌁",
};

const DEPLOY_HERO_AVATARS = new Set([
  "Ahmose",
  "Alonso",
  "Bahiti",
  "Bradley",
  "Edith",
  "Flint",
  "Gatot",
  "Gordon",
  "Greg",
  "Gwen",
  "Hector",
  "Hendrik",
  "Jasser",
  "Jeronimo",
  "Jessie",
  "Ling",
  "Logan",
  "Lumak",
  "Lynn",
  "Mia",
  "Molly",
  "Natalia",
  "Norah",
  "Patrick",
  "Philly",
  "Reina",
  "Renee",
  "Seo-yoon",
  "Sergey",
  "Sonya",
  "Wayne",
  "WuMing",
  "Zinman",
]);

type DeploySetupSheet = "skills" | "joiners" | "buffs";

type DeployRatios = Record<TroopCategory, number>;

function clampTroopCountToCapacity(
  troops: SideState["troops"],
  category: TroopCategory,
  nextValue: number,
  capacity: number,
): SideState["troops"] {
  const otherTotal = CATEGORIES.reduce(
    (sum, current) => sum + (current === category ? 0 : troops[current]),
    0,
  );
  return {
    ...troops,
    [category]: Math.max(
      0,
      Math.min(Math.max(0, capacity - otherTotal), Math.round(nextValue)),
    ),
  };
}

function troopsForPercentages(
  total: number,
  infantryPercent: number,
  lancerPercent: number,
): SideState["troops"] {
  const infantry = Math.round((total * infantryPercent) / 100);
  const lancer = Math.round((total * lancerPercent) / 100);
  return {
    infantry,
    lancer,
    marksman: Math.max(0, total - infantry - lancer),
  };
}

function deployRatiosForTroops(troops: SideState["troops"]): DeployRatios {
  const [infantry, lancer, marksman] = snapTroopPercentages(
    troopPercentagesForCounts(troops),
  );
  return infantry + lancer + marksman === 0
    ? { infantry: 33, lancer: 33, marksman: 34 }
    : { infantry, lancer, marksman };
}

function DeployTypeCrest({ category }: { category: TroopCategory }) {
  return (
    <span
      className={deployStyles.typeCrest}
      data-category={category}
      aria-hidden="true"
    >
      {DEPLOY_CATEGORY_GLYPHS[category]}
    </span>
  );
}

function heroInitials(name: string): string {
  const words = name.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[\s-]+/);
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function deployHeroAvatarPath(name: string): string | null {
  if (!DEPLOY_HERO_AVATARS.has(name)) return null;
  const slug = name === "WuMing"
    ? "wu_ming"
    : name.toLowerCase().replace(/[\s-]+/g, "_");
  return `/hero-avatars/${slug}.webp`;
}

function DeployHeroPortrait({
  name,
  category,
}: {
  name: string;
  category: TroopCategory;
}) {
  const avatarPath = deployHeroAvatarPath(name);
  return (
    <span
      className={deployStyles.heroPortrait}
      data-category={category}
      data-has-avatar={Boolean(avatarPath)}
    >
      {avatarPath ? (
      <Image
        src={avatarPath}
        alt=""
        fill
        loading="eager"
        sizes="(max-width: 639px) 120px, 220px"
        className={deployStyles.heroPortraitImage}
      />
      ) : (
        <span>{heroInitials(name)}</span>
      )}
    </span>
  );
}

function applyDeployHeroSelection({
  category,
  newName,
  which,
  state,
  setState,
  rallyMode,
  syncStatsOnHeroChange,
  onStatSync,
}: {
  category: TroopCategory;
  newName: string | null;
  which: Side;
  state: SideState;
  setState: SidePanelProps["setState"];
  rallyMode: boolean;
  syncStatsOnHeroChange: boolean;
  onStatSync: StatSyncHandler;
}) {
  const previousName = state.heroes[category].name;
  let statSnapshot: Record<string, number> | null = null;
  let deltas: HeroBaseStats | null = null;
  if (syncStatsOnHeroChange && previousName !== newName) {
    const oldBase = heroBaseStats(previousName);
    const newBase = heroBaseStats(newName);
    const computed: HeroBaseStats = {
      attack: newBase.attack - oldBase.attack,
      defense: newBase.defense - oldBase.defense,
      lethality: newBase.lethality - oldBase.lethality,
      health: newBase.health - oldBase.health,
    };
    if (STAT_NAMES_ORDERED.some((stat) => Math.abs(computed[stat]) > 1e-9)) {
      statSnapshot = { ...state.stats[category] };
      deltas = computed;
    }
  }

  setState((previous) => {
    const skills = deriveSkillsForHero(
      previous.heroes[category].name,
      previous.heroes[category].skills,
      newName,
      rallyMode,
    );
    let stats = previous.stats;
    if (deltas) {
      const nextCategoryStats = { ...previous.stats[category] };
      for (const stat of STAT_NAMES_ORDERED) {
        nextCategoryStats[stat] =
          Math.round(((nextCategoryStats[stat] ?? 0) + deltas[stat]) * 100) /
          100;
      }
      stats = { ...previous.stats, [category]: nextCategoryStats };
    }
    return {
      ...previous,
      heroes: {
        ...previous.heroes,
        [category]: { name: newName, skills },
      },
      stats,
    };
  });

  if (statSnapshot && deltas) {
    onStatSync({
      which,
      cat: category,
      oldHeroName: previousName,
      newHeroName: newName,
      prevStats: statSnapshot,
      deltas,
    });
  }
}

function DeployHeroPicker({
  initialCategory,
  which,
  state,
  onSelect,
  onClose,
}: {
  initialCategory: TroopCategory;
  which: Side;
  state: SideState;
  onSelect: (category: TroopCategory, name: string | null) => void;
  onClose: () => void;
}) {
  const [category, setCategory] = useState(initialCategory);
  const [sort, setSort] = useState<"generation" | "name">("generation");
  const [query, setQuery] = useState("");
  const selected = state.heroes[category].name;
  const [focused, setFocused] = useState<string | null>(selected);
  const heroes = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const options = heroesForCategory(category).filter((hero) =>
      normalizedQuery.length === 0
        ? true
        : hero.name.toLowerCase().includes(normalizedQuery),
    );
    if (sort === "name") return options.sort((a, b) => a.name.localeCompare(b.name));
    return options.sort((a, b) => {
      const generation = (value: string | null) => {
        const match = /\d+/.exec(value ?? "");
        return match ? Number(match[0]) : 0;
      };
      return generation(b.generation) - generation(a.generation) ||
        a.name.localeCompare(b.name);
    });
  }, [category, query, sort]);

  return (
    <div className={deployStyles.backdrop} role="presentation" onMouseDown={onClose}>
      <section
        className={deployStyles.picker}
        role="dialog"
        aria-modal="true"
        aria-label="Select heroes"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={deployStyles.modalHeader}>
          <span className={deployStyles.snowCap} aria-hidden="true" />
          <h3>Select Heroes</h3>
          <button type="button" onClick={onClose} aria-label="Close hero picker">×</button>
        </header>
        <div className={deployStyles.pickerAssignments}>
          <DeployHeroSlots
            which={which}
            state={state}
            activeCategory={category}
            onChoose={(nextCategory) => {
              setCategory(nextCategory);
              setFocused(state.heroes[nextCategory].name);
              setQuery("");
            }}
          />
        </div>
        <div className={deployStyles.pickerToolbar}>
          <span><DeployTypeCrest category={category} /> {troopCategoryLabel(category)}</span>
          <label className={deployStyles.heroSearch}>
            <span className="sr-only">Search heroes</span>
            <input
              type="search"
              value={query}
              onChange={(event) => {
                const nextQuery = event.target.value;
                setQuery(nextQuery);
                if (focused && !focused.toLowerCase().includes(nextQuery.trim().toLowerCase())) {
                  setFocused(null);
                }
              }}
              placeholder="Search heroes"
              aria-label="Search heroes"
            />
          </label>
          <label>
            <span>Sort</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as "generation" | "name")}>
              <option value="generation">Generation</option>
              <option value="name">Name</option>
            </select>
          </label>
        </div>
        <div className={deployStyles.heroGrid}>
          {heroes.map((hero) => (
            <button
              key={hero.name}
              type="button"
              className={deployStyles.heroGridCard}
              data-active={focused === hero.name}
              data-assigned={selected === hero.name}
              aria-pressed={focused === hero.name}
              onClick={() => {
                if (focused === hero.name) {
                  onSelect(category, hero.name);
                  return;
                }
                setFocused(hero.name);
              }}
            >
              <DeployHeroPortrait name={hero.name} category={category} />
              <DeployTypeCrest category={category} />
              <strong>{hero.name}</strong>
              <small>{hero.generation ?? "Hero"}</small>
              {selected === hero.name ? (
                <span className={deployStyles.assignedBadge}>Assigned</span>
              ) : null}
              {hero.experimental ? <ExperimentalBadge /> : null}
            </button>
          ))}
          {heroes.length === 0 ? (
            <p className={deployStyles.noHeroes}>No heroes match “{query}”.</p>
          ) : null}
        </div>
        <footer className={deployStyles.modalFooter}>
          <button
            type="button"
            className={deployStyles.secondaryButton}
            onClick={() => {
              onSelect(category, null);
              setFocused(null);
            }}
          >
            Clear slot
          </button>
          <button
            type="button"
            className={deployStyles.gameButton}
            disabled={!focused}
            onClick={() => onSelect(category, focused)}
          >
            Assign
          </button>
        </footer>
      </section>
    </div>
  );
}

function DeployHeroSlots({
  which,
  state,
  activeCategory,
  onChoose,
}: {
  which: Side;
  state: SideState;
  activeCategory?: TroopCategory;
  onChoose: (category: TroopCategory) => void;
}) {
  return (
    <div className={deployStyles.heroSlots} aria-label={`${which} heroes`}>
      {CATEGORIES.map((category) => {
        const hero = getHero(state.heroes[category].name);
        return (
          <button
            key={category}
            type="button"
            className={deployStyles.heroSlot}
            data-active={activeCategory === category}
            data-empty={!hero}
            onClick={() => onChoose(category)}
            aria-label={`Choose ${category} hero, currently ${hero?.name ?? "none"}`}
            data-testid={`deploy-hero-${which}-${category}`}
          >
            {hero ? (
              <>
                <DeployHeroPortrait name={hero.name} category={category} />
                <DeployTypeCrest category={category} />
                <span className={deployStyles.heroGeneration}>{hero.generation ?? "Hero"}</span>
                <strong>{hero.name}</strong>
                <small>Tap to change</small>
              </>
            ) : (
              <>
                <DeployTypeCrest category={category} />
                <span className={deployStyles.addHero}>+</span>
                <strong>Add hero</strong>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

function DeployTroopRow({
  category,
  which,
  state,
  setState,
  capacity,
  setTroops,
}: {
  category: TroopCategory;
  which: Side;
  state: SideState;
  setState: SidePanelProps["setState"];
  capacity: number;
  setTroops: (updater: (troops: SideState["troops"]) => SideState["troops"]) => void;
}) {
  const selectedTier = state.tiers[category];
  const isCustom = !TROOP_TIERS.includes(selectedTier);
  const [editingCustom, setEditingCustom] = useState(isCustom);
  const total = CATEGORIES.reduce((sum, current) => sum + state.troops[current], 0);
  const count = state.troops[category];
  const percent = total > 0 ? Math.round((count / total) * 100) : 0;
  const step = Math.max(1, Math.round(Math.max(capacity, 100) / 100));
  const otherTotal = total - count;
  const maxCount = Math.max(0, capacity - otherTotal);

  const setCount = (nextCount: number) => {
    setTroops((troops) =>
      clampTroopCountToCapacity(troops, category, nextCount, capacity),
    );
  };

  return (
    <div className={deployStyles.troopRow} data-category={category} data-testid={`sim-unit-row-${which}-${category}`}>
      <div className={deployStyles.troopIdentity}>
        <DeployTypeCrest category={category} />
        <span>
          <strong>{troopCategoryLabel(category)}</strong>
          {editingCustom ? (
            <input
              autoFocus
              name={`${which}.troops.${category}.tier`}
              value={selectedTier}
              aria-label={`${category} custom troop type`}
              onChange={(event) => setState((previous) => ({
                ...previous,
                tiers: { ...previous.tiers, [category]: event.target.value },
              }))}
              onBlur={() => {
                if (!troopTypeForSelection(category, selectedTier)) {
                  setState((previous) => ({ ...previous, tiers: { ...previous.tiers, [category]: TROOP_TIERS[0] } }));
                  setEditingCustom(false);
                }
              }}
              placeholder="t6_fc10"
            />
          ) : (
            <select
              name={`${which}.troops.${category}.tier`}
              value={selectedTier}
              aria-label={`${category} troop tier`}
              onChange={(event) => {
                if (event.target.value === "__other__") {
                  setState((previous) => ({ ...previous, tiers: { ...previous.tiers, [category]: "" } }));
                  setEditingCustom(true);
                } else {
                  setState((previous) => ({ ...previous, tiers: { ...previous.tiers, [category]: event.target.value } }));
                }
              }}
            >
              {TROOP_TIERS.map((tier) => <option key={tier} value={tier}>{tier.toUpperCase()}</option>)}
              <option value="__other__">Custom</option>
            </select>
          )}
        </span>
      </div>
      <div className={deployStyles.troopAmount}>
        <button type="button" aria-label={`Remove ${category} troops`} onClick={() => setCount(count - step)}>−</button>
        <label>
          <span className="sr-only">{category} troop count</span>
          <EditableNumberInput
            name={`${which}.troops.${category}.count`}
            min={0}
            max={maxCount}
            inputMode="numeric"
            parse="int"
            value={count}
            onValueChange={setCount}
            aria-label={`${category} troop count`}
          />
          <small>{percent}%</small>
        </label>
        <button type="button" aria-label={`Add ${category} troops`} onClick={() => setCount(count + step)}>+</button>
      </div>
      <input
        className={deployStyles.troopSlider}
        type="range"
        min={0}
        max={Math.max(capacity, 1)}
        step={1}
        value={Math.min(count, Math.max(capacity, 1))}
        disabled={capacity === 0}
        aria-label={`${category} troop ratio`}
        aria-valuemax={maxCount}
        style={{ "--fill": `${capacity > 0 ? (count / capacity) * 100 : 0}%` } as React.CSSProperties}
        onChange={(event) => setCount(Number(event.target.value))}
      />
    </div>
  );
}

function DeployStatsSheet({
  which,
  state,
  opponent,
  rallyMode,
  setState,
}: Pick<SidePanelProps, "which" | "state" | "opponent" | "rallyMode" | "setState">) {
  return (
    <div className={deployStyles.reportTable} data-testid="stat-bonus-edit-matrix">
      <div className={deployStyles.reportHead}>
        <span>Troop</span>
        {STAT_NAMES.map((stat) => <span key={stat}>{STAT_SHORT_LABELS[stat]}</span>)}
      </div>
      {CATEGORIES.map((category) => (
        <div className={deployStyles.reportRow} key={category}>
          <strong><DeployTypeCrest category={category} /> {troopCategoryLabel(category)}</strong>
          {STAT_NAMES.map((stat) => {
            const base = state.stats[category][stat];
            const bonuses = effectiveStatBonusGroups(state, opponent, which, stat, rallyMode);
            const effective = effectiveStatPreview(base, bonuses.up, bonuses.down);
            return (
              <label key={stat}>
                <StatBonusInput
                  value={base}
                  onValueChange={(value) => setState((previous) => ({
                    ...previous,
                    stats: { ...previous.stats, [category]: { ...previous.stats[category], [stat]: Number.isNaN(value) ? 0 : value } },
                  }))}
                  ariaLabel={statLabel(category, stat)}
                  name={`${which}.stats.${category}.${stat}`}
                />
                {(bonuses.up !== 0 || bonuses.down !== 0) ? (
                  <small data-testid={`stat-preview-${which}-${category}-${stat}`}>Effective {effective}</small>
                ) : null}
              </label>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function DeploySkillsSheet({
  which,
  state,
  rallyMode,
  setState,
}: Pick<SidePanelProps, "which" | "state" | "rallyMode" | "setState">) {
  return (
    <div className={deployStyles.skillRows}>
      {CATEGORIES.map((category) => {
        const hero = getHero(state.heroes[category].name);
        if (!hero) return (
          <p key={category} className={deployStyles.emptySheetRow}>
            <DeployTypeCrest category={category} /> Choose a {troopCategoryLabel(category)} hero to configure skills.
          </p>
        );
        return (
          <section key={category} className={deployStyles.skillHeroRow}>
            <div><DeployHeroPortrait name={hero.name} category={category} /><span><strong>{hero.name}</strong><small>{hero.generation ?? troopCategoryLabel(category)}</small></span></div>
            <div>
              {[1, 2, 3, 4].map((slot) => {
                const enabled = skillSlotEnabled(hero, slot as 1 | 2 | 3 | 4, rallyMode);
                const skill = hero.skills.find((entry) => entry.skillNum === slot);
                return (
                  <label key={slot} title={skill?.name ?? `Skill ${slot}`}>
                    <span>S{slot}</span>
                    <select
                      name={`${which}.heroes.${category}.skill${slot}`}
                      value={state.heroes[category].skills[slot - 1]}
                      disabled={!enabled}
                      aria-label={`${category} skill ${slot}`}
                      onChange={(event) => setState((previous) => {
                        const skills = [...previous.heroes[category].skills] as [number, number, number, number];
                        skills[slot - 1] = Number(event.target.value);
                        return { ...previous, heroes: { ...previous.heroes, [category]: { ...previous.heroes[category], skills } } };
                      })}
                    >
                      {[0, 1, 2, 3, 4, 5].map((level) => <option key={level} value={level}>{level}</option>)}
                    </select>
                  </label>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function DeploySetupModal({
  sheet,
  title,
  onClose,
  children,
}: {
  sheet: DeploySetupSheet;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className={deployStyles.backdrop} role="presentation" onMouseDown={onClose}>
      <section className={deployStyles.setupModal} role="dialog" aria-modal="true" aria-label={`${title} ${sheet}`} onMouseDown={(event) => event.stopPropagation()}>
        <header className={deployStyles.modalHeader}>
          <span className={deployStyles.snowCap} aria-hidden="true" />
          <h3>{sheet === "buffs" ? "Battle buffs" : sheet === "skills" ? "Hero skills" : "Rally joiners"}</h3>
          <button type="button" onClick={onClose} aria-label={`Close ${sheet}`}>×</button>
        </header>
        <div className={deployStyles.setupModalBody}>{children}</div>
        <footer className={deployStyles.modalFooter}>
          <button type="button" className={deployStyles.gameButton} onClick={onClose}>Done</button>
        </footer>
      </section>
    </div>
  );
}

function DeployBalancePopover({
  title,
  troops,
  capacity,
  onApply,
  onClose,
}: {
  title: string;
  troops: SideState["troops"];
  capacity: number;
  onApply: (troops: SideState["troops"]) => void;
  onClose: () => void;
}) {
  const [ratios, setRatios] = useState<DeployRatios>(() =>
    deployRatiosForTroops(troops),
  );
  const totalRatio = CATEGORIES.reduce(
    (sum, category) => sum + ratios[category],
    0,
  );

  const setRatio = (category: TroopCategory, nextValue: number) => {
    setRatios((previous) => {
      const otherTotal = CATEGORIES.reduce(
        (sum, current) =>
          sum + (current === category ? 0 : previous[current]),
        0,
      );
      return {
        ...previous,
        [category]: Math.max(
          0,
          Math.min(100 - otherTotal, Math.round(nextValue)),
        ),
      };
    });
  };

  return (
    <div className={deployStyles.backdrop} role="presentation" onMouseDown={onClose}>
      <section
        className={`${deployStyles.setupModal} ${deployStyles.balancePopover}`}
        role="dialog"
        aria-modal="true"
        aria-label={`${title} balance`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={deployStyles.modalHeader}>
          <span className={deployStyles.snowCap} aria-hidden="true" />
          <h3>Balance</h3>
          <button type="button" onClick={onClose} aria-label="Close balance">×</button>
        </header>
        <div className={deployStyles.balanceBody}>
          <div className={deployStyles.balanceCapacity} data-complete={totalRatio === 100}>
            <span aria-hidden="true">♟</span>
            <strong>{totalRatio}% / 100%</strong>
          </div>
          {CATEGORIES.map((category) => {
            const otherTotal = totalRatio - ratios[category];
            const maxRatio = 100 - otherTotal;
            const label = troopCategoryLabel(category);
            return (
              <div className={deployStyles.balanceRow} data-category={category} key={category}>
                <DeployTypeCrest category={category} />
                <strong>{label}</strong>
                <button
                  type="button"
                  aria-label={`Reduce ${category} balance ratio`}
                  disabled={ratios[category] === 0}
                  onClick={() => setRatio(category, ratios[category] - 1)}
                >
                  −
                </button>
                <input
                  className={deployStyles.balanceSlider}
                  type="range"
                  min={0}
                  max={100}
                  value={ratios[category]}
                  aria-label={`${category} balance ratio`}
                  aria-valuemax={maxRatio}
                  style={{ "--fill": `${ratios[category]}%` } as React.CSSProperties}
                  onChange={(event) => setRatio(category, Number(event.target.value))}
                />
                <button
                  type="button"
                  aria-label={`Increase ${category} balance ratio`}
                  disabled={ratios[category] === maxRatio}
                  onClick={() => setRatio(category, ratios[category] + 1)}
                >
                  +
                </button>
                <label>
                  <input
                    type="number"
                    min={0}
                    max={maxRatio}
                    value={ratios[category]}
                    aria-label={`${category} balance percentage`}
                    onChange={(event) => setRatio(category, Number(event.target.value))}
                  />
                  <span>%</span>
                </label>
              </div>
            );
          })}
        </div>
        <footer className={deployStyles.modalFooter}>
          <button type="button" className={deployStyles.secondaryButton} onClick={onClose}>Cancel</button>
          <button
            type="button"
            className={deployStyles.gameButton}
            disabled={totalRatio !== 100 || capacity === 0}
            onClick={() => {
              onApply(troopCountsForPercentages(capacity, [
                ratios.infantry,
                ratios.lancer,
                ratios.marksman,
              ]));
              onClose();
            }}
          >
            Confirm
          </button>
        </footer>
      </section>
    </div>
  );
}

function DeployArmyPanel({
  title,
  which,
  state,
  opponent,
  setState,
  rallyMode,
  syncStatsOnHeroChange,
  onStatSync,
  loadedPresetName,
  onOpenPreset,
}: SidePanelProps) {
  const [heroPicker, setHeroPicker] = useState<TroopCategory | null>(null);
  const [setupSheet, setSetupSheet] = useState<DeploySetupSheet | null>(null);
  const [balanceOpen, setBalanceOpen] = useState(false);
  const total = CATEGORIES.reduce((sum, category) => sum + state.troops[category], 0);
  const [capacity, setCapacity] = useState(total);
  const localTroopUpdateRef = useRef(false);
  useEffect(() => {
    if (localTroopUpdateRef.current) {
      localTroopUpdateRef.current = false;
      return;
    }
    setCapacity(total);
  }, [state.troops, total]);
  const setTroops = (
    updater: (troops: SideState["troops"]) => SideState["troops"],
  ) => {
    localTroopUpdateRef.current = true;
    setState((previous) => ({ ...previous, troops: updater(previous.troops) }));
  };
  const percentages = CATEGORIES.map((category) => total > 0 ? Math.round((state.troops[category] / total) * 100) : 0);
  const activeBuffs = STAT_MODIFIER_NAMES.filter((name) => state.statModifiers[name] !== 0).length + PET_MODIFIER_NAMES.filter((name) => state.petModifiers[name] !== 0).length;
  const activeJoiners = state.joiners.filter((slot) => slot.name).length;

  return (
    <section className={deployStyles.armyPanel} data-tour={`side-panel-${which}`} data-side={which}>
      <header className={deployStyles.armyHeader}>
        <span className={deployStyles.snowCap} aria-hidden="true" />
        <div><small>{title === "Player army" ? "Rally march" : which === "attacker" ? "Offensive march" : "Defensive march"}</small><h2>{title}</h2></div>
      </header>

      <div className={deployStyles.capacityBar}>
        <span><b aria-hidden="true">♟</b> {total.toLocaleString()} / {capacity.toLocaleString()} troops</span>
        <button type="button" onClick={() => setSetupSheet("buffs")}><span>Battle Buffs</span><strong>{activeBuffs > 0 ? `${activeBuffs} active` : "Add buffs"}</strong><b aria-hidden="true">+</b></button>
      </div>

      <DeployHeroSlots which={which} state={state} onChoose={setHeroPicker} />

      <div
        className={deployStyles.troopList}
        data-testid={`side-section-${which}-troops`}
      >
        {CATEGORIES.map((category) => <DeployTroopRow key={category} category={category} which={which} state={state} setState={setState} capacity={capacity} setTroops={setTroops} />)}
      </div>

      <div className={deployStyles.ratioStrip}>
        <span>Troop ratio</span>
        {CATEGORIES.map((category, index) => <span key={category}><DeployTypeCrest category={category} /> {percentages[index]}%</span>)}
      </div>

      <div className={deployStyles.quickActions}>
        <button type="button" onClick={() => setTroops(() => ({ infantry: 0, lancer: 0, marksman: 0 }))}><span aria-hidden="true">↶</span><strong>Withdraw</strong></button>
        <button type="button" disabled={capacity === 0} onClick={() => setTroops(() => troopsForPercentages(capacity, 33.34, 33.33))}><span aria-hidden="true">⚖</span><strong>Equalize</strong></button>
        <button type="button" disabled={capacity === 0} onClick={() => setBalanceOpen(true)}><span aria-hidden="true">☷</span><strong>Balance</strong></button>
      </div>

      <section
        className={deployStyles.inlineStats}
        data-testid={`side-section-${which}-stats`}
      >
        <header className={deployStyles.inlineStatsHeader}>
          <div><strong>Stat bonuses</strong><small>Base + effective</small></div>
          <button
            type="button"
            className={deployStyles.profileButton}
            onClick={onOpenPreset}
            aria-label={`${which} player profile`}
            data-tour={which === "attacker" ? "stat-presets" : undefined}
          >
            <span aria-hidden="true">♙</span><span><strong>Profile</strong><small>{loadedPresetName ?? "Not loaded"}</small></span>
          </button>
        </header>
        <DeployStatsSheet
          which={which}
          state={state}
          opponent={opponent}
          rallyMode={rallyMode}
          setState={setState}
        />
      </section>

      <div className={deployStyles.setupDock} data-testid={`deploy-setup-dock-${which}`}>
        <button type="button" onClick={() => setSetupSheet("skills")}><span>✦</span><strong>Skills</strong><small>Skill levels</small></button>
        {rallyMode ? <button type="button" onClick={() => setSetupSheet("joiners")} data-testid={`side-section-${which}-joiners`}><span>♟</span><strong>Joiners</strong><small>{activeJoiners}/4 assigned</small></button> : null}
        <button type="button" onClick={() => setSetupSheet("buffs")} data-testid={`side-section-${which}-buffs`}><span>+</span><strong>Buffs</strong><small>{activeBuffs} active</small></button>
      </div>

      {heroPicker ? (
        <DeployHeroPicker
          initialCategory={heroPicker}
          which={which}
          state={state}
          onClose={() => setHeroPicker(null)}
          onSelect={(category, name) => {
            applyDeployHeroSelection({ category, newName: name, which, state, setState, rallyMode, syncStatsOnHeroChange, onStatSync });
          }}
        />
      ) : null}

      {balanceOpen ? (
        <DeployBalancePopover
          title={title}
          troops={state.troops}
          capacity={capacity}
          onApply={(troops) => setTroops(() => troops)}
          onClose={() => setBalanceOpen(false)}
        />
      ) : null}

      {setupSheet ? (
        <DeploySetupModal sheet={setupSheet} title={title} onClose={() => setSetupSheet(null)}>
          {setupSheet === "skills" ? <DeploySkillsSheet which={which} state={state} rallyMode={rallyMode} setState={setState} /> : null}
          {setupSheet === "joiners" ? (
            <div className={deployStyles.joinerRows}>
              {state.joiners.map((slot, index) => (
                <label key={index}><span><b>#{index + 1}</b> Joiner hero</span><select name={`${which}.joiners.${index}.hero`} value={slot.name ?? ""} aria-label={`${which} joiner ${index + 1}`} onChange={(event) => setState((previous) => ({ ...previous, joiners: previous.joiners.map((joiner, current) => current === index ? { name: event.target.value || null } : joiner) }))}><option value="">None</option>{HEROES.map((hero) => <option key={hero.name} value={hero.name}>{hero.experimental ? "Experimental - " : ""}{hero.name}</option>)}</select></label>
              ))}
            </div>
          ) : null}
          {setupSheet === "buffs" ? (
            <div className={deployStyles.modifierSheet}>
              <StatModifierControls
                expanded
                which={which}
                modifiers={state.statModifiers}
                petModifiers={state.petModifiers}
                onChange={(name, value) => setState((previous) => ({ ...previous, statModifiers: { ...previous.statModifiers, [name]: value } }))}
                onPetChange={(name, value) => setState((previous) => ({ ...previous, petModifiers: { ...previous.petModifiers, [name]: value } }))}
                onCityPreset={(value) => setState((previous) => ({ ...previous, statModifiers: STAT_MODIFIER_NAMES.reduce((next, name) => ({ ...next, [name]: value }), {} as StatModifierState) }))}
                onPetPreset={(enabled) => setState((previous) => ({ ...previous, petModifiers: enabled ? { attack: PET_BUFF_MAX, defense: PET_BUFF_MAX, lethality: PET_BUFF_MAX, health: PET_BUFF_MAX, enemy_defense: PET_DEFENSE_DEBUFF_MAX, enemy_lethality: PET_DEFAULT_DEBUFF_MAX, enemy_health: PET_DEFAULT_DEBUFF_MAX } : defaultPetModifiers() }))}
              />
            </div>
          ) : null}
        </DeploySetupModal>
      ) : null}
    </section>
  );
}

export function SidePanel(props: SidePanelProps) {
  return props.variant === "deploy" ? (
    <DeployArmyPanel {...props} />
  ) : (
    <DashboardSidePanel {...props} />
  );
}

function StatModifierControls({
  expanded = false,
  which,
  modifiers,
  petModifiers,
  onChange,
  onPetChange,
  onCityPreset,
  onPetPreset,
}: {
  expanded?: boolean;
  which: Side;
  modifiers: StatModifierState;
  petModifiers: PetModifierState;
  onChange: (name: StatModifierName, value: number) => void;
  onPetChange: (name: PetModifierName, value: number) => void;
  onCityPreset: (value: 0 | 10 | 20) => void;
  onPetPreset: (enabled: boolean) => void;
}) {
  const cityPreset = STAT_MODIFIER_OPTIONS.find((value) =>
    STAT_MODIFIER_NAMES.every((name) => modifiers[name] === value),
  );
  const petEnabled = PET_MODIFIER_NAMES.some((name) => petModifiers[name] !== 0);
  const [cityDetailsOpen, setCityDetailsOpen] = useState(false);
  const [petDetailsOpen, setPetDetailsOpen] = useState(false);
  const showCityDetails = expanded || cityDetailsOpen;
  const showPetDetails = expanded || petDetailsOpen;
  return (
    <div className="sim-modifier-editor mt-3" data-expanded={expanded}>
      <div className="sim-modifier-groups grid grid-cols-1 gap-2">
        <div className="sim-modifier-group">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(9.75rem,auto)] items-center gap-2">
            {expanded ? (
              <strong className="sim-modifier-title">City</strong>
            ) : (
              <button
                type="button"
                aria-expanded={cityDetailsOpen}
                aria-controls={`city-modifier-fields-${which}`}
                data-testid={`city-modifier-details-${which}`}
                onClick={() => setCityDetailsOpen((open) => !open)}
                className="flex min-h-[30px] w-full min-w-0 items-center gap-1 text-left text-[10px] font-bold opacity-70 hover:opacity-100"
              >
                <span className="w-3 text-center text-[9px] opacity-70">
                  {cityDetailsOpen ? "▼" : "▶"}
                </span>
                <span className="truncate">City</span>
              </button>
            )}
            <div className="sim-segmented">
              {STAT_MODIFIER_OPTIONS.map((value) => {
                const selected = cityPreset === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-label={`${which} city buffs ${value}%`}
                    aria-pressed={selected}
                    data-testid={`city-modifier-${which}-${value}`}
                    onClick={() => onCityPreset(value)}
                    data-active={selected}
                    title={`Set all city buffs/debuffs to ${value}%`}
                  >
                    {value}%
                  </button>
                );
              })}
            </div>
          </div>
          {showCityDetails && (
            <div
              id={`city-modifier-fields-${which}`}
              className="sim-modifier-fields mt-2 grid grid-cols-1 gap-2"
            >
              {STAT_MODIFIER_NAMES.map((name) => (
                <SegmentedCityModifier
                  key={name}
                  which={which}
                  name={name}
                  value={modifiers[name]}
                  onChange={onChange}
                />
              ))}
            </div>
          )}
        </div>

        <div className="sim-modifier-group">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(9.75rem,auto)] items-center gap-2">
            {expanded ? (
              <strong className="sim-modifier-title">Pets</strong>
            ) : (
              <button
                type="button"
                aria-expanded={petDetailsOpen}
                aria-controls={`pet-modifier-fields-${which}`}
                data-testid={`pet-modifier-details-${which}`}
                onClick={() => setPetDetailsOpen((open) => !open)}
                className="flex min-h-[30px] w-full min-w-0 items-center gap-1 text-left text-[10px] font-bold opacity-70 hover:opacity-100"
              >
                <span className="w-3 text-center text-[9px] opacity-70">
                  {petDetailsOpen ? "▼" : "▶"}
                </span>
                <span className="truncate">Pets</span>
              </button>
            )}
            <button
              type="button"
              aria-label={`${which} pet buffs ${petEnabled ? "off" : "on"}`}
              aria-pressed={petEnabled}
              data-testid={`pet-modifier-${which}-toggle`}
              onClick={() => onPetPreset(!petEnabled)}
              className="sim-compact-toggle"
              data-active={petEnabled}
              title="Toggle pet buffs at max values and debuffs at strongest values."
            >
              {petEnabled ? "On" : "Off"}
            </button>
          </div>
          {showPetDetails && (
            <div
              id={`pet-modifier-fields-${which}`}
              className="sim-modifier-fields mt-2 grid grid-cols-1 gap-2"
            >
              {PET_MODIFIER_NAMES.map((name) => (
                <PetModifierInput
                  key={name}
                  which={which}
                  name={name}
                  value={petModifiers[name]}
                  onChange={onPetChange}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SegmentedCityModifier({
  which,
  name,
  value,
  onChange,
}: {
  which: Side;
  name: StatModifierName;
  value: number;
  onChange: (name: StatModifierName, value: number) => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(9.75rem,auto)] items-center gap-2">
      <span className="min-w-0 truncate text-[10px] opacity-70">
        {STAT_MODIFIER_LABELS[name]}
      </span>
      <div className="sim-segmented">
        {STAT_MODIFIER_OPTIONS.map((option) => {
          const selected = value === option;
          return (
            <button
              key={option}
              type="button"
              aria-label={`${which} ${STAT_MODIFIER_LABELS[name]} ${statModifierDescription(name, option)}`}
              aria-pressed={selected}
              data-testid={`stat-modifier-${which}-${name}-${option}`}
              onClick={() => onChange(name, option)}
              data-active={selected}
              title={`${STAT_MODIFIER_LABELS[name]} ${statModifierDescription(name, option)}`}
            >
              {statModifierDescription(name, option)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PetModifierInput({
  which,
  name,
  value,
  onChange,
}: {
  which: Side;
  name: PetModifierName;
  value: number;
  onChange: (name: PetModifierName, value: number) => void;
}) {
  const isDebuff = PET_DEBUFF_NAMES.includes(name);
  const max = petModifierMax(name);
  const display = isDebuff && value > 0 ? `-${value.toFixed(1)}%` : `+${value.toFixed(1)}%`;
  return (
    <label className="grid grid-cols-[minmax(0,1fr)_5rem_3.25rem] items-center gap-2 text-[10px]">
      <span className="min-w-0 truncate opacity-70">
        {PET_MODIFIER_LABELS[name]}
      </span>
      <EditableNumberInput
        name={`${which}.pets.${name}`}
        min={0}
        max={max}
        step={0.5}
        value={value}
        onValueChange={(parsed) => {
          const next = Math.max(0, Math.min(max, Math.round(parsed * 2) / 2));
          onChange(name, next);
        }}
        className="sim-input min-h-[30px] px-2 text-right text-[10px] tabular-nums"
        aria-label={`${which} pet ${PET_MODIFIER_LABELS[name]}`}
        data-testid={`pet-modifier-${which}-${name}`}
      />
      <span
        className="text-right font-mono tabular-nums"
        style={{ color: isDebuff && value > 0 ? "#f38ba8" : "#a6e3a1" }}
      >
        {value === 0 ? "Off" : display}
      </span>
    </label>
  );
}

function TroopColumn({
  cat,
  which,
  state,
  setState,
  rallyMode,
  syncStatsOnHeroChange,
  onStatSync,
  countInputRef,
  onCountKeyDown,
}: {
  cat: TroopCategory;
  which: Side;
  state: SideState;
  setState: (updater: (prev: SideState) => SideState) => void;
  rallyMode: boolean;
  syncStatsOnHeroChange: boolean;
  onStatSync: StatSyncHandler;
  countInputRef?: (node: HTMLInputElement | null) => void;
  onCountKeyDown?: KeyboardEventHandler<HTMLInputElement>;
}) {
  const heroSlot = state.heroes[cat];
  const hero = getHero(heroSlot.name);
  const heroOptions = heroesForCategory(cat);
  const skill4 = hero?.skill4;
  const skill4Level = heroSlot.skills[3];
  const skill4Active = rallyMode && skill4 && skill4ActiveForSide(hero, which);
  const skill4Pct = skill4Active ? skill4PercentAt(skill4Level) : 0;
  const selectedTier = state.tiers[cat];
  const selectedCustomTroopType =
    !TROOP_TIERS.includes(selectedTier) &&
    troopTypeForSelection(cat, selectedTier) !== null;
  const [customTroopTypeDraft, setCustomTroopTypeDraft] = useState<
    string | null
  >(null);
  const fallbackTierRef = useRef(
    TROOP_TIERS.includes(selectedTier)
      ? selectedTier
      : (TROOP_TIERS[0] ?? "t1"),
  );
  const customTroopTypeActive =
    customTroopTypeDraft !== null || selectedCustomTroopType;
  const customTroopTypeValue = customTroopTypeDraft ?? selectedTier;

  useEffect(() => {
    if (TROOP_TIERS.includes(selectedTier)) {
      fallbackTierRef.current = selectedTier;
    }
  }, [selectedTier]);

  const commitCustomTroopType = () => {
    const troopType = customTroopTypeValue.trim();
    if (troopTypeForSelection(cat, troopType)) {
      setState((prev) => ({
        ...prev,
        tiers: { ...prev.tiers, [cat]: troopType },
      }));
      setCustomTroopTypeDraft(troopType);
      return;
    }

    setState((prev) => ({
      ...prev,
      tiers: { ...prev.tiers, [cat]: fallbackTierRef.current },
    }));
    setCustomTroopTypeDraft(null);
  };

  return (
    <div
      className="sim-unit-row"
      data-testid={`sim-unit-row-${which}-${cat}`}
    >
      <span className="sim-unit-name truncate">
        {troopCategoryLabel(cat)}
      </span>
      <label>
        <span className="sim-field-label">Troops</span>
        <EditableNumberInput
          ref={countInputRef}
          name={`${which}.troops.${cat}.count`}
          min={0}
          inputMode="numeric"
          value={state.troops[cat]}
          parse="int"
          onKeyDown={onCountKeyDown}
          onValueChange={(value) => {
            setState((prev) => ({
              ...prev,
              troops: {
                ...prev.troops,
                [cat]: Math.max(0, value),
              },
            }));
          }}
          className="sim-input font-mono text-xs tabular-nums"
          style={{ textAlign: "right" }}
          aria-label={`${cat} troop count`}
        />
      </label>
      <label>
        <span className="sim-field-label">
          {customTroopTypeActive ? "Troop type" : "Tier"}
        </span>
        {customTroopTypeActive ? (
          <input
            autoFocus
            name={`${which}.troops.${cat}.tier`}
            value={customTroopTypeValue}
            onChange={(event) => {
              setCustomTroopTypeDraft(event.target.value);
            }}
            onBlur={commitCustomTroopType}
            className="sim-input font-mono text-xs"
            aria-label={`${cat} custom troop type`}
            placeholder="t6_fc10"
          />
        ) : (
          <select
            name={`${which}.troops.${cat}.tier`}
            value={selectedTier}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "__other__") {
                setCustomTroopTypeDraft("");
                return;
              }
              setState((prev) => ({
                ...prev,
                tiers: { ...prev.tiers, [cat]: value },
              }));
            }}
            className="sim-input font-mono text-xs"
            aria-label={`${cat} troop tier`}
          >
            {TROOP_TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {tier}
              </option>
            ))}
            <option value="__other__">Other</option>
          </select>
        )}
      </label>
      <label className="sim-hero-field">
        <span className="sim-field-label flex items-center gap-1">
          Hero {hero?.experimental && <ExperimentalBadge />}
        </span>
        <select
          name={`${which}.heroes.${cat}.name`}
          value={heroSlot.name ?? ""}
          onChange={(e) => {
            const newName = e.target.value || null;
            const prevHeroName = state.heroes[cat].name;

            // Pre-compute the stat delta + snapshot outside setState so TS
            // flow analysis can see it, and so we can emit the toast payload
            // after the state update without a closure-narrowing workaround.
            let statSnapshot: Record<string, number> | null = null;
            let deltas: HeroBaseStats | null = null;
            if (syncStatsOnHeroChange && prevHeroName !== newName) {
              const oldBase = heroBaseStats(prevHeroName);
              const newBase = heroBaseStats(newName);
              const computed: HeroBaseStats = {
                attack: newBase.attack - oldBase.attack,
                defense: newBase.defense - oldBase.defense,
                lethality: newBase.lethality - oldBase.lethality,
                health: newBase.health - oldBase.health,
              };
              const anyDelta = STAT_NAMES_ORDERED.some(
                (k) => Math.abs(computed[k]) > 1e-9,
              );
              if (anyDelta) {
                statSnapshot = { ...state.stats[cat] };
                deltas = computed;
              }
            }

            setState((prev) => {
              const newSkills = deriveSkillsForHero(
                prev.heroes[cat].name,
                prev.heroes[cat].skills,
                newName,
                rallyMode,
              );
              let nextStats = prev.stats;
              if (deltas) {
                const prevCatStats = prev.stats[cat];
                const nextCatStats: Record<string, number> = {
                  ...prevCatStats,
                };
                for (const k of STAT_NAMES_ORDERED) {
                  const curr = prevCatStats[k] ?? 0;
                  // Round to 2 decimals to match source JSON precision and
                  // avoid long floating-point trails in the input field.
                  nextCatStats[k] = Math.round((curr + deltas[k]) * 100) / 100;
                }
                nextStats = { ...prev.stats, [cat]: nextCatStats };
              }
              return {
                ...prev,
                heroes: {
                  ...prev.heroes,
                  [cat]: { name: newName, skills: newSkills },
                },
                stats: nextStats,
              };
            });

            if (statSnapshot && deltas) {
              onStatSync({
                which,
                cat,
                oldHeroName: prevHeroName,
                newHeroName: newName,
                prevStats: statSnapshot,
                deltas,
              });
            }
          }}
          className="sim-input font-mono text-xs"
          aria-label={`${cat} hero`}
        >
          <option value="">— None —</option>
          {heroOptions.map((h) => (
            <option key={h.name} value={h.name}>
              {h.experimental ? "🔮 " : ""}{h.name}
            </option>
          ))}
        </select>
      </label>

      {hero && (
        <div className="sim-skill-strip">
          {[1, 2, 3, 4].map((slot) => {
            const enabled = skillSlotEnabled(
              hero,
              slot as 1 | 2 | 3 | 4,
              rallyMode,
            );
            return (
              <label key={slot} className="min-w-0">
                <span className="sim-field-label text-center">S{slot}</span>
                <select
                  name={`${which}.heroes.${cat}.skill${slot}`}
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
                  className="sim-input h-8 px-1 font-mono text-[11px]"
                  style={{ opacity: enabled ? 1 : 0.45 }}
                  aria-label={`${cat} skill ${slot}`}
                >
                  {[0, 1, 2, 3, 4, 5].map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
          {rallyMode && skill4 && (
            <span
              className="col-span-4 truncate text-right font-mono text-[10px]"
              style={{
                color: skill4Active ? "var(--sim-green)" : "var(--sim-muted)",
                opacity: skill4Active ? 1 : 0.6,
              }}
              title={
                skill4Active
                  ? `Active: skill 4 grants +${skill4Pct.toFixed(1)}% ${skill4.stat} to all troops.`
                  : `Inactive on this side: this hero's skill 4 only works on ${skill4.role}.`
              }
            >
              {skill4Active
                ? `Skill 4: +${skill4Pct.toFixed(1)}% ${skill4.stat}`
                : `Skill 4 (${skill4.role}-only)`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
