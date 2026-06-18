// Friendly, benefit-oriented copy for the skills a blueprint can install,
// keyed by slug. Used by the blueprint intro page to explain "what this agent
// can do" in plain language instead of raw slugs.
//
// Generic by design: nothing here is tied to one blueprint or one deployment.
// Any slug not in the catalog falls back to a humanized title + a sensible
// blurb, so a fork's owner sees a clean page even for skills we've never heard
// of.

export type SkillIconKey =
  | "email"
  | "calendar"
  | "crm"
  | "knowledge"
  | "phone"
  | "schedule"
  | "tasks"
  | "generic";

export interface SkillInfo {
  title: string;
  blurb: string;
  icon: SkillIconKey;
}

const CATALOG: Record<string, SkillInfo> = {
  agentmail: {
    title: "Email",
    blurb: "Reads, triages, and sends email on your behalf.",
    icon: "email",
  },
  "ninja-imap": {
    title: "Email",
    blurb: "Connects to a mailbox to read and reply to messages.",
    icon: "email",
  },
  "caldav-calendar": {
    title: "Calendar",
    blurb: "Checks availability, books, and reschedules events.",
    icon: "calendar",
  },
  "relationship-hub": {
    title: "Contact memory (CRM)",
    blurb: "Remembers who it talks to and recalls their details next time.",
    icon: "crm",
  },
  "dojo-relationship-hub": {
    title: "Contact memory (CRM)",
    blurb: "Remembers who it talks to and recalls their details next time.",
    icon: "crm",
  },
  "knowledge-hub": {
    title: "Knowledge base",
    blurb: "Answers questions from your own documents and FAQs.",
    icon: "knowledge",
  },
  "followup-queue": {
    title: "Follow-ups",
    blurb: "Tracks open threads and nudges them to completion.",
    icon: "tasks",
  },
  "dojo-appointment-scheduler": {
    title: "Appointment scheduling",
    blurb: "Finds open slots and books appointments for callers.",
    icon: "schedule",
  },
  "voice-call-trigger": {
    title: "Outbound calling",
    blurb: "Places a phone call when a task needs a voice.",
    icon: "phone",
  },
  "dojo-voice-agent": {
    title: "Voice behavior",
    blurb: "Shapes how it speaks and handles a live call.",
    icon: "phone",
  },
};

/** Friendly title + blurb + icon for a skill slug, with a graceful fallback. */
export function describeSkill(slug: string): SkillInfo {
  const hit = CATALOG[slug];
  if (hit) return hit;
  return {
    title: humanizeSlug(slug),
    blurb: "A capability bundled into this agent.",
    icon: "generic",
  };
}

/** "dojo-inbox-manager" -> "Inbox Manager" for unknown slugs. */
function humanizeSlug(slug: string): string {
  return slug
    .replace(/^dojo-/, "")
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
