// Install-voice phase — shows live status while the install operation
// runs. Mirrors ProgressPhase's visual style but lighter: a single op,
// not a step list. Renders the destination phone number as soon as the
// orchestrator returns the bundle's metadata, so the user has context
// while polling.

"use client";

import type { VoiceOperation } from "@/lib/types";
import { Button, Card, CenteredStatus, Chip, PhaseHeader } from "./atoms";

export function InstallVoicePhase({
  phoneNumber,
  agentId,
  operation,
}: {
  phoneNumber: string | null;
  agentId: string;
  operation: VoiceOperation | null;
}) {
  if (!operation) {
    return (
      <CenteredStatus
        label={`Installing voice on ${agentId}...`}
        detail={
          phoneNumber
            ? `Number ${phoneNumber} — dispatching to fleet-agent. First install can take 30-60s.`
            : "Dispatching install to fleet-agent. First install can take 30-60s."
        }
      />
    );
  }

  const status = operation.status;
  return (
    <div className="space-y-4">
      <PhaseHeader
        title={`Installing voice on ${agentId}`}
        description={phoneNumber ? `Target number ${phoneNumber}` : undefined}
      />

      <Card className="p-4">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-4 w-4 items-center justify-center">
            {status === "succeeded" ? (
              "✓"
            ) : status === "failed" ? (
              "✕"
            ) : (
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            )}
          </span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-white">
              {status === "succeeded"
                ? "Gateway installed"
                : status === "failed"
                  ? "Install failed"
                  : "Running install.sh on fleet host"}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">
              Operation:{" "}
              <span className="font-mono">{operation.id}</span>
            </p>
          </div>
          <Chip
            tone={
              status === "succeeded"
                ? "emerald"
                : status === "failed"
                  ? "gray"
                  : "violet"
            }
          >
            {status}
          </Chip>
        </div>
        {operation.error && status === "failed" && (
          <p className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-xs text-rose-300">
            {operation.error.code}: {operation.error.message}
          </p>
        )}
      </Card>
    </div>
  );
}

export function VoiceDonePhase({
  phoneNumber,
  agentId,
  wixInstalled,
  onReset,
}: {
  phoneNumber: string | null;
  agentId: string;
  /** True when the Wix Bookings app was installed on the voice deployment. */
  wixInstalled?: boolean;
  onReset: () => void;
}) {
  return (
    <Card className="space-y-5 p-6 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-2xl shadow-lg shadow-emerald-600/30">
        📞
      </div>
      <div>
        <p className="text-lg font-bold tracking-tight text-white">
          {agentId} answers calls
        </p>
        {phoneNumber && (
          <p className="mt-1 font-mono text-base text-violet-300">{phoneNumber}</p>
        )}
        <p className="mt-2 text-xs text-gray-500">
          Dial that number and the new sub-agent picks up.
        </p>
        {wixInstalled && (
          <p className="mx-auto mt-4 inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-1.5 text-xs font-medium text-emerald-300">
            ✓ Wix Bookings installed: it can answer service and price questions
            and book real appointments
          </p>
        )}
      </div>
      <div className="pt-1">
        <Button size="sm" variant="secondary" onClick={onReset}>
          Deploy another
        </Button>
      </div>
    </Card>
  );
}
