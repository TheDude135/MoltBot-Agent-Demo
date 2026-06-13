// Voice-half timeline + done card. Mirrors the deploy half EXACTLY (same
// <Timeline> primitive, same endpoint pills) so attaching a phone feels like
// one continuous flow. The three REST calls: install the Wix app -> mint the
// install bundle -> dispatch the gateway onto the fleet host (polled).

"use client";

import type { VoiceOperation } from "@/lib/types";
import { Phone, CheckCircle } from "@phosphor-icons/react";
import { Button, Card, PhaseHeader } from "./atoms";
import { Timeline, type StepStatus, type TimelineStep } from "./Timeline";

export function VoiceTimeline({
  stage,
  phoneNumber,
  agentId,
  operation,
}: {
  /** "app" = installing the Wix app; "gateway" = minting + dispatching the gateway. */
  stage: "app" | "gateway";
  phoneNumber: string | null;
  agentId: string;
  operation: VoiceOperation | null;
}) {
  const opStatus = operation?.status;
  const gatewayStatus: StepStatus =
    stage === "app"
      ? "pending"
      : opStatus === "succeeded"
        ? "done"
        : opStatus === "failed"
          ? "failed"
          : "active";

  const steps: TimelineStep[] = [
    {
      key: "app",
      title: "Install the Wix Bookings app",
      desc: "Connects the booking app so the agent can quote prices and book real appointments.",
      method: "POST",
      path: "/v1/voice-deployments/{id}/apps",
      status: stage === "app" ? "active" : "done",
    },
    {
      key: "bundle",
      title: "Mint the install bundle",
      desc: "A one-time token + config the fleet host redeems to set up the gateway.",
      method: "POST",
      path: "/v1/voice-deployments/{id}/install-bundles",
      status: stage === "app" ? "pending" : "done",
    },
    {
      key: "gateway",
      title: "Install the gateway on the fleet host",
      desc:
        stage === "app"
          ? "Runs install.sh on the host and binds the number to this agent."
          : `Running install.sh on the fleet host${operation ? ` (op ${operation.id})` : ""}. First install takes 30-60s.`,
      method: "POST",
      path: "/v1/deployments/{fleet}/agents/{agentId}/voice-installs",
      status: gatewayStatus,
    },
  ];

  return (
    <div className="space-y-4">
      <PhaseHeader
        title={`Giving ${agentId} a phone`}
        description={
          phoneNumber ? `Binding the number ${phoneNumber} to this sub-agent.` : undefined
        }
      />
      <Timeline title="Voice steps" steps={steps} />
      {operation?.error && opStatus === "failed" && (
        <Card className="border-rose-500/20 bg-rose-500/[0.06] p-3">
          <p className="text-xs text-rose-300">
            <span className="font-mono">{operation.error.code}</span>: {operation.error.message}
          </p>
        </Card>
      )}
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
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-lg shadow-emerald-600/30">
        <Phone size={28} weight="fill" className="text-white" />
      </div>

      <div>
        <p className="text-lg font-bold tracking-tight text-white">
          {agentId} is live on the phone
        </p>
        <p className="mt-1 text-xs text-gray-500">
          The number below is now bound to this sub-agent. Call it to hear your agent answer.
        </p>
      </div>

      {phoneNumber && (
        <a
          href={`tel:${phoneNumber}`}
          className="mx-auto flex w-full max-w-xs items-center justify-center gap-2 rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-3 font-mono text-xl font-bold text-violet-200 transition hover:bg-violet-500/15"
        >
          <Phone size={20} weight="fill" />
          {phoneNumber}
        </a>
      )}

      {wixInstalled && (
        <p className="mx-auto inline-flex items-start gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2 text-left text-xs font-medium text-emerald-300">
          <CheckCircle size={16} weight="fill" className="mt-px flex-shrink-0" />
          <span>
            Wix Bookings connected: the agent can answer service + price questions and book
            real appointments on the live calendar.
          </span>
        </p>
      )}

      <div className="pt-1">
        <Button size="sm" variant="secondary" onClick={onReset}>
          Deploy another
        </Button>
      </div>
    </Card>
  );
}
