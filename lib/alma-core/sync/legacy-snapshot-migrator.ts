import { ALMA_SCHEMA_VERSION, METRIC_REGISTRY_VERSION } from "../data-model/versions";
import type {
  CanonicalEvent,
  JsonValue,
  LegacyUnclassifiedRecord,
  Observation,
  SymptomEpisode,
  UserProfileRecord,
} from "../data-model/types";
import { LocalDatabase } from "./local-database";

type LegacyZone = "cognitive" | "emotional" | "physical" | "libido" | "social";

export interface LegacyZoneValues {
  cognitive: number;
  emotional: number;
  physical: number;
  libido: number;
  social: number;
}

export interface LegacySymptomEntry {
  id: string;
  label: string;
  zone: LegacyZone | "general";
  status: "suggested" | "confirmed" | "dismissed";
  intensity: number;
  suggestedBy: "system" | "user";
}

export interface LegacyLocalSnapshot {
  profile?: Record<string, unknown>;
  states?: Record<string, LegacyZoneValues>;
  symptoms?: Record<string, LegacySymptomEntry[]>;
}

export interface LegacyMigrationReport {
  observations: number;
  events: number;
  symptoms: number;
  preferences: number;
  unclassified: number;
  ignoredSuggestions: number;
  excludedDemoDays: string[];
}

const PROTOTYPE_DEMO_VALUES: LegacyZoneValues = {
  cognitive: -24,
  emotional: -8,
  physical: 18,
  libido: 34,
  social: 6,
};

const RESPONSE_DEFINITIONS: Record<Exclude<LegacyZone, "libido">, string> = {
  cognitive: "cognitive_load_response",
  emotional: "emotional_load_response",
  physical: "physical_load_response",
  social: "social_load_response",
};

const KNOWN_ACTIONS: Record<string, string> = {
  "йога": "yoga",
  "тренировка": "workout",
  "прогулка": "walking",
  "секс": "sex",
  "контрацептив": "medication_intake",
  "приняла контрацептив": "medication_intake",
  "тест на овуляцию": "ovulation_test",
  "тест на беременность": "pregnancy_test",
  "кофе": "coffee",
  "алкоголь": "alcohol",
};

const KNOWN_SYMPTOMS: Record<string, string> = {
  "головная боль": "headache",
  "тошнота": "nausea",
};

export async function migrateLegacyLocalSnapshot(input: {
  snapshot: LegacyLocalSnapshot;
  database: LocalDatabase;
  userId?: string;
  timezone?: string;
  migratedAt?: string;
}): Promise<LegacyMigrationReport> {
  const migratedAt = input.migratedAt ?? new Date().toISOString();
  const timezone = input.timezone ?? "UTC";
  const report: LegacyMigrationReport = {
    observations: 0,
    events: 0,
    symptoms: 0,
    preferences: 0,
    unclassified: 0,
    ignoredSuggestions: 0,
    excludedDemoDays: [],
  };

  if (input.snapshot.profile) {
    const profile: UserProfileRecord = {
      id: input.userId ?? stableUuid("profile:local"),
      userId: input.userId,
      version: 1,
      createdAt: migratedAt,
      updatedAt: migratedAt,
      origin: "migration",
      displayName: "Вы",
      timezone,
      preferences: sanitizeJsonObject(input.snapshot.profile),
      locationPrivacy: "approximate",
      populationOptIn: false,
      schemaVersion: ALMA_SCHEMA_VERSION,
    };
    await input.database.put("profiles", profile, { enqueue: true });
    report.preferences += 1;
  }

  for (const [localDate, values] of Object.entries(input.snapshot.states ?? {})) {
    if (isPrototypeDemoState(values)) {
      report.excludedDemoDays.push(localDate);
      continue;
    }
    for (const zone of ["cognitive", "emotional", "physical", "social"] as const) {
      const observation = legacyObservation({
        userId: input.userId,
        localDate,
        timezone,
        migratedAt,
        definitionId: RESPONSE_DEFINITIONS[zone],
        value: clampSigned(values[zone] / 100),
        legacyKey: `state:${localDate}:${zone}`,
      });
      await input.database.put("observations", observation, { enqueue: true });
      report.observations += 1;
    }
    const libido = legacyObservation({
      userId: input.userId,
      localDate,
      timezone,
      migratedAt,
      definitionId: "libido",
      value: clampSigned(values.libido / 100),
      legacyKey: `state:${localDate}:libido`,
    });
    await input.database.put("observations", libido, { enqueue: true });
    report.observations += 1;
  }

  for (const [localDate, entries] of Object.entries(input.snapshot.symptoms ?? {})) {
    for (const entry of entries) {
      if (entry.status !== "confirmed") {
        if (entry.status === "suggested") report.ignoredSuggestions += 1;
        continue;
      }
      const normalized = normalizeLabel(entry.label);
      if (entry.zone === "general" && KNOWN_ACTIONS[normalized]) {
        const event = legacyEvent({
          userId: input.userId,
          localDate,
          timezone,
          migratedAt,
          definitionId: KNOWN_ACTIONS[normalized],
          legacyKey: `entry:${localDate}:${entry.id}`,
          label: entry.label,
        });
        await input.database.put("events", event, { enqueue: true });
        report.events += 1;
        continue;
      }
      if (entry.zone !== "general" && KNOWN_SYMPTOMS[normalized]) {
        const symptom = legacySymptom({
          userId: input.userId,
          localDate,
          timezone,
          migratedAt,
          definitionId: KNOWN_SYMPTOMS[normalized],
          legacyKey: `entry:${localDate}:${entry.id}`,
          intensity: entry.intensity,
        });
        await input.database.put("symptoms", symptom, { enqueue: true });
        report.symptoms += 1;
        continue;
      }

      const unclassified: LegacyUnclassifiedRecord = {
        id: stableUuid(`unclassified:${localDate}:${entry.id}`),
        userId: input.userId,
        version: 1,
        createdAt: migratedAt,
        updatedAt: migratedAt,
        origin: "migration",
        legacySource: "legacy_local",
        legacyTable: "alma-observation-v2",
        legacyRecordKey: `${localDate}:${entry.id}`,
        localDate,
        rawPayload: sanitizeJson(entry),
        reason: "Не удалось надёжно определить, является запись симптомом или событием.",
        classificationStatus: "pending",
        schemaVersion: ALMA_SCHEMA_VERSION,
      };
      await input.database.put("legacy_unclassified", unclassified, { enqueue: true });
      report.unclassified += 1;
    }
  }
  return report;
}

function legacyObservation(input: {
  userId?: string;
  localDate: string;
  timezone: string;
  migratedAt: string;
  definitionId: string;
  value: number;
  legacyKey: string;
}): Observation<number> {
  return {
    id: stableUuid(input.legacyKey),
    userId: input.userId,
    version: 1,
    createdAt: input.migratedAt,
    updatedAt: input.migratedAt,
    origin: "migration",
    definitionId: input.definitionId,
    localDate: input.localDate,
    timezone: input.timezone,
    timePrecision: "date_only",
    recordedAt: input.migratedAt,
    value: input.value,
    rawValue: input.value * 100,
    unit: "ratio",
    source: { sourceId: "legacy_local", sourceRecordId: input.legacyKey },
    epistemicStatus: "user_confirmed",
    presence: "present",
    confidence: 1,
    metadata: {
      migrationNote: "Перенесено как субъективный отклик; интенсивность нагрузки в старой версии не измерялась.",
      registryVersion: METRIC_REGISTRY_VERSION,
    },
    isCanonical: true,
    schemaVersion: ALMA_SCHEMA_VERSION,
  };
}

function legacyEvent(input: {
  userId?: string;
  localDate: string;
  timezone: string;
  migratedAt: string;
  definitionId: string;
  legacyKey: string;
  label: string;
}): CanonicalEvent {
  return {
    id: stableUuid(input.legacyKey),
    userId: input.userId,
    version: 1,
    createdAt: input.migratedAt,
    updatedAt: input.migratedAt,
    origin: "migration",
    entityDefinitionId: input.definitionId,
    localDate: input.localDate,
    timezone: input.timezone,
    timePrecision: "date_only",
    presence: "present",
    attributes: { legacyLabel: input.label },
    source: { sourceId: "legacy_local", sourceRecordId: input.legacyKey },
    epistemicStatus: "user_confirmed",
    confidence: 1,
    schemaVersion: ALMA_SCHEMA_VERSION,
  };
}

function legacySymptom(input: {
  userId?: string;
  localDate: string;
  timezone: string;
  migratedAt: string;
  definitionId: string;
  legacyKey: string;
  intensity: number;
}): SymptomEpisode {
  return {
    id: stableUuid(input.legacyKey),
    userId: input.userId,
    version: 1,
    createdAt: input.migratedAt,
    updatedAt: input.migratedAt,
    origin: "migration",
    entityDefinitionId: input.definitionId,
    localDate: input.localDate,
    timezone: input.timezone,
    timePrecision: "date_only",
    presence: "present",
    // The old prototype prefilled intensity values. Preserve the original
    // number for review, but do not promote it to confirmed symptom depth.
    attributes: {
      legacyIntensity: input.intensity,
      intensityMigratedAsFact: false,
    },
    source: { sourceId: "legacy_local", sourceRecordId: input.legacyKey },
    epistemicStatus: "user_confirmed",
    confidence: 1,
    provenanceContext: "legacy_local_migration",
    schemaVersion: ALMA_SCHEMA_VERSION,
  };
}

function isPrototypeDemoState(values: LegacyZoneValues) {
  return (Object.keys(PROTOTYPE_DEMO_VALUES) as LegacyZone[]).every(
    (key) => values[key] === PROTOTYPE_DEMO_VALUES[key],
  );
}

function normalizeLabel(value: string) {
  return value.trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
}

function clampSigned(value: number) {
  return Math.max(-1, Math.min(1, value));
}

function sanitizeJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function sanitizeJsonObject(value: Record<string, unknown>): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}

/** Stable valid UUID keeps repeat migration idempotent without server state. */
function stableUuid(value: string) {
  const parts = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    for (let part = 0; part < parts.length; part += 1) {
      parts[part] = Math.imul(parts[part] ^ (code + part * 31), 0x01000193);
    }
  }
  const hex = parts.map((part) => (part >>> 0).toString(16).padStart(8, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
