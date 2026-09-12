"use client";

import { EditableNumberInput } from "@/components/EditableNumberInput";
import type { Side } from "@/lib/simulate/form-state";
import deployStyles from "./DeployArmyPanel.module.css";

export function GarethModifierInput({
  which,
  idPrefix = "",
  value,
  onChange,
}: {
  which: Side;
  idPrefix?: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const prefix = idPrefix ? `${idPrefix}-` : "";
  const labelPrefix = idPrefix ? `${which} ${idPrefix}` : which;
  return (
    <div className={`${deployStyles.garethModifier} text-[10px]`}>
      <span className="min-w-0 truncate opacity-70">
        <label htmlFor={`${prefix}gareth-${which}`} title="Enemy lethality down">Gareth</label>
      </span>
      <button
        type="button"
        className={deployStyles.stepButton}
        aria-label={`${labelPrefix} decrease Gareth`}
        disabled={value <= 0}
        onClick={() => onChange(Math.max(0, value - 0.25))}
      >
        <span aria-hidden="true">−</span>
      </button>
      <EditableNumberInput
        id={`${prefix}gareth-${which}`}
        name={`${prefix}${which}.gareth`}
        min={0}
        max={5}
        step={0.25}
        value={value}
        onValueChange={(next) => onChange(Math.max(0, Math.min(5, Math.round(next * 4) / 4)))}
        className="sim-input min-h-[30px] px-2 text-right text-[10px] tabular-nums"
        aria-label={`${labelPrefix} Gareth`}
        aria-description="Enemy lethality down (%)"
        data-testid={`${prefix}gareth-modifier-${which}`}
      />
      <button
        type="button"
        className={deployStyles.stepButton}
        aria-label={`${labelPrefix} increase Gareth`}
        disabled={value >= 5}
        onClick={() => onChange(Math.min(5, value + 0.25))}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
