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
        className="w-full max-w-3xl max-h-screen sm:max-h-full overflow-y-auto sm:rounded"
        style={{
          border: "1px solid var(--border-color)",
          backgroundColor: "var(--sidebar-bg)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-3 sticky top-0 z-10"
          style={{
            borderBottom: "1px solid var(--border-color)",
            backgroundColor: "var(--sidebar-bg)",
          }}
        >
          <h3
            className="text-sm uppercase tracking-wider font-bold"
            style={{ color: "var(--sidebar-active)" }}
          >
            Upload Battle Report
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <label
              className="flex items-center gap-2 text-xs px-2 py-2 rounded cursor-pointer font-bold min-h-[36px]"
              style={{
                border: `1px solid ${rallyMode ? "var(--sidebar-active)" : "var(--border-color)"}`,
                backgroundColor: rallyMode
                  ? "rgba(137, 180, 250, 0.15)"
                  : "var(--main-bg)",
                color: rallyMode ? "var(--sidebar-active)" : "var(--main-text)",
              }}
              title="Rally mode: skill 4 is applied, so OCR stats are scaled down before filling the main form."
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
              onClick={handleClose}
              className="text-xs px-3 py-2 rounded min-h-[36px]"
              style={{
                border: "1px solid var(--border-color)",
                color: "var(--main-text)",
              }}
              aria-label="Close"
            >
              Close
            </button>
          </div>
        </div>

        <div className="p-3 sm:p-4 flex flex-col gap-3 sm:gap-4">
          <div
            className="grid gap-3 rounded p-3 sm:grid-cols-[minmax(0,1fr)_11rem]"
            style={{
              border: "1px solid var(--border-color)",
              backgroundColor: "var(--main-bg)",
            }}
          >
            <div className="flex flex-col gap-2 text-xs leading-relaxed">
              <p className="font-bold" style={{ color: "var(--sidebar-active)" }}>
                Upload a Stat Bonuses screenshot like this example.
              </p>
              <p className="opacity-75">
                Troop counts must be shown as absolute numbers, not percentages.
                Keep the troop avatars, troop counts, and every stat row in frame
                so the parser can read the troop types and all bonuses.
              </p>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/examples/stat-bonuses-report.png"
              alt="Example Stat Bonuses report with troop avatars, troop counts, and all stat rows visible"
              className="w-full rounded object-cover"
              style={{
                border: "1px solid var(--border-color)",
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
            className="rounded p-4 flex flex-col items-center justify-center gap-2 cursor-pointer text-center"
            style={{
              border: `2px dashed ${dragging ? "var(--sidebar-active)" : "var(--border-color)"}`,
              backgroundColor: "var(--main-bg)",
              minHeight: 120,
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
                <span className="text-sm font-bold">
                  Drag &amp; drop, paste (Ctrl+V), or click to browse
                </span>
                <span className="text-xs opacity-60">
                  Expects a Stat Bonuses screenshot (see task attachment).
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
                className="text-xs px-2 py-1 rounded"
                style={{
                  border: "1px solid var(--border-color)",
                  color: "var(--main-text)",
                }}
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
                className="text-xs px-3 py-2 rounded font-bold min-h-[36px]"
                style={{
                  border: `1px solid ${sidesSwapped ? "var(--sidebar-active)" : "var(--border-color)"}`,
                  backgroundColor: sidesSwapped
                    ? "rgba(137, 180, 250, 0.15)"
                    : "var(--main-bg)",
                  color: sidesSwapped ? "var(--sidebar-active)" : "var(--main-text)",
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
              className="rounded px-3 py-2 text-xs font-mono"
              style={{
                border: "1px solid var(--border-color)",
                backgroundColor: "var(--main-bg)",
                color: "#f38ba8",
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div
          className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 px-3 sm:px-4 py-3 sticky bottom-0 z-10"
          style={{
            borderTop: "1px solid var(--border-color)",
            backgroundColor: "var(--sidebar-bg)",
          }}
        >
          <button
            type="button"
            onClick={handleClose}
            className="text-xs px-3 py-2 rounded min-h-[44px]"
            style={{
              border: "1px solid var(--border-color)",
              color: "var(--main-text)",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={loading || !imageBase64}
            className="text-xs px-3 py-2 rounded font-bold min-h-[44px]"
            style={{
              backgroundColor: "var(--sidebar-active)",
              color: "#1e1e2e",
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
    <div
      className="rounded p-3"
      style={{
        border: "1px solid var(--border-color)",
        backgroundColor: "var(--main-bg)",
      }}
    >
      <h4 className="text-xs uppercase tracking-wider opacity-60 mb-2 font-bold">
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
                <span className="opacity-70 w-16">{label}</span>
                <select
                  value={heroes[cat] ?? ""}
                  onChange={(e) => {
                    onChange({ ...heroes, [cat]: e.target.value || null });
                  }}
                  className="rounded px-2 py-1 font-mono text-xs flex-1"
                  style={{
                    backgroundColor: "var(--sidebar-bg)",
                    border: "1px solid var(--border-color)",
                    color: "var(--main-text)",
                  }}
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
                  <span className="opacity-60">Skill 4 lvl</span>
                  <select
                    value={skill4[cat]}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      onSkill4Change({ ...skill4, [cat]: isNaN(v) ? 0 : v });
                    }}
                    className="rounded px-1.5 py-0.5 font-mono text-[11px] w-14"
                    style={{
                      backgroundColor: "var(--sidebar-bg)",
                      border: "1px solid var(--border-color)",
                      color: "var(--main-text)",
                    }}
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
      <div className="mt-3 rounded border p-2" style={{ borderColor: "var(--border-color)" }}>
        <h5 className="mb-1 text-[10px] font-bold uppercase tracking-wider opacity-60">
          Active buffs in screenshot
        </h5>
        <div className="grid grid-cols-1 gap-2">
          <div className="rounded border p-2" style={{ borderColor: "var(--border-color)" }}>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
              <button
                type="button"
                aria-expanded={cityDetailsOpen}
                aria-controls={`upload-city-modifier-fields-${which}`}
                data-testid={`upload-city-modifier-details-${which}`}
                onClick={() => setCityDetailsOpen((open) => !open)}
                className="flex min-h-[30px] min-w-0 items-center gap-1 text-left text-[10px] font-bold uppercase tracking-wider opacity-70 hover:opacity-100"
              >
                <span className="w-3 text-center text-[9px] opacity-70">
                  {cityDetailsOpen ? "▼" : "▶"}
                </span>
                <span className="truncate">City</span>
              </button>
              <div
                className="inline-grid grid-cols-3 overflow-hidden rounded border"
                style={{ borderColor: "var(--border-color)" }}
              >
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
                      className="min-h-[30px] px-2 text-[10px] font-bold"
                      style={{
                        backgroundColor: selected
                          ? "var(--sidebar-active)"
                          : "var(--sidebar-bg)",
                        color: selected ? "#111827" : "var(--main-text)",
                        borderRight:
                          value === 20 ? "0" : "1px solid var(--border-color)",
                      }}
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
          <div className="rounded border p-2" style={{ borderColor: "var(--border-color)" }}>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
              <button
                type="button"
                aria-expanded={petDetailsOpen}
                aria-controls={`upload-pet-modifier-fields-${which}`}
                data-testid={`upload-pet-modifier-details-${which}`}
                onClick={() => setPetDetailsOpen((open) => !open)}
                className="flex min-h-[30px] min-w-0 items-center gap-1 text-left text-[10px] font-bold uppercase tracking-wider opacity-70 hover:opacity-100"
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
                className="min-h-[30px] rounded px-3 text-[10px] font-bold"
                style={{
                  backgroundColor: petEnabled
                    ? "var(--sidebar-active)"
                    : "var(--sidebar-bg)",
                  border: "1px solid var(--border-color)",
                  color: petEnabled ? "#111827" : "var(--main-text)",
                }}
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
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
      <span className="min-w-0 truncate text-[10px] uppercase tracking-wider opacity-60">
        {STAT_MODIFIER_LABELS[name]}
      </span>
      <div
        className="inline-grid grid-cols-3 overflow-hidden rounded border"
        style={{ borderColor: "var(--border-color)" }}
      >
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
              className="min-h-[30px] px-2 text-[10px] font-bold"
              style={{
                backgroundColor: selected
                  ? "var(--sidebar-active)"
                  : "var(--sidebar-bg)",
                color: selected ? "#111827" : "var(--main-text)",
                borderRight:
                  option === 20 ? "0" : "1px solid var(--border-color)",
              }}
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
      <span className="min-w-0 truncate uppercase tracking-wider opacity-60">
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
        className="min-h-[30px] rounded px-2 text-right font-mono text-[10px] tabular-nums"
        style={{
          backgroundColor: "var(--sidebar-bg)",
          border: "1px solid var(--border-color)",
          color: "var(--main-text)",
        }}
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
