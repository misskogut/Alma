import { METRIC_REGISTRY_VERSION } from "../data-model/versions";
import type { MetricDefinition } from "./types";

const manualFirst = ["manual", "voice", "legacy_local", "legacy_cloud", "model_inference"];

export const METRIC_REGISTRY = {
  overall_wellbeing: metric({
    id: "overall_wellbeing",
    label: "Общее самочувствие",
    kind: "state",
    domain: "internal",
    dataForm: "state_rating",
    unit: "ratio",
    valueType: "number",
    normalizationStrategy: "signed_unit",
    baselineStrategy: "comfortable_personal",
    patternEligible: true,
    forecastEligible: true,
    display: { color: "#d987ff", shortLabel: "Самочувствие", increaseLabel: "лучше", decreaseLabel: "хуже" },
    sourcePriority: manualFirst,
  }),
  cognitive_load_intensity: loadIntensity("cognitive", "Когнитивная нагрузка", "#58b8ff"),
  cognitive_load_response: loadResponse("cognitive", "Отклик на когнитивную нагрузку", "#58b8ff"),
  emotional_load_intensity: loadIntensity("emotional", "Эмоциональная нагрузка", "#ffc64d"),
  emotional_load_response: loadResponse("emotional", "Отклик на эмоциональную нагрузку", "#ffc64d"),
  physical_load_intensity: loadIntensity("physical", "Физическая нагрузка", "#9d7bff", "activity"),
  physical_load_response: loadResponse("physical", "Отклик на физическую нагрузку", "#9d7bff", "activity"),
  social_load_intensity: loadIntensity("social", "Социальная нагрузка", "#57e7c8", "social"),
  social_load_response: loadResponse("social", "Отклик на социальную нагрузку", "#57e7c8", "social"),
  libido: metric({
    id: "libido",
    label: "Либидо",
    kind: "state",
    domain: "internal",
    dataForm: "state_rating",
    unit: "ratio",
    valueType: "number",
    normalizationStrategy: "signed_unit",
    baselineStrategy: "comfortable_personal",
    patternEligible: true,
    forecastEligible: true,
    display: { color: "#ff648d", increaseLabel: "выше", decreaseLabel: "ниже" },
    sourcePriority: manualFirst,
  }),
  headache: symptom("headache", "Головная боль"),
  nausea: symptom("nausea", "Тошнота"),
  fatigue: state("fatigue", "Усталость", "internal", "#c7a6ff"),
  calm: state("calm", "Спокойствие", "internal", "#ffc64d"),
  joy: state("joy", "Радость", "internal", "#ffc64d"),
  anxiety: state("anxiety", "Тревога", "internal", "#ffc64d"),
  clarity: state("clarity", "Ясность", "internal", "#58b8ff"),
  workout: event("workout", "Тренировка", "activity", "activity"),
  walking: event("walking", "Прогулка", "activity", "activity"),
  yoga: event("yoga", "Йога", "activity", "activity"),
  sex: event("sex", "Секс", "cycle", "cycle_event"),
  argument: event("argument", "Конфликт", "social", "social_event"),
  social_support: event("social_support", "Поддержка близких", "social", "social_event"),
  coffee: intake("coffee", "Кофе", "чашка"),
  alcohol: intake("alcohol", "Алкоголь", "порция"),
  water: intake("water", "Вода", "мл"),
  food_item: intake("food_item", "Еда", "порция"),
  medication_intake: intake("medication_intake", "Приём препарата", "доза"),
  menstruation: event("menstruation", "Менструация", "cycle", "cycle_event", "interval_event"),
  ovulation_test: event("ovulation_test", "Тест на овуляцию", "cycle", "cycle_event"),
  pregnancy_test: event("pregnancy_test", "Тест на беременность", "cycle", "cycle_event"),
  sleep_interval: event("sleep_interval", "Сон", "physiology", "physiology_signal", "interval_event"),
  sleep_duration: metric({
    id: "sleep_duration",
    label: "Продолжительность сна",
    kind: "physiology_signal",
    domain: "physiology",
    dataForm: "continuous_metric",
    unit: "h",
    valueType: "number",
    normalizationStrategy: "personal_baseline_ratio",
    baselineStrategy: "population_then_personal",
    patternEligible: true,
    forecastEligible: true,
    display: { color: "#8f85ff", increaseLabel: "дольше", decreaseLabel: "короче" },
    sourcePriority: ["manual", "oura", "apple_health", "legacy_local", "model_inference"],
  }),
  temperature: naturalMetric("temperature", "Температура воздуха", "°C", "#ffae62", ["open_meteo"]),
  pressure: naturalMetric("pressure", "Атмосферное давление", "hPa", "#68ecd3", ["open_meteo"]),
  humidity: naturalMetric("humidity", "Влажность", "%", "#6eb7ff", ["open_meteo"]),
  geomagnetic_kp: naturalMetric("geomagnetic_kp", "Геомагнитная активность", "Kp", "#d38aff", ["noaa_swpc"]),
  daylight: naturalMetric("daylight", "Световой день", "min", "#ffe07b", ["open_meteo"]),
  wind: naturalMetric("wind", "Скорость ветра", "km/h", "#74cfd1", ["open_meteo"]),
  screen_time: unavailableDigital("screen_time", "Экранное время", "min", "android_usage"),
  night_phone_use: unavailableDigital("night_phone_use", "Использование телефона ночью", "min", "android_usage"),
  legacy_unclassified: metric({
    id: "legacy_unclassified",
    label: "Не классифицировано после переноса",
    kind: "context",
    domain: "life_context",
    dataForm: "category",
    valueType: "string",
    normalizationStrategy: "none",
    baselineStrategy: "none",
    patternEligible: false,
    forecastEligible: false,
    display: { color: "#77717f" },
    sourcePriority: ["legacy_local", "legacy_cloud"],
  }),
} as const satisfies Record<string, MetricDefinition>;

export type MetricDefinitionId = keyof typeof METRIC_REGISTRY;

export function metricDefinition(id: string): MetricDefinition | undefined {
  return METRIC_REGISTRY[id as MetricDefinitionId];
}

export function listMetricDefinitions() {
  return Object.values(METRIC_REGISTRY);
}

function metric(definition: Omit<MetricDefinition, "allowedAttributes" | "registryVersion" | "available"> & Partial<Pick<MetricDefinition, "allowedAttributes" | "available" | "unavailableReason">>): MetricDefinition {
  return {
    ...definition,
    allowedAttributes: definition.allowedAttributes ?? {},
    registryVersion: METRIC_REGISTRY_VERSION,
    available: definition.available ?? true,
  };
}

function loadIntensity(key: string, label: string, color: string, domain: "internal" | "activity" | "social" = "internal") {
  return metric({
    id: `${key}_load_intensity`, label, kind: "metric", domain, dataForm: "state_rating", unit: "ratio", valueType: "number",
    normalizationStrategy: "unit_interval", baselineStrategy: "comfortable_personal", patternEligible: true, forecastEligible: true,
    display: { color, increaseLabel: "выше", decreaseLabel: "ниже" }, sourcePriority: manualFirst,
  });
}

function loadResponse(key: string, label: string, color: string, domain: "internal" | "activity" | "social" = "internal") {
  return metric({
    id: `${key}_load_response`, label, kind: "state", domain, dataForm: "state_rating", unit: "ratio", valueType: "number",
    normalizationStrategy: "signed_unit", baselineStrategy: "comfortable_personal", patternEligible: true, forecastEligible: true,
    display: { color, increaseLabel: "переносится легче", decreaseLabel: "переносится тяжелее" }, sourcePriority: manualFirst,
  });
}

function symptom(id: string, label: string) {
  return metric({
    id, label, kind: "symptom", domain: "internal", dataForm: "symptom_episode", valueType: "object",
    normalizationStrategy: "none", baselineStrategy: "none", patternEligible: true, forecastEligible: true,
    allowedAttributes: { intensity: "number", location: "string", durationMinutes: "number", character: "string" },
    display: { color: "#ff759c" }, sourcePriority: manualFirst,
  });
}

function state(id: string, label: string, domain: "internal", color: string) {
  return metric({
    id, label, kind: "state", domain, dataForm: "state_rating", unit: "ratio", valueType: "number",
    normalizationStrategy: "unit_interval", baselineStrategy: "comfortable_personal", patternEligible: true, forecastEligible: true,
    display: { color }, sourcePriority: manualFirst,
  });
}

function event(id: string, label: string, domain: "activity" | "social" | "cycle" | "physiology", kind: "activity" | "social_event" | "cycle_event" | "physiology_signal", dataForm: "point_event" | "interval_event" = "point_event") {
  return metric({
    id, label, kind, domain, dataForm, valueType: "object", normalizationStrategy: "none", baselineStrategy: "none",
    patternEligible: true, forecastEligible: true, display: { color: domain === "activity" ? "#57e7c8" : "#ff648d" }, sourcePriority: manualFirst,
  });
}

function intake(id: string, label: string, unit: string) {
  return metric({
    id, label, kind: "intake", domain: "nutrition", dataForm: "point_event", unit, valueType: "object",
    normalizationStrategy: "none", baselineStrategy: "none", patternEligible: true, forecastEligible: true,
    display: { color: "#ffad66" }, sourcePriority: manualFirst,
  });
}

function naturalMetric(id: string, label: string, unit: string, color: string, sourcePriority: string[]) {
  return metric({
    id, label, kind: "natural_signal", domain: "natural_environment", dataForm: "continuous_metric", unit, valueType: "number",
    normalizationStrategy: "personal_baseline_zscore", baselineStrategy: "rolling_personal", patternEligible: true, forecastEligible: true,
    display: { color, increaseLabel: "выше", decreaseLabel: "ниже" }, sourcePriority,
  });
}

function unavailableDigital(id: string, label: string, unit: string, sourceId: string) {
  return metric({
    id, label, kind: "digital_signal", domain: "digital_environment", dataForm: "continuous_metric", unit, valueType: "number",
    normalizationStrategy: "personal_baseline_zscore", baselineStrategy: "rolling_personal", patternEligible: true, forecastEligible: true,
    display: { color: "#6ba8ff" }, sourcePriority: [sourceId], available: false,
    unavailableReason: "Источник требует нативного разрешения и пока не подключён.",
  });
}
