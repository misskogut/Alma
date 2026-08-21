import assert from "node:assert/strict";
import test from "node:test";
import {
  LocalDatabase,
  LocalObservationRepository,
  MemoryStorageAdapter,
  recalculatePersonalModel,
} from "../lib/alma-core";
import { stableId } from "../lib/alma-core/engines/math";
import type {
  BaselineRecord,
  DynamicFeature,
  Observation,
  OutputFeedRecord,
  PersonalPattern,
} from "../lib/alma-core";

const USER_ID = "00000000-0000-4000-a000-000000000001";

test("orchestrator turns factual dirty history into a personal model and retires invalidated patterns", async () => {
  const database = new LocalDatabase(new MemoryStorageAdapter(), "analysis-orchestrator");
  const observations = new LocalObservationRepository(database);
  const pressureIds: string[] = [];

  for (let day = 0; day < 16; day += 1) {
    const localDate = isoDate(day);
    const pressureId = stableId("pressure", localDate);
    pressureIds.push(pressureId);
    await observations.upsert(numericObservation({
      id: pressureId,
      definitionId: "pressure",
      localDate,
      hour: 8,
      value: day % 2 === 0 ? 1_030 : 990,
      epistemicStatus: "measured",
      sourceId: "open_meteo",
    }));
    await observations.upsert(numericObservation({
      id: stableId("wellbeing", localDate),
      definitionId: "overall_wellbeing",
      localDate,
      hour: 20,
      value: day % 2 === 0 ? 0.8 : -0.8,
      epistemicStatus: "user_confirmed",
      sourceId: "manual",
    }));
  }

  await observations.upsert(numericObservation({
    id: stableId("seed", "pressure"),
    definitionId: "pressure",
    localDate: "2026-01-17",
    hour: 8,
    value: 5_000,
    epistemicStatus: "user_confirmed",
    sourceId: "seed",
    metadata: { synthetic: true },
  }));
  await observations.upsert(numericObservation({
    id: stableId("inferred", "pressure"),
    definitionId: "pressure",
    localDate: "2026-01-18",
    hour: 8,
    value: 6_000,
    epistemicStatus: "inferred",
    sourceId: "model_inference",
  }));

  const first = await recalculatePersonalModel(database, {
    now: "2026-01-18T23:00:00.000Z",
    userId: USER_ID,
  });
  assert.equal(first.skipped, false);
  assert.equal(first.changed, true);
  assert.ok(first.dynamicFeatures > 0);
  assert.ok(first.patterns > 0);

  const baselines = await database.list<BaselineRecord>("baselines");
  const pressureHabitual = baselines.find((item) =>
    item.definitionId === "pressure" && item.kind === "habitual"
  );
  assert.equal(pressureHabitual?.evidenceCount, 16);
  assert.ok((await database.list<DynamicFeature>("dynamic_features")).length > 0);

  const activePatterns = (await database.list<PersonalPattern>("patterns"))
    .filter((pattern) => !pattern.validTo && pattern.lifecycle !== "no_longer_observed");
  assert.ok(activePatterns.some((pattern) =>
    pattern.targetDefinitionId === "overall_wellbeing" &&
    pattern.factorDefinitionIds.includes("pressure") &&
    (pattern.stage === "repeating_pattern" || pattern.stage === "established_personal_pattern")
  ));
  assert.ok((await database.list<OutputFeedRecord>("output_feed")).length > 0);

  const noOp = await recalculatePersonalModel(database, {
    now: "2026-01-18T23:05:00.000Z",
    userId: USER_ID,
  });
  assert.equal(noOp.skipped, true);
  assert.equal(noOp.changed, false);

  for (const id of pressureIds.slice(2)) {
    await observations.markDeleted(id, "2026-01-19T10:00:00.000Z");
  }
  const afterDeletion = await recalculatePersonalModel(database, {
    now: "2026-01-19T11:00:00.000Z",
    userId: USER_ID,
  });
  assert.equal(afterDeletion.skipped, false);

  const retired = (await database.list<PersonalPattern>("patterns"))
    .filter((pattern) => pattern.factorDefinitionIds.includes("pressure"));
  assert.ok(retired.length > 0);
  assert.ok(retired.every((pattern) =>
    pattern.lifecycle === "no_longer_observed" && Boolean(pattern.validTo)
  ));
  assert.ok((await database.list<OutputFeedRecord>("output_feed"))
    .some((item) => item.insightType === "disappeared_pattern"));
  const baselineHistory = (await database.list<BaselineRecord>("baselines"))
    .filter((item) => item.definitionId === "pressure" && item.kind === "habitual");
  assert.ok(baselineHistory.length > 0);
  assert.ok(baselineHistory.every((item) => !item.deletedAt));
  assert.ok(baselineHistory.some((item) => Boolean(item.validTo)));
});

function numericObservation(input: {
  id: string;
  definitionId: string;
  localDate: string;
  hour: number;
  value: number;
  epistemicStatus: "measured" | "user_confirmed" | "inferred";
  sourceId: string;
  metadata?: Observation<number>["metadata"];
}): Observation<number> {
  const occurredAt = `${input.localDate}T${String(input.hour).padStart(2, "0")}:00:00.000Z`;
  return {
    id: input.id,
    userId: USER_ID,
    version: 1,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    origin: "local",
    definitionId: input.definitionId,
    occurredAt,
    localDate: input.localDate,
    timezone: "UTC",
    timePrecision: "exact_time",
    recordedAt: occurredAt,
    value: input.value,
    source: { sourceId: input.sourceId, sourceRecordId: input.id },
    epistemicStatus: input.epistemicStatus,
    presence: "present",
    confidence: 1,
    metadata: input.metadata,
    isCanonical: true,
    schemaVersion: 2,
  };
}

function isoDate(offset: number) {
  const date = new Date(Date.UTC(2026, 0, 1 + offset, 12));
  return date.toISOString().slice(0, 10);
}
