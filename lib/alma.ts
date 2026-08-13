export type ZoneKey = "cognitive" | "emotional" | "physical" | "libido" | "social";
export type ContextKey = "cycle" | "temperature" | "pressure" | "humidity" | "geomagnetic" | "daylight";
export type CyclePhase = "menstruation" | "follicular" | "fertile" | "ovulation" | "luteal";
export type CycleMarker = "menstruation" | "fertile" | "ovulation" | null;
export type SyncMode = "connecting" | "cloud" | "local";

export type ZoneValues = Record<ZoneKey, number>;

export type AlmaProfile = {
  cycleLength: number;
  periodLength: number;
  lastPeriodStart: string;
  locationName: string;
  latitude: number;
  longitude: number;
  automaticHighlights: boolean;
};

export type SymptomStatus = "suggested" | "confirmed" | "dismissed";

export type SymptomEntry = {
  id: string;
  label: string;
  zone: ZoneKey | "general";
  status: SymptomStatus;
  intensity: number;
  suggestedBy: "system" | "user";
};

export type DayModel = {
  iso: string;
  date: Date;
  dayOfMonth: number;
  weekday: string;
  cycleDay: number;
  phase: CyclePhase;
  marker: CycleMarker;
  isToday: boolean;
  isForecast: boolean;
  zones: ZoneValues;
  integral: number;
};

export type EnvironmentDay = {
  date: string;
  temperatureC: number | null;
  humidityPct: number | null;
  pressureHpa: number | null;
  weatherCode: number | null;
  windKph: number | null;
  daylightMinutes: number | null;
};

export type EnvironmentPayload = {
  location: { name: string; latitude: number; longitude: number; timezone: string };
  generatedAt: string;
  current: EnvironmentDay & { observedAt: string };
  days: EnvironmentDay[];
  geomagnetic: { kp: number; observedAt: string } | null;
  sources: Array<{ name: string; url: string }>;
};

export const ZONE_META: Record<ZoneKey, { label: string; short: string; color: string; negative: string; positive: string }> = {
  cognitive: { label: "Когнитивное состояние", short: "мозг", color: "#58b8ff", negative: "сильно рассеянно", positive: "очень ясно" },
  emotional: { label: "Эмоциональное состояние", short: "сердце", color: "#ffc64d", negative: "сильно тяжело", positive: "очень легко" },
  physical: { label: "Физическое состояние", short: "тело", color: "#9d7bff", negative: "сильно истощено", positive: "много сил" },
  libido: { label: "Либидо", short: "лотос", color: "#ff648d", negative: "сильно снижено", positive: "сильно повышено" },
  social: { label: "Социальный фон", short: "контакт", color: "#57e7c8", negative: "сильно напряжённо", positive: "много поддержки" },
};

export const CONTEXT_META: Record<ContextKey, { label: string; unit: string; color: string }> = {
  cycle: { label: "Цикл", unit: "день", color: "#ff67d9" },
  temperature: { label: "Температура", unit: "°C", color: "#ffae62" },
  pressure: { label: "Давление", unit: "гПа", color: "#68ecd3" },
  humidity: { label: "Влажность", unit: "%", color: "#6eb7ff" },
  geomagnetic: { label: "Геомагнитный фон", unit: "Kp", color: "#d38aff" },
  daylight: { label: "Световой день", unit: "ч", color: "#ffe07b" },
};

export const DEFAULT_SYMPTOMS: SymptomEntry[] = [
  { id: "focus", label: "Труднее сосредоточиться", zone: "cognitive", status: "suggested", intensity: 42, suggestedBy: "system" },
  { id: "headache", label: "Головная боль", zone: "physical", status: "suggested", intensity: 35, suggestedBy: "system" },
  { id: "sensitivity", label: "Эмоциональная чувствительность", zone: "emotional", status: "suggested", intensity: 48, suggestedBy: "system" },
];

const DAY_MS = 86_400_000;
export const TIMELINE_RADIUS = 180;

export function clamp(value: number, min = -100, max = 100) {
  return Math.max(min, Math.min(max, value));
}

export function dateFromIso(iso: string) {
  return new Date(`${iso}T12:00:00.000Z`);
}

export function isoFromDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, amount: number) {
  const date = dateFromIso(iso);
  date.setUTCDate(date.getUTCDate() + amount);
  return isoFromDate(date);
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string) {
  return Math.round((dateFromIso(toIso).getTime() - dateFromIso(fromIso).getTime()) / DAY_MS);
}

export function getCycleDay(iso: string, profile: AlmaProfile) {
  const elapsed = daysBetween(profile.lastPeriodStart, iso);
  return ((elapsed % profile.cycleLength) + profile.cycleLength) % profile.cycleLength + 1;
}

export function getOvulationDay(profile: AlmaProfile) {
  return Math.max(profile.periodLength + 5, profile.cycleLength - 14);
}

export function getCyclePhase(day: number, profile: AlmaProfile): CyclePhase {
  const ovulation = getOvulationDay(profile);
  if (day <= profile.periodLength) return "menstruation";
  if (day === ovulation) return "ovulation";
  if (day >= ovulation - 4 && day <= ovulation + 1) return "fertile";
  if (day < ovulation - 4) return "follicular";
  return "luteal";
}

export function getCycleMarker(day: number, profile: AlmaProfile): CycleMarker {
  const phase = getCyclePhase(day, profile);
  if (phase === "menstruation" || phase === "fertile" || phase === "ovulation") return phase;
  return null;
}

export function phaseLabel(phase: CyclePhase) {
  return {
    menstruation: "Менструация",
    follicular: "Фолликулярная фаза",
    fertile: "Фертильное окно",
    ovulation: "Овуляция",
    luteal: "Лютеиновая фаза",
  }[phase];
}

export function phaseHint(phase: CyclePhase) {
  return {
    menstruation: "Отмечены дни менструации",
    follicular: "Период до фертильного окна",
    fertile: "Вероятное фертильное окно",
    ovulation: "Расчётный день овуляции",
    luteal: "Период после овуляции",
  }[phase];
}

export function feelingLabel(value: number) {
  if (value <= -70) return "сильно негативно";
  if (value <= -30) return "скорее негативно";
  if (value < -10) return "слегка негативно";
  if (value <= 10) return "нейтрально";
  if (value < 30) return "слегка позитивно";
  if (value < 70) return "скорее позитивно";
  return "сильно позитивно";
}

export function relativeDayLabel(iso: string, currentIso = todayIso()) {
  const delta = daysBetween(currentIso, iso);
  if (delta === 0) return "Сегодня";
  if (delta === -1) return "Вчера";
  if (delta === 1) return "Прогноз +1";
  if (delta < 0) return `${Math.abs(delta)} дн. назад`;
  return `Прогноз +${delta}`;
}

export function defaultProfile(currentIso = todayIso()): AlmaProfile {
  return {
    cycleLength: 28,
    periodLength: 5,
    lastPeriodStart: addDays(currentIso, -13),
    locationName: "Энгельс",
    latitude: 51.4855,
    longitude: 46.1268,
    automaticHighlights: true,
  };
}

function seededZones(offset: number): ZoneValues {
  const wave = (shift: number, amplitude: number, baseline = 0) => clamp(Math.round(baseline + Math.sin((offset + shift) * 0.7) * amplitude));
  return {
    cognitive: wave(1.4, 38, 4),
    emotional: wave(0.4, 34, -2),
    physical: wave(2.2, 27, 8),
    libido: wave(-0.6, 31, 5),
    social: wave(1.9, 25, 2),
  };
}

// The exact product formula remains intentionally provisional. External context is never included.
export function provisionalIntegral(values: ZoneValues) {
  return Math.round((values.cognitive + values.emotional + values.physical + values.libido + values.social) / 5);
}

export function buildDayModels(profile: AlmaProfile, stateByDate: Record<string, ZoneValues>, currentIso = todayIso(), radius = TIMELINE_RADIUS) {
  return Array.from({ length: radius * 2 + 1 }, (_, index): DayModel => {
    const offset = index - radius;
    const iso = addDays(currentIso, offset);
    const date = dateFromIso(iso);
    const cycleDay = getCycleDay(iso, profile);
    const zones = stateByDate[iso] ?? seededZones(offset);
    return {
      iso,
      date,
      dayOfMonth: date.getUTCDate(),
      weekday: new Intl.DateTimeFormat("ru-RU", { weekday: "short", timeZone: "UTC" }).format(date).replace(".", ""),
      cycleDay,
      phase: getCyclePhase(cycleDay, profile),
      marker: getCycleMarker(cycleDay, profile),
      isToday: offset === 0,
      isForecast: offset > 0,
      zones,
      integral: provisionalIntegral(zones),
    };
  });
}

export function defaultState(currentIso = todayIso()): Record<string, ZoneValues> {
  return {
    [currentIso]: { cognitive: -24, emotional: -8, physical: 18, libido: 34, social: 6 },
  };
}

export function formatShortDate(iso: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" }).format(dateFromIso(iso));
}

export function pressureMmHg(hpa: number | null) {
  return hpa == null ? null : Math.round(hpa * 0.750062);
}

export function weatherLabel(code: number | null) {
  if (code == null) return "нет данных";
  if (code === 0) return "ясно";
  if (code <= 3) return "облачно";
  if (code <= 48) return "туман";
  if (code <= 67) return "дождь";
  if (code <= 77) return "снег";
  if (code <= 82) return "ливни";
  if (code <= 86) return "снегопад";
  return "гроза";
}
