import assert from "node:assert/strict";
import test from "node:test";
import type { PersonalPattern } from "../lib/alma-core/data-model/types";
import {
  baselineChangedMaterially,
  buildCompetingHypotheses,
  chooseBaseline,
  computeComfortableBaseline,
  computeHabitualBaseline,
  createCalibratableForecast,
  createResearchQuest,
  deriveDynamicFeatures,
  evolvePattern,
  normalizeAgainstBaseline,
  refinePattern,
  resolveCanonicalValue,
  resolveForecast,
  summarizeCalibration,
  updateResearchProgress,
  userDeclaredBaseline,
} from "../lib/alma-core";
import {
  analyzeCumulativePattern,
  analyzeInteractionPattern,
  analyzeLaggedPattern,
  materializePattern,
} from "../lib/alma-core/engines/pattern-engine";
import type {
  NumericEvidencePoint,
  PatternCandidate,
} from "../lib/alma-core/engines/types";
import { METRIC_REGISTRY } from "../lib/alma-core/registry/metric-registry";

test("taxonomy keeps symptoms, states, activities and intake separate", () => {
  assert.equal(METRIC_REGISTRY.headache.kind, "symptom");
  assert.equal(METRIC_REGISTRY.clarity.kind, "state");
  assert.equal(METRIC_REGISTRY.workout.kind, "activity");
  assert.equal(METRIC_REGISTRY.coffee.kind, "intake");
  assert.notEqual(METRIC_REGISTRY.workout.dataForm, "symptom_episode");
});

test("load intensity and response use independent value semantics", () => {
  assert.equal(
    METRIC_REGISTRY.cognitive_load_intensity.normalizationStrategy,
    "unit_interval",
  );
  assert.equal(
    METRIC_REGISTRY.cognitive_load_response.normalizationStrategy,
    "signed_unit",
  );
  assert.equal(METRIC_REGISTRY.libido.kind, "state");
});

test("habitual baseline excludes inferred and synthetic history", () => {
  const points = [
    ...series("sleep_duration", [6, 6.5, 7, 6, 7.5, 100]),
    point("synthetic", "sleep_duration", 99, 20, { synthetic: true }),
    point("inferred", "sleep_duration", 88, 21, {
      epistemicStatus: "inferred",
    }),
  ];
  const baseline = computeHabitualBaseline("sleep_duration", points);
  assert.ok(baseline);
  assert.ok(baseline.center < 8);
  assert.equal(baseline.evidenceCount, 6);
});

test("comfortable baseline is not silently equated with habitual", () => {
  const sleep = series("sleep_duration", [6, 6, 6, 7.5, 8, 7.8, 6, 8.1]);
  const wellbeing = series(
    "overall_wellbeing",
    [-0.4, -0.2, -0.1, 0.6, 0.8, 0.7, -0.2, 0.75],
  );
  const habitual = computeHabitualBaseline("sleep_duration", sleep);
  const comfortable = computeComfortableBaseline(
    "sleep_duration",
    sleep,
    wellbeing,
  );
  assert.ok(habitual && comfortable);
  assert.ok(comfortable.center > habitual.center);
});

test("user-declared baseline wins selection and changes are detectable", () => {
  const habitual = computeHabitualBaseline(
    "sleep_duration",
    series("sleep_duration", [6, 6, 6.5, 6.5, 7]),
  );
  const declared = userDeclaredBaseline("sleep_duration", 8, "2026-01-01");
  assert.equal(chooseBaseline([habitual, declared])?.kind, "user_declared");
  assert.equal(baselineChangedMaterially(declared, { ...declared, center: 8.05 }), false);
  assert.equal(baselineChangedMaterially(declared, { ...declared, center: 10 }), true);
});

test("normalization retains raw meaning while mapping around baseline", () => {
  const baseline = userDeclaredBaseline("temperature", 20, "2026-01-01", 5);
  assert.equal(normalizeAgainstBaseline(20, "personal_baseline_zscore", baseline), 0);
  assert.equal(normalizeAgainstBaseline(30, "personal_baseline_zscore", baseline), 1);
  assert.equal(normalizeAgainstBaseline(-0.6, "signed_unit", null), -0.6);
});

test("presence absence and unknown remain distinct", () => {
  const present = point("present", "headache", undefined, 0, { presence: "present" });
  const absent = point("absent", "headache", undefined, 1, {
    presence: "confirmed_absent",
  });
  const unknown = point("unknown", "headache", undefined, 2, {
    presence: "unknown",
  });
  const candidate = analyzeLaggedPattern({
    factorPoints: series("coffee", [1, 0, 1, 0, 1, 0]),
    targetPoints: [present, absent, unknown, present, absent, present],
    lagWindows: [{ minMinutes: 0, maxMinutes: 60 }],
  });
  assert.ok(candidate);
  assert.equal(candidate.diagnostics.opportunities, 5);
});

test("manual confirmed value overrides lower-priority inference", () => {
  const base = observation("inferred", "overall_wellbeing", 0.8, "model_inference", "inferred");
  const manual = observation("manual", "overall_wellbeing", -0.3, "manual", "user_confirmed");
  const resolved = resolveCanonicalValue([base, manual]);
  assert.equal(resolved.canonical?.id, "manual");
  assert.equal(resolved.reason, "manual_override");
});

test("feature engine derives direction, volatility, streak and threshold crossing", () => {
  const features = deriveDynamicFeatures(
    series("pressure", [0.1, 0.2, 0.35, 0.7, 0.8]),
    { normalizationStrategy: "signed_unit", threshold: 0.5 },
  );
  assert.ok(features.some((feature) => feature.featureType === "volatility"));
  assert.ok(
    features.some(
      (feature) =>
        feature.featureType === "threshold_crossing" && feature.value === 1,
    ),
  );
  assert.ok(
    features.some(
      (feature) => feature.featureType === "streak" && feature.value >= 3,
    ),
  );
});

test("lag engine detects a next-day relationship and counts controls", () => {
  const factor: NumericEvidencePoint[] = [];
  const target: NumericEvidencePoint[] = [];
  for (let day = 0; day < 16; day += 1) {
    const exposure = day % 2 === 0 ? 1 : 0;
    factor.push(point(`f-${day}`, "pressure_drop", exposure, day, { hour: 8 }));
    target.push(point(`t-${day}`, "headache", exposure, day, { hour: 20 }));
  }
  const pattern = analyzeLaggedPattern({
    factorPoints: factor,
    targetPoints: target,
    lagWindows: [{ minMinutes: 600, maxMinutes: 900 }],
  });
  assert.ok(pattern);
  assert.equal(pattern.relationshipType, "lagged");
  assert.ok((pattern.typicalLagMinutes ?? 0) >= 600);
  assert.ok(pattern.diagnostics.support >= 12);
  assert.equal(pattern.stage, "established_personal_pattern");
});

test("opposite-direction relationship is detected", () => {
  const pattern = analyzeLaggedPattern({
    factorPoints: series("cognitive_load", [-0.9, -0.7, -0.5, -0.3, 0, 0.2, 0.4, 0.6, 0.8, 1]),
    targetPoints: series("libido", [0.9, 0.7, 0.5, 0.3, 0, -0.2, -0.4, -0.6, -0.8, -1]),
    lagWindows: [{ minMinutes: 0, maxMinutes: 60 }],
  });
  assert.ok(pattern);
  assert.equal(pattern.relationshipType, "inverse");
  assert.ok(pattern.direction === "up_down" || pattern.direction === "down_up");
});

test("cumulative engine detects a three-day streak effect", () => {
  const factor: NumericEvidencePoint[] = [];
  const target: NumericEvidencePoint[] = [];
  const values = [1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0];
  values.forEach((value, day) => {
    factor.push(point(`f-${day}`, "training", value, day));
    target.push(
      point(`t-${day}`, "poor_sleep", value === 1 && day % 4 === 2 ? 1 : 0, day),
    );
  });
  const pattern = analyzeCumulativePattern({
    factorPoints: factor,
    targetPoints: target,
    minimumStreak: 3,
  });
  assert.ok(pattern);
  assert.equal(pattern.relationshipType, "cumulative");
  assert.equal(pattern.cumulativeWindowDays, 3);
});

test("modifier engine detects an interaction stronger than either factor alone", () => {
  const factor: NumericEvidencePoint[] = [];
  const modifier: NumericEvidencePoint[] = [];
  const target: NumericEvidencePoint[] = [];
  for (let day = 0; day < 20; day += 1) {
    const f = day % 2 === 0 ? 1 : 0;
    const m = Math.floor(day / 2) % 2 === 0 ? 1 : 0;
    factor.push(point(`f-${day}`, "pressure_drop", f, day));
    modifier.push(point(`m-${day}`, "late_cycle", m, day));
    target.push(point(`t-${day}`, "headache", f && m ? 1 : 0, day));
  }
  const pattern = analyzeInteractionPattern({
    factorPoints: factor,
    modifierPoints: modifier,
    targetPoints: target,
  });
  assert.ok(pattern);
  assert.equal(pattern.relationshipType, "interaction");
  assert.deepEqual(pattern.modifierDefinitionIds, ["late_cycle"]);
});

test("three repetitions alone never become a pattern", () => {
  const pattern = analyzeLaggedPattern({
    factorPoints: series("coffee", [1, 1, 1]),
    targetPoints: series("headache", [1, 1, 1]),
    lagWindows: [{ minMinutes: 0, maxMinutes: 60 }],
  });
  assert.ok(pattern);
  assert.equal(pattern.stage, "observation");
});

test("hysteresis weakens an established pattern before revoking it", () => {
  const previous = establishedPattern();
  const candidate = candidateWithScore(0.45, 10, 5, 5);
  const evolution = evolvePattern(previous, candidate);
  assert.equal(evolution.stage, "established_personal_pattern");
  assert.equal(evolution.lifecycle, "weakening");
});

test("pattern refinement preserves the parent and creates a linked child", () => {
  const parent = establishedPattern();
  const refined = candidateWithScore(0.8, 16, 14, 2);
  const result = refinePattern(parent, refined, "late_cycle", "2026-06-01");
  assert.equal(result.parent.lifecycle, "refined");
  assert.equal(result.child.parentPatternId, parent.id);
  assert.ok(result.child.modifierDefinitionIds.includes("late_cycle"));
});

test("research keeps competing hypotheses and marks sufficient evidence", () => {
  const hypotheses = buildCompetingHypotheses("headache", [
    { factorDefinitionIds: ["coffee"], explanation: "Проверяем связь с кофе." },
    {
      factorDefinitionIds: ["pressure"],
      modifierDefinitionIds: ["cycle_phase"],
      explanation: "Проверяем сочетание условий.",
    },
  ]);
  const quest = createResearchQuest({
    title: "Почему болит голова?",
    targetDefinitionId: "headache",
    hypotheses,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const updated = updateResearchProgress(
    quest,
    [candidateWithScore(0.8, 16, 14, 2)],
    quest.requiredMetricIds,
  );
  assert.equal(updated.hypotheses.length, 2);
  assert.equal(updated.progress.enoughData, true);
  assert.equal(updated.status, "sufficient_result");
});

test("forecast records outcomes and calibration instead of decorative percentages", () => {
  const pattern = establishedPattern();
  const forecast = createCalibratableForecast({
    targetDefinitionId: "headache",
    generatedAt: "2026-01-01T08:00:00.000Z",
    windowStart: "2026-01-01T08:00:00.000Z",
    windowEnd: "2026-01-02T08:00:00.000Z",
    baseRate: 0.2,
    patterns: [pattern],
    activeFactorValues: { pressure_drop: 1 },
  });
  const resolved = resolveForecast(
    forecast,
    "confirmed_absent",
    "2026-01-02T09:00:00.000Z",
  );
  assert.equal(resolved.outcome, "confirmed_absent");
  assert.equal(resolved.brierScore, forecast.probability ** 2);
  const calibration = summarizeCalibration([resolved]);
  assert.equal(calibration.count, 1);
  assert.ok(typeof calibration.brierMean === "number");
});

function series(definitionId: string, values: number[]) {
  return values.map((value, index) =>
    point(`${definitionId}-${index}`, definitionId, value, index),
  );
}

function point(
  id: string,
  definitionId: string,
  value: number | undefined,
  day: number,
  options: Partial<NumericEvidencePoint> & { hour?: number } = {},
): NumericEvidencePoint {
  const date = new Date(Date.UTC(2026, 0, 1 + day, options.hour ?? 12));
  const { hour: _hour, ...rest } = options;
  return {
    id,
    definitionId,
    value,
    occurredAt: date.toISOString(),
    localDate: date.toISOString().slice(0, 10),
    epistemicStatus: "user_confirmed",
    confidence: 1,
    ...rest,
  };
}

function observation(
  id: string,
  definitionId: string,
  value: number,
  sourceId: string,
  epistemicStatus: "user_confirmed" | "inferred",
) {
  const now = "2026-01-01T12:00:00.000Z";
  return {
    id,
    version: 1,
    createdAt: now,
    updatedAt: now,
    definitionId,
    localDate: "2026-01-01",
    timezone: "UTC",
    timePrecision: "exact_time" as const,
    occurredAt: now,
    recordedAt: now,
    value,
    source: { sourceId },
    epistemicStatus,
    isCanonical: true,
    schemaVersion: 2,
  };
}

function candidateWithScore(
  score: number,
  opportunities: number,
  support: number,
  counterexamples: number,
): PatternCandidate {
  return {
    targetDefinitionId: "headache",
    factorDefinitionIds: ["pressure_drop"],
    modifierDefinitionIds: [],
    relationshipType: "lagged",
    direction: "up_up",
    typicalLagMinutes: 720,
    lagRangeMinutes: [600, 900],
    evidenceScore: score,
    stage:
      score >= 0.72
        ? "established_personal_pattern"
        : score >= 0.55
          ? "repeating_pattern"
          : "possible_link",
    diagnostics: {
      opportunities,
      support,
      counterexamples,
      unknown: opportunities - support - counterexamples,
      effectSize: score,
      dataQuality: 1,
      temporalStability: 0.8,
      lagConsistency: 0.8,
      evidence: [],
    },
    algorithmVersion: "deterministic-v1",
  };
}

function establishedPattern(): PersonalPattern {
  return materializePattern(
    candidateWithScore(0.82, 16, 14, 2),
    "2026-01-01",
  );
}
