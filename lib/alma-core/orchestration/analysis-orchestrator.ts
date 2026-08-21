import type {
  BaselineRecord,
  CanonicalEntity,
  CanonicalEvent,
  ContextPeriod,
  DynamicFeature,
  ForecastRecord,
  JsonValue,
  Observation,
  PersonalExperimentRecord,
  PersonalPattern,
  PersonalToolRecord,
  RecommendationRecord,
  SymptomEpisode,
  VersionedRecord,
} from "../data-model/types";
import { PATTERN_ALGORITHM_VERSION } from "../data-model/versions";
import {
  createInputRequestRecords,
  expireStaleRequests,
  rankInputRequests,
  requestsFromQuests,
} from "../communication/input-request-engine";
import {
  createOutputFeedItem,
  isMaterialModelUpdate,
} from "../communication/output-feed-engine";
import type { OutputFeedRecord, StructuredInsight } from "../communication/types";
import {
  baselineChangedMaterially,
  chooseBaseline,
  computeComfortableBaseline,
  computeHabitualBaseline,
} from "../engines/baseline-engine";
import { deriveDynamicFeatures } from "../engines/feature-engine";
import {
  createCalibratableForecast,
  resolveForecast,
} from "../engines/forecast-engine";
import { updateHypothesesFromPatterns } from "../engines/hypothesis-engine";
import { stableId } from "../engines/math";
import {
  analyzeCumulativePattern,
  analyzeInteractionPattern,
  analyzeLaggedPattern,
  materializePattern,
} from "../engines/pattern-engine";
import { derivePersonalActions } from "../engines/recommendation-engine";
import { updateResearchProgress } from "../engines/research-engine";
import type {
  BaselineEstimate,
  InputRequestRecord,
  NumericEvidencePoint,
  PatternCandidate,
  ResearchQuestRecord,
} from "../engines/types";
import { numericPointValue } from "../engines/types";
import {
  listMetricDefinitions,
  metricDefinition,
} from "../registry/metric-registry";
import type { EntityKind } from "../data-model/types";
import { LocalDatabase, type DirtyDateRange } from "../sync/local-database";

export interface AnalysisRunResult {
  skipped: boolean;
  changed: boolean;
  dirtyRanges: DirtyDateRange[];
  baselines: number;
  dynamicFeatures: number;
  patterns: number;
  researchQuests: number;
  forecasts: number;
  recommendations: number;
  personalTools: number;
  experiments: number;
  feedItems: number;
}

export interface AnalysisRunOptions {
  force?: boolean;
  now?: string;
  userId?: string;
  maximumCandidatePairs?: number;
}

type PairPlan = {
  targetDefinitionId: string;
  factorDefinitionId: string;
  modifierDefinitionIds: string[];
  cumulative: boolean;
  priority: number;
};

/**
 * Deterministic local-first orchestration for the current personal model.
 * It never treats inferred/predicted/planned/synthetic records as historical
 * evidence and only clears dirty ranges after a successful recomputation.
 */
export async function recalculatePersonalModel(
  database: LocalDatabase,
  options: AnalysisRunOptions = {},
): Promise<AnalysisRunResult> {
  const dirtyRanges = await database.consumeDirtyRanges();
  if (!options.force && dirtyRanges.length === 0) return emptyResult(true, dirtyRanges);

  const now = options.now ?? new Date().toISOString();
  try {
    const [
      observations,
      events,
      symptoms,
      contexts,
      entities,
      existingBaselines,
      existingFeatures,
      existingPatterns,
      quests,
      existingForecasts,
      existingRecommendations,
      existingTools,
      existingExperiments,
      existingFeed,
      existingRequests,
    ] = await Promise.all([
      database.list<Observation>("observations"),
      database.list<CanonicalEvent>("events"),
      database.list<SymptomEpisode>("symptoms"),
      database.list<ContextPeriod>("contexts"),
      database.list<CanonicalEntity>("entities"),
      database.list<BaselineRecord>("baselines"),
      database.list<DynamicFeature>("dynamic_features"),
      database.list<PersonalPattern>("patterns"),
      database.list<ResearchQuestRecord>("research_quests"),
      database.list<ForecastRecord>("forecasts"),
      database.list<RecommendationRecord>("recommendations"),
      database.list<PersonalToolRecord>("personal_tools"),
      database.list<PersonalExperimentRecord>("experiments"),
      database.list<OutputFeedRecord>("output_feed"),
      database.list<InputRequestRecord>("input_requests"),
    ]);
    const userId = options.userId ?? firstUserId([
      ...observations,
      ...events,
      ...symptoms,
      ...contexts,
      ...quests,
    ]);
    const entityKinds = new Map<string, EntityKind>(
      entities.map((entity) => [entity.canonicalKey, entity.kind]),
    );
    const points = [
      ...observations.filter((record) => record.isCanonical).map(observationPoint),
      ...events.map(eventPoint),
      ...symptoms.map(symptomPoint),
      ...contexts.map(contextPoint),
    ];
    const eligiblePoints = points.filter((point) =>
      !point.synthetic &&
      (point.epistemicStatus === "measured" || point.epistemicStatus === "user_confirmed"),
    );
    const pointsByDefinition = groupPoints(eligiblePoints);
    const knownDefinitionIds = new Set(pointsByDefinition.keys());
    const wellbeingPoints = pointsByDefinition.get("overall_wellbeing") ?? [];
    let changed = false;

    const baselineEstimates = new Map<string, BaselineEstimate>();
    const computedBaselineEstimates: Array<{
      estimate: BaselineEstimate;
      unit?: string;
    }> = [];
    for (const definition of listMetricDefinitions()) {
      if (definition.baselineStrategy === "none") continue;
      const definitionPoints = pointsByDefinition.get(definition.id) ?? [];
      if (!definitionPoints.length) continue;
      const declared = existingBaselines
        .filter((item) => item.definitionId === definition.id && item.kind === "user_declared")
        .sort((left, right) => right.validFrom.localeCompare(left.validFrom))[0];
      const declaredEstimate = declared
        ? baselineEstimateFromRecord(declared)
        : null;
      const habitual = computeHabitualBaseline(definition.id, definitionPoints);
      const comfortable = computeComfortableBaseline(
        definition.id,
        definitionPoints,
        wellbeingPoints,
      );
      const selected = chooseBaseline([declaredEstimate, comfortable, habitual]);
      if (selected) baselineEstimates.set(definition.id, selected);
      for (const estimate of [habitual, comfortable]) {
        if (estimate) computedBaselineEstimates.push({ estimate, unit: definition.unit });
      }
    }
    const persistedBaselines = await persistComputedBaselines({
      database,
      estimates: computedBaselineEstimates,
      existing: existingBaselines,
      now,
      userId,
    });
    const computedBaselines = persistedBaselines.records;
    changed = persistedBaselines.changed || changed;

    const computedFeatures: DynamicFeature[] = [];
    for (const [definitionId, definitionPoints] of pointsByDefinition) {
      const definition = metricDefinition(definitionId);
      if (!definition || definition.normalizationStrategy === "none") continue;
      const features = deriveDynamicFeatures(definitionPoints, {
        normalizationStrategy: definition.normalizationStrategy,
        baseline: baselineEstimates.get(definitionId),
      });
      computedFeatures.push(...features.map((feature) => ({
        ...feature,
        userId,
        origin: "local" as const,
      })));
    }
    changed = (await persistCollection(database, "dynamic_features", computedFeatures, existingFeatures, now)) || changed;
    changed = (await retireMissing(
      database,
      "dynamic_features",
      existingFeatures,
      new Set(computedFeatures.map((item) => item.id)),
      now,
    )) || changed;

    const pairPlans = buildPairPlans({
      pointsByDefinition,
      quests,
      entityKinds,
      maximumCandidatePairs: options.maximumCandidatePairs ?? 160,
    });
    const candidates = analyzePlans(pairPlans, pointsByDefinition);
    const candidateById = new Map<string, PatternCandidate>();
    for (const candidate of candidates) {
      const id = patternIdentity(candidate);
      const previous = candidateById.get(id);
      if (!previous || candidate.evidenceScore > previous.evidenceScore) {
        candidateById.set(id, candidate);
      }
    }
    const activeCandidates = [...candidateById.values()];
    const previousPatternById = new Map(existingPatterns.map((pattern) => [pattern.id, pattern]));
    const nextPatterns: PersonalPattern[] = [];
    for (const candidate of activeCandidates) {
      const id = patternIdentity(candidate);
      const previous = previousPatternById.get(id) ?? null;
      const earliest = candidate.diagnostics.evidence
        .map((item) => item.opportunityAt.slice(0, 10))
        .sort()[0] ?? now.slice(0, 10);
      const pattern = materializePattern(candidate, earliest, previous);
      nextPatterns.push({
        ...pattern,
        id,
        userId,
        origin: "local",
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
        validTo: undefined,
      });
    }
    const persistedPatterns = await persistCollectionWithRecords(
      database,
      "patterns",
      nextPatterns,
      existingPatterns,
      now,
    );
    changed = persistedPatterns.changed || changed;
    const producedPatternIds = new Set(nextPatterns.map((item) => item.id));
    const retiredPatterns: PersonalPattern[] = [];
    for (const previous of existingPatterns) {
      if (previous.validTo || previous.lifecycle === "no_longer_observed" || producedPatternIds.has(previous.id)) continue;
      const retired: PersonalPattern = {
        ...previous,
        version: previous.version + 1,
        updatedAt: now,
        validTo: now.slice(0, 10),
        lifecycle: "no_longer_observed",
      };
      if (await persistIfChanged(database, "patterns", retired, previous, now)) {
        changed = true;
        retiredPatterns.push(retired);
      }
    }
    const currentPatterns = persistedPatterns.records.filter((item) => !item.validTo && item.lifecycle !== "no_longer_observed");

    const actionModel = derivePersonalActions({ patterns: currentPatterns, now, userId });
    const recommendations = mergeRecommendationState(actionModel.recommendations, existingRecommendations);
    const tools = mergeToolState(actionModel.tools, existingTools);
    const experiments = mergeExperimentState(actionModel.experiments, existingExperiments);
    changed = (await persistCollection(database, "recommendations", recommendations, existingRecommendations, now)) || changed;
    changed = (await persistCollection(database, "personal_tools", tools, existingTools, now)) || changed;
    changed = (await persistCollection(database, "experiments", experiments, existingExperiments, now)) || changed;
    changed = (await retireGeneratedRecommendations(database, existingRecommendations, new Set(recommendations.map((item) => item.id)), now)) || changed;
    changed = (await retireGeneratedTools(database, existingTools, new Set(tools.map((item) => item.id)), now)) || changed;
    changed = (await cancelGeneratedExperiments(database, existingExperiments, new Set(experiments.map((item) => item.id)), now)) || changed;

    const updatedQuests: ResearchQuestRecord[] = [];
    for (const quest of quests) {
      const withHypotheses = {
        ...quest,
        hypotheses: updateHypothesesFromPatterns(quest.hypotheses, activeCandidates),
      };
      const progressed = updateResearchProgress(
        withHypotheses,
        activeCandidates,
        [...knownDefinitionIds],
        now,
      );
      const updated: ResearchQuestRecord = {
        ...progressed,
        dossier: {
          ...progressed.dossier,
          personalToolIds: tools
            .filter((item) => item.targetDefinitionId === quest.targetDefinitionId)
            .map((item) => item.id),
          experimentIds: experiments
            .filter((item) => item.targetDefinitionId === quest.targetDefinitionId)
            .map((item) => item.id),
        },
      };
      updatedQuests.push(updated);
      changed = (await persistIfChanged(database, "research_quests", updated, quest, now)) || changed;
    }
    const refreshedRequests = expireStaleRequests(existingRequests, new Date(now));
    for (const request of refreshedRequests) {
      const previous = existingRequests.find((item) => item.id === request.id);
      changed = (await persistIfChanged(database, "input_requests", request, previous, now)) || changed;
    }
    const openRequestKeys = new Set(
      refreshedRequests
        .filter((request) => request.status === "open")
        .map((request) => `${request.relatedQuestId ?? ""}:${request.targetDefinitionId}`),
    );
    const requestCandidates = rankInputRequests(
      requestsFromQuests(updatedQuests, knownDefinitionIds, new Date(now)),
      new Date(now),
    ).filter((candidate) =>
      !candidate.sharedWithQuestIds.some((questId) =>
        openRequestKeys.has(`${questId}:${candidate.targetDefinitionId}`),
      ),
    );
    for (const request of createInputRequestRecords(requestCandidates, now)) {
      await database.put("input_requests", { ...request, userId, origin: "local" });
      changed = true;
    }

    const resolvedForecasts = await resolvePendingForecasts({
      database,
      forecasts: existingForecasts,
      pointsByDefinition,
      now,
    });
    changed = resolvedForecasts.changed || changed;
    const currentForecasts = [...existingForecasts.filter((item) => !resolvedForecasts.replacedIds.has(item.id)), ...resolvedForecasts.records];
    const generatedForecasts = await generateForecasts({
      database,
      patterns: currentPatterns,
      existing: currentForecasts,
      pointsByDefinition,
      symptomDefinitionIds: new Set([
        ...symptoms.map((item) => item.entityDefinitionId),
        ...[...entityKinds.entries()].filter(([, kind]) => kind === "symptom").map(([id]) => id),
      ]),
      now,
      userId,
    });
    changed = generatedForecasts.changed || changed;

    const feedItems = await publishModelUpdates({
      database,
      previousPatterns: existingPatterns,
      currentPatterns,
      retiredPatterns,
      forecasts: generatedForecasts.records,
      recommendations,
      experiments,
      existingFeed,
      now,
      userId,
    });
    changed = feedItems.changed || changed;

    return {
      skipped: false,
      changed,
      dirtyRanges,
      baselines: computedBaselines.length,
      dynamicFeatures: computedFeatures.length,
      patterns: currentPatterns.length,
      researchQuests: updatedQuests.length,
      forecasts: currentForecasts.length + generatedForecasts.records.length,
      recommendations: recommendations.length,
      personalTools: tools.length,
      experiments: experiments.length,
      feedItems: feedItems.count,
    };
  } catch (error) {
    await database.restoreDirtyRanges(dirtyRanges);
    throw error;
  }
}

function buildPairPlans(input: {
  pointsByDefinition: Map<string, NumericEvidencePoint[]>;
  quests: ResearchQuestRecord[];
  entityKinds: Map<string, EntityKind>;
  maximumCandidatePairs: number;
}) {
  const planByKey = new Map<string, PairPlan>();
  const add = (plan: PairPlan) => {
    const key = `${plan.targetDefinitionId}|${plan.factorDefinitionId}|${[...plan.modifierDefinitionIds].sort().join(",")}`;
    const previous = planByKey.get(key);
    if (!previous || plan.priority > previous.priority) planByKey.set(key, plan);
  };
  for (const quest of input.quests.filter((item) => ["active", "reactivated", "sufficient_result"].includes(item.status))) {
    for (const hypothesis of quest.hypotheses) {
      for (const factorDefinitionId of hypothesis.factorDefinitionIds) {
        add({
          targetDefinitionId: quest.targetDefinitionId,
          factorDefinitionId,
          modifierDefinitionIds: hypothesis.modifierDefinitionIds,
          cumulative: hypothesis.relationshipType === "cumulative",
          priority: 10_000,
        });
      }
    }
  }
  const targetIds = [...input.pointsByDefinition.keys()].filter((definitionId) => {
    const kind = metricDefinition(definitionId)?.kind ?? input.entityKinds.get(definitionId);
    return kind === "state" || kind === "symptom" || definitionId.endsWith("_load_response");
  });
  const factorIds = [...input.pointsByDefinition.keys()].filter((definitionId) => {
    const definition = metricDefinition(definitionId);
    return definition ? definition.patternEligible : Boolean(input.entityKinds.get(definitionId));
  });
  for (const targetDefinitionId of targetIds) {
    for (const factorDefinitionId of factorIds) {
      if (targetDefinitionId === factorDefinitionId) continue;
      const targetCount = knownPointCount(input.pointsByDefinition.get(targetDefinitionId) ?? []);
      const factorCount = knownPointCount(input.pointsByDefinition.get(factorDefinitionId) ?? []);
      if (targetCount < 3 || factorCount < 3) continue;
      const factorKind = metricDefinition(factorDefinitionId)?.kind ?? input.entityKinds.get(factorDefinitionId);
      add({
        targetDefinitionId,
        factorDefinitionId,
        modifierDefinitionIds: [],
        cumulative: factorKind === "activity" || factorKind === "social_event" || factorKind === "intake",
        priority: Math.min(targetCount, factorCount),
      });
    }
  }
  return [...planByKey.values()]
    .sort((left, right) => right.priority - left.priority || planKey(left).localeCompare(planKey(right)))
    .slice(0, input.maximumCandidatePairs);
}

function analyzePlans(
  plans: PairPlan[],
  pointsByDefinition: Map<string, NumericEvidencePoint[]>,
) {
  const candidates: PatternCandidate[] = [];
  for (const plan of plans) {
    const targetPoints = pointsByDefinition.get(plan.targetDefinitionId) ?? [];
    const factorPoints = pointsByDefinition.get(plan.factorDefinitionId) ?? [];
    const lagged = analyzeLaggedPattern({ factorPoints, targetPoints });
    if (lagged) candidates.push(lagged);
    if (plan.cumulative) {
      const cumulative = analyzeCumulativePattern({ factorPoints, targetPoints });
      if (cumulative) candidates.push(cumulative);
    }
    for (const modifierDefinitionId of plan.modifierDefinitionIds) {
      const modifierPoints = pointsByDefinition.get(modifierDefinitionId) ?? [];
      const interaction = analyzeInteractionPattern({ factorPoints, modifierPoints, targetPoints });
      if (interaction) candidates.push(interaction);
    }
  }
  return candidates;
}

async function publishModelUpdates(input: {
  database: LocalDatabase;
  previousPatterns: PersonalPattern[];
  currentPatterns: PersonalPattern[];
  retiredPatterns: PersonalPattern[];
  forecasts: ForecastRecord[];
  recommendations: RecommendationRecord[];
  experiments: PersonalExperimentRecord[];
  existingFeed: OutputFeedRecord[];
  now: string;
  userId?: string;
}) {
  const previousById = new Map(input.previousPatterns.map((item) => [item.id, item]));
  const existingInsightIds = new Set(input.existingFeed.map((item) => item.structuredPayload.id));
  let count = 0;
  let changed = false;
  const publish = async (insight: StructuredInsight) => {
    if (existingInsightIds.has(insight.id)) return;
    const item = { ...createOutputFeedItem(insight, { now: input.now }), userId: input.userId, origin: "local" as const };
    await input.database.put("output_feed", item);
    existingInsightIds.add(insight.id);
    count += 1;
    changed = true;
  };
  for (const pattern of input.currentPatterns) {
    if (pattern.stage === "observation") continue;
    const previous = previousById.get(pattern.id);
    if (previous && !isMaterialModelUpdate({
      previousStage: previous.stage,
      nextStage: pattern.stage,
      previousEvidenceScore: previous.evidenceScore,
      nextEvidenceScore: pattern.evidenceScore,
      lifecycleChanged: previous.lifecycle !== pattern.lifecycle,
    })) continue;
    await publish(patternInsight(pattern, input.now, previous));
  }
  for (const pattern of input.retiredPatterns) {
    await publish(patternInsight(pattern, input.now, previousById.get(pattern.id)));
  }
  for (const forecast of input.forecasts) {
    if (forecast.probability < 0.65 || (forecast.uncertainty ?? 1) > 0.5) continue;
    await publish({
      id: stableId("insight", "forecast", forecast.id),
      type: "forecast",
      createdAt: input.now,
      targetDefinitionId: forecast.targetDefinitionId,
      probability: forecast.probability,
      uncertainty: forecast.uncertainty,
      factorDefinitionIds: [...forecast.positiveContributorIds, ...forecast.negativeContributorIds],
      relatedPatternId: forecast.relatedPatternIds[0],
      relevantPeriod: { start: forecast.windowStart, end: forecast.windowEnd },
    });
  }
  for (const recommendation of input.recommendations) {
    await publish({
      id: stableId("insight", "recommendation", recommendation.id),
      type: "recommendation",
      createdAt: input.now,
      targetDefinitionId: recommendation.targetDefinitionId,
      actionDefinitionId: recommendation.actionDefinitionId,
      relatedPatternId: recommendation.relatedPatternIds[0],
      evidenceScore: recommendation.expectedBenefit,
    });
  }
  for (const experiment of input.experiments) {
    await publish({
      id: stableId("insight", "experiment", experiment.id),
      type: "experiment_proposal",
      createdAt: input.now,
      targetDefinitionId: experiment.targetDefinitionId,
      factorDefinitionIds: stringArray(experiment.hypothesis.factorDefinitionIds),
      relatedPatternId: optionalString(experiment.hypothesis.relatedPatternId),
      relevantPeriod: { start: experiment.periodStart, end: experiment.periodEnd },
    });
  }
  return { count, changed };
}

function patternInsight(
  pattern: PersonalPattern,
  now: string,
  previous?: PersonalPattern,
): StructuredInsight {
  const support = pattern.evidence.filter((item) => item.relation === "supports").length;
  const counterexamples = pattern.evidence.filter((item) => item.relation === "contradicts").length;
  const type: StructuredInsight["type"] = pattern.lifecycle === "no_longer_observed"
    ? "disappeared_pattern"
    : pattern.lifecycle === "weakening"
      ? "weakening_pattern"
      : pattern.relationshipType === "lagged"
        ? "lagged_relationship"
        : pattern.relationshipType === "cumulative"
          ? "cumulative_relationship"
          : pattern.relationshipType === "inverse"
            ? "inverse_relationship"
            : pattern.relationshipType === "interaction"
              ? "interaction"
              : pattern.relationshipType === "compensation"
                ? "compensation"
                : pattern.stage === "established_personal_pattern"
                  ? "established_personal_pattern"
                  : pattern.stage === "repeating_pattern"
                    ? "repeated_pattern"
                    : "possible_relationship";
  return {
    id: stableId(
      "insight",
      pattern.id,
      type,
      pattern.stage,
      Math.round(pattern.evidenceScore * 10),
    ),
    type,
    createdAt: now,
    targetDefinitionId: pattern.targetDefinitionId,
    factorDefinitionIds: pattern.factorDefinitionIds,
    modifierDefinitionIds: pattern.modifierDefinitionIds,
    direction: pattern.direction,
    lagMinutes: pattern.typicalLagMinutes,
    lagRangeMinutes: pattern.lagRangeMinutes,
    cumulativeWindowDays: pattern.cumulativeWindowDays,
    support,
    opportunities: support + counterexamples,
    counterexamples,
    evidenceScore: pattern.evidenceScore,
    stage: pattern.stage,
    lifecycle: pattern.lifecycle,
    relatedPatternId: pattern.id,
    relevantPeriod: { start: pattern.validFrom, end: pattern.validTo },
  };
}

async function generateForecasts(input: {
  database: LocalDatabase;
  patterns: PersonalPattern[];
  existing: ForecastRecord[];
  pointsByDefinition: Map<string, NumericEvidencePoint[]>;
  symptomDefinitionIds: Set<string>;
  now: string;
  userId?: string;
}) {
  const today = input.now.slice(0, 10);
  const generatedAt = `${today}T00:00:00.000Z`;
  const windowDate = shiftDate(today, 1);
  const windowStart = `${windowDate}T00:00:00.000Z`;
  const windowEnd = `${windowDate}T23:59:59.999Z`;
  const existingIds = new Set(input.existing.map((item) => item.id));
  const records: ForecastRecord[] = [];
  let changed = false;
  for (const targetDefinitionId of input.symptomDefinitionIds) {
    const targetPoints = input.pointsByDefinition.get(targetDefinitionId) ?? [];
    const outcomes = targetPoints
      .map((point) => point.presence === "present" ? 1 : point.presence === "confirmed_absent" ? 0 : null)
      .filter((value): value is 0 | 1 => value !== null);
    if (outcomes.length < 6 || !outcomes.includes(0) || !outcomes.includes(1)) continue;
    const patterns = input.patterns.filter((pattern) => pattern.targetDefinitionId === targetDefinitionId);
    if (!patterns.some((pattern) => pattern.stage === "repeating_pattern" || pattern.stage === "established_personal_pattern")) continue;
    const activeFactorValues: Record<string, number | undefined> = {};
    for (const factorId of new Set(patterns.flatMap((pattern) => pattern.factorDefinitionIds))) {
      const latest = (input.pointsByDefinition.get(factorId) ?? [])
        .filter((point) => point.localDate === today)
        .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))[0];
      if (latest) activeFactorValues[factorId] = numericPointValue(latest) ?? undefined;
    }
    if (!Object.values(activeFactorValues).some((value) => typeof value === "number" && value !== 0)) continue;
    const forecast = {
      ...createCalibratableForecast({
        targetDefinitionId,
        generatedAt,
        windowStart,
        windowEnd,
        baseRate: outcomes.reduce<number>((sum, value) => sum + value, 0) / outcomes.length,
        patterns,
        activeFactorValues,
      }),
      userId: input.userId,
      origin: "local" as const,
    };
    if (existingIds.has(forecast.id) || forecast.relatedPatternIds.length === 0) continue;
    await input.database.put("forecasts", forecast);
    records.push(forecast);
    changed = true;
  }
  return { records, changed };
}

async function resolvePendingForecasts(input: {
  database: LocalDatabase;
  forecasts: ForecastRecord[];
  pointsByDefinition: Map<string, NumericEvidencePoint[]>;
  now: string;
}) {
  const records: ForecastRecord[] = [];
  const replacedIds = new Set<string>();
  let changed = false;
  for (const forecast of input.forecasts) {
    if (forecast.outcome !== "pending" || forecast.windowEnd >= input.now) continue;
    const points = (input.pointsByDefinition.get(forecast.targetDefinitionId) ?? [])
      .filter((point) => point.occurredAt >= forecast.windowStart && point.occurredAt <= forecast.windowEnd);
    const outcome = points.some((point) => point.presence === "present")
      ? "confirmed_occurred" as const
      : points.some((point) => point.presence === "confirmed_absent")
        ? "confirmed_absent" as const
        : "unknown" as const;
    const resolved = resolveForecast(forecast, outcome, input.now);
    if (await persistIfChanged(input.database, "forecasts", resolved, forecast, input.now)) changed = true;
    records.push(resolved);
    replacedIds.add(forecast.id);
  }
  return { records, replacedIds, changed };
}

function observationPoint(record: Observation): NumericEvidencePoint {
  return {
    id: record.id,
    definitionId: record.definitionId,
    occurredAt: canonicalOccurredAt(record.localDate, record.timePrecision, record.occurredAt, record.recordedAt),
    localDate: record.localDate,
    value: typeof record.value === "number" ? record.value : undefined,
    presence: record.presence,
    epistemicStatus: record.epistemicStatus,
    confidence: record.confidence,
    sourceId: record.source.sourceId,
    synthetic: isSynthetic(record.source.sourceId, record.metadata),
    metadata: record.metadata,
  };
}

function eventPoint(record: CanonicalEvent): NumericEvidencePoint {
  return {
    id: record.id,
    definitionId: record.entityDefinitionId,
    occurredAt: canonicalOccurredAt(record.localDate, record.timePrecision, record.occurredAt, record.createdAt),
    localDate: record.localDate,
    value: record.quantity,
    presence: record.presence,
    epistemicStatus: record.epistemicStatus,
    confidence: record.confidence,
    sourceId: record.source.sourceId,
    synthetic: isSynthetic(record.source.sourceId, record.attributes),
    metadata: record.attributes,
  };
}

function symptomPoint(record: SymptomEpisode): NumericEvidencePoint {
  return {
    id: record.id,
    definitionId: record.entityDefinitionId,
    occurredAt: canonicalOccurredAt(record.localDate, record.timePrecision, record.occurredAt, record.createdAt),
    localDate: record.localDate,
    value: record.intensity,
    presence: record.presence,
    epistemicStatus: record.epistemicStatus,
    confidence: record.confidence,
    sourceId: record.source.sourceId,
    synthetic: isSynthetic(record.source.sourceId, record.attributes),
    metadata: record.attributes,
  };
}

function contextPoint(record: ContextPeriod): NumericEvidencePoint {
  const localDate = record.startedAt.slice(0, 10);
  return {
    id: record.id,
    definitionId: record.entityDefinitionId,
    occurredAt: record.startedAt,
    localDate,
    value: typeof record.value === "number" ? record.value : 1,
    presence: "present",
    epistemicStatus: record.epistemicStatus,
    confidence: record.confidence,
    sourceId: record.source.sourceId,
    synthetic: isSynthetic(record.source.sourceId),
  };
}

function canonicalOccurredAt(
  localDate: string,
  precision: string,
  occurredAt?: string,
  fallback?: string,
) {
  if (precision === "date_only") return `${localDate}T12:00:00.000Z`;
  return occurredAt ?? fallback ?? `${localDate}T12:00:00.000Z`;
}

function isSynthetic(sourceId: string, metadata?: Record<string, JsonValue>) {
  return sourceId === "seed" || metadata?.synthetic === true || metadata?.demo === true;
}

function groupPoints(points: NumericEvidencePoint[]) {
  const groups = new Map<string, NumericEvidencePoint[]>();
  for (const point of points) {
    const group = groups.get(point.definitionId) ?? [];
    group.push(point);
    groups.set(point.definitionId, group);
  }
  for (const group of groups.values()) group.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  return groups;
}

function baselineRecord(
  estimate: BaselineEstimate,
  unit: string | undefined,
  now: string,
  userId?: string,
): BaselineRecord {
  return {
    id: stableId("baseline", estimate.definitionId, estimate.kind, estimate.validFrom, estimate.algorithmVersion),
    userId,
    version: 1,
    createdAt: now,
    updatedAt: now,
    origin: "local",
    definitionId: estimate.definitionId,
    kind: estimate.kind,
    value: estimate.center,
    unit,
    validFrom: estimate.validFrom,
    validTo: estimate.validTo,
    evidenceCount: estimate.evidenceCount,
    confidence: estimate.confidence,
    algorithmVersion: estimate.algorithmVersion,
    userConfirmed: estimate.userConfirmed,
  };
}

async function persistComputedBaselines(input: {
  database: LocalDatabase;
  estimates: Array<{ estimate: BaselineEstimate; unit?: string }>;
  existing: BaselineRecord[];
  now: string;
  userId?: string;
}) {
  const nowDate = input.now.slice(0, 10);
  const activeByKey = new Map(
    input.existing
      .filter((record) =>
        !record.validTo &&
        !record.deletedAt &&
        (record.kind === "habitual" || record.kind === "comfortable")
      )
      .map((record) => [`${record.definitionId}:${record.kind}`, record]),
  );
  const producedKeys = new Set<string>();
  const records: BaselineRecord[] = [];
  let changed = false;

  for (const { estimate, unit } of input.estimates) {
    const key = `${estimate.definitionId}:${estimate.kind}`;
    producedKeys.add(key);
    const active = activeByKey.get(key);
    if (!active) {
      const created = baselineRecord(estimate, unit, input.now, input.userId);
      changed = (await persistIfChanged(input.database, "baselines", created, undefined, input.now)) || changed;
      records.push(created);
      continue;
    }

    if (
      active.validFrom !== nowDate &&
      baselineChangedMaterially(baselineEstimateFromRecord(active), estimate)
    ) {
      const closed: BaselineRecord = {
        ...active,
        validTo: laterDate(active.validFrom, shiftDate(nowDate, -1)),
      };
      changed = (await persistIfChanged(input.database, "baselines", closed, active, input.now)) || changed;
      const replacementEstimate: BaselineEstimate = {
        ...estimate,
        validFrom: nowDate,
        validTo: undefined,
      };
      const replacement = baselineRecord(
        replacementEstimate,
        unit,
        input.now,
        input.userId ?? active.userId,
      );
      changed = (await persistIfChanged(input.database, "baselines", replacement, undefined, input.now)) || changed;
      records.push(replacement);
      continue;
    }

    const updated: BaselineRecord = {
      ...baselineRecord(
        { ...estimate, validFrom: active.validFrom, validTo: undefined },
        unit,
        input.now,
        input.userId ?? active.userId,
      ),
      id: active.id,
      version: active.version,
      createdAt: active.createdAt,
    };
    changed = (await persistIfChanged(input.database, "baselines", updated, active, input.now)) || changed;
    records.push(updated);
  }

  for (const active of activeByKey.values()) {
    const key = `${active.definitionId}:${active.kind}`;
    if (producedKeys.has(key)) continue;
    const closed: BaselineRecord = {
      ...active,
      validTo: laterDate(active.validFrom, nowDate),
    };
    changed = (await persistIfChanged(input.database, "baselines", closed, active, input.now)) || changed;
  }

  return { changed, records };
}

function baselineEstimateFromRecord(record: BaselineRecord): BaselineEstimate {
  return {
    definitionId: record.definitionId,
    kind: record.kind,
    center: record.value,
    scale: Math.max(Math.abs(record.value) * 0.1, 0.01),
    evidenceCount: record.evidenceCount,
    confidence: record.confidence,
    validFrom: record.validFrom,
    validTo: record.validTo,
    userConfirmed: record.userConfirmed,
    algorithmVersion: record.algorithmVersion,
  };
}

function patternIdentity(candidate: PatternCandidate) {
  return stableId(
    candidate.targetDefinitionId,
    ...candidate.factorDefinitionIds,
    ...candidate.modifierDefinitionIds,
    candidate.relationshipType,
  );
}

async function persistCollection<TRecord extends VersionedRecord>(
  database: LocalDatabase,
  recordType: string,
  next: TRecord[],
  previous: TRecord[],
  now: string,
) {
  return (await persistCollectionWithRecords(database, recordType, next, previous, now)).changed;
}

async function persistCollectionWithRecords<TRecord extends VersionedRecord>(
  database: LocalDatabase,
  recordType: string,
  next: TRecord[],
  previous: TRecord[],
  now: string,
) {
  const previousById = new Map(previous.map((record) => [record.id, record]));
  const records: TRecord[] = [];
  let changed = false;
  for (const record of next) {
    const existing = previousById.get(record.id);
    if (await persistIfChanged(database, recordType, record, existing, now)) changed = true;
    records.push(existing && semanticRecordEqual(existing, record) ? existing : record);
  }
  return { changed, records };
}

async function persistIfChanged<TRecord extends VersionedRecord>(
  database: LocalDatabase,
  recordType: string,
  next: TRecord,
  previous: TRecord | undefined,
  now: string,
) {
  if (previous && semanticRecordEqual(previous, next)) return false;
  const record: TRecord = {
    ...next,
    version: previous?.version ?? next.version,
    createdAt: previous?.createdAt ?? next.createdAt ?? now,
    updatedAt: now,
    userId: next.userId ?? previous?.userId,
  };
  const sync = await database.syncMetadata(recordType, record.id);
  await database.put(recordType, record, { baseServerVersion: sync?.serverVersion });
  return true;
}

async function retireMissing<TRecord extends VersionedRecord>(
  database: LocalDatabase,
  recordType: string,
  previous: TRecord[],
  nextIds: Set<string>,
  now: string,
) {
  let changed = false;
  for (const record of previous) {
    if (nextIds.has(record.id)) continue;
    await database.softDelete(recordType, record.id, now);
    changed = true;
  }
  return changed;
}

async function retireGeneratedRecommendations(
  database: LocalDatabase,
  previous: RecommendationRecord[],
  nextIds: Set<string>,
  now: string,
) {
  let changed = false;
  for (const record of previous) {
    if (nextIds.has(record.id) || !["generated", "shown", "opened"].includes(record.status)) continue;
    await database.softDelete("recommendations", record.id, now);
    changed = true;
  }
  return changed;
}

async function retireGeneratedTools(
  database: LocalDatabase,
  previous: PersonalToolRecord[],
  nextIds: Set<string>,
  now: string,
) {
  let changed = false;
  for (const record of previous) {
    if (nextIds.has(record.id) || record.status === "retired") continue;
    const retired: PersonalToolRecord = { ...record, status: "retired" };
    changed = (await persistIfChanged(database, "personal_tools", retired, record, now)) || changed;
  }
  return changed;
}

async function cancelGeneratedExperiments(
  database: LocalDatabase,
  previous: PersonalExperimentRecord[],
  nextIds: Set<string>,
  now: string,
) {
  let changed = false;
  for (const record of previous) {
    if (
      nextIds.has(record.id) ||
      record.status === "completed" ||
      record.status === "cancelled"
    ) continue;
    const cancelled: PersonalExperimentRecord = { ...record, status: "cancelled" };
    changed = (await persistIfChanged(database, "experiments", cancelled, record, now)) || changed;
  }
  return changed;
}

function mergeRecommendationState(next: RecommendationRecord[], previous: RecommendationRecord[]) {
  const byId = new Map(previous.map((item) => [item.id, item]));
  return next.map((item) => {
    const existing = byId.get(item.id);
    return existing ? {
      ...item,
      status: existing.status,
      shownAt: existing.shownAt,
      performedEventId: existing.performedEventId,
    } : item;
  });
}

function mergeToolState(next: PersonalToolRecord[], previous: PersonalToolRecord[]) {
  const byId = new Map(previous.map((item) => [item.id, item]));
  return next.map((item) => {
    const existing = byId.get(item.id);
    return existing?.status === "retired" ? { ...item, status: existing.status } : item;
  });
}

function mergeExperimentState(next: PersonalExperimentRecord[], previous: PersonalExperimentRecord[]) {
  const byId = new Map(previous.map((item) => [item.id, item]));
  return next.map((item) => {
    const existing = byId.get(item.id);
    return existing ? {
      ...item,
      periodStart: existing.periodStart,
      periodEnd: existing.periodEnd,
      baselineWindow: existing.baselineWindow,
      observationWindow: existing.observationWindow,
      status: existing.status,
      result: existing.result,
      evidence: existing.evidence.length ? existing.evidence : item.evidence,
    } : item;
  });
}

function semanticRecordEqual(left: VersionedRecord, right: VersionedRecord) {
  return JSON.stringify(semanticRecord(left)) === JSON.stringify(semanticRecord(right));
}

function semanticRecord(record: VersionedRecord) {
  const { version: _version, createdAt: _createdAt, updatedAt: _updatedAt, origin: _origin, ...semantic } = record;
  return semantic;
}

function knownPointCount(points: NumericEvidencePoint[]) {
  return points.filter((point) => numericPointValue(point) !== null).length;
}

function planKey(plan: PairPlan) {
  return `${plan.targetDefinitionId}|${plan.factorDefinitionId}|${plan.modifierDefinitionIds.join(",")}`;
}

function firstUserId(records: VersionedRecord[]) {
  return records.find((record) => record.userId)?.userId;
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function laterDate(left: string, right: string) {
  return left.localeCompare(right) >= 0 ? left : right;
}

function stringArray(value: JsonValue | undefined) {
  return Array.isArray(value) ? value.map(String) : [];
}

function optionalString(value: JsonValue | undefined) {
  return typeof value === "string" ? value : undefined;
}

function emptyResult(skipped: boolean, dirtyRanges: DirtyDateRange[]): AnalysisRunResult {
  return {
    skipped,
    changed: false,
    dirtyRanges,
    baselines: 0,
    dynamicFeatures: 0,
    patterns: 0,
    researchQuests: 0,
    forecasts: 0,
    recommendations: 0,
    personalTools: 0,
    experiments: 0,
    feedItems: 0,
  };
}
