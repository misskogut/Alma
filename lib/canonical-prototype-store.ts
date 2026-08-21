import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AlmaProfile,
  DayEvidence,
  EnvironmentPayload,
  MainWaveDatum,
  PatternSummary,
  SymptomEntry,
  TimelineMarker,
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
  buildCompetingHypotheses,
  createInputRequestRecords,
  createResearchQuest,
  createSupabaseSyncTransport,
  markInsightRead,
  metricDefinition,
  migrateLegacyLocalSnapshot,
  rankInputRequests,
  rankOutputFeed,
  requestsFromQuests,
  synchronize,
} from "./alma-core";
import type {
  CanonicalEntity,
  CanonicalEvent,
  ForecastRecord,
  InputRequestRecord,
  JsonValue,
  Observation,
  OutputFeedRecord,
  PersonalPattern,
  PlannedEvent,
  ResearchQuestRecord,
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

const LOAD_INTENSITY_ZONE: Record<string, Exclude<ZoneKey, "libido">> = {
  cognitive_load_intensity: "cognitive",
  emotional_load_intensity: "emotional",
  physical_load_intensity: "physical",
  social_load_intensity: "social",
};

const ZONE_INTENSITY_DEFINITION = Object.fromEntries(
  Object.entries(LOAD_INTENSITY_ZONE).map(([definitionId, zone]) => [zone, definitionId]),
) as Record<Exclude<ZoneKey, "libido">, string>;

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

export type NutritionEntry = {
  id: string;
  definitionId: string;
  label: string;
  localDate: string;
  quantity?: number;
  unit?: string;
  dayPart?: "morning" | "day" | "evening" | "night";
};

export interface PrototypeProjection {
  profile: AlmaProfile;
  hasStoredProfile: boolean;
  states: Record<string, ZoneValues>;
  loadIntensityByDate: Record<string, Partial<Record<Exclude<ZoneKey, "libido">, number>>>;
  mainWaveByDate: Record<string, MainWaveDatum>;
  evidenceByDate: Record<string, DayEvidence>;
  patterns: PatternSummary[];
  nutritionByDate: Record<string, NutritionEntry[]>;
  researchQuests: ResearchQuestRecord[];
  inputRequests: InputRequestRecord[];
  outputFeed: OutputFeedRecord[];
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
    const [profiles, observations, symptoms, events, entities, plannedEvents, forecasts, patterns, researchQuests, inputRequests, outputFeed] = await Promise.all([
      this.database.list<UserProfileRecord>("profiles"),
      this.observations.listCanonical(),
      this.symptoms.list(),
      this.events.list(),
      this.database.list<CanonicalEntity>("entities"),
      this.database.list<PlannedEvent>("planned_events"),
      this.database.list<ForecastRecord>("forecasts"),
      this.database.list<PersonalPattern>("patterns"),
      this.database.list<ResearchQuestRecord>("research_quests"),
      this.database.list<InputRequestRecord>("input_requests"),
      this.database.list<OutputFeedRecord>("output_feed"),
    ]);
    const profile = profiles
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .at(0);
    const states: Record<string, ZoneValues> = {};
    const loadIntensityByDate: PrototypeProjection["loadIntensityByDate"] = {};
    const mainWaveByDate: Record<string, MainWaveDatum> = {};
    const mainWaveRecordedAt = new Map<string, string>();
    const latestObservationAt = new Map<string, string>();
    const evidenceByDate: Record<string, DayEvidence> = {};
    const nutritionByDate: Record<string, NutritionEntry[]> = {};
    const entries: Record<string, SymptomEntry[]> = {};
    const entityLabels = new Map(
      entities.map((entity) => [entity.canonicalKey, entity.userLabel ?? entity.canonicalLabel]),
    );
    const entityKinds = new Map(entities.map((entity) => [entity.canonicalKey, entity.kind]));

    for (const observation of observations) {
      addEvidence(evidenceByDate, observation.localDate, observation.epistemicStatus);
      if (
        observation.definitionId === "overall_wellbeing"
        && typeof observation.value === "number"
        && (observation.epistemicStatus === "user_confirmed" || observation.epistemicStatus === "inferred")
      ) {
        const existing = mainWaveByDate[observation.localDate];
        const value = clampSigned(observation.value);
        const status = observation.epistemicStatus === "inferred" ? "inferred" : "user_confirmed";
        const recordedAt = observation.recordedAt || observation.updatedAt;
        const previousRecordedAt = mainWaveRecordedAt.get(observation.localDate);
        const shouldBecomeAnchor = !existing
          || (existing.status === "inferred" && status === "user_confirmed")
          || (existing.status === status && (!previousRecordedAt || recordedAt >= previousRecordedAt));
        mainWaveByDate[observation.localDate] = {
          value: shouldBecomeAnchor ? value : existing.value,
          status: shouldBecomeAnchor ? status : existing.status,
          dailyMin: existing?.dailyMin == null ? value : Math.min(existing.dailyMin, value),
          dailyMax: existing?.dailyMax == null ? value : Math.max(existing.dailyMax, value),
        };
        if (shouldBecomeAnchor) mainWaveRecordedAt.set(observation.localDate, recordedAt);
        continue;
      }
      const intensityZone = LOAD_INTENSITY_ZONE[observation.definitionId];
      if (intensityZone && typeof observation.value === "number") {
        const key = `${observation.localDate}:${observation.definitionId}`;
        const recordedAt = observation.recordedAt || observation.updatedAt;
        if ((latestObservationAt.get(key) ?? "") > recordedAt) continue;
        latestObservationAt.set(key, recordedAt);
        loadIntensityByDate[observation.localDate] ??= {};
        loadIntensityByDate[observation.localDate][intensityZone] = Math.round(Math.max(0, Math.min(1, observation.value)) * 100);
        continue;
      }
      const zone = DEFINITION_ZONE[observation.definitionId];
      if (zone && typeof observation.value === "number") {
        const key = `${observation.localDate}:${observation.definitionId}`;
        const recordedAt = observation.recordedAt || observation.updatedAt;
        if ((latestObservationAt.get(key) ?? "") > recordedAt) continue;
        latestObservationAt.set(key, recordedAt);
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
      addEvidence(evidenceByDate, symptom.localDate, symptom.epistemicStatus);
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
      if (symptom.presence === "present") {
        addTimelineMarker(evidenceByDate, symptom.localDate, {
          id: symptom.id,
          definitionId: symptom.entityDefinitionId,
          label: definition?.label
            ?? entityLabels.get(symptom.entityDefinitionId)
            ?? attributeLabel(symptom.attributes)
            ?? "Своё ощущение",
          kind: "symptom",
          status: symptom.epistemicStatus === "inferred" ? "inferred" : "factual",
        });
      }
    }

    for (const event of events) {
      for (const localDate of datesCoveredBy(event.localDate, event.occurredEndAt)) {
        addEvidence(evidenceByDate, localDate, event.epistemicStatus);
      }
      const definition = metricDefinition(event.entityDefinitionId);
      const label = definition?.label
        ?? entityLabels.get(event.entityDefinitionId)
        ?? attributeLabel(event.attributes)
        ?? "Своё действие";
      const isNutrition = event.entityDefinitionId !== "medication_intake"
        && (definition?.kind === "intake" || entityKinds.get(event.entityDefinitionId) === "intake");
      if (isNutrition && event.presence === "present") {
        nutritionByDate[event.localDate] ??= [];
        nutritionByDate[event.localDate].push({
          id: event.id,
          definitionId: event.entityDefinitionId,
          label,
          localDate: event.localDate,
          quantity: event.quantity,
          unit: event.unit,
          dayPart: event.attributes?.dayPart as NutritionEntry["dayPart"],
        });
      } else if (!isNutrition) {
        entries[event.localDate] ??= [];
        entries[event.localDate].push({
          id: event.id,
          label,
          zone: "general",
          status: "confirmed",
          intensity: 0,
          suggestedBy: "user",
        });
      }
      if (event.presence === "present") {
        for (const localDate of datesCoveredBy(event.localDate, event.occurredEndAt)) {
          addTimelineMarker(evidenceByDate, localDate, {
            id: event.id,
            definitionId: event.entityDefinitionId,
            label,
            kind: "event",
            status: event.epistemicStatus === "inferred" ? "inferred" : "factual",
          });
        }
      }
    }

    for (const planned of plannedEvents) {
      if (planned.status !== "planned") continue;
      const definition = metricDefinition(planned.entityDefinitionId);
      for (const localDate of datesCoveredBy(planned.localDate, planned.plannedEndAt)) {
        addEvidence(evidenceByDate, localDate, "planned");
        addTimelineMarker(evidenceByDate, localDate, {
          id: planned.id,
          definitionId: planned.entityDefinitionId,
          label: definition?.label ?? entityLabels.get(planned.entityDefinitionId) ?? "Запланированное событие",
          kind: "planned",
          status: "planned",
        });
      }
    }

    for (const forecast of forecasts) {
      if (forecast.outcome !== "pending") continue;
      const definition = metricDefinition(forecast.targetDefinitionId);
      for (const localDate of datesCoveredBy(forecast.windowStart.slice(0, 10), forecast.windowEnd)) {
        addEvidence(evidenceByDate, localDate, "predicted");
        addTimelineMarker(evidenceByDate, localDate, {
          id: forecast.id,
          definitionId: forecast.targetDefinitionId,
          label: definition?.label ?? "Персональный прогноз",
          kind: "forecast",
          status: "predicted",
        });
        if (
          forecast.targetDefinitionId === "overall_wellbeing"
          && typeof forecast.predictedValue === "number"
          && (!mainWaveByDate[localDate] || mainWaveByDate[localDate].status === "predicted")
        ) {
          mainWaveByDate[localDate] = {
            value: clampSigned(forecast.predictedValue),
            status: "predicted",
          };
        }
      }
    }

    return {
      profile: profileFromPreferences(profile?.preferences, fallbackProfile),
      hasStoredProfile: Boolean(profile),
      states,
      loadIntensityByDate,
      mainWaveByDate,
      evidenceByDate,
      patterns: patterns.map((pattern) => ({
        id: pattern.id,
        targetDefinitionId: pattern.targetDefinitionId,
        factorDefinitionIds: pattern.factorDefinitionIds,
        modifierDefinitionIds: pattern.modifierDefinitionIds,
        stage: pattern.stage,
        relationshipType: pattern.relationshipType,
        evidenceScore: pattern.evidenceScore,
        direction: pattern.direction,
        typicalLagMinutes: pattern.typicalLagMinutes,
        cumulativeWindowDays: pattern.cumulativeWindowDays,
        lifecycle: pattern.lifecycle,
      })),
      nutritionByDate,
      researchQuests: [...researchQuests].sort((left, right) => researchQuestOrder(left.status) - researchQuestOrder(right.status) || right.updatedAt.localeCompare(left.updatedAt)),
      inputRequests: inputRequests
        .filter((request) => request.status === "open" && (!request.expiresAt || request.expiresAt > new Date().toISOString()))
        .sort((left, right) => right.priority - left.priority || left.estimatedEffort - right.estimatedEffort),
      outputFeed: rankOutputFeed(outputFeed),
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

  async saveLoadIntensity(input: {
    localDate: string;
    zone: Exclude<ZoneKey, "libido">;
    value: number;
    userId?: string;
  }) {
    const definitionId = ZONE_INTENSITY_DEFINITION[input.zone];
    const id = stableUuid(`observation:${input.localDate}:${definitionId}`);
    const existing = await this.observations.getById(id);
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
      value: Math.max(0, Math.min(1, input.value / 100)),
      rawValue: input.value,
      unit: "ratio",
      source: { sourceId: "manual", sourceRecordId: id },
      epistemicStatus: "user_confirmed",
      presence: "present",
      confidence: 1,
      metadata: { interaction: "prototype_load_intensity" },
      isCanonical: true,
      schemaVersion: ALMA_SCHEMA_VERSION,
    } satisfies Observation<number>);
  }

  async saveOverallWellbeing(input: {
    localDate: string;
    value: number;
    userId?: string;
  }) {
    const definitionId = "overall_wellbeing";
    const id = stableUuid(`observation:${input.localDate}:${definitionId}`);
    const existing = await this.observations.getById(id);
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
      value: clampSigned(input.value / 100),
      rawValue: input.value,
      unit: "ratio",
      source: { sourceId: "manual", sourceRecordId: id },
      epistemicStatus: "user_confirmed",
      presence: "present",
      confidence: 1,
      metadata: { interaction: "overall_wellbeing_anchor" },
      isCanonical: true,
      schemaVersion: ALMA_SCHEMA_VERSION,
    } satisfies Observation<number>);
  }

  async recordMenstruationInterval(input: {
    startDate: string;
    durationDays: number;
    userId?: string;
  }) {
    const durationDays = Math.max(1, Math.min(14, Math.round(input.durationDays)));
    const id = stableUuid(`event:${input.startDate}:menstruation`);
    const existing = await this.events.getById(id);
    const now = new Date().toISOString();
    return this.events.upsert({
      id,
      userId: input.userId,
      version: existing?.version ?? 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      origin: "local",
      entityDefinitionId: "menstruation",
      localDate: input.startDate,
      occurredAt: `${input.startDate}T12:00:00.000Z`,
      occurredEndAt: `${shiftIsoDate(input.startDate, durationDays - 1)}T23:59:59.999Z`,
      timezone: inferTimezone(),
      timePrecision: "date_only",
      presence: "present",
      attributes: { durationDays },
      source: { sourceId: "manual", sourceRecordId: id },
      epistemicStatus: "user_confirmed",
      confidence: 1,
      schemaVersion: ALMA_SCHEMA_VERSION,
    } satisfies CanonicalEvent);
  }

  async saveIntake(input: {
    localDate: string;
    definitionId?: string;
    label: string;
    quantity?: number;
    unit?: string;
    dayPart?: NutritionEntry["dayPart"];
    present?: boolean;
    userId?: string;
  }) {
    const requestedDefinition = input.definitionId ?? "food_item";
    const known = metricDefinition(requestedDefinition);
    const isNamedFoodItem = requestedDefinition === "food_item"
      && normalize(input.label) !== normalize(known?.label ?? "Еда");
    const definitionId = known?.kind === "intake" && !isNamedFoodItem
      ? requestedDefinition
      : `custom_intake_${slug(input.label)}`;
    if (!known || known.kind !== "intake" || isNamedFoodItem) {
      await this.ensureCustomEntity({
        canonicalKey: definitionId,
        label: input.label,
        kind: "intake",
        domain: "nutrition",
        userId: input.userId,
      });
    }
    const now = new Date().toISOString();
    const id = stableUuid(`intake:${input.localDate}:${definitionId}:${now}`);
    return this.events.upsert({
      id,
      userId: input.userId,
      version: 1,
      createdAt: now,
      updatedAt: now,
      origin: "local",
      entityDefinitionId: definitionId,
      localDate: input.localDate,
      occurredAt: input.present === false ? undefined : now,
      timezone: inferTimezone(),
      timePrecision: input.dayPart ? "day_part" : "date_only",
      presence: input.present === false ? "confirmed_absent" : "present",
      quantity: input.quantity,
      unit: input.unit ?? known?.unit,
      attributes: { label: input.label, ...(input.dayPart ? { dayPart: input.dayPart } : {}) },
      source: { sourceId: "manual", sourceRecordId: id },
      epistemicStatus: "user_confirmed",
      confidence: 1,
      schemaVersion: ALMA_SCHEMA_VERSION,
    } satisfies CanonicalEvent);
  }

  async removeIntake(id: string) {
    return this.events.markDeleted(id, new Date().toISOString());
  }

  async startResearch(input: {
    title: string;
    targetDefinitionId: string;
    factorDefinitionIds: string[];
    userId?: string;
  }) {
    const now = new Date().toISOString();
    const hypotheses = buildCompetingHypotheses(input.targetDefinitionId, [{
      factorDefinitionIds: input.factorDefinitionIds,
      source: "user_question",
      explanation: `Проверяем личный вопрос: «${input.title}».`,
    }]);
    const quest: ResearchQuestRecord = {
      ...createResearchQuest({
        title: input.title,
        targetDefinitionId: input.targetDefinitionId,
        hypotheses,
        status: "active",
        createdAt: now,
      }),
      userId: input.userId,
      origin: "local",
    };
    await this.database.put("research_quests", quest);

    const [observations, symptoms, events, openRequests] = await Promise.all([
      this.observations.listCanonical(),
      this.symptoms.list(),
      this.events.list(),
      this.database.list<InputRequestRecord>("input_requests"),
    ]);
    const knownDefinitionIds = new Set([
      ...observations.map((record) => record.definitionId),
      ...symptoms.map((record) => record.entityDefinitionId),
      ...events.map((record) => record.entityDefinitionId),
    ]);
    const existingOpenTargets = new Set(openRequests.filter((request) => request.status === "open").map((request) => request.targetDefinitionId));
    const ranked = rankInputRequests(requestsFromQuests([quest], knownDefinitionIds, new Date(now)))
      .filter((request) => !existingOpenTargets.has(request.targetDefinitionId));
    for (const request of createInputRequestRecords(ranked, now)) {
      await this.database.put("input_requests", { ...request, userId: input.userId, origin: "local" });
    }
    return quest;
  }

  async answerInputRequest(input: {
    requestId: string;
    localDate: string;
    present?: boolean;
    value?: number;
    quantity?: number;
    userId?: string;
  }) {
    const request = await this.database.get<InputRequestRecord>("input_requests", input.requestId);
    if (!request || request.status !== "open") return null;
    const definition = metricDefinition(request.targetDefinitionId);
    const now = new Date().toISOString();
    let answerObservationId: string | undefined;

    if (definition?.kind === "intake") {
      await this.saveIntake({
        localDate: input.localDate,
        definitionId: request.targetDefinitionId,
        label: definition.label,
        quantity: input.quantity,
        unit: definition.unit,
        present: input.present,
        userId: input.userId,
      });
    } else if (definition?.kind === "symptom") {
      const id = stableUuid(`request-answer:${request.id}:${input.localDate}`);
      await this.symptoms.upsert({
        id,
        userId: input.userId,
        version: 1,
        createdAt: now,
        updatedAt: now,
        origin: "local",
        entityDefinitionId: request.targetDefinitionId,
        localDate: input.localDate,
        timezone: inferTimezone(),
        timePrecision: "date_only",
        presence: input.present === false ? "confirmed_absent" : "present",
        source: { sourceId: "manual", sourceRecordId: id },
        epistemicStatus: "user_confirmed",
        confidence: 1,
        provenanceContext: "research_input",
        schemaVersion: ALMA_SCHEMA_VERSION,
      } satisfies SymptomEpisode);
    } else if (definition?.kind === "activity" || definition?.kind === "social_event" || definition?.kind === "cycle_event") {
      const id = stableUuid(`request-answer:${request.id}:${input.localDate}`);
      await this.events.upsert({
        id,
        userId: input.userId,
        version: 1,
        createdAt: now,
        updatedAt: now,
        origin: "local",
        entityDefinitionId: request.targetDefinitionId,
        localDate: input.localDate,
        timezone: inferTimezone(),
        timePrecision: "date_only",
        presence: input.present === false ? "confirmed_absent" : "present",
        source: { sourceId: "manual", sourceRecordId: id },
        epistemicStatus: "user_confirmed",
        confidence: 1,
        schemaVersion: ALMA_SCHEMA_VERSION,
      } satisfies CanonicalEvent);
    } else {
      const id = stableUuid(`request-answer:${request.id}:${input.localDate}`);
      answerObservationId = id;
      await this.observations.upsert({
        id,
        userId: input.userId,
        version: 1,
        createdAt: now,
        updatedAt: now,
        origin: "local",
        definitionId: request.targetDefinitionId,
        localDate: input.localDate,
        timezone: inferTimezone(),
        timePrecision: "date_only",
        recordedAt: now,
        value: input.value ?? (input.present === false ? 0 : 1),
        rawValue: input.value ?? input.present ?? true,
        unit: definition?.unit,
        source: { sourceId: "manual", sourceRecordId: id },
        epistemicStatus: "user_confirmed",
        presence: input.present === false ? "confirmed_absent" : "present",
        confidence: 1,
        metadata: { reasonCode: request.reasonCode, relatedQuestId: request.relatedQuestId ?? null },
        isCanonical: true,
        schemaVersion: ALMA_SCHEMA_VERSION,
      } satisfies Observation<number>);
    }

    return this.database.put("input_requests", {
      ...request,
      userId: input.userId ?? request.userId,
      version: request.version + 1,
      updatedAt: now,
      status: "answered",
      answerObservationId,
    } satisfies InputRequestRecord);
  }

  async markOutputRead(id: string) {
    const item = await this.database.get<OutputFeedRecord>("output_feed", id);
    if (!item) return null;
    return this.database.put("output_feed", markInsightRead(item, new Date().toISOString()));
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

function researchQuestOrder(status: ResearchQuestRecord["status"]) {
  const order: Record<ResearchQuestRecord["status"], number> = {
    active: 0,
    reactivated: 0,
    sufficient_result: 1,
    suggested: 2,
    paused: 3,
    background_monitoring: 4,
    completed: 5,
  };
  return order[status];
}

function addEvidence(
  target: Record<string, DayEvidence>,
  localDate: string,
  status: "measured" | "user_confirmed" | "inferred" | "predicted" | "planned",
) {
  target[localDate] ??= { factualCount: 0, inferredCount: 0, plannedCount: 0, predictedCount: 0, markers: [] };
  if (status === "measured" || status === "user_confirmed") target[localDate].factualCount += 1;
  else if (status === "inferred") target[localDate].inferredCount += 1;
  else if (status === "planned") target[localDate].plannedCount += 1;
  else target[localDate].predictedCount += 1;
}

function addTimelineMarker(
  target: Record<string, DayEvidence>,
  localDate: string,
  marker: TimelineMarker,
) {
  target[localDate] ??= { factualCount: 0, inferredCount: 0, plannedCount: 0, predictedCount: 0, markers: [] };
  if (!target[localDate].markers.some((item) => item.id === marker.id && item.kind === marker.kind)) {
    target[localDate].markers.push(marker);
  }
}

function datesCoveredBy(startDate: string, endAt?: string) {
  const endDate = endAt?.slice(0, 10) ?? startDate;
  const dates: string[] = [];
  let cursor = startDate;
  for (let count = 0; count < 370 && cursor <= endDate; count += 1) {
    dates.push(cursor);
    cursor = shiftIsoDate(cursor, 1);
  }
  return dates;
}

function shiftIsoDate(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
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
