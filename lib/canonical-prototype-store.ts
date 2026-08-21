import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AlmaProfile,
  EnvironmentPayload,
  SymptomEntry,
  ZoneKey,
  ZoneValues,
} from "./alma";
import {
  ALMA_SCHEMA_VERSION,
  BrowserLocalStorageAdapter,
  LocalDatabase,
  LocalEventRepository,
  LocalObservationRepository,
  LocalSymptomRepository,
  METRIC_REGISTRY_VERSION,
  SupabaseJsRecordStore,
  affectedDateRange,
  createSupabaseSyncTransport,
  metricDefinition,
  migrateLegacyLocalSnapshot,
  synchronize,
} from "./alma-core";
import type {
  CanonicalEntity,
  CanonicalEvent,
  JsonValue,
  Observation,
  SymptomEpisode,
  UserProfileRecord,
  VersionedRecord,
} from "./alma-core";
import type { LegacyLocalSnapshot } from "./alma-core";

const CANONICAL_STORAGE_KEY = "alma-canonical-v2";
const MIGRATION_MARKER_ID = "legacy-local-v2";

const ZONE_DEFINITION: Record<ZoneKey, string> = {
  cognitive: "cognitive_load_response",
  emotional: "emotional_load_response",
  physical: "physical_load_response",
  libido: "libido",
  social: "social_load_response",
};

const DEFINITION_ZONE = Object.fromEntries(
  Object.entries(ZONE_DEFINITION).map(([zone, definition]) => [definition, zone]),
) as Record<string, ZoneKey>;

const ACTION_DEFINITIONS: Record<string, string> = {
  "йога": "yoga",
  "тренировка": "workout",
  "прогулка": "walking",
  "секс": "sex",
  "контрацептив": "medication_intake",
  "приняла контрацептив": "medication_intake",
  "тест на овуляцию": "ovulation_test",
  "тест на беременность": "pregnancy_test",
  "алкоголь": "alcohol",
  "кофе": "coffee",
};

export interface PrototypeProjection {
  profile: AlmaProfile;
  hasStoredProfile: boolean;
  states: Record<string, ZoneValues>;
  entries: Record<string, SymptomEntry[]>;
}

export function createBrowserCanonicalStore() {
  return new CanonicalPrototypeStore(
    new LocalDatabase(
      new BrowserLocalStorageAdapter(),
      CANONICAL_STORAGE_KEY,
    ),
  );
}

export class CanonicalPrototypeStore {
  private readonly observations: LocalObservationRepository;
  private readonly events: LocalEventRepository;
  private readonly symptoms: LocalSymptomRepository;
  private syncRun: Promise<void> | null = null;

  constructor(readonly database: LocalDatabase) {
    this.observations = new LocalObservationRepository(database);
    this.events = new LocalEventRepository(database);
    this.symptoms = new LocalSymptomRepository(database);
  }

  async migrateLegacyIfNeeded(snapshot: LegacyLocalSnapshot | null) {
    if (!snapshot) return null;
    if (await this.database.get("migration_state", MIGRATION_MARKER_ID)) return null;
    const report = await migrateLegacyLocalSnapshot({
      snapshot,
      database: this.database,
      timezone: inferTimezone(),
    });
    const now = new Date().toISOString();
    await this.database.put("migration_state", {
      id: MIGRATION_MARKER_ID,
      version: 1,
      createdAt: now,
      updatedAt: now,
      origin: "migration",
    }, { enqueue: false });
    return report;
  }

  async loadProjection(fallbackProfile: AlmaProfile): Promise<PrototypeProjection> {
    const [profiles, observations, symptoms, events, entities] = await Promise.all([
      this.database.list<UserProfileRecord>("profiles"),
      this.observations.listCanonical(),
      this.symptoms.list(),
      this.events.list(),
      this.database.list<CanonicalEntity>("entities"),
    ]);
    const profile = profiles
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .at(0);
    const states: Record<string, ZoneValues> = {};
    const entries: Record<string, SymptomEntry[]> = {};
    const entityLabels = new Map(
      entities.map((entity) => [entity.canonicalKey, entity.userLabel ?? entity.canonicalLabel]),
    );

    for (const observation of observations) {
      const zone = DEFINITION_ZONE[observation.definitionId];
      if (zone && typeof observation.value === "number") {
        states[observation.localDate] ??= emptyZoneValues();
        states[observation.localDate][zone] = Math.round(observation.value * 100);
        continue;
      }
      const definition = metricDefinition(observation.definitionId);
      if (definition?.kind !== "state" || typeof observation.value !== "number") continue;
      entries[observation.localDate] ??= [];
      entries[observation.localDate].push({
        id: observation.id,
        label: definition.label,
        zone: zoneForDomain(definition.domain),
        status: "confirmed",
        intensity: Math.round(Math.abs(observation.value) * 100),
        suggestedBy: "user",
      });
    }

    for (const symptom of symptoms) {
      entries[symptom.localDate] ??= [];
      const definition = metricDefinition(symptom.entityDefinitionId);
      entries[symptom.localDate].push({
        id: symptom.id,
        label: definition?.label
          ?? entityLabels.get(symptom.entityDefinitionId)
          ?? attributeLabel(symptom.attributes)
          ?? "Своё ощущение",
        zone: symptomZone(symptom),
        status: "confirmed",
        intensity: symptom.intensity == null ? 0 : Math.round(symptom.intensity * 100),
        suggestedBy: "user",
      });
    }

    for (const event of events) {
      entries[event.localDate] ??= [];
      const definition = metricDefinition(event.entityDefinitionId);
      entries[event.localDate].push({
        id: event.id,
        label: definition?.label
          ?? entityLabels.get(event.entityDefinitionId)
          ?? attributeLabel(event.attributes)
          ?? "Своё действие",
        zone: "general",
        status: "confirmed",
        intensity: 0,
        suggestedBy: "user",
      });
    }

    return {
      profile: profileFromPreferences(profile?.preferences, fallbackProfile),
      hasStoredProfile: Boolean(profile),
      states,
      entries,
    };
  }

  async saveProfile(profile: AlmaProfile, userId?: string) {
    const current = (await this.database.list<UserProfileRecord>("profiles"))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .at(0);
    const now = new Date().toISOString();
    const record: UserProfileRecord = {
      id: userId ?? current?.id ?? stableUuid("profile:local"),
      userId,
      version: current?.version ?? 1,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
      origin: "local",
      displayName: current?.displayName ?? "Вы",
      timezone: inferTimezone(),
      preferences: toJsonObject(profile),
      locationPrivacy: current?.locationPrivacy ?? "approximate",
      populationOptIn: current?.populationOptIn ?? false,
      schemaVersion: ALMA_SCHEMA_VERSION,
    };
    return this.database.put("profiles", record, {
      baseServerVersion: (await this.database.syncMetadata("profiles", record.id))?.serverVersion,
    });
  }

  async saveZoneResponse(input: {
    localDate: string;
    zone: ZoneKey;
    value: number;
    userId?: string;
  }) {
    const definitionId = ZONE_DEFINITION[input.zone];
    const id = stableUuid(`observation:${input.localDate}:${definitionId}`);
    const existing = await this.observations.getById(id);
    const now = new Date().toISOString();
    const observation: Observation<number> = {
      id,
      userId: input.userId,
      version: existing?.version ?? 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      origin: "local",
      definitionId,
      localDate: input.localDate,
      timezone: inferTimezone(),
      timePrecision: "date_only",
      recordedAt: now,
      value: clampSigned(input.value / 100),
      rawValue: input.value,
      unit: "ratio",
      source: { sourceId: "manual", sourceRecordId: id },
      epistemicStatus: "user_confirmed",
      presence: "present",
      confidence: 1,
      metadata: {
        interaction: "prototype_signed_slider",
        semanticNote: input.zone === "libido"
          ? "Субъективное состояние либидо."
          : "Субъективный отклик на нагрузку; интенсивность нагрузки отдельно не утверждается.",
      },
      isCanonical: true,
      schemaVersion: ALMA_SCHEMA_VERSION,
    };
    return this.observations.upsert(observation);
  }

  async saveEntry(input: {
    localDate: string;
    entry: SymptomEntry;
    userId?: string;
  }) {
    const resolved = resolveFeelingDefinition(input.entry.label);
    if (resolved?.kind === "state") return this.saveStateFeeling(input, resolved.id);
    if (input.entry.zone === "general") return this.saveAction(input);
    return this.saveSymptom(input, resolved?.id);
  }

  async recordEnvironment(environment: EnvironmentPayload, userId?: string) {
    const now = new Date().toISOString();
    const values = [
      ["temperature", environment.current.temperatureC, "°C", "open_meteo"],
      ["humidity", environment.current.humidityPct, "%", "open_meteo"],
      ["pressure", environment.current.pressureHpa, "hPa", "open_meteo"],
      ["wind", environment.current.windKph, "km/h", "open_meteo"],
      ["daylight", environment.current.daylightMinutes, "min", "open_meteo"],
      ["geomagnetic_kp", environment.geomagnetic?.kp ?? null, "Kp", "noaa_swpc"],
    ] as const;
    for (const [definitionId, value, unit, sourceId] of values) {
      if (value == null) continue;
      const id = stableUuid(`environment:${environment.current.date}:${definitionId}:${environment.location.latitude.toFixed(3)}:${environment.location.longitude.toFixed(3)}`);
      const existing = await this.observations.getById(id);
      await this.observations.upsert({
        id,
        userId,
        version: existing?.version ?? 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        origin: "local",
        definitionId,
        occurredAt: definitionId === "geomagnetic_kp"
          ? environment.geomagnetic?.observedAt
          : environment.current.observedAt,
        localDate: environment.current.date,
        timezone: environment.location.timezone,
        timePrecision: "exact_time",
        recordedAt: now,
        value,
        rawValue: value,
        unit,
        source: {
          sourceId,
          sourceRecordId: id,
          adapterVersion: "environment-route-v1",
        },
        epistemicStatus: "measured",
        presence: "present",
        confidence: 0.9,
        metadata: {
          locationName: environment.location.name,
          latitude: environment.location.latitude,
          longitude: environment.location.longitude,
        },
        isCanonical: true,
        schemaVersion: ALMA_SCHEMA_VERSION,
      });
    }
  }

  async sync(client: SupabaseClient, userId: string) {
    if (this.syncRun) return this.syncRun;
    this.syncRun = (async () => {
      await synchronize(
        this.database,
        createSupabaseSyncTransport({
          store: new SupabaseJsRecordStore(client),
          userId,
        }),
      );
    })().finally(() => {
      this.syncRun = null;
    });
    return this.syncRun;
  }

  private async saveAction(input: {
    localDate: string;
    entry: SymptomEntry;
    userId?: string;
  }) {
    const normalized = normalize(input.entry.label);
    const definitionId = ACTION_DEFINITIONS[normalized]
      ?? `custom_action_${slug(input.entry.label)}`;
    const id = isUuid(input.entry.id)
      ? input.entry.id
      : stableUuid(`event:${input.localDate}:${definitionId}`);
    const existing = await this.events.getById(id);
    if (input.entry.status !== "confirmed") {
      if (existing) await this.events.markDeleted(id, new Date().toISOString());
      return;
    }
    if (!ACTION_DEFINITIONS[normalized]) {
      await this.ensureCustomEntity({
        canonicalKey: definitionId,
        label: input.entry.label,
        kind: "activity",
        domain: "activity",
        userId: input.userId,
      });
    }
    const now = new Date().toISOString();
    return this.events.upsert({
      id,
      userId: input.userId,
      version: existing?.version ?? 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      origin: "local",
      entityDefinitionId: definitionId,
      localDate: input.localDate,
      timezone: inferTimezone(),
      timePrecision: "date_only",
      presence: "present",
      attributes: { label: input.entry.label },
      source: { sourceId: "manual", sourceRecordId: id },
      epistemicStatus: "user_confirmed",
      confidence: 1,
      schemaVersion: ALMA_SCHEMA_VERSION,
    } satisfies CanonicalEvent);
  }

  private async saveStateFeeling(
    input: { localDate: string; entry: SymptomEntry; userId?: string },
    definitionId: string,
  ) {
    const id = isUuid(input.entry.id)
      ? input.entry.id
      : stableUuid(`state:${input.localDate}:${definitionId}`);
    const existing = await this.observations.getById(id);
    if (input.entry.status !== "confirmed") {
      if (existing) await this.observations.markDeleted(id, new Date().toISOString());
      return;
    }
    const now = new Date().toISOString();
    return this.observations.upsert({
      id,
      userId: input.userId,
      version: existing?.version ?? 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      origin: "local",
      definitionId,
      localDate: input.localDate,
      timezone: inferTimezone(),
      timePrecision: "date_only",
      recordedAt: now,
      value: Math.max(0, Math.min(1, input.entry.intensity / 100)),
      rawValue: input.entry.intensity,
      unit: "ratio",
      source: { sourceId: "manual", sourceRecordId: id },
      epistemicStatus: "user_confirmed",
      presence: "present",
      confidence: 1,
      metadata: { label: input.entry.label },
      isCanonical: true,
      schemaVersion: ALMA_SCHEMA_VERSION,
    } satisfies Observation<number>);
  }

  private async saveSymptom(
    input: { localDate: string; entry: SymptomEntry; userId?: string },
    knownDefinitionId?: string,
  ) {
    if (input.entry.zone === "general") {
      throw new Error("Действие должно сохраняться через каталог событий.");
    }
    const definitionId = knownDefinitionId
      ?? `custom_symptom_${slug(input.entry.label)}`;
    const id = isUuid(input.entry.id)
      ? input.entry.id
      : stableUuid(`symptom:${input.localDate}:${definitionId}`);
    const existing = await this.symptoms.getById(id);
    if (input.entry.status !== "confirmed") {
      if (existing) await this.symptoms.markDeleted(id, new Date().toISOString());
      return;
    }
    if (!knownDefinitionId) {
      await this.ensureCustomEntity({
        canonicalKey: definitionId,
        label: input.entry.label,
        kind: "symptom",
        domain: "internal",
        userId: input.userId,
      });
    }
    const now = new Date().toISOString();
    return this.symptoms.upsert({
      id,
      userId: input.userId,
      version: existing?.version ?? 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      origin: "local",
      entityDefinitionId: definitionId,
      localDate: input.localDate,
      timezone: inferTimezone(),
      timePrecision: "date_only",
      presence: "present",
      intensity: input.entry.intensity > 0
        ? Math.max(0, Math.min(1, input.entry.intensity / 100))
        : undefined,
      attributes: {
        label: input.entry.label,
        selectedNearDefinitionId: ZONE_DEFINITION[input.entry.zone],
      },
      source: { sourceId: "manual", sourceRecordId: id },
      epistemicStatus: "user_confirmed",
      confidence: 1,
      provenanceContext: input.entry.zone,
      schemaVersion: ALMA_SCHEMA_VERSION,
    } satisfies SymptomEpisode);
  }

  private async ensureCustomEntity(input: {
    canonicalKey: string;
    label: string;
    kind: CanonicalEntity["kind"];
    domain: CanonicalEntity["domain"];
    userId?: string;
  }) {
    const id = stableUuid(`entity:${input.canonicalKey}`);
    const existing = await this.database.get<CanonicalEntity>("entities", id);
    if (existing) return existing;
    const now = new Date().toISOString();
    return this.database.put("entities", {
      id,
      userId: input.userId,
      version: 1,
      createdAt: now,
      updatedAt: now,
      origin: "local",
      canonicalKey: input.canonicalKey,
      canonicalLabel: input.label,
      userLabel: input.label,
      kind: input.kind,
      domain: input.domain,
      custom: true,
      registryVersion: METRIC_REGISTRY_VERSION,
    } satisfies CanonicalEntity);
  }
}

export function parseLegacyPrototypeSnapshot(raw: string | null): LegacyLocalSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LegacyLocalSnapshot;
    if (!parsed.states || !parsed.symptoms) return null;
    return parsed;
  } catch {
    return null;
  }
}

function profileFromPreferences(
  preferences: Record<string, JsonValue> | undefined,
  fallback: AlmaProfile,
): AlmaProfile {
  if (!preferences) return fallback;
  const candidate = preferences as unknown as Partial<AlmaProfile>;
  if (!candidate.lastPeriodStart) return fallback;
  return { ...fallback, ...candidate };
}

function resolveFeelingDefinition(label: string) {
  const normalized = normalize(label);
  const ids = ["headache", "nausea", "fatigue", "calm", "joy", "anxiety", "clarity"];
  return ids
    .map((id) => metricDefinition(id))
    .find((definition) => definition && normalize(definition.label) === normalized);
}

function symptomZone(symptom: SymptomEpisode): ZoneKey {
  const selectedNear = symptom.attributes?.selectedNearDefinitionId;
  if (typeof selectedNear === "string" && DEFINITION_ZONE[selectedNear]) {
    return DEFINITION_ZONE[selectedNear];
  }
  if (
    symptom.provenanceContext === "cognitive" ||
    symptom.provenanceContext === "emotional" ||
    symptom.provenanceContext === "physical" ||
    symptom.provenanceContext === "libido" ||
    symptom.provenanceContext === "social"
  ) return symptom.provenanceContext;
  return "physical";
}

function zoneForDomain(domain: string): ZoneKey {
  if (domain === "activity" || domain === "physiology") return "physical";
  if (domain === "social") return "social";
  return "emotional";
}

function attributeLabel(attributes: Record<string, JsonValue> | undefined) {
  const value = attributes?.label ?? attributes?.legacyLabel;
  return typeof value === "string" ? value : undefined;
}

function emptyZoneValues(): ZoneValues {
  return { cognitive: 0, emotional: 0, physical: 0, libido: 0, social: 0 };
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
}

function slug(value: string) {
  return normalize(value)
    .replace(/[^a-zа-я0-9]+/giu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "custom";
}

function clampSigned(value: number) {
  return Math.max(-1, Math.min(1, value));
}

function inferTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function toJsonObject(value: unknown): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

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
