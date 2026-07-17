"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEventHandler,
  type ReactNode,
} from "react";
import { EditableNumberInput } from "@/components/EditableNumberInput";
import { TroopRatioInput } from "@/components/simulate/TroopRatioInput";
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

function statModifierPercent(baseValue: number, effectiveValue: number): number {
  if (baseValue === 0) return effectiveValue === 0 ? 0 : 100;
  return ((effectiveValue - baseValue) / baseValue) * 100;
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
  const modifierPercent = statModifierPercent(baseValue, effectiveNumber);
  const value = effectiveStatPreview(baseValue, bonusGroups.up, bonusGroups.down);
  const tone =
    !hasModifier || Math.abs(modifierPercent) < 0.05
      ? "neutral"
      : modifierPercent > 0
        ? "up"
        : "down";
  return {
    value,
    modifierText: hasModifier ? ` (${signedPercent(modifierPercent)})` : "",
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

export function SidePanel({
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
}: {
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
}) {
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
                        {h.name}
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

function StatModifierControls({
  which,
  modifiers,
  petModifiers,
  onChange,
  onPetChange,
  onCityPreset,
  onPetPreset,
}: {
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
  return (
    <div className="sim-modifier-editor mt-3">
      <div className="grid grid-cols-1 gap-2">
        <div className="sim-modifier-group">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(9.75rem,auto)] items-center gap-2">
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
          {cityDetailsOpen && (
            <div
              id={`city-modifier-fields-${which}`}
              className="mt-2 grid grid-cols-1 gap-2"
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
          {petDetailsOpen && (
            <div
              id={`pet-modifier-fields-${which}`}
              className="mt-2 grid grid-cols-1 gap-2"
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
        <span className="sim-field-label">Tier</span>
        <select
          name={`${which}.troops.${cat}.tier`}
          value={state.tiers[cat]}
          onChange={(e) => {
            const v = e.target.value;
            setState((prev) => ({
              ...prev,
              tiers: { ...prev.tiers, [cat]: v },
            }));
          }}
          className="sim-input font-mono text-xs"
          aria-label={`${cat} troop tier`}
        >
          {TROOP_TIERS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="sim-hero-field">
        <span className="sim-field-label">Hero</span>
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
              {h.name}
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
