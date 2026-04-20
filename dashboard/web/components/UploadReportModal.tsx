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

export type HeroSelection = Record<TroopCategory, string | null>;
export type Skill4LevelMap = Record<TroopCategory, number>;

export interface OcrSideData {
  troops: Record<TroopCategory, number | null>;
  stats: Record<TroopCategory, Record<string, number | null>>;
}

export interface OcrResult {
  attacker: OcrSideData;
  defender: OcrSideData;
  raw_text?: string;
  warnings?: string[];
}

export interface UploadReportSubmission {
  ocr: OcrResult;
  heroes: {
    attacker: HeroSelection;
    defender: HeroSelection;
  };
  rallyMode: boolean;
  skill4Levels: {
    attacker: Skill4LevelMap;
    defender: Skill4LevelMap;
  };
}

interface Props {
  open: boolean;
  onClose: () => void;
  onApply: (submission: UploadReportSubmission) => void;
  initialRallyMode?: boolean;
}

const emptyHeroes = (): HeroSelection => ({
  infantry: null,
  lancer: null,
  marksman: null,
});

const emptySkill4 = (): Skill4LevelMap => ({
  infantry: 0,
  lancer: 0,
  marksman: 0,
});

export default function UploadReportModal({
  open,
  onClose,
  onApply,
  initialRallyMode = false,
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
  // Reports always show "me" on the left. When the user is the defender, they
  // toggle this so the OCR left column is treated as defender, not attacker.
  const [sidesSwapped, setSidesSwapped] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync rally toggle with the caller whenever the modal opens.
  useEffect(() => {
    if (open) setRallyMode(initialRallyMode);
  }, [open, initialRallyMode]);

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
        skill4Levels: {
          attacker: { ...attackerSkill4 },
          defender: { ...defenderSkill4 },
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label="Upload battle report"
    >
      <div
        className="rounded w-full max-w-3xl max-h-full overflow-y-auto"
        style={{
          border: "1px solid var(--border-color)",
          backgroundColor: "var(--sidebar-bg)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid var(--border-color)" }}
        >
          <h3
            className="text-sm uppercase tracking-wider font-bold"
            style={{ color: "var(--sidebar-active)" }}
          >
            Upload Battle Report
          </h3>
          <div className="flex items-center gap-2">
            <label
              className="flex items-center gap-2 text-xs px-2 py-1 rounded cursor-pointer font-bold"
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
              className="text-xs px-2 py-1 rounded"
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

        <div className="p-4 flex flex-col gap-4">
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
            <div className="flex-1" style={{ order: sidesSwapped ? 3 : 1 }}>
              <HeroPickerPanel
                title="Attacker heroes"
                which="attacker"
                heroes={attackerHeroes}
                onChange={setAttackerHeroes}
                skill4={attackerSkill4}
                onSkill4Change={setAttackerSkill4}
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
                className="text-xs px-2 py-1 rounded font-bold"
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
            <div className="flex-1" style={{ order: sidesSwapped ? 1 : 3 }}>
              <HeroPickerPanel
                title="Defender heroes"
                which="defender"
                heroes={defenderHeroes}
                onChange={setDefenderHeroes}
                skill4={defenderSkill4}
                onSkill4Change={setDefenderSkill4}
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
          className="flex justify-end gap-2 px-4 py-3"
          style={{ borderTop: "1px solid var(--border-color)" }}
        >
          <button
            type="button"
            onClick={handleClose}
            className="text-xs px-3 py-2 rounded"
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
            className="text-xs px-3 py-2 rounded font-bold"
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
  rallyMode,
}: {
  title: string;
  which: "attacker" | "defender";
  heroes: HeroSelection;
  onChange: (next: HeroSelection) => void;
  skill4: Skill4LevelMap;
  onSkill4Change: (next: Skill4LevelMap) => void;
  rallyMode: boolean;
}) {
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
    </div>
  );
}
