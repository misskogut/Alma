import type {
  PatternEvidenceItem,
  PatternLifecycle,
  PatternStage,
  PersonalPattern,
} from "../data-model/types";
import { PATTERN_ALGORITHM_VERSION } from "../data-model/versions";
import {
  clamp,
  mean,
  median,
  minutesBetween,
  pearson,
  stableId,
  standardDeviation,
} from "./math";
import type {
  LagWindow,
  NumericEvidencePoint,
  PatternAnalysisDiagnostics,
  PatternCandidate,
} from "./types";
import { isEvidencePointEligible, numericPointValue } from "./types";

const DEFAULT_LAG_WINDOWS: LagWindow[] = [
  { minMinutes: 0, maxMinutes: 360 },
  { minMinutes: 360, maxMinutes: 1_440 },
  { minMinutes: 1_440, maxMinutes: 4_320 },
  { minMinutes: 4_320, maxMinutes: 10_080 },
];

interface AlignedPair {
  factor: NumericEvidencePoint;
  target: NumericEvidencePoint;
  factorValue: number;
  targetValue: number;
  lagMinutes: number;
}

export interface LaggedPatternInput {
  factorPoints: NumericEvidencePoint[];
  targetPoints: NumericEvidencePoint[];
  lagWindows?: LagWindow[];
  minimumOpportunities?: number;
}

export function analyzeLaggedPattern(
  input: LaggedPatternInput,
): PatternCandidate | null {
  const factorPoints = eligibleKnownPoints(input.factorPoints);
  const targetPoints = eligibleKnownPoints(input.targetPoints);
  if (factorPoints.length < 3 || targetPoints.length < 3) return null;

  const candidates = (input.lagWindows ?? DEFAULT_LAG_WINDOWS)
    .map((window) => analyzeWindow(factorPoints, targetPoints, window))
    .filter((candidate): candidate is PatternCandidate => Boolean(candidate));
  if (candidates.length === 0) return null;

  const best = [...candidates].sort(
    (left, right) => right.evidenceScore - left.evidenceScore,
  )[0];
  if (
    best.diagnostics.opportunities < (input.minimumOpportunities ?? 4) &&
    best.stage !== "observation"
  ) {
    return { ...best, stage: "observation" };
  }
  return best;
}

export interface CumulativePatternInput {
  factorPoints: NumericEvidencePoint[];
  targetPoints: NumericEvidencePoint[];
  minimumStreak?: number;
}

export function analyzeCumulativePattern(
  input: CumulativePatternInput,
): PatternCandidate | null {
  const factor = dailyValueMap(input.factorPoints);
  const targets = eligibleKnownPoints(input.targetPoints).sort(byTime);
  const minimumStreak = input.minimumStreak ?? 3;
  const rows: Array<{
    target: NumericEvidencePoint;
    streak: number;
    outcome: number;
    factorIds: string[];
  }> = [];

  for (const target of targets) {
    let streak = 0;
    const factorIds: string[] = [];
    const cursor = new Date(`${target.localDate}T00:00:00.000Z`);
    for (let offset = 0; offset < 30; offset += 1) {
      cursor.setUTCDate(cursor.getUTCDate() - (offset === 0 ? 0 : 1));
      const date = cursor.toISOString().slice(0, 10);
      const factorPoint = factor.get(date);
      if (!factorPoint || (numericPointValue(factorPoint) ?? 0) <= 0) break;
      streak += 1;
      factorIds.push(factorPoint.id);
    }
    const outcome = numericPointValue(target);
    if (outcome !== null) rows.push({ target, streak, outcome, factorIds });
  }

  if (rows.length < 6) return null;
  const exposed = rows.filter((row) => row.streak >= minimumStreak);
  const controls = rows.filter((row) => row.streak < minimumStreak);
  if (exposed.length < 2 || controls.length < 2) return null;

  const exposedRate = mean(exposed.map((row) => row.outcome));
  const controlRate = mean(controls.map((row) => row.outcome));
  const effect = exposedRate - controlRate;
  const evidence = rows.map<PatternEvidenceItem>((row) => ({
    id: stableId("cumulative", row.target.id, ...row.factorIds),
    relation:
      row.streak >= minimumStreak
        ? effect >= 0
          ? row.outcome > controlRate
            ? "supports"
            : "contradicts"
          : row.outcome < controlRate
            ? "supports"
            : "contradicts"
        : "unknown",
    opportunityAt: row.target.occurredAt,
    factorObservationIds: row.factorIds,
    outcomeObservationIds: [row.target.id],
    quality: row.target.confidence ?? 0.75,
    metadata: { streak: row.streak },
  }));
  const diagnostics = diagnosticsFromEvidence(
    evidence,
    Math.abs(effect),
    exposedRate,
    controlRate,
  );
  const score = evidenceScore(diagnostics);

  return {
    targetDefinitionId: rows[0].target.definitionId,
    factorDefinitionIds: [input.factorPoints[0]?.definitionId ?? "unknown"],
    modifierDefinitionIds: [],
    relationshipType: "cumulative",
    direction: effect >= 0 ? "up_up" : "up_down",
    cumulativeWindowDays: minimumStreak,
    threshold: minimumStreak,
    evidenceScore: score,
    stage: stageFromEvidence(score, diagnostics),
    diagnostics,
    algorithmVersion: PATTERN_ALGORITHM_VERSION,
  };
}

export interface InteractionPatternInput {
  factorPoints: NumericEvidencePoint[];
  modifierPoints: NumericEvidencePoint[];
  targetPoints: NumericEvidencePoint[];
}

export function analyzeInteractionPattern(
  input: InteractionPatternInput,
): PatternCandidate | null {
  const factor = dailyValueMap(input.factorPoints);
  const modifier = dailyValueMap(input.modifierPoints);
  const target = dailyValueMap(input.targetPoints);
  const dates = [...target.keys()].filter(
    (date) => factor.has(date) && modifier.has(date),
  );
  const groups = {
    both: [] as number[],
    factorOnly: [] as number[],
    modifierOnly: [] as number[],
    neither: [] as number[],
  };
  const evidence: PatternEvidenceItem[] = [];

  for (const date of dates) {
    const factorPoint = factor.get(date)!;
    const modifierPoint = modifier.get(date)!;
    const targetPoint = target.get(date)!;
    const factorValue = numericPointValue(factorPoint);
    const modifierValue = numericPointValue(modifierPoint);
    const targetValue = numericPointValue(targetPoint);
    if (factorValue === null || modifierValue === null || targetValue === null) continue;
    const factorPresent = factorValue > 0;
    const modifierPresent = modifierValue > 0;
    const group = factorPresent
      ? modifierPresent
        ? "both"
        : "factorOnly"
      : modifierPresent
        ? "modifierOnly"
        : "neither";
    groups[group].push(targetValue);
    evidence.push({
      id: stableId("interaction", date, factorPoint.id, modifierPoint.id, targetPoint.id),
      relation: group === "both" ? "supports" : "unknown",
      opportunityAt: targetPoint.occurredAt,
      factorObservationIds: [factorPoint.id, modifierPoint.id],
      outcomeObservationIds: [targetPoint.id],
      quality: mean([
        factorPoint.confidence ?? 0.75,
        modifierPoint.confidence ?? 0.75,
        targetPoint.confidence ?? 0.75,
      ]),
      metadata: { group },
    });
  }

  if (groups.both.length < 3) return null;
  const bothRate = mean(groups.both);
  const singleBest = Math.max(
    groups.factorOnly.length ? mean(groups.factorOnly) : 0,
    groups.modifierOnly.length ? mean(groups.modifierOnly) : 0,
    groups.neither.length ? mean(groups.neither) : 0,
  );
  const interactionLift = bothRate - singleBest;
  if (Math.abs(interactionLift) < 0.05) return null;

  for (const item of evidence) {
    if (item.metadata?.group !== "both") continue;
    const targetPoint = target.get(item.opportunityAt.slice(0, 10));
    const value = targetPoint ? numericPointValue(targetPoint) : null;
    item.relation =
      value === null
        ? "unknown"
        : interactionLift >= 0
          ? value >= singleBest
            ? "supports"
            : "contradicts"
          : value <= singleBest
            ? "supports"
            : "contradicts";
  }

  const diagnostics = diagnosticsFromEvidence(
    evidence,
    Math.abs(interactionLift),
    bothRate,
    singleBest,
  );
  const score = evidenceScore(diagnostics);
  return {
    targetDefinitionId: input.targetPoints[0]?.definitionId ?? "unknown",
    factorDefinitionIds: [input.factorPoints[0]?.definitionId ?? "unknown"],
    modifierDefinitionIds: [input.modifierPoints[0]?.definitionId ?? "unknown"],
    relationshipType: "interaction",
    direction: interactionLift >= 0 ? "up_up" : "up_down",
    evidenceScore: score,
    stage: stageFromEvidence(score, diagnostics),
    diagnostics,
    algorithmVersion: PATTERN_ALGORITHM_VERSION,
  };
}

export function evolvePattern(
  previous: PersonalPattern | null,
  candidate: PatternCandidate,
): { stage: PatternStage; lifecycle: PatternLifecycle } {
  if (!previous) return { stage: candidate.stage, lifecycle: "emerged" };

  const stageOrder: PatternStage[] = [
    "observation",
    "possible_link",
    "repeating_pattern",
    "established_personal_pattern",
  ];
  const previousRank = stageOrder.indexOf(previous.stage);
  const nextRank = stageOrder.indexOf(candidate.stage);
  const scoreDrop = previous.evidenceScore - candidate.evidenceScore;

  // Hysteresis: an established relationship is not revoked after one or two
  // exceptions. It weakens first and only disappears after sustained evidence.
  if (previous.stage === "established_personal_pattern") {
    if (
      candidate.evidenceScore < 0.25 &&
      candidate.diagnostics.opportunities >= 8
    ) {
      return { stage: "possible_link", lifecycle: "no_longer_observed" };
    }
    if (candidate.evidenceScore < 0.55 || scoreDrop >= 0.12) {
      return { stage: "established_personal_pattern", lifecycle: "weakening" };
    }
  }

  if (nextRank > previousRank) {
    return { stage: candidate.stage, lifecycle: "strengthening" };
  }
  if (nextRank < previousRank) {
    return {
      stage: scoreDrop < 0.12 ? previous.stage : candidate.stage,
      lifecycle: "weakening",
    };
  }
  return { stage: candidate.stage, lifecycle: "stable" };
}

export function materializePattern(
  candidate: PatternCandidate,
  validFrom: string,
  previous: PersonalPattern | null = null,
): PersonalPattern {
  const evolution = evolvePattern(previous, candidate);
  const now = new Date().toISOString();
  return {
    id:
      previous?.id ??
      stableId(
        candidate.targetDefinitionId,
        ...candidate.factorDefinitionIds,
        ...candidate.modifierDefinitionIds,
        candidate.relationshipType,
      ),
    version: (previous?.version ?? 0) + 1,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    targetDefinitionId: candidate.targetDefinitionId,
    factorDefinitionIds: candidate.factorDefinitionIds,
    modifierDefinitionIds: candidate.modifierDefinitionIds,
    relationshipType: candidate.relationshipType,
    direction: candidate.direction,
    typicalLagMinutes: candidate.typicalLagMinutes,
    lagRangeMinutes: candidate.lagRangeMinutes,
    cumulativeWindowDays: candidate.cumulativeWindowDays,
    threshold: candidate.threshold,
    evidenceScore: candidate.evidenceScore,
    stage: evolution.stage,
    lifecycle: evolution.lifecycle,
    evidence: candidate.diagnostics.evidence,
    parentPatternId: previous?.parentPatternId,
    validFrom: previous?.validFrom ?? validFrom,
    algorithmVersion: candidate.algorithmVersion,
  };
}

export function refinePattern(
  parent: PersonalPattern,
  refined: PatternCandidate,
  modifierDefinitionId: string,
  validFrom: string,
) {
  const now = new Date().toISOString();
  const parentUpdate: PersonalPattern = {
    ...parent,
    version: parent.version + 1,
    updatedAt: now,
    lifecycle: "refined",
    validTo: validFrom,
  };
  const child = materializePattern(
    {
      ...refined,
      modifierDefinitionIds: Array.from(
        new Set([...refined.modifierDefinitionIds, modifierDefinitionId]),
      ),
    },
    validFrom,
  );
  child.parentPatternId = parent.id;
  return { parent: parentUpdate, child };
}

function analyzeWindow(
  factorPoints: NumericEvidencePoint[],
  targetPoints: NumericEvidencePoint[],
  window: LagWindow,
): PatternCandidate | null {
  const pairs = alignWithinLag(factorPoints, targetPoints, window);
  if (pairs.length < 3) return null;
  const left = pairs.map((pair) => pair.factorValue);
  const right = pairs.map((pair) => pair.targetValue);
  const factorBinary = new Set(left).size <= 2 && left.every((value) => value === 0 || value === 1);
  const targetBinary = new Set(right).size <= 2 && right.every((value) => value === 0 || value === 1);
  let effect = pearson(left, right);
  let exposedRate: number | undefined;
  let controlRate: number | undefined;
  if (factorBinary && targetBinary) {
    const exposed = pairs.filter((pair) => pair.factorValue > 0).map((pair) => pair.targetValue);
    const controls = pairs.filter((pair) => pair.factorValue <= 0).map((pair) => pair.targetValue);
    if (exposed.length > 0 && controls.length > 0) {
      exposedRate = mean(exposed);
      controlRate = mean(controls);
      effect = exposedRate - controlRate;
    }
  }
  if (!Number.isFinite(effect)) effect = 0;

  const factorCenter = mean(left);
  const targetCenter = mean(right);
  const expectedSign = effect >= 0 ? 1 : -1;
  const evidence = pairs.map<PatternEvidenceItem>((pair) => {
    const factorDelta = pair.factorValue - factorCenter;
    const targetDelta = pair.targetValue - targetCenter;
    const relationshipSign = Math.sign(factorDelta * targetDelta) || 0;
    return {
      id: stableId("pattern-evidence", pair.factor.id, pair.target.id, window.minMinutes, window.maxMinutes),
      relation:
        relationshipSign === 0
          ? "unknown"
          : relationshipSign === expectedSign
            ? "supports"
            : "contradicts",
      opportunityAt: pair.target.occurredAt,
      factorObservationIds: [pair.factor.id],
      outcomeObservationIds: [pair.target.id],
      quality: mean([
        pair.factor.confidence ?? 0.75,
        pair.target.confidence ?? 0.75,
      ]),
      lagMinutes: pair.lagMinutes,
    };
  });

  const temporalStability = splitHalfStability(pairs);
  const lags = pairs.map((pair) => pair.lagMinutes);
  const lagRange = Math.max(window.maxMinutes - window.minMinutes, 1);
  const lagConsistency = clamp(1 - standardDeviation(lags) / lagRange, 0, 1);
  const diagnostics = diagnosticsFromEvidence(
    evidence,
    Math.abs(effect),
    exposedRate,
    controlRate,
    temporalStability,
    lagConsistency,
  );
  const score = evidenceScore(diagnostics);
  const dominantFactorDirection = mean(left) < 0 ? "down" : "up";
  const direction =
    dominantFactorDirection === "up"
      ? effect >= 0
        ? "up_up"
        : "up_down"
      : effect >= 0
        ? "down_down"
        : "down_up";
  const typicalLag = Math.round(median(lags));

  return {
    targetDefinitionId: pairs[0].target.definitionId,
    factorDefinitionIds: [pairs[0].factor.definitionId],
    modifierDefinitionIds: [],
    relationshipType:
      typicalLag > 60 || window.minMinutes > 0
        ? "lagged"
        : effect < 0
          ? "inverse"
          : "association",
    direction,
    typicalLagMinutes: typicalLag,
    lagRangeMinutes: [Math.round(Math.min(...lags)), Math.round(Math.max(...lags))],
    evidenceScore: score,
    stage: stageFromEvidence(score, diagnostics),
    diagnostics,
    algorithmVersion: PATTERN_ALGORITHM_VERSION,
  };
}

function alignWithinLag(
  factorPoints: NumericEvidencePoint[],
  targetPoints: NumericEvidencePoint[],
  window: LagWindow,
) {
  const pairs: AlignedPair[] = [];
  for (const target of targetPoints) {
    const targetValue = numericPointValue(target);
    if (targetValue === null) continue;
    const candidate = factorPoints
      .map((factor) => ({
        factor,
        lagMinutes: minutesBetween(factor.occurredAt, target.occurredAt),
      }))
      .filter(
        ({ lagMinutes }) =>
          lagMinutes >= window.minMinutes && lagMinutes <= window.maxMinutes,
      )
      .sort((left, right) => left.lagMinutes - right.lagMinutes)[0];
    if (!candidate) continue;
    const factorValue = numericPointValue(candidate.factor);
    if (factorValue === null) continue;
    pairs.push({
      factor: candidate.factor,
      target,
      factorValue,
      targetValue,
      lagMinutes: candidate.lagMinutes,
    });
  }
  return pairs;
}

function diagnosticsFromEvidence(
  evidence: PatternEvidenceItem[],
  effectSize: number,
  exposedRate?: number,
  controlRate?: number,
  temporalStability = 0.6,
  lagConsistency = 0.6,
): PatternAnalysisDiagnostics {
  const support = evidence.filter((item) => item.relation === "supports").length;
  const counterexamples = evidence.filter(
    (item) => item.relation === "contradicts",
  ).length;
  const unknown = evidence.filter((item) => item.relation === "unknown").length;
  return {
    opportunities: evidence.length,
    support,
    counterexamples,
    unknown,
    effectSize: clamp(effectSize, 0, 1),
    exposedRate,
    controlRate,
    dataQuality: clamp(mean(evidence.map((item) => item.quality)), 0, 1),
    temporalStability,
    lagConsistency,
    evidence,
  };
}

function evidenceScore(diagnostics: PatternAnalysisDiagnostics) {
  const known = Math.max(
    diagnostics.support + diagnostics.counterexamples,
    1,
  );
  const repeatability = diagnostics.support / known;
  const counterRate = diagnostics.counterexamples / known;
  const opportunityStrength = clamp(diagnostics.opportunities / 14, 0, 1);
  return clamp(
    diagnostics.effectSize * 0.34 +
      opportunityStrength * 0.18 +
      repeatability * 0.17 +
      diagnostics.dataQuality * 0.13 +
      diagnostics.temporalStability * 0.12 +
      diagnostics.lagConsistency * 0.06 -
      counterRate * 0.14,
    0,
    1,
  );
}

function stageFromEvidence(
  score: number,
  diagnostics: PatternAnalysisDiagnostics,
): PatternStage {
  const known = diagnostics.support + diagnostics.counterexamples;
  const counterRate = diagnostics.counterexamples / Math.max(known, 1);
  if (
    diagnostics.opportunities >= 12 &&
    score >= 0.72 &&
    counterRate <= 0.3 &&
    diagnostics.temporalStability >= 0.55
  ) {
    return "established_personal_pattern";
  }
  if (diagnostics.opportunities >= 7 && score >= 0.55) {
    return "repeating_pattern";
  }
  if (diagnostics.opportunities >= 4 && score >= 0.35) {
    return "possible_link";
  }
  return "observation";
}

function splitHalfStability(pairs: AlignedPair[]) {
  if (pairs.length < 6) return 0.4;
  const middle = Math.floor(pairs.length / 2);
  const first = pairs.slice(0, middle);
  const second = pairs.slice(middle);
  const firstEffect = pearson(
    first.map((pair) => pair.factorValue),
    first.map((pair) => pair.targetValue),
  );
  const secondEffect = pearson(
    second.map((pair) => pair.factorValue),
    second.map((pair) => pair.targetValue),
  );
  if (Math.sign(firstEffect) !== Math.sign(secondEffect)) return 0.1;
  return clamp(1 - Math.abs(Math.abs(firstEffect) - Math.abs(secondEffect)), 0.2, 1);
}

function eligibleKnownPoints(points: NumericEvidencePoint[]) {
  return points
    .filter(isEvidencePointEligible)
    .filter((point) => numericPointValue(point) !== null)
    .sort(byTime);
}

function dailyValueMap(points: NumericEvidencePoint[]) {
  const result = new Map<string, NumericEvidencePoint>();
  for (const point of eligibleKnownPoints(points)) {
    const previous = result.get(point.localDate);
    if (!previous || Date.parse(point.occurredAt) > Date.parse(previous.occurredAt)) {
      result.set(point.localDate, point);
    }
  }
  return result;
}

function byTime(left: NumericEvidencePoint, right: NumericEvidencePoint) {
  return Date.parse(left.occurredAt) - Date.parse(right.occurredAt);
}
