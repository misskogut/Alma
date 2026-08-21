import { PATTERN_ALGORITHM_VERSION } from "../data-model/versions";
import type { NormalizationStrategy } from "../registry/types";
import { clamp, median, medianAbsoluteDeviation } from "./math";
import type { BaselineEstimate, NumericEvidencePoint } from "./types";
import { isEvidencePointEligible, numericPointValue } from "./types";

export interface BaselineOptions {
  minimumEvidence?: number;
  validFrom?: string;
  validTo?: string;
}

export function computeHabitualBaseline(
  definitionId: string,
  points: NumericEvidencePoint[],
  options: BaselineOptions = {},
): BaselineEstimate | null {
  const values = eligibleValues(points);
  const minimumEvidence = options.minimumEvidence ?? 5;
  if (values.length < minimumEvidence) return null;

  const center = median(values);
  const robustSpread = medianAbsoluteDeviation(values) * 1.4826;
  const scale = robustSpread > 0 ? robustSpread : fallbackScale(values, center);
  const consistency = 1 / (1 + scale / Math.max(Math.abs(center), 1));

  return {
    definitionId,
    kind: "habitual",
    center,
    scale,
    evidenceCount: values.length,
    confidence: clamp((values.length / 28) * consistency, 0.05, 0.95),
    validFrom: options.validFrom ?? earliestDate(points),
    validTo: options.validTo,
    userConfirmed: false,
    algorithmVersion: PATTERN_ALGORITHM_VERSION,
  };
}

/**
 * A comfortable baseline is learned only from days with a confirmed positive
 * overall-wellbeing anchor. Habitual frequency alone is deliberately not
 * treated as comfort or optimality.
 */
export function computeComfortableBaseline(
  definitionId: string,
  points: NumericEvidencePoint[],
  wellbeingAnchors: NumericEvidencePoint[],
  options: BaselineOptions & { comfortableThreshold?: number } = {},
): BaselineEstimate | null {
  const threshold = options.comfortableThreshold ?? 0.35;
  const comfortableDates = new Set(
    wellbeingAnchors
      .filter(isEvidencePointEligible)
      .filter((point) => (numericPointValue(point) ?? -Infinity) >= threshold)
      .map((point) => point.localDate),
  );
  const comfortablePoints = points.filter((point) =>
    comfortableDates.has(point.localDate),
  );
  const habitual = computeHabitualBaseline(definitionId, comfortablePoints, {
    ...options,
    minimumEvidence: options.minimumEvidence ?? 4,
  });
  if (!habitual) return null;
  return {
    ...habitual,
    kind: "comfortable",
    confidence: clamp(habitual.confidence * 0.95, 0, 0.95),
  };
}

export function userDeclaredBaseline(
  definitionId: string,
  center: number,
  validFrom: string,
  scale = Math.max(Math.abs(center) * 0.1, 1),
): BaselineEstimate {
  return {
    definitionId,
    kind: "user_declared",
    center,
    scale,
    evidenceCount: 1,
    confidence: 1,
    validFrom,
    userConfirmed: true,
    algorithmVersion: PATTERN_ALGORITHM_VERSION,
  };
}

export function populationReferenceBaseline(
  definitionId: string,
  center: number,
  scale: number,
  validFrom: string,
): BaselineEstimate {
  return {
    definitionId,
    kind: "population_reference",
    center,
    scale: Math.max(scale, Number.EPSILON),
    evidenceCount: 0,
    confidence: 0.25,
    validFrom,
    userConfirmed: false,
    algorithmVersion: PATTERN_ALGORITHM_VERSION,
  };
}

export function chooseBaseline(
  candidates: Array<BaselineEstimate | null | undefined>,
) {
  const available = candidates.filter(
    (candidate): candidate is BaselineEstimate => Boolean(candidate),
  );
  const priority: BaselineEstimate["kind"][] = [
    "user_declared",
    "comfortable",
    "habitual",
    "population_reference",
  ];
  return (
    [...available].sort((left, right) => {
      const kindDifference =
        priority.indexOf(left.kind) - priority.indexOf(right.kind);
      if (kindDifference !== 0) return kindDifference;
      return Date.parse(right.validFrom) - Date.parse(left.validFrom);
    })[0] ?? null
  );
}

export function normalizeAgainstBaseline(
  value: number,
  strategy: NormalizationStrategy,
  baseline?: BaselineEstimate | null,
) {
  if (!Number.isFinite(value)) return null;
  switch (strategy) {
    case "none":
      return value;
    case "signed_unit":
      return clamp(value, -1, 1);
    case "unit_interval":
      return clamp(value, 0, 1);
    case "personal_baseline_ratio":
      if (!baseline || baseline.center === 0) return null;
      return clamp((value - baseline.center) / Math.abs(baseline.center), -1, 1);
    case "personal_baseline_zscore":
      if (!baseline || baseline.scale <= 0) return null;
      return clamp((value - baseline.center) / (baseline.scale * 2), -1, 1);
    case "category_encoding":
      return null;
  }
}

export function baselineChangedMaterially(
  previous: BaselineEstimate,
  next: BaselineEstimate,
  relativeThreshold = 0.15,
) {
  if (previous.definitionId !== next.definitionId) return false;
  const denominator = Math.max(Math.abs(previous.center), previous.scale, 0.001);
  return Math.abs(next.center - previous.center) / denominator >= relativeThreshold;
}

function eligibleValues(points: NumericEvidencePoint[]) {
  return points
    .filter(isEvidencePointEligible)
    .map(numericPointValue)
    .filter((value): value is number => value !== null && Number.isFinite(value));
}

function fallbackScale(values: number[], center: number) {
  const meanAbsoluteDistance =
    values.reduce((sum, value) => sum + Math.abs(value - center), 0) /
    Math.max(values.length, 1);
  return Math.max(meanAbsoluteDistance, Math.abs(center) * 0.05, 0.01);
}

function earliestDate(points: NumericEvidencePoint[]) {
  return (
    [...points]
      .sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt))[0]
      ?.localDate ?? new Date(0).toISOString().slice(0, 10)
  );
}
