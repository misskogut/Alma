import { PATTERN_ALGORITHM_VERSION } from "../data-model/versions";
import { clamp, stableId } from "./math";
import type {
  PatternCandidate,
  ResearchHypothesis,
  ResearchQuestRecord,
  ResearchQuestStatus,
} from "./types";

const TRANSITIONS: Record<ResearchQuestStatus, ResearchQuestStatus[]> = {
  suggested: ["active", "completed"],
  active: ["paused", "sufficient_result", "completed"],
  paused: ["active", "completed", "background_monitoring"],
  sufficient_result: ["active", "completed", "background_monitoring"],
  completed: ["background_monitoring", "reactivated"],
  background_monitoring: ["reactivated", "completed"],
  reactivated: ["active", "paused", "sufficient_result", "completed"],
};

export function createResearchQuest(input: {
  title: string;
  targetDefinitionId: string;
  hypotheses: ResearchHypothesis[];
  createdAt?: string;
  status?: Extract<ResearchQuestStatus, "suggested" | "active">;
}): ResearchQuestRecord {
  const createdAt = input.createdAt ?? new Date().toISOString();
  return {
    id: stableId("research", input.targetDefinitionId, input.title, createdAt),
    version: 1,
    createdAt,
    updatedAt: createdAt,
    title: input.title,
    targetDefinitionId: input.targetDefinitionId,
    status: input.status ?? "suggested",
    hypotheses: input.hypotheses,
    requiredMetricIds: Array.from(
      new Set(input.hypotheses.flatMap((hypothesis) => hypothesis.requiredMetricIds)),
    ),
    optionalMetricIds: Array.from(
      new Set(input.hypotheses.flatMap((hypothesis) => hypothesis.optionalMetricIds)),
    ),
    progress: {
      knownOpportunities: 0,
      controlDays: 0,
      evidenceCoverage: 0,
      enoughData: false,
    },
    dossier: {
      supportedHypothesisIds: [],
      weakenedHypothesisIds: [],
      modifierDefinitionIds: [],
      personalToolIds: [],
      experimentIds: [],
    },
    algorithmVersion: PATTERN_ALGORITHM_VERSION,
  };
}

export function transitionResearchQuest(
  quest: ResearchQuestRecord,
  nextStatus: ResearchQuestStatus,
  updatedAt = new Date().toISOString(),
) {
  if (!TRANSITIONS[quest.status].includes(nextStatus)) {
    throw new Error(`Invalid research transition: ${quest.status} -> ${nextStatus}`);
  }
  return {
    ...quest,
    version: quest.version + 1,
    updatedAt,
    status: nextStatus,
  };
}

export function updateResearchProgress(
  quest: ResearchQuestRecord,
  patterns: PatternCandidate[],
  knownMetricIds: string[],
  updatedAt = new Date().toISOString(),
): ResearchQuestRecord {
  const relevant = patterns.filter(
    (pattern) => pattern.targetDefinitionId === quest.targetDefinitionId,
  );
  const knownOpportunities = relevant.reduce(
    (maximum, pattern) => Math.max(maximum, pattern.diagnostics.opportunities),
    0,
  );
  const controlDays = relevant.reduce(
    (maximum, pattern) =>
      Math.max(maximum, pattern.diagnostics.counterexamples),
    0,
  );
  const required = quest.requiredMetricIds.length;
  const evidenceCoverage =
    required === 0
      ? 1
      : quest.requiredMetricIds.filter((metric) => knownMetricIds.includes(metric)).length /
        required;
  const enoughData =
    evidenceCoverage >= 0.75 &&
    knownOpportunities >= 12 &&
    relevant.some(
      (pattern) =>
        pattern.stage === "repeating_pattern" ||
        pattern.stage === "established_personal_pattern",
    );
  const supportedHypothesisIds = quest.hypotheses
    .filter((hypothesis) => hypothesis.status === "supported")
    .map((hypothesis) => hypothesis.id);
  const weakenedHypothesisIds = quest.hypotheses
    .filter(
      (hypothesis) =>
        hypothesis.status === "weakened" || hypothesis.status === "rejected",
    )
    .map((hypothesis) => hypothesis.id);
  const modifierDefinitionIds = Array.from(
    new Set(relevant.flatMap((pattern) => pattern.modifierDefinitionIds)),
  );

  return {
    ...quest,
    version: quest.version + 1,
    updatedAt,
    status:
      enoughData && (quest.status === "active" || quest.status === "reactivated")
        ? "sufficient_result"
        : quest.status,
    progress: {
      knownOpportunities,
      controlDays,
      evidenceCoverage: clamp(evidenceCoverage, 0, 1),
      enoughData,
    },
    dossier: {
      ...quest.dossier,
      supportedHypothesisIds,
      weakenedHypothesisIds,
      modifierDefinitionIds,
    },
  };
}

export function sharedResearchMetrics(quests: ResearchQuestRecord[]) {
  const active = quests.filter((quest) =>
    ["active", "reactivated", "sufficient_result"].includes(quest.status),
  );
  const counts = new Map<string, number>();
  for (const quest of active) {
    for (const metric of new Set(quest.requiredMetricIds)) {
      counts.set(metric, (counts.get(metric) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([definitionId, questCount]) => ({ definitionId, questCount }));
}
