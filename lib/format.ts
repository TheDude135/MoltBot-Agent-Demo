// Display helpers for the live Phase-2 deploy step list. The blueprint deploy
// is the one setup phase whose individual steps the API exposes
// (pendingSteps/completedSteps), so we surface each one with a clear label and
// a one-line "what this does" so the demo reflects exactly what's happening.

/** Friendly names for the skills a blueprint installs, keyed by slug. */
const SKILL_LABELS: Record<string, string> = {
  "relationship-hub": "CRM — caller memory (RelationshipHub)",
  "dojo-relationship-hub": "CRM — caller memory (RelationshipHub)",
  "dojo-voice-agent": "Voice agent behavior",
  "voice-call-trigger": "Outbound calling",
  "dojo-appointment-scheduler": "Appointment scheduler",
  "dojo-inbox-manager": "Inbox manager",
};

/** Short, human label for one deploy step (e.g. "skill:relationship-hub"). */
export function formatStepName(step: string): string {
  if (step === "dojoSync") return "Writing the agent's files";
  if (step === "voiceConfig") return "Applying voice settings";
  if (step.startsWith("secret:")) return `Storing secret · ${step.slice(7)}`;
  if (step.startsWith("skill:")) {
    const slug = step.slice(6);
    return `Installing skill · ${SKILL_LABELS[slug] ?? slug}`;
  }
  if (step.startsWith("gallery:")) return `Installing template · ${step.slice(8)}`;
  return step;
}

/** One-line description of what a step actually does, or null if self-evident. */
export function describeStep(step: string): string | null {
  if (step === "dojoSync")
    return "Persona (SOUL.md), playbook, and config into the agent's own isolated workspace.";
  if (step === "voiceConfig")
    return "Greeting, language, and call mode for the phone gateway.";
  if (step.startsWith("secret:"))
    return "Encrypted in Secret Manager — never exposed to the browser.";
  if (step === "skill:relationship-hub" || step === "skill:dojo-relationship-hub")
    return "Per-agent CRM so the bot recognizes repeat callers and saves their details.";
  if (step.startsWith("skill:")) return "Adds a capability to the agent.";
  if (step.startsWith("gallery:")) return "Installs a Dojo gallery template.";
  return null;
}
