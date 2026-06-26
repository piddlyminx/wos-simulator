"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  TroopCategory,
  heroesForCategory,
  getHero,
  skill4ActiveForSide,
  skill4PercentAt,
} from "@/lib/heroes-catalogue";

const CATEGORIES: TroopCategory[] = ["infantry", "lancer", "marksman"];
const STAT_MODIFIER_NAMES = [
  "attack",
  "defense",
  "lethality",
  "health",
  "enemy_attack",
  "enemy_defense",
] as const;
const STAT_MODIFIER_OPTIONS = [0, 10, 20] as const;
const PET_MODIFIER_NAMES = [
  "attack",
  "defense",
  "lethality",
  "health",
  "enemy_defense",
  "enemy_lethality",
  "enemy_health",
] as const;
const PET_DEBUFF_NAMES: PetModifierName[] = [
  "enemy_defense",
  "enemy_lethality",
  "enemy_health",
];
const PET_BUFF_MAX = 10;
const PET_DEFAULT_DEBUFF_MAX = 5;
const PET_DEFENSE_DEBUFF_MAX = 10;
const STAT_MODIFIER_LABELS: Record<StatModifierName, string> = {
  attack: "Attack",
  defense: "Defense",
  lethality: "Lethality",
  health: "Health",
  enemy_attack: "Enemy Atk",
  enemy_defense: "Enemy Def",
};
const PET_MODIFIER_LABELS: Record<PetModifierName, string> = {
  attack: "Attack",
  defense: "Defense",
  lethality: "Lethality",
  health: "Health",
  enemy_defense: "Enemy Defense",
  enemy_lethality: "Enemy Lethality",
  enemy_health: "Enemy Health",
};

export type StatModifierName = (typeof STAT_MODIFIER_NAMES)[number];
export type PetModifierName = (typeof PET_MODIFIER_NAMES)[number];
export type UploadStatModifierState = Record<StatModifierName, number>;
export type UploadPetModifierState = Record<PetModifierName, number>;
export interface UploadActiveModifiers {
  statModifiers: UploadStatModifierState;
  petModifiers: UploadPetModifierState;
}

export type HeroSelection = Record<TroopCategory, string | null>;
export type Skill4LevelMap = Record<TroopCategory, number>;

export interface OcrSideData {
  troops: Record<TroopCategory, number | null>;
  troop_types?: Record<TroopCategory, string | null>;
  stats: Record<TroopCategory, Record<string, number | null>>;
}

export interface OcrResult {
  attacker: OcrSideData;
  defender: OcrSideData;
  raw_text?: string;
  warnings?: string[];
  ocr_retried?: boolean;
}

export interface UploadReportSubmission {
  ocr: OcrResult;
  heroes: {
    attacker: HeroSelection;
    defender: HeroSelection;
  };
  rallyMode: boolean;
  sidesSwapped: boolean;
  skill4Levels: {
    attacker: Skill4LevelMap;
    defender: Skill4LevelMap;
  };
  activeModifiers: {
    attacker: UploadActiveModifiers;
    defender: UploadActiveModifiers;
  };
}

interface Props {
  open: boolean;
  onClose: () => void;
  onApply: (submission: UploadReportSubmission) => void;
  initialRallyMode?: boolean;
  initialSidesSwapped?: boolean;
}

const emptyHeroes = (): HeroSelection => ({
  infantry: null,
  lancer: null,
  marksman: null,
});

const emptySkill4 = (): Skill4LevelMap => ({
  infantry: 5,
  lancer: 5,
  marksman: 5,
});

const defaultStatModifiers = (): UploadStatModifierState => ({
  attack: 0,
  defense: 0,
  lethality: 0,
  health: 0,
  enemy_attack: 0,
  enemy_defense: 0,
});

const defaultPetModifiers = (): UploadPetModifierState => ({
  attack: 0,
  defense: 0,
  lethality: 0,
  health: 0,
  enemy_defense: 0,
  enemy_lethality: 0,
  enemy_health: 0,
});

const defaultActiveModifiers = (): UploadActiveModifiers => ({
  statModifiers: defaultStatModifiers(),
  petModifiers: defaultPetModifiers(),
});

export default function UploadReportModal({
  open,
  onClose,
  onApply,
  initialRallyMode = false,
  initialSidesSwapped = false,
}: Props) {
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attackerHeroes, setAttackerHeroes] = useState<HeroSelection>(emptyHeroes);
  const [defenderHeroes, setDefenderHeroes] = useState<HeroSelection>(emptyHeroes);
  const [rallyMode, setRallyMode] = useState(initialRallyMode);
  const [attackerSkill4, setAttackerSkill4] = useState<Skill4LevelMap>(emptySkill4);
  const [defenderSkill4, setDefenderSkill4] = useState<Skill4LevelMap>(emptySkill4);
  const [attackerModifiers, setAttackerModifiers] =
    useState<UploadActiveModifiers>(defaultActiveModifiers);
  const [defenderModifiers, setDefenderModifiers] =
    useState<UploadActiveModifiers>(defaultActiveModifiers);
  // Reports always show "me" on the left. When the user is the defender, they
  // toggle this so the OCR left column is treated as defender, not attacker.
  // Initial value is read from the parent so the modal opens in the same order
  // as the main simulate page.
  const [sidesSwapped, setSidesSwapped] = useState(initialSidesSwapped);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync rally toggle + sides-swap with the caller whenever the modal opens,
  // so the modal always starts in the same state as the main page.
  useEffect(() => {
    if (open) {
      setRallyMode(initialRallyMode);
      setSidesSwapped(initialSidesSwapped);
    }
  }, [open, initialRallyMode, initialSidesSwapped]);

  const reset = useCallback(() => {
    setImageDataUrl(null);
    setImageBase64(null);
    setDragging(false);
    setLoading(false);
    setError(null);
    setAttackerHeroes(emptyHeroes());
    setDefenderHeroes(emptyHeroes());
    setAttackerSkill4(emptySkill4());
    setDefenderSkill4(emptySkill4());
    setAttackerModifiers(defaultActiveModifiers());
    setDefenderModifiers(defaultActiveModifiers());
    setSidesSwapped(false);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const loadFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      setError(`Unsupported file type: ${file.type || "unknown"}`);
      return;
    }
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setImageDataUrl(dataUrl);
      const commaIdx = dataUrl.indexOf(",");
      setImageBase64(commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl);
    };
    reader.onerror = () => {
      setError("Failed to read file.");
    };
    reader.readAsDataURL(file);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) loadFile(file);
    },
    [loadFile],
  );

  const onFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) loadFile(file);
    },
    [loadFile],
  );

  // Paste-image support while the modal is open.
  useEffect(() => {
    if (!open) return;
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            loadFile(file);
            e.preventDefault();
            return;
          }
        }
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    window.addEventListener("paste", onPaste);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, loadFile, handleClose]);

  async function submit() {
    if (!imageBase64) {
      setError("Please provide an image first.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ocr-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_base64: imageBase64 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `OCR request failed (${res.status})`);
        setLoading(false);
        return;
      }
      const parsed = data as OcrResult;
      const ocr: OcrResult = sidesSwapped
        ? {
            ...parsed,
            attacker: parsed.defender,
            defender: parsed.attacker,
          }
        : parsed;
      onApply({
        ocr,
        heroes: {
          attacker: { ...attackerHeroes },
          defender: { ...defenderHeroes },
        },
        rallyMode,
        sidesSwapped,
        skill4Levels: {
          attacker: { ...attackerSkill4 },
          defender: { ...defenderSkill4 },
        },
        activeModifiers: {
          attacker: cloneActiveModifiers(attackerModifiers),
          defender: cloneActiveModifiers(defenderModifiers),
        },
      });
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center p-0 sm:p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label="Upload battle report"
    >
      <div
        className="sim-modal w-full max-w-3xl max-h-screen overflow-y-auto sm:max-h-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="sim-modal-header sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--sim-line)] px-3 py-3 sm:px-4"
        >
          <h3 className="sim-modal-title">Upload report</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <label
              className="sim-toggle grid min-w-[9.5rem] cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-2 px-2.5 py-1.5 text-xs font-bold"
              data-active={rallyMode}
              title="Rally mode: skill 4 is applied, so OCR stats are scaled down before filling the main form."
            >
              <input
                className="sim-switch-input"
                type="checkbox"
                checked={rallyMode}
                onChange={(e) => setRallyMode(e.target.checked)}
                aria-label="Rally mode"
              />
              <span className="sim-switch" aria-hidden="true" />
              <span>Rally mode</span>
            </label>
            <button
              type="button"
              onClick={handleClose}
              className="sim-edit-chip min-h-[36px] px-3 py-2 text-xs font-bold"
              aria-label="Close"
            >
              Close
            </button>
          </div>
        </div>

        <div className="p-3 sm:p-4 flex flex-col gap-3 sm:gap-4">
          <div
            className="sim-tool-panel grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_11rem]"
          >
            <div className="flex flex-col gap-2 text-xs leading-relaxed">
              <p className="sim-modal-section-title">
                Upload a Stat Bonuses screenshot like this example.
              </p>
              <p className="sim-modal-copy">
                Troop counts must be shown as absolute numbers, not percentages.
                Keep the troop avatars, troop counts, and every stat row in frame
                so the parser can read the troop types and all bonuses.
              </p>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/examples/stat-bonuses-report.png"
              alt="Reference Stat Bonuses report with troop avatars, troop counts, and all stat rows visible"
              className="w-full rounded object-cover"
              style={{
                border: "1px solid var(--sim-line)",
                maxHeight: 180,
                objectPosition: "top",
              }}
            />
          </div>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className="sim-upload-dropzone relative flex cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden p-4 text-center"
            data-dragging={dragging}
            style={{
              minHeight: 220,
            }}
            role="button"
            aria-label="Drop zone"
          >
            {imageDataUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={imageDataUrl}
                alt="battle report preview"
                style={{ maxHeight: 260, maxWidth: "100%", objectFit: "contain" }}
              />
            ) : (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/examples/stat-bonuses-report.png"
                  alt="Example Stat Bonuses report with troop avatars, troop counts, and all stat rows visible"
                  className="absolute inset-0 h-full w-full object-cover opacity-25"
                  style={{ objectPosition: "top" }}
                />
                <span
                  className="relative rounded px-3 py-2 text-sm font-bold"
                  style={{ backgroundColor: "rgba(24,24,37,0.86)" }}
                >
                  Drop report here, tap to choose, or paste into this area
                </span>
                <span
                  className="relative rounded px-3 py-2 text-xs opacity-80"
                  style={{ backgroundColor: "rgba(24,24,37,0.86)" }}
                >
                  Use a Stat Bonuses screenshot with both armies, troop counts,
                  heroes, and stat rows visible.
                </span>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={onFileInputChange}
              className="hidden"
            />
          </div>
          {imageDataUrl && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setImageDataUrl(null);
                  setImageBase64(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                className="sim-edit-chip min-h-[32px] px-3 py-1 text-xs font-bold"
              >
                Clear image
              </button>
            </div>
          )}

          <div className="flex flex-col md:flex-row items-stretch gap-2">
            <div className="flex-1 min-w-0" style={{ order: sidesSwapped ? 3 : 1 }}>
              <HeroPickerPanel
                title="Attacker heroes"
                which="attacker"
                heroes={attackerHeroes}
                onChange={setAttackerHeroes}
                skill4={attackerSkill4}
                onSkill4Change={setAttackerSkill4}
                activeModifiers={attackerModifiers}
                onActiveModifiersChange={setAttackerModifiers}
                rallyMode={rallyMode}
              />
            </div>
            <div
              className="flex md:flex-col items-center justify-center"
              style={{ order: 2 }}
            >
              <button
                type="button"
                onClick={() => setSidesSwapped((v) => !v)}
                className="sim-edit-chip min-h-[36px] px-3 py-2 text-xs font-bold"
                style={{
                  backgroundColor: sidesSwapped
                    ? "rgba(137, 180, 250, 0.15)"
                    : "var(--sim-panel)",
                  color: sidesSwapped ? "var(--sim-blue)" : "var(--sim-text)",
                }}
                title="Swap attacker and defender. Use this when you were the defender in the report — battle reports always show 'me' on the left."
                aria-label="Swap attacker and defender"
                aria-pressed={sidesSwapped}
              >
                ⇆ Swap
              </button>
            </div>
            <div className="flex-1 min-w-0" style={{ order: sidesSwapped ? 1 : 3 }}>
              <HeroPickerPanel
                title="Defender heroes"
                which="defender"
                heroes={defenderHeroes}
                onChange={setDefenderHeroes}
                skill4={defenderSkill4}
                onSkill4Change={setDefenderSkill4}
                activeModifiers={defenderModifiers}
                onActiveModifiersChange={setDefenderModifiers}
                rallyMode={rallyMode}
              />
            </div>
          </div>

          {error && (
            <div
              className="sim-tool-panel px-3 py-2 text-xs font-mono"
              style={{
                color: "#f38ba8",
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div
          className="sim-modal-footer sticky bottom-0 z-10 flex flex-col-reverse gap-2 border-t border-[var(--sim-line)] px-3 py-3 sm:flex-row sm:justify-end sm:px-4"
        >
          <button
            type="button"
            onClick={handleClose}
            className="sim-edit-chip min-h-[44px] px-3 py-2 text-xs font-bold"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={loading || !imageBase64}
            className="sim-run-button min-h-[44px] px-3 py-2 text-xs font-bold"
            style={{
              opacity: loading || !imageBase64 ? 0.5 : 1,
              cursor: loading || !imageBase64 ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Parsing…" : "Parse and apply"}
          </button>
        </div>
      </div>
    </div>
  );
}

function HeroPickerPanel({
  title,
  which,
  heroes,
  onChange,
  skill4,
  onSkill4Change,
  activeModifiers,
  onActiveModifiersChange,
  rallyMode,
}: {
  title: string;
  which: "attacker" | "defender";
  heroes: HeroSelection;
  onChange: (next: HeroSelection) => void;
  skill4: Skill4LevelMap;
  onSkill4Change: (next: Skill4LevelMap) => void;
  activeModifiers: UploadActiveModifiers;
  onActiveModifiersChange: (next: UploadActiveModifiers) => void;
  rallyMode: boolean;
}) {
  const cityPreset = STAT_MODIFIER_OPTIONS.find((value) =>
    STAT_MODIFIER_NAMES.every(
      (name) => activeModifiers.statModifiers[name] === value,
    ),
  );
  const petEnabled = PET_MODIFIER_NAMES.some(
    (name) => activeModifiers.petModifiers[name] !== 0,
  );
  const [cityDetailsOpen, setCityDetailsOpen] = useState(false);
  const [petDetailsOpen, setPetDetailsOpen] = useState(false);
  const updateStatModifier = (name: StatModifierName, value: number) => {
    onActiveModifiersChange({
      ...activeModifiers,
      statModifiers: { ...activeModifiers.statModifiers, [name]: value },
    });
  };
  const updatePetModifier = (name: PetModifierName, value: number) => {
    onActiveModifiersChange({
      ...activeModifiers,
      petModifiers: { ...activeModifiers.petModifiers, [name]: value },
    });
  };
  return (
    <div className="sim-tool-panel p-3">
      <h4 className="sim-modal-section-title mb-2">
        {title}
      </h4>
      <div className="flex flex-col gap-2">
        {CATEGORIES.map((cat) => {
          const options = heroesForCategory(cat);
          const label =
            cat === "marksman" ? "Marksman" : cat[0].toUpperCase() + cat.slice(1);
          const hero = getHero(heroes[cat]);
          const showSkill4 = rallyMode && hero?.skill4;
          const active = showSkill4 && skill4ActiveForSide(hero, which);
          const pct = active ? skill4PercentAt(skill4[cat]) : 0;
          return (
            <div key={cat} className="flex flex-col gap-1">
              <label className="flex items-center justify-between gap-2 text-xs">
                <span className="sim-field-label w-16">{label}</span>
                <select
                  value={heroes[cat] ?? ""}
                  onChange={(e) => {
                    onChange({ ...heroes, [cat]: e.target.value || null });
                  }}
                  className="sim-input min-h-[32px] flex-1 px-2 py-1 font-mono text-xs"
                  aria-label={`${title} ${cat}`}
                >
                  <option value="">— None —</option>
                  {options.map((h) => (
                    <option key={h.name} value={h.name}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </label>
              {showSkill4 && (
                <label className="flex items-center justify-between gap-2 text-[11px] pl-16">
                  <span className="sim-field-label">Skill 4 level</span>
                  <select
                    value={skill4[cat]}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      onSkill4Change({ ...skill4, [cat]: isNaN(v) ? 0 : v });
                    }}
                    className="sim-input min-h-[30px] w-14 px-1.5 py-0.5 font-mono text-[11px]"
                    aria-label={`${title} ${cat} skill 4 level`}
                  >
                    {[0, 1, 2, 3, 4, 5].map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <span
                    className="font-mono flex-1 text-right"
                    style={{
                      color: active ? "#a6e3a1" : "#6c7086",
                      opacity: active ? 1 : 0.6,
                    }}
                    title={
                      active
                        ? `Skill 4 adds +${pct.toFixed(1)}% ${hero!.skill4!.stat}. OCR value will be scaled down by this amount.`
                        : `Inactive on ${which} side (this skill only works on ${hero!.skill4!.role}).`
                    }
                  >
                    {active
                      ? `+${pct.toFixed(1)}% ${hero!.skill4!.stat}`
                      : `(${hero!.skill4!.role}-only)`}
                  </span>
                </label>
              )}
            </div>
          );
        })}
      </div>
      <div className="sim-modifier-editor mt-3">
        <h5 className="sim-modal-section-title">Buffs and debuffs</h5>
        <div className="grid grid-cols-1 gap-2">
          <div className="sim-modifier-group">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(9.75rem,auto)] items-center gap-2">
              <button
                type="button"
                aria-expanded={cityDetailsOpen}
                aria-controls={`upload-city-modifier-fields-${which}`}
                data-testid={`upload-city-modifier-details-${which}`}
                onClick={() => setCityDetailsOpen((open) => !open)}
                className="flex min-h-[30px] min-w-0 items-center gap-1 text-left text-[10px] font-bold opacity-70 hover:opacity-100"
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
                      aria-label={`${which} upload city buffs ${value}%`}
                      aria-pressed={selected}
                      data-testid={`upload-city-modifier-${which}-${value}`}
                      onClick={() =>
                        onActiveModifiersChange({
                          ...activeModifiers,
                          statModifiers: STAT_MODIFIER_NAMES.reduce(
                            (next, name) => ({ ...next, [name]: value }),
                            {} as UploadStatModifierState,
                          ),
                        })
                      }
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
                id={`upload-city-modifier-fields-${which}`}
                className="mt-2 grid grid-cols-1 gap-2"
              >
                {STAT_MODIFIER_NAMES.map((name) => (
                  <UploadCityModifier
                    key={name}
                    which={which}
                    name={name}
                    value={activeModifiers.statModifiers[name]}
                    onChange={updateStatModifier}
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
                aria-controls={`upload-pet-modifier-fields-${which}`}
                data-testid={`upload-pet-modifier-details-${which}`}
                onClick={() => setPetDetailsOpen((open) => !open)}
                className="flex min-h-[30px] min-w-0 items-center gap-1 text-left text-[10px] font-bold opacity-70 hover:opacity-100"
              >
                <span className="w-3 text-center text-[9px] opacity-70">
                  {petDetailsOpen ? "▼" : "▶"}
                </span>
                <span className="truncate">Pets</span>
              </button>
              <button
                type="button"
                aria-label={`${which} upload pet buffs ${petEnabled ? "off" : "on"}`}
                aria-pressed={petEnabled}
                data-testid={`upload-pet-modifier-${which}-toggle`}
                onClick={() =>
                  onActiveModifiersChange({
                    ...activeModifiers,
                    petModifiers: petEnabled
                      ? defaultPetModifiers()
                      : {
                          attack: PET_BUFF_MAX,
                          defense: PET_BUFF_MAX,
                          lethality: PET_BUFF_MAX,
                          health: PET_BUFF_MAX,
                          enemy_defense: PET_DEFENSE_DEBUFF_MAX,
                          enemy_lethality: PET_DEFAULT_DEBUFF_MAX,
                          enemy_health: PET_DEFAULT_DEBUFF_MAX,
                      },
                  })
                }
                className="sim-compact-toggle"
                data-active={petEnabled}
                title="Toggle pet buffs at max values and debuffs at strongest values."
              >
                {petEnabled ? "On" : "Off"}
              </button>
            </div>
            {petDetailsOpen && (
              <div
                id={`upload-pet-modifier-fields-${which}`}
                className="mt-2 grid grid-cols-1 gap-2"
              >
                {PET_MODIFIER_NAMES.map((name) => (
                  <UploadPetModifier
                    key={name}
                    which={which}
                    name={name}
                    value={activeModifiers.petModifiers[name]}
                    onChange={updatePetModifier}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function cloneActiveModifiers(value: UploadActiveModifiers): UploadActiveModifiers {
  return {
    statModifiers: { ...value.statModifiers },
    petModifiers: { ...value.petModifiers },
  };
}

function statModifierDescription(name: StatModifierName, value: number): string {
  if (name === "enemy_attack" || name === "enemy_defense") {
    return value === 0 ? "Off" : `-${value}%`;
  }
  return value === 0 ? "Off" : `+${value}%`;
}

function petModifierMax(name: PetModifierName): number {
  if (name === "enemy_defense") return PET_DEFENSE_DEBUFF_MAX;
  return PET_DEBUFF_NAMES.includes(name) ? PET_DEFAULT_DEBUFF_MAX : PET_BUFF_MAX;
}

function UploadCityModifier({
  which,
  name,
  value,
  onChange,
}: {
  which: "attacker" | "defender";
  name: StatModifierName;
  value: number;
  onChange: (name: StatModifierName, value: number) => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(9.75rem,auto)] items-center gap-2">
      <span className="min-w-0 truncate text-[10px] opacity-60">
        {STAT_MODIFIER_LABELS[name]}
      </span>
      <div className="sim-segmented">
        {STAT_MODIFIER_OPTIONS.map((option) => {
          const selected = value === option;
          return (
            <button
              key={option}
              type="button"
              aria-label={`${which} upload ${STAT_MODIFIER_LABELS[name]} ${statModifierDescription(name, option)}`}
              aria-pressed={selected}
              data-testid={`upload-stat-modifier-${which}-${name}-${option}`}
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

function UploadPetModifier({
  which,
  name,
  value,
  onChange,
}: {
  which: "attacker" | "defender";
  name: PetModifierName;
  value: number;
  onChange: (name: PetModifierName, value: number) => void;
}) {
  const isDebuff = PET_DEBUFF_NAMES.includes(name);
  const max = petModifierMax(name);
  const display = isDebuff && value > 0 ? `-${value.toFixed(1)}%` : `+${value.toFixed(1)}%`;
  return (
    <label className="grid grid-cols-[minmax(0,1fr)_5rem_3.25rem] items-center gap-2 text-[10px]">
      <span className="min-w-0 truncate opacity-60">
        {PET_MODIFIER_LABELS[name]}
      </span>
      <input
        type="number"
        min={0}
        max={max}
        step={0.5}
        value={value}
        onChange={(e) => {
          const parsed = parseFloat(e.target.value);
          const next = Number.isNaN(parsed)
            ? 0
            : Math.max(0, Math.min(max, Math.round(parsed * 2) / 2));
          onChange(name, next);
        }}
        className="sim-input min-h-[30px] px-2 text-right font-mono text-[10px] tabular-nums"
        aria-label={`${which} upload pet ${PET_MODIFIER_LABELS[name]}`}
        data-testid={`upload-pet-modifier-${which}-${name}`}
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
