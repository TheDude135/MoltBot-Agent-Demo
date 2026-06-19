// The deploy wizard's phase machine and stepper geometry. Pure, UI-agnostic
// logic shared by the orchestrator (app/page.tsx) and the flow hooks, kept here
// so it can be unit-tested in isolation.

import type { Blueprint } from "./types";

/** Every screen the deploy flow can show. */
export type Phase =
  | "catalog"
  | "detail"
  | "url"
  | "configure"
  | "provisioning"
  | "progress"
  | "done"
  | "pick-voice"
  | "installing-app"
  | "installing-voice"
  | "voice-done"
  | "error";

// Site-less blueprints (no Wix introspection) drop the "Site" step, so each
// phase maps to a step LABEL and we look its index up in whichever step list is
// active - this works for both the 5-step (Wix) and 4-step (no-site) shapes.
export const STEPS_WITH_SITE = [
  "Blueprint",
  "Site",
  "Configure",
  "Deploy",
  "Voice",
] as const;
export const STEPS_NO_SITE = [
  "Blueprint",
  "Configure",
  "Deploy",
  "Voice",
] as const;

const STEP_LABEL_FOR_PHASE: Record<Phase, string> = {
  catalog: "Blueprint",
  detail: "Blueprint",
  url: "Site",
  configure: "Configure",
  provisioning: "Deploy",
  progress: "Deploy",
  done: "Deploy",
  "pick-voice": "Voice",
  "installing-app": "Voice",
  "installing-voice": "Voice",
  "voice-done": "Voice",
  error: "Deploy",
};

/**
 * True when a blueprint carries the Wix-introspectable variables the Site step
 * fills (business_name / services). Site-less blueprints (e.g. the Personal
 * Assistant) skip the Site step and the AI persona seeding.
 */
export function blueprintUsesSite(bp: Blueprint): boolean {
  return bp.variables.some(
    (v) => v.key === "services_table_md" || v.key === "business_name",
  );
}

/**
 * The stepper geometry for the current phase: which labels to show and which
 * one is active. `usesSite` selects the 5- or 4-step shape. `current` is clamped
 * to 0 so a phase whose label is missing from the active list never goes
 * negative (defensive - every phase currently maps to a present label).
 */
export function computeStepper(
  phase: Phase,
  usesSite: boolean,
): { steps: readonly string[]; current: number } {
  const steps: readonly string[] = usesSite ? STEPS_WITH_SITE : STEPS_NO_SITE;
  const current = Math.max(0, steps.indexOf(STEP_LABEL_FOR_PHASE[phase]));
  return { steps, current };
}
