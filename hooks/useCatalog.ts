"use client";

// Loads the owner's blueprints + deployments once on mount. The two endpoints
// are treated INDEPENDENTLY: a key with blueprints:read but not
// deployments:read still shows the catalog, and the deployment dropdown surfaces
// its own error later in the Configure phase.

import { useEffect, useMemo, useState } from "react";
import type { Blueprint, Deployment } from "@/lib/types";
import { errorMessage, getBlueprints, getDeployments } from "@/lib/browser-api";

export interface CatalogState {
  blueprints: Blueprint[];
  deployments: Deployment[];
  operationalDeployments: Deployment[];
  loading: boolean;
  catalogError: string | null;
  deploymentsError: string | null;
}

export function useCatalog(): CatalogState {
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [deploymentsError, setDeploymentsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Settle both so one failure can't hide the other (the documented intent).
      const [bp, dep] = await Promise.allSettled([
        getBlueprints(),
        getDeployments(),
      ]);
      if (cancelled) return;
      if (bp.status === "fulfilled") setBlueprints(bp.value);
      else setCatalogError(errorMessage(bp.reason));
      if (dep.status === "fulfilled") setDeployments(dep.value);
      else setDeploymentsError(errorMessage(dep.reason));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // OPERATIONAL deployments are the only valid deploy targets; the rest are
  // still provisioning or errored.
  const operationalDeployments = useMemo(
    () => deployments.filter((d) => d.status === "OPERATIONAL"),
    [deployments],
  );

  return {
    blueprints,
    deployments,
    operationalDeployments,
    loading,
    catalogError,
    deploymentsError,
  };
}
