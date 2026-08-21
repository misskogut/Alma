import assert from "node:assert/strict";
import test from "node:test";
import { defaultProfile } from "../lib/alma";
import { CanonicalPrototypeStore } from "../lib/canonical-prototype-store";
import { LocalDatabase, MemoryStorageAdapter } from "../lib/alma-core";
import type {
  CanonicalEvent,
  ForecastRecord,
  Observation,
  PersonalPattern,
  PlannedEvent,
  SymptomEpisode,
  UserProfileRecord,
} from "../lib/alma-core";

test("prototype compatibility projects events separately from symptoms", async () => {
  const database = new LocalDatabase(new MemoryStorageAdapter(), "projection-test");
  const store = new CanonicalPrototypeStore(database);
  await store.saveEntry({
    localDate: "2026-08-21",
    entry: {
      id: "quick-yoga",
      label: "Йога",
      zone: "general",
      status: "confirmed",
      intensity: 0,
      suggestedBy: "user",
    },
  });
  await store.saveEntry({
    localDate: "2026-08-21",
    entry: {
      id: "quick-headache",
      label: "Головная боль",
      zone: "physical",
      status: "confirmed",
      intensity: 60,
      suggestedBy: "user",
    },
  });

  const events = await database.list<CanonicalEvent>("events");
  const symptoms = await database.list<SymptomEpisode>("symptoms");
  assert.equal(events.length, 1);
  assert.equal(events[0].entityDefinitionId, "yoga");
  assert.equal(symptoms.length, 1);
  assert.equal(symptoms[0].entityDefinitionId, "headache");

  const projection = await store.loadProjection(defaultProfile("2026-08-21"));
  assert.equal(projection.entries["2026-08-21"].length, 2);
  assert.ok(projection.entries["2026-08-21"].some((item) => item.zone === "general"));
});

test("prototype slider stores only subjective response and never invents load intensity", async () => {
  const database = new LocalDatabase(new MemoryStorageAdapter(), "zone-test");
  const store = new CanonicalPrototypeStore(database);
  await store.saveZoneResponse({
    localDate: "2026-08-21",
    zone: "cognitive",
    value: 64,
  });
  const observations = await database.list<Observation<number>>("observations");
  assert.equal(observations.length, 1);
  assert.equal(observations[0].definitionId, "cognitive_load_response");
  assert.equal(observations[0].value, 0.64);
  assert.equal(
    observations.some((item) => item.definitionId === "cognitive_load_intensity"),
    false,
  );
});

test("load intensity and subjective response remain separate canonical observations", async () => {
  const database = new LocalDatabase(new MemoryStorageAdapter(), "load-assessment-test");
  const store = new CanonicalPrototypeStore(database);
  await store.saveLoadIntensity({ localDate: "2026-08-21", zone: "physical", value: 82 });
  await store.saveZoneResponse({ localDate: "2026-08-21", zone: "physical", value: -36 });

  const observations = await database.list<Observation<number>>("observations");
  assert.deepEqual(
    observations.map((observation) => [observation.definitionId, observation.value]).sort(),
    [["physical_load_intensity", 0.82], ["physical_load_response", -0.36]],
  );
  const projection = await store.loadProjection(defaultProfile("2026-08-21"));
  assert.equal(projection.loadIntensityByDate["2026-08-21"].physical, 82);
  assert.equal(projection.states["2026-08-21"].physical, -36);
});

test("the main wave uses only an overall anchor and never averages load axes", async () => {
  const database = new LocalDatabase(new MemoryStorageAdapter(), "main-wave-anchor-test");
  const store = new CanonicalPrototypeStore(database);
  await store.saveZoneResponse({ localDate: "2026-08-21", zone: "cognitive", value: 100 });
  await store.saveZoneResponse({ localDate: "2026-08-21", zone: "emotional", value: -100 });

  let projection = await store.loadProjection(defaultProfile("2026-08-21"));
  assert.equal(projection.mainWaveByDate["2026-08-21"], undefined);

  await store.saveOverallWellbeing({ localDate: "2026-08-21", value: 35 });
  projection = await store.loadProjection(defaultProfile("2026-08-21"));
  assert.deepEqual(projection.mainWaveByDate["2026-08-21"], {
    value: 0.35,
    status: "user_confirmed",
    dailyMin: 0.35,
    dailyMax: 0.35,
  });
});

test("factual observations override forecasts while planned and forecast beads remain explicit", async () => {
  const database = new LocalDatabase(new MemoryStorageAdapter(), "forecast-projection-test");
  const store = new CanonicalPrototypeStore(database);
  const timestamp = "2026-08-21T10:00:00.000Z";
  await database.put<PlannedEvent>("planned_events", {
    id: "planned-walk",
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    origin: "local",
    entityDefinitionId: "walking",
    plannedStartAt: "2026-08-22T18:00:00.000Z",
    timezone: "UTC",
    localDate: "2026-08-22",
    status: "planned",
    source: { sourceId: "manual" },
    schemaVersion: 2,
  });
  await database.put<ForecastRecord>("forecasts", {
    id: "wellbeing-forecast",
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    origin: "local",
    targetDefinitionId: "overall_wellbeing",
    generatedAt: timestamp,
    windowStart: "2026-08-22T00:00:00.000Z",
    windowEnd: "2026-08-22T23:59:59.999Z",
    probability: 0.7,
    predictedValue: 0.72,
    positiveContributorIds: [],
    negativeContributorIds: [],
    compensatorIds: [],
    relatedPatternIds: [],
    outcome: "pending",
    algorithmVersion: "test",
  });

  let projection = await store.loadProjection(defaultProfile("2026-08-21"));
  assert.equal(projection.mainWaveByDate["2026-08-22"].status, "predicted");
  assert.equal(projection.evidenceByDate["2026-08-22"].plannedCount, 1);
  assert.ok(projection.evidenceByDate["2026-08-22"].markers.some((marker) => marker.kind === "planned"));
  assert.ok(projection.evidenceByDate["2026-08-22"].markers.some((marker) => marker.kind === "forecast"));

  await store.saveOverallWellbeing({ localDate: "2026-08-22", value: -20 });
  projection = await store.loadProjection(defaultProfile("2026-08-21"));
  assert.equal(projection.mainWaveByDate["2026-08-22"].status, "user_confirmed");
  assert.equal(projection.mainWaveByDate["2026-08-22"].value, -0.2);
});

test("menstruation intervals create factual beads for every covered day", async () => {
  const database = new LocalDatabase(new MemoryStorageAdapter(), "interval-event-test");
  const store = new CanonicalPrototypeStore(database);
  await store.recordMenstruationInterval({ startDate: "2026-08-18", durationDays: 3 });
  const projection = await store.loadProjection(defaultProfile("2026-08-21"));
  for (const localDate of ["2026-08-18", "2026-08-19", "2026-08-20"]) {
    assert.ok(projection.evidenceByDate[localDate].markers.some((marker) => marker.definitionId === "menstruation" && marker.status === "factual"));
  }
  assert.equal(projection.evidenceByDate["2026-08-21"], undefined);
});

test("persisted pattern engine results are projected without UI heuristics", async () => {
  const database = new LocalDatabase(new MemoryStorageAdapter(), "pattern-projection-test");
  const store = new CanonicalPrototypeStore(database);
  const timestamp = "2026-08-21T10:00:00.000Z";
  await database.put<PersonalPattern>("patterns", {
    id: "pattern-temperature-headache",
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    origin: "local",
    targetDefinitionId: "headache",
    factorDefinitionIds: ["temperature"],
    modifierDefinitionIds: [],
    relationshipType: "lagged",
    typicalLagMinutes: 180,
    evidenceScore: 0.62,
    stage: "repeating_pattern",
    lifecycle: "strengthening",
    evidence: [],
    validFrom: "2026-08-01",
    algorithmVersion: "test",
  });
  const projection = await store.loadProjection(defaultProfile("2026-08-21"));
  assert.deepEqual(projection.patterns, [{
    id: "pattern-temperature-headache",
    targetDefinitionId: "headache",
    factorDefinitionIds: ["temperature"],
    modifierDefinitionIds: [],
    stage: "repeating_pattern",
    relationshipType: "lagged",
    evidenceScore: 0.62,
    direction: undefined,
    typicalLagMinutes: 180,
    cumulativeWindowDays: undefined,
    lifecycle: "strengthening",
  }]);
});

test("known feelings remain state observations rather than symptom episodes", async () => {
  const database = new LocalDatabase(new MemoryStorageAdapter(), "state-test");
  const store = new CanonicalPrototypeStore(database);
  await store.saveEntry({
    localDate: "2026-08-21",
    entry: {
      id: "fatigue",
      label: "Усталость",
      zone: "physical",
      status: "confirmed",
      intensity: 70,
      suggestedBy: "user",
    },
  });
  const observations = await database.list<Observation<number>>("observations");
  assert.equal(observations[0].definitionId, "fatigue");
  assert.equal((await database.list("symptoms")).length, 0);
});

test("a known state label is not converted into an action by the legacy general zone", async () => {
  const database = new LocalDatabase(new MemoryStorageAdapter(), "voice-state-test");
  const store = new CanonicalPrototypeStore(database);
  await store.saveEntry({
    localDate: "2026-08-21",
    entry: {
      id: "voice-fatigue",
      label: "Усталость",
      zone: "general",
      status: "confirmed",
      intensity: 45,
      suggestedBy: "user",
    },
  });
  assert.equal((await database.list("events")).length, 0);
  assert.equal((await database.list("observations")).length, 1);
});

test("profile quick sets are persisted as canonical preferences", async () => {
  const database = new LocalDatabase(new MemoryStorageAdapter(), "profile-test");
  const store = new CanonicalPrototypeStore(database);
  const profile = {
    ...defaultProfile("2026-08-21"),
    quickActions: ["Йога", "Прогулка"],
    cycleQuickAccessActions: ["Контрацептив"],
  };
  await store.saveProfile(profile);
  const profiles = await database.list<UserProfileRecord>("profiles");
  assert.deepEqual(profiles[0].preferences.quickActions, ["Йога", "Прогулка"]);
  const projection = await store.loadProjection(defaultProfile("2026-08-21"));
  assert.deepEqual(projection.profile.cycleQuickAccessActions, ["Контрацептив"]);
});

test("dismissing a quick action soft-deletes its event", async () => {
  const database = new LocalDatabase(new MemoryStorageAdapter(), "toggle-test");
  const store = new CanonicalPrototypeStore(database);
  const entry = {
    id: "quick-walk",
    label: "Прогулка",
    zone: "general" as const,
    status: "confirmed" as const,
    intensity: 0,
    suggestedBy: "user" as const,
  };
  await store.saveEntry({ localDate: "2026-08-21", entry });
  await store.saveEntry({
    localDate: "2026-08-21",
    entry: { ...entry, status: "dismissed" },
  });
  assert.equal((await database.list("events")).length, 0);
  assert.equal((await database.list("events", true)).length, 1);
});
