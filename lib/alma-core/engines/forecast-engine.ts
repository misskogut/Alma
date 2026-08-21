import type { ForecastRecord, PersonalPattern } from "../data-model/types";
import { FORECAST_ALGORITHM_VERSION } from "../data-model/versions";
import { clamp, mean, stableId } from "./math";

export interface ForecastInput {
  targetDefinitionId: string;
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  baseRate: number;
  patterns: PersonalPattern[];
  activeFactorValues: Record<string, number | undefined>;
}

export function createCalibratableForecast(input: ForecastInput): ForecastRecord {
  const patterns = input.patterns.filter(
    (pattern) =>
      pattern.targetDefinitionId === input.targetDefinitionId &&
      (pattern.stage === "repeating_pattern" ||
        pattern.stage === "established_personal_pattern") &&
      pattern.lifecycle !== "no_longer_observed",
  );
  const contributors: Array<{ id: string; contribution: number }> = [];
  for (const pattern of patterns) {
    const factorValue = mean(
      pattern.factorDefinitionIds
        .map((id) => input.activeFactorValues[id])
        .filter((value): value is number => typeof value === "number"),
    );
    if (!Number.isFinite(factorValue) || factorValue === 0) continue;
    const direction =
      pattern.direction === "up_down" || pattern.direction === "down_up" ? -1 : 1;
    const lifecycleWeight = pattern.lifecycle === "weakening" ? 0.6 : 1;
    contributors.push({
      id: pattern.factorDefinitionIds.join("+"),
      contribution:
        direction * factorValue * pattern.evidenceScore * lifecycleWeight,
    });
  }

  const baseLogit = logit(clamp(input.baseRate, 0.01, 0.99));
  const evidenceLogit = contributors.reduce(
    (total, contributor) => total + contributor.contribution * 1.25,
    0,
  );
  const probability = clamp(logistic(baseLogit + evidenceLogit), 0.01, 0.99);
  const evidenceStrength = patterns.length
    ? mean(patterns.map((pattern) => pattern.evidenceScore))
    : 0;
  const now = input.generatedAt;

  return {
    id: stableId(
      "forecast",
      input.targetDefinitionId,
      input.generatedAt,
      input.windowStart,
      input.windowEnd,
    ),
    version: 1,
    createdAt: now,
    updatedAt: now,
    targetDefinitionId: input.targetDefinitionId,
    generatedAt: input.generatedAt,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    probability,
    uncertainty: clamp(1 - evidenceStrength, 0.05, 0.95),
    positiveContributorIds: contributors
      .filter((item) => item.contribution > 0)
      .map((item) => item.id),
    negativeContributorIds: contributors
      .filter((item) => item.contribution < 0)
      .map((item) => item.id),
    compensatorIds: [],
    relatedPatternIds: patterns.map((pattern) => pattern.id),
    outcome: "pending",
    algorithmVersion: FORECAST_ALGORITHM_VERSION,
  };
}

export function resolveForecast(
  forecast: ForecastRecord,
  outcome: Exclude<ForecastRecord["outcome"], "pending">,
  resolvedAt = new Date().toISOString(),
): ForecastRecord {
  const observed =
    outcome === "confirmed_occurred"
      ? 1
      : outcome === "confirmed_absent"
        ? 0
        : null;
  return {
    ...forecast,
    version: forecast.version + 1,
    updatedAt: resolvedAt,
    outcome,
    resolvedAt,
    brierScore:
      observed === null ? undefined : (forecast.probability - observed) ** 2,
  };
}

export function summarizeCalibration(forecasts: ForecastRecord[]) {
  const resolved = forecasts.filter(
    (forecast) =>
      forecast.outcome === "confirmed_occurred" ||
      forecast.outcome === "confirmed_absent",
  );
  const bins = Array.from({ length: 5 }, (_, index) => {
    const minimum = index * 0.2;
    const maximum = index === 4 ? 1.001 : (index + 1) * 0.2;
    const members = resolved.filter(
      (forecast) =>
        forecast.probability >= minimum && forecast.probability < maximum,
    );
    return {
      range: [minimum, Math.min(maximum, 1)] as [number, number],
      count: members.length,
      predictedMean: members.length
        ? mean(members.map((forecast) => forecast.probability))
        : null,
      observedRate: members.length
        ? members.filter((forecast) => forecast.outcome === "confirmed_occurred")
            .length / members.length
        : null,
      brierMean: members.length
        ? mean(
            members
              .map((forecast) => forecast.brierScore)
              .filter((score): score is number => typeof score === "number"),
          )
        : null,
    };
  });
  return {
    count: resolved.length,
    brierMean: resolved.length
      ? mean(
          resolved
            .map((forecast) => forecast.brierScore)
            .filter((score): score is number => typeof score === "number"),
        )
      : null,
    falseNegatives: resolved.filter(
      (forecast) =>
        forecast.probability < 0.3 && forecast.outcome === "confirmed_occurred",
    ).length,
    falsePositives: resolved.filter(
      (forecast) =>
        forecast.probability > 0.7 && forecast.outcome === "confirmed_absent",
    ).length,
    bins,
  };
}

function logistic(value: number) {
  return 1 / (1 + Math.exp(-value));
}

function logit(probability: number) {
  return Math.log(probability / (1 - probability));
}
