// Install-voice phase — shows live status while the install operation
// runs. Mirrors ProgressPhase's visual style but lighter: a single op,
// not a step list. Renders the destination phone number as soon as the
// orchestrator returns the bundle's metadata, so the user has context
// while polling.

"use client";

import type { VoiceOperation } from "@/lib/types";
import { CenteredStatus, Chip } from "./atoms";

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
    <div className="space-y-3">
      <header>
        <p className="text-xs uppercase tracking-wider text-gray-500">Phase 6</p>
        <h2 className="text-base font-bold text-white">
          Installing voice on {agentId}
        </h2>
        {phoneNumber && (
          <p className="mt-1 font-mono text-xs text-gray-500">
            target {phoneNumber}
          </p>
        )}
      </header>

      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
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
          <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-300">
            {operation.error.code}: {operation.error.message}
          </p>
        )}
      </div>
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
    <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-center">
      <div className="text-3xl">📞</div>
      <div>
        <p className="text-base font-bold text-white">
          "{agentId}" answers calls
        </p>
        {phoneNumber && (
          <p className="mt-1 font-mono text-sm text-violet-300">
            {phoneNumber}
          </p>
        )}
        <p className="mt-2 text-xs text-gray-500">
          Dial that number — the new sub-agent picks up.
        </p>
        {wixInstalled && (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5 text-xs font-semibold text-emerald-300">
            ✓ Wix Bookings installed — the agent can answer service/price
            questions and book real appointments
          </p>
        )}
      </div>
      <button
        onClick={onReset}
        className="rounded-xl border border-white/10 px-4 py-2 text-xs font-bold text-gray-300 hover:bg-white/5"
      >
        Deploy another
      </button>
    </div>
  );
}
