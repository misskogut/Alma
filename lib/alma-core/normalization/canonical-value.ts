import type { Observation } from "../data-model/types";
import { isHistoricalEvidenceStatus } from "../data-model/types";
import { metricDefinition } from "../registry/metric-registry";
import { sourceDefinition } from "../registry/source-registry";

export interface CanonicalResolution {
  canonical: Observation | null;
  alternatives: Observation[];
  reason: "manual_override" | "registry_priority" | "quality" | "no_eligible_value";
}

/**
 * Resolves one analytical value for one definition/time interval.
 * Predicted/planned/inferred rows never silently replace measured or confirmed facts.
 */
export function resolveCanonicalValue(observations: Observation[]): CanonicalResolution {
  const active = observations.filter((item) => !item.deletedAt);
  if (active.length === 0) return { canonical: null, alternatives: [], reason: "no_eligible_value" };

  const definitionId = active[0].definitionId;
  if (active.some((item) => item.definitionId !== definitionId)) {
    throw new Error("resolveCanonicalValue requires observations for one definition");
  }

  const facts = active.filter((item) => isHistoricalEvidenceStatus(item.epistemicStatus));
  const candidates = facts.length > 0 ? facts : active.filter((item) => item.epistemicStatus === "inferred");
  if (candidates.length === 0) {
    return { canonical: null, alternatives: active, reason: "no_eligible_value" };
  }

  const manualOverrides = candidates.filter((item) => item.source.sourceId === "manual" && item.epistemicStatus === "user_confirmed");
  const pool = manualOverrides.length > 0 ? manualOverrides : candidates;
  const registryPriority = metricDefinition(definitionId)?.sourcePriority ?? [];

  const sorted = [...pool].sort((a, b) => {
    const priorityA = sourceRank(a.source.sourceId, registryPriority);
    const priorityB = sourceRank(b.source.sourceId, registryPriority);
    if (priorityA !== priorityB) return priorityB - priorityA;
    const qualityA = a.confidence ?? 0.5;
    const qualityB = b.confidence ?? 0.5;
    if (qualityA !== qualityB) return qualityB - qualityA;
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });

  const canonical = sorted[0] ?? null;
  return {
    canonical,
    alternatives: active.filter((item) => item.id !== canonical?.id),
    reason: manualOverrides.length > 0 ? "manual_override" : registryPriority.length > 0 ? "registry_priority" : "quality",
  };
}

function sourceRank(sourceId: string, registryPriority: string[]) {
  const registryIndex = registryPriority.indexOf(sourceId);
  if (registryIndex >= 0) return 10_000 - registryIndex * 100;
  return sourceDefinition(sourceId)?.priority ?? 0;
}

