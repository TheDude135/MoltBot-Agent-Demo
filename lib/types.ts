// Shared types describing the slice of the MoltBot Ninja API this demo
// consumes. Hand-aligned with functions/src/api/v1/blueprints-catalog.ts,
// deployments.ts, agents.ts, blueprints.ts, and operations.ts.
//
// The demo never imports types from the ClawdBot Installer repo — this
// file is the external app's contract surface. If the API evolves,
// update these types deliberately.

export type VariableType =
  | "text"
  | "textarea"
  | "secret"
  | "number"
  | "select"
  | "boolean";

// The agent's emoji has a single source of truth: the identity picker shown
// in the Configure phase. Blueprints also expose it as a variable (used in
// their persona/SOUL files); when present, that variable is driven from the
// picker and hidden from the variable list so there is never a second emoji
// control that can diverge from the identity icon shown in the Ninja UI.
export const EMOJI_VARIABLE_KEY = "agent_emoji";

// The agent's name has a single source of truth: the identity "Name" field in
// the Configure phase, which also generates the agentId. Blueprints also expose
// the name as a variable (used in their IDENTITY/SOUL/persona files); when
// present, that variable is driven from the Name field and hidden from the
// variable list, exactly like EMOJI_VARIABLE_KEY, so there is never a second
// name control that can diverge from the agent's identity.
export const NAME_VARIABLE_KEY = "agent_name";

export interface BlueprintVariable {
  key: string;
  label: string;
  description: string;
  type: VariableType;
  required: boolean;
  default: string;
  maxLength?: number;
  options?: string[];
  secretLabel?: string;
}

export interface BlueprintFileManifestEntry {
  path: string;
  sizeBytes: number;
}

export interface Blueprint {
  id: string;
  name: string;
  description: string;
  version: number;
  variables: BlueprintVariable[];
  skills: { slug: string }[];
  galleryTemplates: string[];
  voiceConfig: Record<string, unknown> | null;
  fileManifest: BlueprintFileManifestEntry[];
  sourceDeploymentId: string;
  sourceAgentId: string;
  createdAt: string | null;
  updatedAt: string | null;
}

// ─── Demo wizard flow state (these are not MoltBot Ninja API shapes) ──────

/** Identity of the agent currently being deployed; set after provision. */
export interface ProvisionContext {
  requestId: string;
  deploymentId: string;
  agentId: string;
}

/** Summary of a successful Wix site introspection. Shown in the Configure
 *  banner and reused to install the Wix app during voice setup. */
export interface IntrospectSummary {
  businessName: string;
  serviceCount: number;
  staffCount: number;
  canonicalUrl: string;
}

export interface Deployment {
  id: string;
  status: string;
  botName: string | null;
  telegramUsername: string | null;
  publicIp: string | null;
  instanceName: string | null;
  errorMessage: string | null;
  createdAt: string | null;
}

export type OperationStatus = "pending" | "succeeded" | "failed";

export interface Operation {
  id: string;
  status: OperationStatus;
  kind: string;
  resource: string;
  createdAt: string;
  completedAt: string | null;
  result: Record<string, unknown> | null;
  error: { code: string; message: string } | null;
}

export type DeployStatus = "applying" | "complete" | "partial" | "failed";

export interface BlueprintDeployRecord {
  requestId: string;
  blueprintId: string;
  status: DeployStatus;
  pendingSteps: string[];
  completedSteps: string[];
  failedSteps: string[];
  agentId: string;
  deploymentId: string;
}

// ─── Voice install bundle types (TTMA voice-api) ─────────────────────────

/** A voice deployment owned by the customer — Telnyx phone + TTMA voice gateway. */
export interface VoiceDeployment {
  id: string;
  /** Friendly deployment name (the bot's display name). Null on legacy
   *  deployments that never had one set. */
  name: string | null;
  phoneNumber: string | null;
  lifecycleStatus: string | null;
  agentId: string | null;
  createdAt: string | null;
}

/**
 * The opaque bundle returned by TTMA `/v1/voice-deployments/:id/install-bundles`.
 * Forwarded verbatim to Ninja `/v1/.../voice-installs`. The token is one-time
 * use with a 15-minute TTL; do not cache.
 */
export interface InstallBundle {
  token: string;
  voiceDeploymentId: string;
  agentId: string;
  phoneNumber: string;
  expiresAt: string;
  redeemEndpoint?: string;
  requestedVersion?: string | null;
}

/** Public projection of `apiOperations` for voice.install / voice.uninstall. */
export interface VoiceOperation extends Operation {
  kind: "voice.install" | "voice.uninstall";
}

/** Per-agent voice back-pointer surfaced by GET /v1/.../agents/:agentId. */
export interface AgentVoiceBackPointer {
  voiceDeploymentId: string;
  phoneNumber: string | null;
  installedAt: string | null;
  installId: string;
}
