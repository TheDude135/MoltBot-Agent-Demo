// Pick-voice-deployment phase — after the blueprint deploy succeeds, the
// user can pick a voice deployment they own (Telnyx phone + TTMA voice
// gateway) to attach to the newly-created sub-agent. The TTMA list is
// fetched lazily on entry, scoped to the API key's per-instance scope.

"use client";

import type { VoiceDeployment } from "@/lib/types";
import { Button, Card, CenteredStatus, Chip, PhaseHeader, Section } from "./atoms";

export function PickVoiceDeploymentPhase({
  voiceDeployments,
  loading,
  error,
  agentId,
  selectedVoiceDeploymentId,
  onChangeSelected,
  onBack,
  onSubmit,
  onSkip,
  canSubmit,
}: {
  voiceDeployments: VoiceDeployment[];
  loading: boolean;
  error: string | null;
  agentId: string;
  selectedVoiceDeploymentId: string;
  onChangeSelected: (id: string) => void;
  onBack: () => void;
  onSubmit: () => void;
  onSkip: () => void;
  canSubmit: boolean;
}) {
  if (loading) {
    return (
      <CenteredStatus
        label="Looking up your voice deployments..."
        detail="Talking to api.talktomyagent.io via the local proxy."
      />
    );
  }

  if (error) {
    return (
      <Card className="space-y-3 border-rose-500/30 bg-rose-500/[0.08] p-5">
        <p className="font-semibold text-rose-300">Could not load voice deployments</p>
        <p className="text-sm text-rose-200/80">{error}</p>
        <p className="text-xs text-rose-200/60">
          Hint: your API key needs the
          <code className="mx-1 rounded bg-black/30 px-1 font-mono">voice:read</code>
          scope and must be scoped to at least one voice deployment.
        </p>
        <div className="flex gap-2 pt-2">
          <Button size="sm" variant="secondary" onClick={onBack}>
            Back
          </Button>
          <Button size="sm" variant="secondary" onClick={onSkip}>
            Skip voice
          </Button>
        </div>
      </Card>
    );
  }

  // The list excludes voice deployments without a phone number — those
  // can't be installed via the install-bundle flow. If the customer
  // truly has zero usable voice deployments, we surface the same "skip"
  // affordance rather than blocking.
  const usable = voiceDeployments.filter((d) => d.phoneNumber);

  if (usable.length === 0) {
    return (
      <Card className="space-y-4 p-6">
        <div>
          <p className="text-base font-bold text-white">
            No voice deployments available
          </p>
          <p className="mt-1 text-xs text-gray-500">
            You can still finish here, or provision a Telnyx number first via
            the TTMA portal at{" "}
            <a
              href="https://app.talktomyagent.io"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              app.talktomyagent.io
            </a>{" "}
            and try again.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={onBack}>
            Back
          </Button>
          <Button size="sm" onClick={onSkip}>
            Finish without voice
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <PhaseHeader
        title={`Give ${agentId} a phone`}
        description="Pick a voice deployment you own. The install binds the number to this agent, so calls reach this sub-agent's voice playbook."
        onBack={onBack}
      />

      <Section title="Your voice deployments">
        <div className="space-y-2">
          {usable.map((vd) => {
            const selected = vd.id === selectedVoiceDeploymentId;
            return (
              <button
                key={vd.id}
                onClick={() => onChangeSelected(vd.id)}
                className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                  selected
                    ? "border-violet-400 bg-violet-500/10"
                    : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-sm font-bold text-white">
                      {vd.phoneNumber}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-gray-500">
                      {vd.id}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {vd.agentId && (
                      <Chip tone="violet">
                        bound to {vd.agentId}
                      </Chip>
                    )}
                    {vd.lifecycleStatus && (
                      <Chip tone={vd.lifecycleStatus === "active" ? "emerald" : "gray"}>
                        {vd.lifecycleStatus}
                      </Chip>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Rebinding note">
        <p className="text-xs text-gray-500">
          If the selected number is already bound to another sub-agent, the
          install will <span className="text-violet-300">rotate that gateway's secret</span>{" "}
          and rebind to "{agentId}". Use this flow on a number you intend to
          re-route. Otherwise pick another deployment or provision a fresh one
          at app.talktomyagent.io.
        </p>
      </Section>

      <div className="flex items-center gap-2 pt-2">
        <Button size="sm" variant="ghost" onClick={onSkip}>
          Skip voice
        </Button>
        <Button
          size="sm"
          onClick={onSubmit}
          disabled={!canSubmit}
          leadingIcon={<span>📞</span>}
          className="ml-auto"
        >
          Install voice
        </Button>
      </div>
    </div>
  );
}
