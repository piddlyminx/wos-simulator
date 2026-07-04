"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import {
  cleanStatPresetName,
  MAX_STAT_PRESETS,
  normalizeStatPresetStats,
  saveLocalStatPresets,
  newStatPresetId,
  sortPlayerStatPresets,
  type PlayerStatPreset,
  type StatPresetValues,
} from "@/lib/stat-presets";

type PresetStatus = { kind: "ok" | "error"; message: string } | null;

interface PlayerStatProfileModalProps {
  title: string;
  defaultName: string;
  currentStats: StatPresetValues;
  presets: PlayerStatPreset[];
  setPresets: Dispatch<SetStateAction<PlayerStatPreset[]>>;
  loadedPresetId: string | null;
  loadedPresetName: string | null;
  loadingPresets?: boolean;
  selectAriaLabel?: string;
  nameAriaLabel?: string;
  description?: string;
  testId?: string;
  onLoadPreset: (preset: PlayerStatPreset) => void;
  onLoadedPresetChange: (id: string | null, name: string | null) => void;
  onClose: () => void;
}

export default function PlayerStatProfileModal({
  title,
  defaultName,
  currentStats,
  presets,
  setPresets,
  loadedPresetId,
  loadedPresetName,
  loadingPresets = false,
  selectAriaLabel,
  nameAriaLabel,
  description = "Profiles store base player stats only. Hero stats are removed on save and reapplied on load.",
  testId = "stat-profile-modal",
  onLoadPreset,
  onLoadedPresetChange,
  onClose,
}: PlayerStatProfileModalProps) {
  const initialLoaded = presets.find((preset) => preset.id === loadedPresetId);
  const [selectedId, setSelectedId] = useState(
    initialLoaded?.id ?? loadedPresetId ?? "",
  );
  const [draftName, setDraftName] = useState(
    initialLoaded?.name ?? loadedPresetName ?? defaultName,
  );
  const [status, setStatus] = useState<PresetStatus>(null);

  function choosePreset(id: string) {
    setSelectedId(id);
    if (!id) {
      setDraftName(defaultName);
      setStatus(null);
      return;
    }
    const selected = presets.find((preset) => preset.id === id);
    if (!selected) {
      setStatus({ kind: "error", message: "Choose a profile." });
      return;
    }
    setDraftName(selected.name);
    setStatus(null);
  }

  function loadSelectedPreset() {
    if (!selectedId) {
      onLoadedPresetChange(null, null);
      setDraftName(defaultName);
      setStatus({ kind: "ok", message: "No profile loaded." });
      return;
    }
    const selected = presets.find((preset) => preset.id === selectedId);
    if (!selected) {
      setStatus({ kind: "error", message: "Choose a profile to load." });
      return;
    }
    onLoadPreset(selected);
    onLoadedPresetChange(selected.id, selected.name);
    setDraftName(selected.name);
    setStatus({ kind: "ok", message: `Loaded ${selected.name}.` });
  }

  function saveCurrentStats() {
    setStatus(null);
    try {
      const cleanName = cleanStatPresetName(draftName);
      const fallbackName = `Preset ${presets.length + 1}`;
      const presetName = cleanName || fallbackName;
      const existing =
        presets.find((preset) => preset.id === selectedId) ??
        presets.find(
          (preset) =>
            preset.name.toLocaleLowerCase() === presetName.toLocaleLowerCase(),
        );
      if (!existing && presets.length >= MAX_STAT_PRESETS) {
        throw new Error(`Preset limit reached (${MAX_STAT_PRESETS})`);
      }
      const timestamp = new Date().toISOString();
      const preset: PlayerStatPreset = {
        id: existing?.id ?? newStatPresetId(),
        name: presetName,
        created_at: existing?.created_at ?? timestamp,
        updated_at: timestamp,
        stats: normalizeStatPresetStats(currentStats),
      };
      const next = sortPlayerStatPresets([
        preset,
        ...presets.filter((row) => row.id !== preset.id),
      ]);
      saveLocalStatPresets(next);
      setPresets(next);
      onLoadedPresetChange(preset.id, preset.name);
      setSelectedId(preset.id);
      setDraftName(preset.name);
      setStatus({
        kind: "ok",
        message: `${existing ? "Updated" : "Created"} ${preset.name}.`,
      });
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to save preset",
      });
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-3 py-6"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.55)" }}
      role="dialog"
      aria-modal="true"
      data-testid={testId}
      onClick={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          saveCurrentStats();
        }}
        className="sim-modal w-full max-w-md p-4 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="sim-modal-title">{title}</h3>
            {description ? (
              <p className="sim-modal-copy mt-1">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="sim-edit-chip min-h-[32px] px-2 py-1 text-sm font-bold leading-none"
            aria-label="Close profile modal"
          >
            x
          </button>
        </div>

        <label className="mb-3 flex flex-col gap-1">
          <span className="sim-field-label">Profile</span>
          <select
            value={selectedId}
            onChange={(event) => choosePreset(event.target.value)}
            className="sim-input min-h-[40px] px-2 py-2 font-mono text-xs"
            aria-label={selectAriaLabel}
          >
            <option value="">{loadingPresets ? "Loading..." : "-- None --"}</option>
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>

        <label className="mb-4 flex flex-col gap-1">
          <span className="sim-field-label">Profile name</span>
          <input
            type="text"
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            placeholder={defaultName}
            className="sim-input min-h-[40px] px-2 py-2 text-sm"
            aria-label={nameAriaLabel}
          />
        </label>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={loadSelectedPreset}
            className="sim-edit-chip min-h-[40px] px-3 py-2 text-xs font-bold"
            disabled={selectedId === (loadedPresetId ?? "")}
          >
            Load selected
          </button>
          <button
            type="submit"
            className="sim-edit-chip min-h-[40px] px-3 py-2 text-xs font-bold"
            style={{ color: "var(--sim-blue)" }}
          >
            Save current stats
          </button>
          <button
            type="button"
            onClick={onClose}
            className="sim-edit-chip min-h-[40px] px-3 py-2 text-xs font-bold"
          >
            Done
          </button>
        </div>

        {status && (
          <p
            className="mt-3 text-xs font-mono"
            style={{ color: status.kind === "error" ? "#f38ba8" : "#a6e3a1" }}
            data-testid="stat-preset-status"
          >
            {status.message}
          </p>
        )}
      </form>
    </div>
  );
}
