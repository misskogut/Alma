import assert from "node:assert/strict";
import test from "node:test";
import {
  LocalDatabase,
  LocalObservationRepository,
  MemoryStorageAdapter,
  buildCompetingHypotheses,
  canonicalRecordToSupabaseRow,
  createOutputFeedItem,
  createResearchQuest,
  createSupabaseSyncTransport,
  invalidateAfterDeletion,
  mergeDirtyRanges,
  migrateLegacyLocalSnapshot,
  resolvePlannedEvent,
  synchronize,
  supabaseRowToCanonicalRecord,
} from "../lib/alma-core";
import type {
  BaselineRecord,
  DynamicFeature,
  ForecastRecord,
  InputRequestRecord,
  Observation,
  OutputFeedRecord,
  PersonalExperimentRecord,
  PersonalPattern,
  PersonalToolRecord,
  PlannedEvent,
  ResearchQuestRecord,
  RecommendationRecord,
  StructuredInsight,
  SymptomEpisode,
  SyncTransport,
  SupabaseRecordStore,
  SupabaseRow,
  VersionedRecord,
} from "../lib/alma-core";

test("offline record survives a new LocalDatabase instance", async () => {
  const storage = new MemoryStorageAdapter();
  const first = new LocalDatabase(storage, "offline-test");
  await first.put("records", record("offline-1"));

  const reopened = new LocalDatabase(storage, "offline-test");
  assert.equal((await reopened.get("records", "offline-1"))?.id, "offline-1");
  assert.equal((await reopened.outbox()).length, 1);
});

test("repeated edits keep stable identity and collapse to one outbox entry", async () => {
  const database = new LocalDatabase(new MemoryStorageAdapter(), "dedupe-test");
  await database.put("records", record("same"));
  await database.put("records", {
    ...record("same"),
    updatedAt: "2026-08-22T00:00:00.000Z",
  });
  const saved = await database.get("records", "same");
  assert.equal(saved?.version, 2);
  assert.equal((await database.outbox()).length, 1);
  assert.equal((await database.outbox())[0].recordId, "same");
});

test("multi-day offline sync acknowledges records without duplicates", async () => {
  const database = new LocalDatabase(new MemoryStorageAdapter(), "sync-test");
  await database.put("records", record("day-1"));
  await database.put("records", record("day-2", "2026-08-22T00:00:00.000Z"));
  const server = new Map<string, VersionedRecord>();
  const transport: SyncTransport = {
    async push({ record: pending }) {
      const existing = server.get(pending.id);
      if (existing) return { status: "duplicate", record: existing };
      server.set(pending.id, pending);
      return { status: "accepted", record: pending, serverVersion: pending.version };
    },
    async pull() {
      return {
        changes: [...server.values()].map((remote) => ({
          recordType: "records",
          record: remote,
        })),
        cursor: "2026-08-23T00:00:00.000Z",
      };
    },
  };
  const first = await synchronize(database, transport);
  const second = await synchronize(database, transport);
  assert.equal(first.pushed, 2);
  assert.equal(second.pushed, 0);
  assert.equal(server.size, 2);
  assert.equal((await database.outbox()).length, 0);
});

test("conflicting server copy never silently overwrites an offline correction", async () => {
  const database = new LocalDatabase(new MemoryStorageAdapter(), "conflict-test");
  await database.put("records", {
    ...record("conflict"),
    version: 2,
    updatedAt: "2026-08-22T12:00:00.000Z",
  });
  const transport: SyncTransport = {
    async push() {
      return { status: "conflict", serverVersion: 3, reason: "concurrent_edit" };
    },
    async pull() {
      return { changes: [], cursor: "cursor" };
    },
  };
  const result = await synchronize(database, transport);
  assert.equal(result.conflicts, 1);
  assert.equal((await database.syncMetadata("records", "conflict"))?.syncState, "conflict");
  assert.equal((await database.get("records", "conflict"))?.version, 2);
});

test("soft deletion removes a fact from current queries and queues recalculation", async () => {
  const database = new LocalDatabase(new MemoryStorageAdapter(), "delete-test");
  const repository = new LocalObservationRepository(database);
  await repository.upsert(observation("observation-1"));
  await repository.markDeleted("observation-1", "2026-08-22T12:00:00.000Z");
  assert.equal((await repository.list()).length, 0);
  assert.equal((await repository.list({ includeDeleted: true })).length, 1);
  const dirty = await database.consumeDirtyRanges();
  assert.equal(dirty.length, 1);
  assert.equal(dirty[0].from, "2026-08-21");
  assert.equal(dirty[0].to, "2026-09-20");
  assert.equal((await database.outbox())[0].operation, "delete");
});

test("overlapping dirty ranges merge for incremental recomputation", () => {
  const ranges = mergeDirtyRanges([
    { from: "2026-08-01", to: "2026-08-10", reason: "update", recordIds: ["a"] },
    { from: "2026-08-08", to: "2026-08-20", reason: "delete", recordIds: ["b"] },
  ]);
  assert.deepEqual(ranges, [{
    from: "2026-08-01",
    to: "2026-08-20",
    reason: "update",
    recordIds: ["a", "b"],
  }]);
});

test("legacy snapshot migrates facts safely and excludes prototype seed data", async () => {
  const database = new LocalDatabase(new MemoryStorageAdapter(), "migration-test");
  const report = await migrateLegacyLocalSnapshot({
    database,
    userId: "00000000-0000-4000-a000-000000000001",
    timezone: "Europe/Moscow",
    migratedAt: "2026-08-21T12:00:00.000Z",
    snapshot: {
      profile: {
        cycleLength: 28,
        quickActions: ["Йога"],
        cycleQuickAccessActions: ["Контрацептив"],
      },
      states: {
        "2026-08-20": { cognitive: -24, emotional: -8, physical: 18, libido: 34, social: 6 },
        "2026-08-21": { cognitive: 70, emotional: -30, physical: 40, libido: 20, social: -10 },
      },
      symptoms: {
        "2026-08-21": [
          { id: "yoga", label: "Йога", zone: "general", status: "confirmed", intensity: 0, suggestedBy: "user" },
          { id: "head", label: "Головная боль", zone: "physical", status: "confirmed", intensity: 55, suggestedBy: "system" },
          { id: "suggestion", label: "Туман в голове", zone: "cognitive", status: "suggested", intensity: 40, suggestedBy: "system" },
          { id: "ambiguous", label: "Особое ощущение", zone: "emotional", status: "confirmed", intensity: 20, suggestedBy: "user" },
        ],
      },
    },
  });
  assert.deepEqual(report.excludedDemoDays, ["2026-08-20"]);
  assert.equal(report.observations, 5);
  assert.equal(report.events, 1);
  assert.equal(report.symptoms, 1);
  assert.equal(report.unclassified, 1);
  assert.equal(report.ignoredSuggestions, 1);
  assert.equal((await database.list("profiles")).length, 1);
  assert.equal((await database.list("observations")).length, 5);
  assert.equal((await database.list("events")).length, 1);
  const migratedSymptoms = await database.list<SymptomEpisode>("symptoms");
  assert.equal(migratedSymptoms.length, 1);
  assert.equal(migratedSymptoms[0].intensity, undefined);
  assert.equal(migratedSymptoms[0].attributes?.intensityMigratedAsFact, false);
  assert.equal((await database.list("legacy_unclassified")).length, 1);
  assert.equal(
    (await database.list<Observation<number>>("observations"))
      .find((item) => item.definitionId === "cognitive_load_response")?.value,
    0.7,
  );
});

test("planned event becomes historical evidence only after confirmation", () => {
  const planned = plannedEvent();
  const cancelled = resolvePlannedEvent({
    plannedEvent: planned,
    confirmation: "cancelled",
    confirmedAt: "2026-08-22T10:00:00.000Z",
  });
  assert.equal(cancelled.plannedEvent.status, "confirmed_cancelled");
  assert.equal(cancelled.actualEvent, undefined);

  const happened = resolvePlannedEvent({
    plannedEvent: planned,
    confirmation: "happened",
    confirmedAt: "2026-08-22T10:00:00.000Z",
  });
  assert.equal(happened.plannedEvent.status, "confirmed_happened");
  assert.equal(happened.actualEvent?.epistemicStatus, "user_confirmed");
  assert.equal(happened.actualEvent?.convertedFromPlannedEventId, planned.id);
});

test("deleted source leaves immutable insight copy but marks it as retired evidence", () => {
  const source = record("source");
  const structured: StructuredInsight = {
    id: "insight-1",
    type: "possible_relationship",
    createdAt: "2026-08-21T00:00:00.000Z",
    targetDefinitionId: "headache",
    factorDefinitionIds: ["pressure"],
  };
  const feed = createOutputFeedItem(structured);
  const result = invalidateAfterDeletion({
    records: [source],
    feed: [feed],
    deletedRecordIds: [source.id],
    affectedInsightIds: [feed.id],
    deletedAt: "2026-08-22T00:00:00.000Z",
  });
  assert.equal(result.activeRecords.length, 0);
  assert.equal(result.affectedInsightRecords[0].body, feed.body);
  assert.equal(
    result.affectedInsightRecords[0].sourceDataDeletedAt,
    "2026-08-22T00:00:00.000Z",
  );
});

test("Supabase mapping preserves canonical observation semantics", () => {
  const source = observation("00000000-0000-4000-a000-000000000010");
  const userId = "00000000-0000-4000-a000-000000000001";
  const row = canonicalRecordToSupabaseRow("observations", source, userId);
  const restored = supabaseRowToCanonicalRecord("observations", row) as Observation<number>;
  assert.equal(row.definition_id, "overall_wellbeing");
  assert.equal(row.epistemic_status, "user_confirmed");
  assert.equal(restored.definitionId, source.definitionId);
  assert.equal(restored.value, source.value);
  assert.equal(restored.source.sourceId, "manual");
});

test("Supabase transport protects base version and pulls deterministic changes", async () => {
  const userId = "00000000-0000-4000-a000-000000000001";
  const store = new MemorySupabaseStore();
  const transport = createSupabaseSyncTransport({
    store,
    userId,
    now: () => "2026-08-23T00:00:00.000Z",
  });
  const first = observation("00000000-0000-4000-a000-000000000020");
  const accepted = await transport.push({
    entry: {
      id: `observations:${first.id}`,
      recordType: "observations",
      recordId: first.id,
      operation: "upsert",
      localVersion: 1,
      enqueuedAt: first.createdAt,
      attempts: 0,
    },
    record: first,
  });
  assert.equal(accepted.status, "accepted");

  const changed: Observation<number> = {
    ...first,
    value: -0.4,
    version: 2,
    updatedAt: "2026-08-22T00:00:00.000Z",
  };
  const update = await transport.push({
    entry: {
      id: `observations:${first.id}`,
      recordType: "observations",
      recordId: first.id,
      operation: "upsert",
      localVersion: 2,
      baseServerVersion: 1,
      enqueuedAt: changed.updatedAt,
      attempts: 0,
    },
    record: changed,
  });
  assert.equal(update.status, "accepted");

  const stale = await transport.push({
    entry: {
      id: `observations:${first.id}`,
      recordType: "observations",
      recordId: first.id,
      operation: "upsert",
      localVersion: 2,
      baseServerVersion: 1,
      enqueuedAt: changed.updatedAt,
      attempts: 0,
    },
    record: { ...changed, value: 0.9 } as Observation<number>,
  });
  assert.equal(stale.status, "conflict");
  assert.equal(stale.serverVersion, 2);

  const pull = await transport.pull("2026-08-21T12:00:00.000Z");
  assert.equal(pull.cursor, "2026-08-23T00:00:00.000Z");
  assert.ok(pull.changes.some((item) => item.record.id === first.id));
});

test("Supabase mappings round-trip learned, forecast, research and contact records", () => {
  const userId = "00000000-0000-4000-a000-000000000001";
  const timestamp = "2026-08-21T10:00:00.000Z";
  const planned = plannedEvent();
  const plannedRow = canonicalRecordToSupabaseRow("plannedEvents", planned, userId);
  const plannedRestored = supabaseRowToCanonicalRecord("planned_events", plannedRow) as PlannedEvent;
  assert.equal(plannedRestored.entityDefinitionId, planned.entityDefinitionId);
  assert.equal(plannedRestored.status, "planned");

  const pattern: PersonalPattern = {
    ...record("pattern-roundtrip", timestamp),
    targetDefinitionId: "overall_wellbeing",
    factorDefinitionIds: ["pressure"],
    modifierDefinitionIds: ["sleep_duration"],
    relationshipType: "lagged",
    direction: "up_down",
    typicalLagMinutes: 180,
    lagRangeMinutes: [60, 360],
    evidenceScore: 0.64,
    stage: "repeating_pattern",
    lifecycle: "strengthening",
    evidence: [],
    validFrom: "2026-08-01",
    algorithmVersion: "pattern-test",
  };
  const patternRestored = supabaseRowToCanonicalRecord(
    "patterns",
    canonicalRecordToSupabaseRow("patterns", pattern, userId),
  ) as PersonalPattern;
  assert.deepEqual(patternRestored.lagRangeMinutes, [60, 360]);
  assert.deepEqual(patternRestored.modifierDefinitionIds, ["sleep_duration"]);

  const forecast: ForecastRecord = {
    ...record("forecast-roundtrip", timestamp),
    targetDefinitionId: "overall_wellbeing",
    generatedAt: timestamp,
    windowStart: "2026-08-22T00:00:00.000Z",
    windowEnd: "2026-08-22T23:59:59.999Z",
    probability: 0.68,
    predictedValue: 0.42,
    uncertainty: 0.21,
    positiveContributorIds: ["sleep_duration"],
    negativeContributorIds: ["pressure"],
    compensatorIds: ["walking"],
    relatedPatternIds: [pattern.id],
    outcome: "pending",
    algorithmVersion: "forecast-test",
  };
  const forecastRestored = supabaseRowToCanonicalRecord(
    "forecasts",
    canonicalRecordToSupabaseRow("forecasts", forecast, userId),
  ) as ForecastRecord;
  assert.equal(forecastRestored.probability, 0.68);
  assert.deepEqual(forecastRestored.compensatorIds, ["walking"]);

  const quest: ResearchQuestRecord = createResearchQuest({
    title: "Меняется ли самочувствие вместе с давлением?",
    targetDefinitionId: "overall_wellbeing",
    status: "active",
    createdAt: timestamp,
    hypotheses: buildCompetingHypotheses("overall_wellbeing", [{
      factorDefinitionIds: ["pressure"],
      source: "user_question",
      explanation: "Проверяем личный вопрос.",
    }]),
  });
  const questRestored = supabaseRowToCanonicalRecord(
    "research_quests",
    canonicalRecordToSupabaseRow("research_quests", quest, userId),
  ) as ResearchQuestRecord;
  assert.equal(questRestored.status, "active");
  assert.deepEqual(questRestored.requiredMetricIds.sort(), ["overall_wellbeing", "pressure"]);

  const request: InputRequestRecord = {
    ...record("input-roundtrip", timestamp),
    targetDefinitionId: "overall_wellbeing",
    reasonCode: "research_missing_metric",
    relatedQuestId: quest.id,
    priority: 0.82,
    informationValue: 0.85,
    estimatedEffort: 0.15,
    recurring: true,
    retrospectiveAllowed: false,
    explanation: "Короткий ответ поможет проверить личный вопрос.",
    status: "answered",
    answerObservationId: "observation-answer",
    algorithmVersion: "input-test",
  };
  const requestRestored = supabaseRowToCanonicalRecord(
    "input_requests",
    canonicalRecordToSupabaseRow("input_requests", request, userId),
  ) as InputRequestRecord;
  assert.equal(requestRestored.answerObservationId, "observation-answer");
  assert.equal(requestRestored.relatedQuestId, quest.id);

  const feed: OutputFeedRecord = createOutputFeedItem({
    id: "feed-roundtrip-source",
    type: "possible_relationship",
    createdAt: timestamp,
    targetDefinitionId: "overall_wellbeing",
    factorDefinitionIds: ["pressure"],
    relatedPatternId: pattern.id,
    relatedQuestId: quest.id,
    evidenceScore: 0.46,
  });
  const feedRestored = supabaseRowToCanonicalRecord(
    "output_feed",
    canonicalRecordToSupabaseRow("output_feed", feed, userId),
  ) as OutputFeedRecord;
  assert.equal(feedRestored.body, feed.body);
  assert.equal(feedRestored.relatedQuestId, quest.id);
  assert.deepEqual(feedRestored.structuredPayload.factorDefinitionIds, ["pressure"]);

  const baseline: BaselineRecord = {
    ...record("baseline-roundtrip", timestamp),
    definitionId: "pressure",
    kind: "habitual",
    value: 1_012.5,
    unit: "hPa",
    validFrom: "2026-08-01",
    evidenceCount: 18,
    confidence: 0.81,
    algorithmVersion: "baseline-test",
    userConfirmed: false,
  };
  const baselineRestored = supabaseRowToCanonicalRecord(
    "baselines",
    canonicalRecordToSupabaseRow("baselines", baseline, userId),
  ) as BaselineRecord;
  assert.equal(baselineRestored.value, 1_012.5);
  assert.equal(baselineRestored.evidenceCount, 18);

  const feature: DynamicFeature = {
    ...record("feature-roundtrip", timestamp),
    definitionId: "pressure",
    localDate: "2026-08-21",
    featureType: "deviation_from_baseline",
    value: -0.42,
    windowStart: "2026-08-21T00:00:00.000Z",
    windowEnd: "2026-08-21T23:59:59.999Z",
    basedOnObservationIds: ["00000000-0000-4000-a000-000000000010"],
    algorithmVersion: "feature-test",
  };
  const featureRestored = supabaseRowToCanonicalRecord(
    "dynamicFeatures",
    canonicalRecordToSupabaseRow("dynamicFeatures", feature, userId),
  ) as DynamicFeature;
  assert.equal(featureRestored.featureType, "deviation_from_baseline");
  assert.deepEqual(featureRestored.basedOnObservationIds, feature.basedOnObservationIds);

  const recommendation: RecommendationRecord = {
    ...record("recommendation-roundtrip", timestamp),
    targetDefinitionId: "overall_wellbeing",
    actionDefinitionId: "walking",
    relatedPatternIds: [pattern.id],
    expectedBenefit: 0.62,
    controllability: 0.9,
    effort: 0.25,
    risk: 0.05,
    status: "accepted",
    nonMedical: true,
    algorithmVersion: "recommendation-test",
  };
  const recommendationRestored = supabaseRowToCanonicalRecord(
    "recommendations",
    canonicalRecordToSupabaseRow("recommendations", recommendation, userId),
  ) as RecommendationRecord;
  assert.equal(recommendationRestored.status, "accepted");
  assert.equal(recommendationRestored.actionDefinitionId, "walking");

  const tool: PersonalToolRecord = {
    ...record("tool-roundtrip", timestamp),
    targetDefinitionId: "overall_wellbeing",
    actionDefinitionId: "walking",
    contextFilter: { modifierDefinitionIds: ["sleep_duration"] },
    testCount: 14,
    consistency: 0.78,
    status: "active",
    relatedPatternIds: [pattern.id],
    algorithmVersion: "tool-test",
  };
  const toolRestored = supabaseRowToCanonicalRecord(
    "personalTools",
    canonicalRecordToSupabaseRow("personalTools", tool, userId),
  ) as PersonalToolRecord;
  assert.equal(toolRestored.status, "active");
  assert.deepEqual(toolRestored.contextFilter, tool.contextFilter);

  const experiment: PersonalExperimentRecord = {
    ...record("experiment-roundtrip", timestamp),
    hypothesis: { factorDefinitionIds: ["walking"], relatedPatternId: pattern.id },
    intervention: { actionDefinitionId: "walking", nonMedical: true },
    targetDefinitionId: "overall_wellbeing",
    periodStart: "2026-08-22",
    periodEnd: "2026-08-28",
    baselineWindow: ["2026-08-15", "2026-08-21"],
    observationWindow: ["2026-08-22", "2026-08-28"],
    status: "proposed",
    evidence: [],
    algorithmVersion: "experiment-test",
  };
  const experimentRestored = supabaseRowToCanonicalRecord(
    "experiments",
    canonicalRecordToSupabaseRow("experiments", experiment, userId),
  ) as PersonalExperimentRecord;
  assert.deepEqual(experimentRestored.baselineWindow, experiment.baselineWindow);
  assert.deepEqual(experimentRestored.observationWindow, experiment.observationWindow);
});

function record(id: string, updatedAt = "2026-08-21T00:00:00.000Z"): VersionedRecord {
  return {
    id,
    version: 1,
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt,
    origin: "local",
  };
}

function observation(id: string): Observation<number> {
  return {
    ...record(id),
    definitionId: "overall_wellbeing",
    localDate: "2026-08-21",
    timezone: "UTC",
    timePrecision: "date_only",
    recordedAt: "2026-08-21T00:00:00.000Z",
    value: 0.4,
    source: { sourceId: "manual" },
    epistemicStatus: "user_confirmed",
    isCanonical: true,
    schemaVersion: 2,
  };
}

function plannedEvent(): PlannedEvent {
  return {
    ...record("planned-1"),
    entityDefinitionId: "workout",
    plannedStartAt: "2026-08-22T09:00:00.000Z",
    plannedEndAt: "2026-08-22T10:00:00.000Z",
    timezone: "UTC",
    localDate: "2026-08-22",
    status: "planned",
    source: { sourceId: "calendar" },
    schemaVersion: 2,
  };
}

class MemorySupabaseStore implements SupabaseRecordStore {
  private rows = new Map<string, SupabaseRow>();

  async get(input: {
    table: string;
    userId: string;
    identityColumn: string;
    recordId: string;
  }) {
    return this.rows.get(this.key(input.table, input.recordId)) ?? null;
  }

  async upsert(input: {
    table: string;
    row: SupabaseRow;
    conflictColumn: string;
  }) {
    const identity = String(input.row[input.conflictColumn]);
    const row = { ...input.row };
    this.rows.set(this.key(input.table, identity), row);
    return row;
  }

  async listChanged(input: {
    table: string;
    userId: string;
    after?: string;
    through: string;
  }) {
    return [...this.rows.entries()]
      .filter(([key, row]) =>
        key.startsWith(`${input.table}:`) &&
        row.user_id === input.userId &&
        String(row.updated_at) <= input.through &&
        (!input.after || String(row.updated_at) > input.after),
      )
      .map(([, row]) => row);
  }

  private key(table: string, identity: string) {
    return `${table}:${identity}`;
  }
}
