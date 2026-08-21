import assert from "node:assert/strict";
import test from "node:test";
import { defaultProfile } from "../lib/alma";
import { CanonicalPrototypeStore } from "../lib/canonical-prototype-store";
import { LocalDatabase, MemoryStorageAdapter } from "../lib/alma-core";
import type {
  CanonicalEvent,
  Observation,
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
