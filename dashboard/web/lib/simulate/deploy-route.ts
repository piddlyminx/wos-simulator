import {
  isBearSavedSimulationKind,
  type SavedSimulationKind,
} from "@/lib/simulate-run";

export type DeploySimulatorMode = "battle" | "bear";

export function deployModeForSavedKind(
  kind: SavedSimulationKind,
): DeploySimulatorMode {
  return isBearSavedSimulationKind(kind) ? "bear" : "battle";
}

export function deployRunHref(
  id: string,
  kind: SavedSimulationKind,
): string {
  const params = new URLSearchParams({
    mode: deployModeForSavedKind(kind),
    run: id,
  });
  return `/deploy?${params.toString()}`;
}
