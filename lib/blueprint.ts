// Blueprint helpers shared across the wizard phases. Keeps the single rule for
// "which variables does the user actually personalize" in one place, so the
// catalog card, the intro page, and the Configure form never disagree.

import type { Blueprint, BlueprintVariable } from "./types";
import { EMOJI_VARIABLE_KEY, NAME_VARIABLE_KEY } from "./types";

// Variables the demo drives from its own identity controls (the Name field and
// the emoji picker) instead of showing as editable fields. They are hidden
// everywhere a blueprint's variables are listed and mirrored back in at submit
// (see submitProvision in app/page.tsx), so the agent's identity and its
// persona files can never carry two diverging values.
const IDENTITY_VARIABLE_KEYS = new Set<string>([
  NAME_VARIABLE_KEY,
  EMOJI_VARIABLE_KEY,
]);

/** True for a variable driven by an identity control, not the Configure form. */
export function isIdentityVariable(variable: BlueprintVariable): boolean {
  return IDENTITY_VARIABLE_KEYS.has(variable.key);
}

/** The variables a user actually personalizes (identity-driven ones removed). */
export function personalizableVariables(
  blueprint: Blueprint,
): BlueprintVariable[] {
  return blueprint.variables.filter((v) => !isIdentityVariable(v));
}
