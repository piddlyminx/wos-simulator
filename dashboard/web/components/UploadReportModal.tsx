"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  TroopCategory,
  heroesForCategory,
} from "@/lib/heroes-catalogue";

const CATEGORIES: TroopCategory[] = ["infantry", "lancer", "marksman"];

export type HeroSelection = Record<TroopCategory, string | null>;

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
}

interface Props {
  open: boolean;
  onClose: () => void;
  onApply: (submission: UploadReportSubmission) => void;
}

const emptyHeroes = (): HeroSelection => ({
  infantry: null,
  lancer: null,
  marksman: null,
});

export default function UploadReportModal({ open, onClose, onApply }: Props) {
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attackerHeroes, setAttackerHeroes] = useState<HeroSelection>(emptyHeroes);
  const [defenderHeroes, setDefenderHeroes] = useState<HeroSelection>(emptyHeroes);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setImageDataUrl(null);
    setImageBase64(null);
    setDragging(false);
    setLoading(false);
    setError(null);
    setAttackerHeroes(emptyHeroes());
    setDefenderHeroes(emptyHeroes());
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
      onApply({
        ocr: data as OcrResult,
        heroes: {
          attacker: { ...attackerHeroes },
          defender: { ...defenderHeroes },
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <HeroPickerPanel
              title="Attacker heroes"
              heroes={attackerHeroes}
              onChange={setAttackerHeroes}
            />
            <HeroPickerPanel
              title="Defender heroes"
              heroes={defenderHeroes}
              onChange={setDefenderHeroes}
            />
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
  heroes,
  onChange,
}: {
  title: string;
  heroes: HeroSelection;
  onChange: (next: HeroSelection) => void;
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
          return (
            <label key={cat} className="flex items-center justify-between gap-2 text-xs">
              <span className="opacity-70">{label}</span>
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
          );
        })}
      </div>
    </div>
  );
}
