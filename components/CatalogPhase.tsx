// Catalog phase — first phase the user sees. Lists blueprints the API
// returned and lets them pick one. Loading and error states render in-place.

"use client";

import type { Blueprint } from "@/lib/types";
import { tidyDashes } from "@/lib/format";
import { Card, CenteredStatus, Chip, PhaseHeader } from "./atoms";

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
      <Card className="border-rose-500/30 bg-rose-500/[0.08] p-5">
        <p className="font-semibold text-rose-300">Could not load catalog</p>
        <p className="mt-1 text-sm text-rose-200/80">{error}</p>
        <p className="mt-3 text-xs text-rose-200/60">
          Hint: confirm NINJA_API_KEY in .env.local has the
          <code className="mx-1 rounded bg-black/30 px-1 font-mono">
            blueprints:read
          </code>
          and
          <code className="mx-1 rounded bg-black/30 px-1 font-mono">
            deployments:read
          </code>
          scopes, and that the dev server was restarted after editing .env.local.
        </p>
      </Card>
    );
  }
  if (blueprints.length === 0) {
    return (
      <Card className="p-6 text-center">
        <p className="text-sm font-semibold text-gray-300">No blueprints yet</p>
        <p className="mt-1 text-xs text-gray-500">
          Save an agent as a blueprint in MoltBot Ninja first, then come back.
        </p>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      <PhaseHeader
        title="Pick a blueprint"
        description="Each blueprint is a pre-configured agent. Clone one and tailor it to your business."
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {blueprints.map((bp) => (
          <button
            key={bp.id}
            onClick={() => onSelect(bp)}
            className="group rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-left shadow-[0_20px_40px_-24px_rgba(0,0,0,0.7)] backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-violet-500/50 hover:bg-violet-500/[0.06]"
          >
            <p className="text-sm font-semibold text-white">{bp.name}</p>
            {bp.description && (
              <p className="mt-1 line-clamp-2 text-xs text-gray-500">
                {tidyDashes(bp.description)}
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
