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
