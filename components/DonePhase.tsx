// Terminal phases — Done (deploy reached complete/partial/failed) and
// Error (orchestrator-side failure before the deploy was even dispatched).

"use client";

import type { BlueprintDeployRecord } from "@/lib/types";
import { formatStepName } from "@/lib/format";
import { Button, Card } from "./atoms";

/** Seeding outcome surfaced under the done state. `null` = not applicable
 *  (e.g. deploy didn't complete). */
export interface SeedNote {
  status: "running" | "seeded" | "skipped" | "error";
  message: string;
}

export function DonePhase({
  deployRecord,
  agentId,
  onReset,
  onAttachVoice,
  seedNote,
}: {
  deployRecord: BlueprintDeployRecord | null;
  agentId: string;
  onReset: () => void;
  /** Optional — when present, renders the "Add a phone number" action.
   *  Wired only when the deploy completed cleanly; partial / failed
   *  states get only the reset button to keep the failure visible. */
  onAttachVoice?: () => void;
  /** Optional — AI file-seeding status (enrichment, best-effort). */
  seedNote?: SeedNote | null;
}) {
  const status = deployRecord?.status ?? "complete";
  const failedSteps = deployRecord?.failedSteps ?? [];
  const ring =
    status === "complete"
      ? "from-emerald-400 to-emerald-600 shadow-emerald-600/30"
      : status === "partial"
        ? "from-amber-400 to-amber-600 shadow-amber-600/30"
        : "from-rose-400 to-rose-600 shadow-rose-600/30";
  return (
    <Card className="space-y-5 p-6 text-center">
      <div
        className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br text-2xl shadow-lg ${ring}`}
      >
        {status === "complete" ? "🎉" : status === "partial" ? "⚠️" : "❌"}
      </div>
      <div>
        <p className="text-lg font-bold tracking-tight text-white">
          {status === "complete"
            ? `${agentId} is live`
            : status === "partial"
              ? "Deployed with some failed steps"
              : "Deploy failed"}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          {status === "complete"
            ? "Your sub-agent is deployed and ready."
            : "See the details below."}
        </p>
      </div>

      {failedSteps.length > 0 && (
        <div className="space-y-1 rounded-xl border border-rose-500/20 bg-rose-500/[0.06] p-3 text-left">
          <p className="text-xs font-semibold text-rose-300">Failed steps</p>
          {failedSteps.map((s) => (
            <p key={s} className="font-mono text-[11px] text-rose-300/80">
              ✕ {formatStepName(s)}
            </p>
          ))}
        </div>
      )}

      {seedNote && <SeedNoteCard note={seedNote} />}

      <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
        {onAttachVoice && (
          <Button size="sm" onClick={onAttachVoice} leadingIcon={<span>📞</span>}>
            Add a phone number
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={onReset}>
          Deploy another
        </Button>
      </div>
    </Card>
  );
}

function SeedNoteCard({ note }: { note: SeedNote }) {
  const tone =
    note.status === "seeded"
      ? "border-emerald-500/20 bg-emerald-500/[0.06]"
      : note.status === "error"
        ? "border-amber-500/20 bg-amber-500/[0.06]"
        : "border-white/10 bg-white/[0.03]";
  const title =
    note.status === "running"
      ? "✍️ Tailoring the agent to the site…"
      : note.status === "seeded"
        ? "✍️ Persona tailored to the site"
        : note.status === "skipped"
          ? "✍️ Using the blueprint's templated files"
          : "✍️ Seeding skipped";
  return (
    <div className={`rounded-xl border p-3 text-left text-[11px] ${tone}`}>
      <p className="flex items-center gap-2 font-semibold text-gray-200">
        {note.status === "running" && (
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
        )}
        {title}
      </p>
      <p className="mt-0.5 text-gray-500">{note.message}</p>
    </div>
  );
}

export function ErrorPhase({
  message,
  onReset,
}: {
  message: string;
  onReset: () => void;
}) {
  return (
    <Card className="space-y-3 border-rose-500/30 bg-rose-500/[0.08] p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/15 text-lg">
          ⚠️
        </div>
        <p className="text-base font-bold text-rose-200">Something went wrong</p>
      </div>
      <p className="text-sm leading-relaxed text-rose-200/80">{message}</p>
      <div className="pt-1">
        <Button size="sm" variant="danger" onClick={onReset}>
          Start over
        </Button>
      </div>
    </Card>
  );
}
