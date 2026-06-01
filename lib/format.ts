// Display helpers. Mirrors the Phase-2 step label format used by the
// main dashboard so a customer who has seen one surface recognises
// the other.

export function formatStepName(step: string): string {
  if (step === "dojoSync") return "Writing files";
  if (step === "voiceConfig") return "Applying voice config";
  if (step.startsWith("secret:")) return `Configuring secret: ${step.slice(7)}`;
  if (step.startsWith("skill:")) return `Installing skill: ${step.slice(6)}`;
  if (step.startsWith("gallery:")) return `Installing template: ${step.slice(8)}`;
  return step;
}
