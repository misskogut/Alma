import type {
  PersonalExperimentRecord,
  PersonalPattern,
  PersonalToolRecord,
  RecommendationRecord,
} from "../data-model/types";
import { PATTERN_ALGORITHM_VERSION } from "../data-model/versions";
import { metricDefinition } from "../registry/metric-registry";
import { clamp, stableId } from "./math";

const SAFE_CONTROLLABLE_ACTIONS = new Set([
  "walking",
  "workout",
  "yoga",
  "social_support",
]);

const LOWER_IS_MORE_COMFORTABLE = new Set([
  "headache",
  "nausea",
  "fatigue",
  "anxiety",
]);

const ACTION_EFFORT: Record<string, number> = {
  walking: 0.25,
  yoga: 0.35,
  social_support: 0.3,
  workout: 0.65,
};

export interface PersonalActionModel {
  recommendations: RecommendationRecord[];
  tools: PersonalToolRecord[];
  experiments: PersonalExperimentRecord[];
}

/**
 * Builds optional personal actions only from repeating personal evidence.
 * Medication, alcohol, food restriction and other health interventions are
 * deliberately excluded until a reviewed Safety/Scientific KB exists.
 */
export function derivePersonalActions(input: {
  patterns: PersonalPattern[];
  now?: string;
  userId?: string;
}): PersonalActionModel {
  const now = input.now ?? new Date().toISOString();
  const candidates = input.patterns
    .filter((pattern) =>
      !pattern.deletedAt &&
      !pattern.validTo &&
      pattern.lifecycle !== "no_longer_observed" &&
      (pattern.stage === "repeating_pattern" ||
        pattern.stage === "established_personal_pattern") &&
      pattern.factorDefinitionIds.length === 1 &&
      SAFE_CONTROLLABLE_ACTIONS.has(pattern.factorDefinitionIds[0]) &&
      isComfortableDirection(pattern),
    )
    .sort((left, right) => right.evidenceScore - left.evidenceScore);

  const recommendations: RecommendationRecord[] = [];
  const tools: PersonalToolRecord[] = [];
  const experiments: PersonalExperimentRecord[] = [];
  for (const pattern of candidates) {
    const actionDefinitionId = pattern.factorDefinitionIds[0];
    const evidence = evidenceCounts(pattern);
    const consistency = evidence.known === 0 ? 0 : evidence.support / evidence.known;
    const common = {
      userId: input.userId,
      version: 1,
      createdAt: now,
      updatedAt: now,
      origin: "local" as const,
      targetDefinitionId: pattern.targetDefinitionId,
      actionDefinitionId,
      relatedPatternIds: [pattern.id],
      algorithmVersion: PATTERN_ALGORITHM_VERSION,
    };

    recommendations.push({
      ...common,
      id: stableId("recommendation", pattern.targetDefinitionId, actionDefinitionId),
      expectedBenefit: clamp(pattern.evidenceScore * consistency, 0, 1),
      controllability: 0.9,
      effort: ACTION_EFFORT[actionDefinitionId] ?? 0.5,
      risk: 0.05,
      status: "generated",
      nonMedical: true,
    });

    if (pattern.stage === "established_personal_pattern") {
      tools.push({
        ...common,
        id: stableId("personal-tool", pattern.targetDefinitionId, actionDefinitionId),
        contextFilter: pattern.modifierDefinitionIds.length
          ? { modifierDefinitionIds: pattern.modifierDefinitionIds }
          : {},
        testCount: evidence.known,
        consistency,
        status: evidence.known >= 12 && consistency >= 0.7 ? "active" : "candidate",
      });
      continue;
    }

    const periodStart = shiftDate(now.slice(0, 10), 1);
    const periodEnd = shiftDate(periodStart, 6);
    experiments.push({
      id: stableId("experiment", pattern.targetDefinitionId, actionDefinitionId),
      userId: input.userId,
      version: 1,
      createdAt: now,
      updatedAt: now,
      origin: "local",
      hypothesis: {
        targetDefinitionId: pattern.targetDefinitionId,
        factorDefinitionIds: pattern.factorDefinitionIds,
        relatedPatternId: pattern.id,
      },
      intervention: {
        actionDefinitionId,
        mode: "repeat_if_natural_and_appropriate",
        nonMedical: true,
      },
      targetDefinitionId: pattern.targetDefinitionId,
      periodStart,
      periodEnd,
      baselineWindow: [shiftDate(periodStart, -7), shiftDate(periodStart, -1)],
      observationWindow: [periodStart, periodEnd],
      status: "proposed",
      evidence: pattern.evidence,
      algorithmVersion: PATTERN_ALGORITHM_VERSION,
    });
  }

  return {
    recommendations: deduplicate(recommendations, (item) => item.id),
    tools: deduplicate(tools, (item) => item.id),
    experiments: deduplicate(experiments, (item) => item.id),
  };
}

export function isSafeControllableAction(definitionId: string) {
  const definition = metricDefinition(definitionId);
  return Boolean(
    SAFE_CONTROLLABLE_ACTIONS.has(definitionId) &&
    definition &&
    (definition.kind === "activity" || definition.kind === "social_event"),
  );
}

function isComfortableDirection(pattern: PersonalPattern) {
  const targetPrefersLower =
    LOWER_IS_MORE_COMFORTABLE.has(pattern.targetDefinitionId) ||
    metricDefinition(pattern.targetDefinitionId)?.kind === "symptom";
  const targetMovesDown =
    pattern.direction === "up_down" || pattern.direction === "down_down";
  const targetMovesUp =
    pattern.direction === "up_up" || pattern.direction === "down_up";
  return targetPrefersLower ? targetMovesDown : targetMovesUp;
}

function evidenceCounts(pattern: PersonalPattern) {
  const support = pattern.evidence.filter((item) => item.relation === "supports").length;
  const contradicts = pattern.evidence.filter((item) => item.relation === "contradicts").length;
  return { support, contradicts, known: support + contradicts };
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function deduplicate<T>(items: T[], key: (item: T) => string) {
  return [...new Map(items.map((item) => [key(item), item])).values()];
}
