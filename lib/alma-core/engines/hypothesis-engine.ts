import { PATTERN_ALGORITHM_VERSION } from "../data-model/versions";
import { clamp, stableId } from "./math";
import type { PatternCandidate, ResearchHypothesis } from "./types";

export interface HypothesisSeed {
  factorDefinitionIds: string[];
  modifierDefinitionIds?: string[];
  relationshipType?: PatternCandidate["relationshipType"];
  priorScore?: number;
  source?: ResearchHypothesis["source"];
  explanation: string;
  optionalMetricIds?: string[];
}

/**
 * Builds explicit competing hypotheses from supplied seeds. The engine does
 * not invent medical/scientific priors: those may be supplied later by a
 * reviewed knowledge adapter.
 */
export function buildCompetingHypotheses(
  targetDefinitionId: string,
  seeds: HypothesisSeed[],
): ResearchHypothesis[] {
  return deduplicateSeeds(seeds).map((seed) => {
    const factorDefinitionIds = [...seed.factorDefinitionIds].sort();
    const modifierDefinitionIds = [...(seed.modifierDefinitionIds ?? [])].sort();
    return {
      id: stableId(
        "hypothesis",
        targetDefinitionId,
        ...factorDefinitionIds,
        ...modifierDefinitionIds,
        seed.relationshipType ?? "association",
      ),
      targetDefinitionId,
      factorDefinitionIds,
      modifierDefinitionIds,
      relationshipType: seed.relationshipType ?? "association",
      priorScore: clamp(seed.priorScore ?? 0.15, 0, 1),
      evidenceScore: 0,
      status: "candidate",
      source: seed.source ?? "personal_candidate",
      requiredMetricIds: Array.from(
        new Set([targetDefinitionId, ...factorDefinitionIds, ...modifierDefinitionIds]),
      ),
      optionalMetricIds: Array.from(new Set(seed.optionalMetricIds ?? [])),
      explanation: seed.explanation,
    };
  });
}

export function updateHypothesesFromPatterns(
  hypotheses: ResearchHypothesis[],
  patterns: PatternCandidate[],
) {
  return hypotheses.map((hypothesis) => {
    const matches = patterns.filter(
      (pattern) =>
        pattern.targetDefinitionId === hypothesis.targetDefinitionId &&
        sameMembers(pattern.factorDefinitionIds, hypothesis.factorDefinitionIds) &&
        hypothesis.modifierDefinitionIds.every((modifier) =>
          pattern.modifierDefinitionIds.includes(modifier),
        ),
    );
    const evidenceScore = matches.length
      ? Math.max(...matches.map((pattern) => pattern.evidenceScore))
      : hypothesis.evidenceScore;
    const opportunities = matches.length
      ? Math.max(...matches.map((pattern) => pattern.diagnostics.opportunities))
      : 0;
    const status: ResearchHypothesis["status"] =
      evidenceScore >= 0.72 && opportunities >= 12
        ? "supported"
        : evidenceScore >= 0.35
          ? "collecting"
          : opportunities >= 8 && evidenceScore < 0.2
            ? "weakened"
            : hypothesis.status;
    return {
      ...hypothesis,
      evidenceScore,
      status,
    };
  });
}

export function hypothesisAlgorithmVersion() {
  return PATTERN_ALGORITHM_VERSION;
}

function deduplicateSeeds(seeds: HypothesisSeed[]) {
  const seen = new Set<string>();
  return seeds.filter((seed) => {
    const key = [
      [...seed.factorDefinitionIds].sort().join(","),
      [...(seed.modifierDefinitionIds ?? [])].sort().join(","),
      seed.relationshipType ?? "association",
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sameMembers(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}
