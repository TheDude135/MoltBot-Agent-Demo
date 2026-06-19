"use client";

// Orchestrator for the demo deploy flow. It owns only the master state machine
// (`phase`) and the shared error message, then wires three flow hooks together
// and renders the component for the current phase. The flow logic lives in:
//   - hooks/useCatalog       load blueprints + deployments
//   - hooks/useDeployFlow    pick -> (site) -> configure -> provision -> progress -> seed
//   - hooks/useVoiceInstall  optional voice attach (pick -> app -> voice -> done)
// and every /api call goes through the tested lib/browser-api client.
//
// Security: no API key, no Firestore credential, no SDK in the browser bundle -
// the demo's own same-origin Next.js routes are the only thing this page talks
// to, and they hold the bearer key server-side.

import { useState } from "react";
import type { Phase } from "@/lib/wizard-steps";
import { computeStepper } from "@/lib/wizard-steps";
import { useCatalog } from "@/hooks/useCatalog";
import { useDeployFlow } from "@/hooks/useDeployFlow";
import { useVoiceInstall } from "@/hooks/useVoiceInstall";
import { AppHeader } from "@/components/AppHeader";
import { Stepper } from "@/components/Stepper";
import { CatalogPhase } from "@/components/CatalogPhase";
import { BlueprintDetailPhase } from "@/components/BlueprintDetailPhase";
import { UrlPhase } from "@/components/UrlPhase";
import { ConfigurePhase } from "@/components/ConfigurePhase";
import { DonePhase, ErrorPhase } from "@/components/DonePhase";
import { PickVoiceDeploymentPhase } from "@/components/PickVoiceDeploymentPhase";
import { VoiceTimeline, VoiceDonePhase } from "@/components/InstallVoicePhase";
import { SetupTimeline } from "@/components/SetupTimeline";

export default function Page() {
  const [phase, setPhase] = useState<Phase>("catalog");
  // The single shared error message. Both flow hooks set it (via setError) just
  // before switching to the "error" phase; ErrorPhase renders it.
  const [provisionError, setProvisionError] = useState<string | null>(null);

  const catalog = useCatalog();
  const deploy = useDeployFlow({ phase, setPhase, setError: setProvisionError });
  const voice = useVoiceInstall({
    phase,
    setPhase,
    setError: setProvisionError,
    provisionContext: deploy.provisionContext,
    introspectSummary: deploy.introspectSummary,
  });

  // Full reset back to the catalog: clear phase + error, then each flow's state.
  const reset = () => {
    setPhase("catalog");
    setProvisionError(null);
    deploy.resetDeploy();
    voice.resetVoice();
  };

  const { steps, current } = computeStepper(phase, deploy.usesSite);
  const agentId = deploy.provisionContext?.agentId;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <AppHeader />

      {phase !== "error" && (
        <div className="mb-8">
          <Stepper steps={steps} current={current} />
        </div>
      )}

      <div key={phase} className="animate-fade-in">
        {phase === "catalog" && (
          <CatalogPhase
            blueprints={catalog.blueprints}
            loading={catalog.loading}
            error={catalog.catalogError}
            onSelect={deploy.handleSelectBlueprint}
          />
        )}

        {phase === "detail" && deploy.selectedBlueprint && (
          <BlueprintDetailPhase
            blueprint={deploy.selectedBlueprint}
            usesSite={deploy.usesSite}
            onBack={deploy.backToCatalog}
            onContinue={deploy.handleContinueToDeploy}
          />
        )}

        {phase === "url" && deploy.selectedBlueprint && (
          <UrlPhase
            blueprint={deploy.selectedBlueprint}
            siteUrl={deploy.siteUrl}
            onChangeSiteUrl={deploy.setSiteUrl}
            introspecting={deploy.introspecting}
            introspectError={deploy.introspectError}
            onSubmit={deploy.handleIntrospect}
            onBack={() => setPhase("detail")}
          />
        )}

        {phase === "configure" && deploy.selectedBlueprint && (
          <ConfigurePhase
            blueprint={deploy.selectedBlueprint}
            deployments={catalog.operationalDeployments}
            allDeployments={catalog.deployments}
            deploymentsError={catalog.deploymentsError}
            targetDeploymentId={deploy.targetDeploymentId}
            onChangeTargetDeploymentId={deploy.setTargetDeploymentId}
            agentName={deploy.agentName}
            onChangeAgentName={deploy.onChangeAgentName}
            nameError={deploy.nameError}
            generatedAgentId={deploy.generatedAgentId}
            agentEmoji={deploy.agentEmoji}
            onChangeAgentEmoji={deploy.setAgentEmoji}
            variableValues={deploy.variableValues}
            onChangeVariableValue={deploy.onChangeVariableValue}
            introspectSummary={deploy.introspectSummary}
            onBack={() => setPhase(deploy.usesSite ? "url" : "detail")}
            onSubmit={deploy.submitProvision}
            canSubmit={deploy.canSubmit}
          />
        )}

        {phase === "provisioning" && (
          <SetupTimeline
            phase="provisioning"
            deployRecord={deploy.deployRecord}
            seedNote={deploy.seedNote}
            usesSite={deploy.usesSite}
            agentId={agentId ?? deploy.generatedAgentId ?? "your agent"}
          />
        )}

        {phase === "progress" && (
          <SetupTimeline
            phase="progress"
            deployRecord={deploy.deployRecord}
            seedNote={deploy.seedNote}
            usesSite={deploy.usesSite}
            agentId={agentId ?? deploy.generatedAgentId ?? "(unknown)"}
          />
        )}

        {phase === "done" && (
          <DonePhase
            deployRecord={deploy.deployRecord}
            agentId={agentId ?? "(unknown)"}
            onReset={reset}
            onAttachVoice={
              deploy.deployRecord?.status === "complete"
                ? voice.handleAttachVoice
                : undefined
            }
            seedNote={deploy.seedNote}
          />
        )}

        {phase === "pick-voice" && (
          <PickVoiceDeploymentPhase
            voiceDeployments={voice.voiceDeployments}
            loading={voice.voiceListLoading}
            error={voice.voiceListError}
            agentId={agentId ?? "(unknown)"}
            selectedVoiceDeploymentId={voice.selectedVoiceDeploymentId}
            onChangeSelected={voice.setSelectedVoiceDeploymentId}
            onBack={() => setPhase("done")}
            onSubmit={voice.submitInstallAppThenVoice}
            onSkip={() => setPhase("done")}
            canSubmit={Boolean(voice.selectedVoiceDeploymentId)}
          />
        )}

        {phase === "installing-app" && (
          <VoiceTimeline
            stage="app"
            phoneNumber={voice.voiceInstallContext?.phoneNumber ?? null}
            agentId={agentId ?? "(unknown)"}
            operation={null}
          />
        )}

        {phase === "installing-voice" && (
          <VoiceTimeline
            stage="gateway"
            phoneNumber={voice.voiceInstallContext?.phoneNumber ?? null}
            agentId={agentId ?? "(unknown)"}
            operation={voice.voiceOperation}
          />
        )}

        {phase === "voice-done" && (
          <VoiceDonePhase
            phoneNumber={voice.voiceInstallContext?.phoneNumber ?? null}
            agentId={agentId ?? "(unknown)"}
            wixInstalled={voice.wixAppInstalled}
            onReset={reset}
          />
        )}

        {phase === "error" && (
          <ErrorPhase message={provisionError ?? "Unknown error"} onReset={reset} />
        )}
      </div>
    </main>
  );
}
