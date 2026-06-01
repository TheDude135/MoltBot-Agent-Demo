// Catalog phase — first phase the user sees. Lists blueprints the API
// returned and lets them pick one. Loading and error states render in-place.

"use client";

import type { Blueprint } from "@/lib/types";
import { CenteredStatus, Chip } from "./atoms";

export function CatalogPhase({
  blueprints,
  loading,
  error,
  onSelect,
}: {
  blueprints: Blueprint[];
  loading: boolean;
  error: string | null;
  onSelect: (bp: Blueprint) => void;
}) {
  if (loading) {
    return (
      <CenteredStatus
        label="Loading blueprints..."
        detail="Talking to api.moltbot.ninja via the local proxy."
      />
    );
  }
  if (error) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5">
        <p className="font-semibold text-red-300">Could not load catalog</p>
        <p className="mt-1 text-sm text-red-200/80">{error}</p>
        <p className="mt-3 text-xs text-red-200/60">
          Hint: confirm MBN_API_KEY in .env.local has the
          <code className="mx-1 rounded bg-black/30 px-1 font-mono">
            blueprints:read
          </code>
          and
          <code className="mx-1 rounded bg-black/30 px-1 font-mono">
            deployments:read
          </code>
          scopes, AND that the API itself is deployed (api.moltbot.ninja must
          list /v1/blueprints in /v1/openapi.json).
        </p>
      </div>
    );
  }
  if (blueprints.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-center">
        <p className="text-sm font-semibold text-gray-300">No blueprints yet</p>
        <p className="mt-1 text-xs text-gray-500">
          Save an agent as a blueprint in MoltBot Ninja first, then come back.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">
        Pick a blueprint
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {blueprints.map((bp) => (
          <button
            key={bp.id}
            onClick={() => onSelect(bp)}
            className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-left transition-all hover:border-violet-500/40 hover:bg-violet-500/[0.04]"
          >
            <p className="text-sm font-semibold text-white">{bp.name}</p>
            {bp.description && (
              <p className="mt-1 line-clamp-2 text-xs text-gray-500">
                {bp.description}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Chip>v{bp.version}</Chip>
              <Chip>{bp.fileManifest.length} files</Chip>
              {bp.skills.length > 0 && (
                <Chip tone="emerald">
                  {bp.skills.length} skill{bp.skills.length !== 1 ? "s" : ""}
                </Chip>
              )}
              {bp.variables.length > 0 && (
                <Chip tone="violet">
                  {bp.variables.length} var
                  {bp.variables.length !== 1 ? "s" : ""}
                </Chip>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
