"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type SimWorkspaceTab = "attacker" | "defender" | "setup" | "results";
type RunMode = "simulate" | "optimise" | "explore";
type SimulateTourPlacement = "top" | "bottom" | "left" | "right";
type SimulateTourRunAction = RunMode | "example";
type SimulateTourStartSource = "auto" | "manual" | "restart";

interface SimulateTourStep {
  id: string;
  title: string;
  text: string;
  target: string;
  fallbackTarget?: string;
  placement: SimulateTourPlacement;
  mobileTab?: SimWorkspaceTab;
  runMode?: RunMode;
  runAction?: SimulateTourRunAction;
  afterRunStepId?: string;
  closeRunOptions?: boolean;
}

interface TourGeometry {
  popover: { top: number; left: number };
  spotlight: { top: number; left: number; width: number; height: number };
  viewport: { width: number; height: number };
}

interface UseSimulateTourOptions {
  wideLayout: boolean;
  initialRunId?: string | null;
  loadingSavedRun: boolean;
  hasSimulationResult: boolean;
  hasOptimizeResult: boolean;
  hasSurfaceResult: boolean;
  setMobileTab: (tab: SimWorkspaceTab) => void;
  setRunMode: (mode: RunMode) => void;
  setRunOptionsOpen: (open: boolean) => void;
  runSimulation: () => Promise<unknown>;
  runOptimizeRatio: () => Promise<unknown>;
  runSurfaceExplore: () => Promise<unknown>;
  showRepresentativeBattleExample: () => Promise<unknown>;
}

interface UseSimulateTourResult {
  startSimulateTour: (source?: SimulateTourStartSource) => void;
  simulateTour: ReactNode;
}

const SIMULATE_TOUR_SEEN_KEY = "wos-simulator.simulate-tour.v1.seen";
const SIMULATE_TOUR_PROGRESS_KEY = "wos-simulator.simulate-tour.v1.progress";

function markSimulateTourSeen() {
  try {
    window.localStorage.setItem(SIMULATE_TOUR_SEEN_KEY, "1");
  } catch {
    // Private browsing and locked-down webviews can reject localStorage writes.
  }
}

function hasSeenSimulateTour(): boolean {
  try {
    return window.localStorage.getItem(SIMULATE_TOUR_SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

function saveSimulateTourProgress(index: number) {
  try {
    window.localStorage.setItem(SIMULATE_TOUR_PROGRESS_KEY, String(index));
  } catch {
    // Ignore unavailable localStorage; the in-memory tour state still works.
  }
}

function loadSimulateTourProgress(max: number): number {
  try {
    const parsed = parseInt(
      window.localStorage.getItem(SIMULATE_TOUR_PROGRESS_KEY) ?? "0",
      10,
    );
    return Number.isFinite(parsed) ? Math.max(0, Math.min(max, parsed)) : 0;
  } catch {
    return 0;
  }
}

function clearSimulateTourProgress() {
  try {
    window.localStorage.removeItem(SIMULATE_TOUR_PROGRESS_KEY);
  } catch {
    // Ignore unavailable localStorage.
  }
}

function runActionLabel(action: SimulateTourRunAction | undefined): string | null {
  if (action === "simulate") return "Run simulate now";
  if (action === "optimise") return "Run optimise now";
  if (action === "explore") return "Run explore now";
  if (action === "example") return "Show Example";
  return null;
}

function applySimulateTourGeometry(geometry: TourGeometry) {
  const px = (value: number) => `${Math.round(value)}px`;
  const spotlightTop = geometry.spotlight.top;
  const spotlightLeft = geometry.spotlight.left;
  const spotlightRight = geometry.spotlight.left + geometry.spotlight.width;
  const spotlightBottom = geometry.spotlight.top + geometry.spotlight.height;
  const clippedTop = Math.max(0, spotlightTop);
  const clippedLeft = Math.max(0, spotlightLeft);
  const clippedRight = Math.min(geometry.viewport.width, spotlightRight);
  const clippedBottom = Math.min(geometry.viewport.height, spotlightBottom);
  const clippedHeight = Math.max(0, clippedBottom - clippedTop);
  const spotlight = document.querySelector<HTMLElement>(".sim-tour-spotlight");
  const popover = document.querySelector<HTMLElement>(".sim-tour-popover");
  const topScrim = document.querySelector<HTMLElement>("[data-tour-scrim='top']");
  const bottomScrim = document.querySelector<HTMLElement>("[data-tour-scrim='bottom']");
  const leftScrim = document.querySelector<HTMLElement>("[data-tour-scrim='left']");
  const rightScrim = document.querySelector<HTMLElement>("[data-tour-scrim='right']");

  if (spotlight) {
    spotlight.style.top = px(geometry.spotlight.top);
    spotlight.style.left = px(geometry.spotlight.left);
    spotlight.style.width = px(geometry.spotlight.width);
    spotlight.style.height = px(geometry.spotlight.height);
  }
  if (popover) {
    popover.style.top = px(geometry.popover.top);
    popover.style.left = px(geometry.popover.left);
  }
  if (topScrim) {
    topScrim.style.top = "0";
    topScrim.style.left = "0";
    topScrim.style.right = "0";
    topScrim.style.bottom = "";
    topScrim.style.width = "";
    topScrim.style.height = px(clippedTop);
  }
  if (bottomScrim) {
    bottomScrim.style.top = px(clippedBottom);
    bottomScrim.style.left = "0";
    bottomScrim.style.right = "0";
    bottomScrim.style.bottom = "0";
    bottomScrim.style.width = "";
    bottomScrim.style.height = "";
  }
  if (leftScrim) {
    leftScrim.style.top = px(clippedTop);
    leftScrim.style.left = "0";
    leftScrim.style.right = "";
    leftScrim.style.bottom = "";
    leftScrim.style.width = px(clippedLeft);
    leftScrim.style.height = px(clippedHeight);
  }
  if (rightScrim) {
    rightScrim.style.top = px(clippedTop);
    rightScrim.style.left = px(clippedRight);
    rightScrim.style.right = "0";
    rightScrim.style.bottom = "";
    rightScrim.style.width = "";
    rightScrim.style.height = px(clippedHeight);
  }
}

function calculateSimulateTourGeometry(step: SimulateTourStep): TourGeometry | null {
  const target =
    document.querySelector<HTMLElement>(step.target) ??
    (step.fallbackTarget
      ? document.querySelector<HTMLElement>(step.fallbackTarget)
      : null);
  if (!target) return null;

  const rect = target.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const popoverRect = document
    .querySelector<HTMLElement>(".sim-tour-popover")
    ?.getBoundingClientRect();
  const popoverWidth = popoverRect?.width ?? Math.min(400, viewportWidth - 24);
  const popoverHeight = popoverRect?.height ?? Math.min(352, viewportHeight - 24);
  const gap = 12;
  let top = rect.bottom + gap;
  let left = rect.left + rect.width / 2 - popoverWidth / 2;

  if (step.placement === "top") top = rect.top - popoverHeight - gap;
  if (step.placement === "left") {
    top = rect.top + rect.height / 2 - popoverHeight / 2;
    left = rect.left - popoverWidth - gap;
  }
  if (step.placement === "right") {
    top = rect.top + rect.height / 2 - popoverHeight / 2;
    left = rect.right + gap;
  }

  return {
    popover: {
      top: Math.max(12, Math.min(top, viewportHeight - popoverHeight - 12)),
      left: Math.max(12, Math.min(left, viewportWidth - popoverWidth - 12)),
    },
    spotlight: {
      top: rect.top - 6,
      left: rect.left - 6,
      width: rect.width + 12,
      height: rect.height + 12,
    },
    viewport: {
      width: viewportWidth,
      height: viewportHeight,
    },
  };
}

function buildSimulateTourSteps(wideLayout: boolean): SimulateTourStep[] {
  return [
    {
      id: "welcome",
      title: "Battle simulator",
      text: "Use this page when you want to answer a concrete matchup question: how often does this army win, which troop split performs best, or which ratios are dangerous.",
      target: "[data-tour='simulate-start']",
      placement: "bottom",
    },
    {
      id: "reports",
      title: "Start from evidence",
      text: "Upload a report screenshot to quickly populate stats and troops, saving manual entry. Recent runs is for returning to a previous simulation or comparing another setup.",
      target: "[data-tour='simulate-start-actions']",
      placement: "bottom",
    },
    {
      id: "toggles",
      title: "Choose the rule set",
      text: "Rally mode enables joiner heroes and eligible widget skills. Sync hero stats automatically adjusts for the difference in stats between heroes, which is useful when trying different setups for the same account.",
      target: "[data-tour='simulate-toggles']",
      placement: "bottom",
    },
    {
      id: "army-config",
      title: "Army configuration",
      text: "Enter the troop counts, heroes, stats, buffs, and other setup for the two armies. For rallies it matters which side is attacker or defender because that changes which widget bonuses apply; for 1v1 it makes no difference.",
      target: "[data-tour='army-config']",
      placement: wideLayout ? "top" : "bottom",
      mobileTab: "attacker",
    },
    {
      id: "player-presets",
      title: "Player presets",
      text: "Save and load stat presets here. You probably want Sync hero stats turned on when doing this: presets save your base stats without heroes, then load them with the currently selected heroes added back, so future hero choices reflect how your stats would look with those heroes.",
      target: "[data-tour='stat-presets']",
      placement: wideLayout ? "right" : "bottom",
      mobileTab: "attacker",
    },
    {
      id: "run-modes",
      title: "Run modes",
      text: "There are three different questions here. Simulate asks 'what happens for this exact setup?' Optimise asks 'what troop mix should one side use?' Explore asks 'how do both sides' ratios interact across the whole matchup space?'",
      target: "[data-tour='run-mode-command']",
      placement: "top",
      closeRunOptions: true,
    },
    {
      id: "simulate-action",
      title: "Action: Simulate",
      text: "Use Simulate first. It holds every input fixed and repeats the fight many times, so random skill triggers become a distribution instead of one misleading example battle. More replicates make the result steadier but take longer.",
      target: "[data-tour='run-mode-command']",
      placement: "top",
      runMode: "simulate",
      runAction: "simulate",
      afterRunStepId: "simulate-summary",
      closeRunOptions: true,
    },
    {
      id: "simulate-summary",
      title: "Simulation summary",
      text: "Mean survivors is the average margin: positive favors attacker and negative favors defender. Win rate tells how often attacker wins, while standard deviation tells how much RNG affects the outcome.",
      target: "[data-tour='simulate-results-summary']",
      fallbackTarget: "[data-tour='results-panel']",
      placement: wideLayout ? "top" : "bottom",
      mobileTab: "results",
    },
    {
      id: "simulate-chart",
      title: "Distribution and examples",
      text: "Pick a point on the chart and click \"Show example\" to see a round by round breakdown of a representative battle that finished with that result. This is often useful to identify what is happening when the distribution has a surprising shape or is multimodal.",
      target: "[data-tour='simulate-outcome-chart']",
      fallbackTarget: "[data-tour='results-panel']",
      placement: wideLayout ? "top" : "bottom",
      mobileTab: "results",
      runAction: "example",
      afterRunStepId: "simulate-trace",
    },
    {
      id: "simulate-trace",
      title: "Example battle trace",
      text: "The round by round table shows remaining troops after each round. Click a row to expand it and see more details about that round, including kills, effects, and skill behavior.",
      target: "[data-tour='simulate-trace-rounds']",
      fallbackTarget: "[data-tour='simulate-trace']",
      placement: wideLayout ? "top" : "bottom",
      mobileTab: "results",
    },
    {
      id: "optimise-action",
      title: "Action: Optimise ratio",
      text: "Use Optimise when you want to know what troop ratio for one side performs best against the other army, which stays fixed. The total troop count for the side you are optimising remains constant. You can select which side to optimise in the options.",
      target: "[data-tour='run-mode-command']",
      placement: "top",
      runMode: "optimise",
      runAction: "optimise",
      afterRunStepId: "optimise-results",
      closeRunOptions: true,
    },
    {
      id: "optimise-results",
      title: "Best ratio result",
      text: "The best result uses the ranking priority selected in Optimise options, with the other metric breaking ties. Average margin is the average remaining survivors: positive for attacker, negative for defender. A tiny win-rate gain with a worse margin may not be worth using.",
      target: "[data-tour='optimize-results-summary']",
      fallbackTarget: "[data-tour='results-panel']",
      placement: wideLayout ? "top" : "bottom",
      mobileTab: "results",
    },
    {
      id: "optimise-apply",
      title: "Apply a found ratio",
      text: "Select any row from the results table, then Use selected ratio copies that row's troop counts back into the attacker or defender inputs. After applying a ratio, it is a good idea to run a larger sample and check the distribution by running Simulate.",
      target: "[data-tour='optimize-apply']",
      fallbackTarget: "[data-tour='optimize-results']",
      placement: wideLayout ? "left" : "bottom",
      mobileTab: "results",
    },
    {
      id: "explore-action",
      title: "Action: Explore ratios",
      text: "Use Explore when you want a complete picture of how varying troop ratios for both armies impacts the outcome, not one best answer. It shows which regions are attacker-favored, defender-favored, or unstable.",
      target: "[data-tour='run-mode-command']",
      placement: "top",
      runMode: "explore",
      runAction: "explore",
      afterRunStepId: "explore-results",
      closeRunOptions: true,
    },
    {
      id: "explore-results",
      title: "Reading the ratio surface",
      text: "Each dot represents a particular troop ratio and its Color shows the average outcome of that ratio against all enemy formations. Red is attacker-favored, blue is defender-favored, and white is close. Hovering or selecting a dot will change the opposite triangle to show the results against only that selected ratio instead of against all ratios.",
      target: "[data-tour='surface-panels']",
      fallbackTarget: "[data-tour='surface-results']",
      placement: wideLayout ? "top" : "bottom",
      mobileTab: "results",
    },
    {
      id: "explore-interaction",
      title: "Slicing the surface",
      text: "Without a selection, each point is averaged across all opposing ratios. Hover or click a point on one triangle to pin that ratio and make the other triangle show matchup outcomes against that fixed composition.",
      target: "[data-tour='surface-panels']",
      fallbackTarget: "[data-tour='surface-results']",
      placement: wideLayout ? "top" : "bottom",
      mobileTab: "results",
    },
  ];
}

export function useSimulateTour({
  wideLayout,
  initialRunId,
  loadingSavedRun,
  hasSimulationResult,
  hasOptimizeResult,
  hasSurfaceResult,
  setMobileTab,
  setRunMode,
  setRunOptionsOpen,
  runSimulation,
  runOptimizeRatio,
  runSurfaceExplore,
  showRepresentativeBattleExample,
}: UseSimulateTourOptions): UseSimulateTourResult {
  const [stepIndex, setStepIndex] = useState<number | null>(null);
  const [geometry, setGeometry] = useState<TourGeometry | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const hasUserInteractedRef = useRef(false);
  const steps = useMemo(() => buildSimulateTourSteps(wideLayout), [wideLayout]);

  const prepareStep = useCallback((step: SimulateTourStep) => {
    if (!wideLayout && step.mobileTab) setMobileTab(step.mobileTab);
    if (step.runMode) setRunMode(step.runMode);
    if (step.runMode === "simulate" || step.closeRunOptions) {
      setRunOptionsOpen(false);
    }
  }, [setMobileTab, setRunMode, setRunOptionsOpen, wideLayout]);

  const measureStep = useCallback((
    step: SimulateTourStep,
    options: { scroll?: boolean; commit?: boolean } = {},
  ) => {
    const updateGeometry = () => {
      const nextGeometry = calculateSimulateTourGeometry(step);
      if (!nextGeometry) {
        if (options.commit !== false) setGeometry(null);
        return;
      }
      if (options.commit === false) {
        applySimulateTourGeometry(nextGeometry);
      } else {
        setGeometry(nextGeometry);
      }
    };

    if (!options.scroll) {
      updateGeometry();
      return;
    }

    window.setTimeout(() => {
      const target =
        document.querySelector<HTMLElement>(step.target) ??
        (step.fallbackTarget
          ? document.querySelector<HTMLElement>(step.fallbackTarget)
          : null);
      target?.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
      window.requestAnimationFrame(updateGeometry);
    }, 70);
  }, []);

  const resolveStepIndex = useCallback((
    index: number,
    options: { allowResultStepWithoutState?: boolean } = {},
  ) => {
    if (options.allowResultStepWithoutState) return index;
    const step = steps[index];
    if (!step) return index;

    const fallbackStepId =
      !hasSimulationResult && ["simulate-summary", "simulate-chart", "simulate-trace"].includes(step.id)
        ? "simulate-action"
        : !hasOptimizeResult && ["optimise-results", "optimise-apply"].includes(step.id)
          ? "optimise-action"
          : !hasSurfaceResult && ["explore-results", "explore-interaction"].includes(step.id)
            ? "explore-action"
            : null;

    if (!fallbackStepId) return index;
    const fallbackIndex = steps.findIndex((candidate) => candidate.id === fallbackStepId);
    return fallbackIndex >= 0 ? fallbackIndex : 0;
  }, [hasOptimizeResult, hasSimulationResult, hasSurfaceResult, steps]);

  const showStep = useCallback((
    index: number,
    options: { allowResultStepWithoutState?: boolean } = {},
  ) => {
    const resolvedIndex = resolveStepIndex(index, options);
    const step = steps[resolvedIndex];
    if (!step) return;
    prepareStep(step);
    setGeometry(null);
    setStepIndex(resolvedIndex);
    saveSimulateTourProgress(resolvedIndex);
    measureStep(step, { scroll: true });
  }, [measureStep, prepareStep, resolveStepIndex, steps]);

  const closeTour = useCallback((complete = false) => {
    markSimulateTourSeen();
    if (complete) clearSimulateTourProgress();
    setStepIndex(null);
    setGeometry(null);
    setActionLoading(false);
  }, []);

  const startSimulateTour = useCallback((source: SimulateTourStartSource = "manual") => {
    if (stepIndex !== null && source !== "restart") return;
    if (source === "auto" && hasSeenSimulateTour()) return;
    showStep(source === "restart" ? 0 : loadSimulateTourProgress(steps.length - 1));
  }, [showStep, stepIndex, steps.length]);

  useEffect(() => {
    if (stepIndex === null) return;
    const step = steps[stepIndex];
    if (!step) return;
    let animationFrame = 0;
    const onMove = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() =>
        measureStep(step, { commit: false }),
      );
    };
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [measureStep, stepIndex, steps]);

  useEffect(() => {
    if (stepIndex === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeTour(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeTour, stepIndex]);

  useEffect(() => {
    if (initialRunId || loadingSavedRun || stepIndex !== null) return;
    const markInteracted = () => {
      hasUserInteractedRef.current = true;
    };
    window.addEventListener("pointerdown", markInteracted, { once: true });
    window.addEventListener("keydown", markInteracted, { once: true });
    window.addEventListener("wheel", markInteracted, { once: true });
    window.addEventListener("touchstart", markInteracted, { once: true });
    const handle = window.setTimeout(() => {
      if (hasUserInteractedRef.current) return;
      startSimulateTour("auto");
    }, 500);
    return () => {
      window.clearTimeout(handle);
      window.removeEventListener("pointerdown", markInteracted);
      window.removeEventListener("keydown", markInteracted);
      window.removeEventListener("wheel", markInteracted);
      window.removeEventListener("touchstart", markInteracted);
    };
  }, [initialRunId, loadingSavedRun, startSimulateTour, stepIndex]);

  async function runTourAction(step: SimulateTourStep, nextIndex: number) {
    if (!step.runAction || actionLoading) return;
    setActionLoading(true);
    try {
      if (step.runAction === "simulate") await runSimulation();
      else if (step.runAction === "optimise") await runOptimizeRatio();
      else if (step.runAction === "explore") await runSurfaceExplore();
      else await showRepresentativeBattleExample();
      const afterRunIndex = step.afterRunStepId
        ? steps.findIndex((candidate) => candidate.id === step.afterRunStepId)
        : -1;
      showStep(afterRunIndex >= 0 ? afterRunIndex : nextIndex, {
        allowResultStepWithoutState: true,
      });
    } finally {
      setActionLoading(false);
    }
  }

  const activeStep = stepIndex === null ? null : steps[stepIndex] ?? null;
  const activeIndex = stepIndex ?? 0;
  const isLast = stepIndex !== null && stepIndex >= steps.length - 1;
  const actionLabel = runActionLabel(activeStep?.runAction);

  return {
    startSimulateTour,
    simulateTour: activeStep ? (
      <div
        className="sim-tour-layer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="simulate-tour-title"
      >
        {geometry && (
          <>
            <div
              className="sim-tour-scrim-panel"
              data-tour-scrim="top"
              style={{
                top: 0,
                left: 0,
                right: 0,
                height: Math.max(0, geometry.spotlight.top),
              }}
              aria-hidden="true"
            />
            <div
              className="sim-tour-scrim-panel"
              data-tour-scrim="bottom"
              style={{
                top: Math.min(
                  geometry.viewport.height,
                  geometry.spotlight.top + geometry.spotlight.height,
                ),
                left: 0,
                right: 0,
                bottom: 0,
              }}
              aria-hidden="true"
            />
            <div
              className="sim-tour-scrim-panel"
              data-tour-scrim="left"
              style={{
                top: Math.max(0, geometry.spotlight.top),
                left: 0,
                width: Math.max(0, geometry.spotlight.left),
                height: Math.max(
                  0,
                  Math.min(
                    geometry.viewport.height,
                    geometry.spotlight.top + geometry.spotlight.height,
                  ) - Math.max(0, geometry.spotlight.top),
                ),
              }}
              aria-hidden="true"
            />
            <div
              className="sim-tour-scrim-panel"
              data-tour-scrim="right"
              style={{
                top: Math.max(0, geometry.spotlight.top),
                left: Math.min(
                  geometry.viewport.width,
                  geometry.spotlight.left + geometry.spotlight.width,
                ),
                right: 0,
                height: Math.max(
                  0,
                  Math.min(
                    geometry.viewport.height,
                    geometry.spotlight.top + geometry.spotlight.height,
                  ) - Math.max(0, geometry.spotlight.top),
                ),
              }}
              aria-hidden="true"
            />
            <div
              className="sim-tour-spotlight"
              style={{
                top: geometry.spotlight.top,
                left: geometry.spotlight.left,
                width: geometry.spotlight.width,
                height: geometry.spotlight.height,
              }}
            />
          </>
        )}
        <section
          className="sim-tour-popover"
          style={
            geometry
              ? {
                  top: geometry.popover.top,
                  left: geometry.popover.left,
                }
              : { visibility: "hidden" }
          }
        >
          <div className="sim-tour-header">
            <h3 id="simulate-tour-title">{activeStep.title}</h3>
            <button
              type="button"
              onClick={() => closeTour(false)}
              aria-label="Close simulate page tour"
            >
              &times;
            </button>
          </div>
          <p>{activeStep.text}</p>
          <div className="sim-tour-footer">
            <span>
              {activeIndex + 1} / {steps.length}
            </span>
            <div>
              {activeIndex > 0 && (
                <button
                  type="button"
                  className="sim-tour-secondary"
                  onClick={() => showStep(activeIndex - 1)}
                >
                  Back
                </button>
              )}
              {activeIndex === 0 && (
                <button
                  type="button"
                  className="sim-tour-secondary"
                  onClick={() => closeTour(false)}
                >
                  Skip
                </button>
              )}
              {activeIndex > 0 && (
                <button
                  type="button"
                  className="sim-tour-secondary"
                  disabled={actionLoading}
                  onClick={() => startSimulateTour("restart")}
                >
                  Restart
                </button>
              )}
              <button
                type="button"
                className="sim-tour-primary"
                disabled={actionLoading}
                onClick={() => {
                  if (activeStep.runAction) {
                    void runTourAction(activeStep, activeIndex + 1);
                  } else if (isLast) {
                    closeTour(true);
                  } else {
                    showStep(activeIndex + 1);
                  }
                }}
              >
                {actionLoading
                  ? "Running..."
                  : actionLabel ?? (isLast ? "Done" : "Next")}
              </button>
              {activeStep.runAction && (
                <button
                  type="button"
                  className="sim-tour-secondary"
                  disabled={actionLoading}
                  onClick={() => showStep(activeIndex + 1)}
                >
                  Skip run
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
    ) : null,
  };
}
