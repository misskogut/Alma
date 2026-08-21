import type { DynamicFeature } from "../data-model/types";
import { PATTERN_ALGORITHM_VERSION } from "../data-model/versions";
import type { NormalizationStrategy } from "../registry/types";
import { normalizeAgainstBaseline } from "./baseline-engine";
import { daysBetween, stableId, standardDeviation } from "./math";
import type { BaselineEstimate, NumericEvidencePoint } from "./types";
import { isEvidencePointEligible, numericPointValue } from "./types";

export interface FeatureEngineOptions {
  baseline?: BaselineEstimate | null;
  normalizationStrategy: NormalizationStrategy;
  rollingWindow?: number;
  threshold?: number;
  neutralEpsilon?: number;
}

export function deriveDynamicFeatures(
  points: NumericEvidencePoint[],
  options: FeatureEngineOptions,
): DynamicFeature[] {
  const rollingWindow = options.rollingWindow ?? 7;
  const threshold = options.threshold ?? 0.5;
  const neutralEpsilon = options.neutralEpsilon ?? 0.03;
  const active = collapseToLatestDailyPoint(
    points.filter(isEvidencePointEligible),
  );
  const rows = active
    .map((point) => {
      const raw = numericPointValue(point);
      if (raw === null) return null;
      const normalized = normalizeAgainstBaseline(
        raw,
        options.normalizationStrategy,
        options.baseline,
      );
      if (normalized === null) return null;
      return { point, raw, normalized };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const features: DynamicFeature[] = [];
  let streak = 0;
  let previousDirection = 0;
  let directionStartedAt = rows[0]?.point.occurredAt;

  rows.forEach((row, index) => {
    const previous = rows[index - 1];
    const delta = previous ? row.normalized - previous.normalized : 0;
    const elapsedDays = previous
      ? Math.max(daysBetween(previous.point.occurredAt, row.point.occurredAt), 1 / 24)
      : 1;
    const direction = Math.abs(delta) <= neutralEpsilon ? 0 : delta > 0 ? 1 : -1;
    if (direction === 0) {
      streak = 0;
      directionStartedAt = row.point.occurredAt;
    } else if (direction === previousDirection) {
      streak += 1;
    } else {
      streak = 1;
      directionStartedAt = row.point.occurredAt;
    }
    previousDirection = direction;

    const window = rows.slice(Math.max(0, index - rollingWindow + 1), index + 1);
    const normalizedWindow = window.map((item) => item.normalized);
    const windowStart = window[0]?.point.occurredAt ?? row.point.occurredAt;
    const basedOnObservationIds = window.map((item) => item.point.id);
    const deviation = options.baseline
      ? row.raw - options.baseline.center
      : row.normalized;
    const previousThresholdSide = previous
      ? Math.sign(Math.abs(previous.normalized) - threshold)
      : 0;
    const thresholdSide = Math.sign(Math.abs(row.normalized) - threshold);
    const thresholdCrossing =
      previous && previousThresholdSide !== thresholdSide ? thresholdSide : 0;

    pushFeature(features, row.point, "normalized_value", row.normalized, windowStart, basedOnObservationIds);
    pushFeature(features, row.point, "deviation_from_baseline", deviation, windowStart, basedOnObservationIds);
    pushFeature(features, row.point, "delta", delta, previous?.point.occurredAt ?? windowStart, previous ? [previous.point.id, row.point.id] : [row.point.id]);
    pushFeature(features, row.point, "slope", delta / elapsedDays, previous?.point.occurredAt ?? windowStart, previous ? [previous.point.id, row.point.id] : [row.point.id]);
    pushFeature(features, row.point, "direction", direction, previous?.point.occurredAt ?? windowStart, previous ? [previous.point.id, row.point.id] : [row.point.id]);
    pushFeature(features, row.point, "velocity", delta / (elapsedDays * 24), previous?.point.occurredAt ?? windowStart, previous ? [previous.point.id, row.point.id] : [row.point.id]);
    pushFeature(features, row.point, "volatility", standardDeviation(normalizedWindow), windowStart, basedOnObservationIds);
    pushFeature(
      features,
      row.point,
      "duration",
      directionStartedAt
        ? Math.max(0, daysBetween(directionStartedAt, row.point.occurredAt) * 1_440)
        : 0,
      directionStartedAt ?? windowStart,
      basedOnObservationIds,
    );
    pushFeature(features, row.point, "cumulative_change", row.normalized - normalizedWindow[0], windowStart, basedOnObservationIds);
    pushFeature(features, row.point, "streak", streak * direction, windowStart, basedOnObservationIds);
    pushFeature(features, row.point, "threshold_crossing", thresholdCrossing, previous?.point.occurredAt ?? windowStart, previous ? [previous.point.id, row.point.id] : [row.point.id]);

  });

  return features;
}

function pushFeature(
  target: DynamicFeature[],
  point: NumericEvidencePoint,
  featureType: DynamicFeature["featureType"],
  value: number,
  windowStart: string,
  basedOnObservationIds: string[],
) {
  const now = point.occurredAt;
  target.push({
    id: stableId(point.definitionId, point.localDate, featureType),
    version: 1,
    createdAt: now,
    updatedAt: now,
    definitionId: point.definitionId,
    localDate: point.localDate,
    featureType,
    value,
    windowStart,
    windowEnd: point.occurredAt,
    basedOnObservationIds,
    algorithmVersion: PATTERN_ALGORITHM_VERSION,
  });
}

function collapseToLatestDailyPoint(points: NumericEvidencePoint[]) {
  const byDay = new Map<string, NumericEvidencePoint>();
  for (const point of points) {
    const key = `${point.definitionId}:${point.localDate}`;
    const previous = byDay.get(key);
    if (!previous || Date.parse(point.occurredAt) > Date.parse(previous.occurredAt)) {
      byDay.set(key, point);
    }
  }
  return [...byDay.values()].sort(
    (left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt),
  );
}
