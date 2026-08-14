export type ZoneKey = "cognitive" | "emotional" | "physical" | "libido" | "social";
export type ContextKey = "cycle" | "temperature" | "pressure" | "humidity" | "geomagnetic" | "daylight" | "screenTime" | "nightPhone" | "movement" | "phoneActivity" | "deviceTilt" | "deviceMotion";
export type WaveLayerKey = "internal" | "external" | "behavior";
export type DeviceSignals = {
  enabledAt: string;
  motion: number | null;
  tilt: number | null;
  orientation: "portrait" | "landscape" | "unknown";
  activeSeconds: number;
  visibility: "visible" | "hidden";
};
export type CyclePhase = "menstruation" | "follicular" | "fertile" | "ovulation" | "luteal";
export type CycleMarker = "menstruation" | "fertile" | "ovulation" | null;
export type FertilityContext = { label: string; hint: string; level: "low" | "possible" | "high" };
export type SyncMode = "connecting" | "cloud" | "local";

export type DirectionalCoincidence = {
  observed: number;
  matches: number;
  direction: "рост" | "снижение" | null;
};

/** Compares movement only; this is intentionally not a causal claim. */
export function findDirectionalCoincidence(subject: Array<number | null>, context: Array<number | null>, threshold = 8): DirectionalCoincidence {
  let observed = 0;
  let matches = 0;
  let lastDirection: DirectionalCoincidence["direction"] = null;
  const length = Math.min(subject.length, context.length);
  for (let index = 1; index < length; index += 1) {
    const subjectDelta = subject[index] == null || subject[index - 1] == null ? null : subject[index]! - subject[index - 1]!;
    const contextDelta = context[index] == null || context[index - 1] == null ? null : context[index]! - context[index - 1]!;
    if (subjectDelta == null || contextDelta == null || Math.abs(subjectDelta) < threshold || Math.abs(contextDelta) < threshold) continue;
    observed += 1;
    if (Math.sign(subjectDelta) === Math.sign(contextDelta)) {
      matches += 1;
      lastDirection = subjectDelta > 0 ? "рост" : "снижение";
    }
  }
  return { observed, matches, direction: lastDirection };
}

export type ZoneValues = Record<ZoneKey, number>;

export type AlmaProfile = {
  cycleLength: number;
  periodLength: number;
  lastPeriodStart: string;
  locationName: string;
  latitude: number;
  longitude: number;
  automaticHighlights: boolean;
  /** Personal working set for the cycle-sheet quick actions. */
  quickActions?: string[];
  /** Actions created by the person; they remain available in the catalogue. */
  actionCatalog?: string[];
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
  cognitive: { label: "Когнитивное состояние", short: "когнитивное", color: "#58b8ff", negative: "сильно рассеянно", positive: "очень ясно" },
  emotional: { label: "Эмоциональное состояние", short: "эмоциональное", color: "#ffc64d", negative: "сильно тяжело", positive: "очень легко" },
  physical: { label: "Физическое состояние", short: "физическое", color: "#9d7bff", negative: "сильно истощено", positive: "много сил" },
  libido: { label: "Либидо", short: "либидо", color: "#ff648d", negative: "сильно снижено", positive: "сильно повышено" },
  social: { label: "Социальное состояние", short: "социальное", color: "#57e7c8", negative: "сильно напряжённо", positive: "много поддержки" },
};

export const CONTEXT_META: Record<ContextKey, { label: string; unit: string; color: string }> = {
  cycle: { label: "Цикл", unit: "день", color: "#ff67d9" },
  temperature: { label: "Температура", unit: "°C", color: "#ffae62" },
  pressure: { label: "Давление", unit: "гПа", color: "#68ecd3" },
  humidity: { label: "Влажность", unit: "%", color: "#6eb7ff" },
  geomagnetic: { label: "Геомагнитный фон", unit: "Kp", color: "#d38aff" },
  daylight: { label: "Световой день", unit: "ч", color: "#ffe07b" },
  screenTime: { label: "Экранное время", unit: "ч", color: "#61b6ff" },
  nightPhone: { label: "Ночной телефон", unit: "мин", color: "#8d78ff" },
  movement: { label: "Движение", unit: "мин", color: "#68e3b4" },
  phoneActivity: { label: "Активность телефона", unit: "индекс", color: "#ff9dc8" },
  deviceTilt: { label: "Положение телефона", unit: "°", color: "#b792ff" },
  deviceMotion: { label: "Движение телефона", unit: "индекс", color: "#70e5b8" },
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
  // The fertile window belongs to the late follicular part of the cycle.
  // The day after the estimated ovulation is already luteal, never follicular.
  if (day >= ovulation - 5 && day < ovulation) return "fertile";
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
    // The fertile window is a calendar context inside the late follicular phase,
    // not a separate biological phase.
    fertile: "Фолликулярная фаза",
    ovulation: "Овуляция",
    luteal: "Лютеиновая фаза",
  }[phase];
}

// Fertility is a separate calendar layer, not a fifth biological phase.
// A calendar estimate is deliberately probabilistic and never identifies
// "safe days" or confirms actual ovulation.
export function getFertilityContext(day: number, profile: AlmaProfile): FertilityContext {
  const ovulation = getOvulationDay(profile);
  if (day === ovulation) return { label: "Высокая вероятность беременности", hint: "Расчётный день овуляции", level: "high" };
  if (day >= ovulation - 2 && day < ovulation) return { label: "Высокая вероятность беременности", hint: "Расчётное фертильное окно", level: "high" };
  if (day >= ovulation - 5 && day < ovulation - 2) return { label: "Вероятность беременности возможна", hint: "Расчётное фертильное окно", level: "possible" };
  // Product calendar window: the two days after estimated ovulation stay
  // visually connected to fertility, although the biological phase is luteal.
  if (day >= ovulation + 1 && day <= ovulation + 2) return { label: "Вероятность беременности ещё возможна", hint: "Первые дни после расчётной овуляции", level: "possible" };
  return { label: "Низкая вероятность беременности", hint: day <= profile.periodLength ? "Менструальные дни" : "Вне расчётного фертильного окна", level: "low" };
}

function dayCount(value: number) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return "дня";
  return "дней";
}

export function cycleTimingLabel(day: number, profile: AlmaProfile) {
  const ovulation = getOvulationDay(profile);
  if (day < ovulation) {
    const remaining = ovulation - day;
    return `Овуляция через ${remaining} ${dayCount(remaining)}`;
  }
  if (day === ovulation) return "Расчётная овуляция сегодня";
  const remaining = profile.cycleLength - day + 1;
  return `Месячные через ${remaining} ${dayCount(remaining)}`;
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
  if (value <= -67) return "высокая негативная";
  if (value <= -34) return "средняя негативная";
  if (value < 0) return "лёгкая негативная";
  if (value === 0) return "нейтрально";
  if (value <= 33) return "лёгкая позитивная";
  if (value <= 66) return "средняя позитивная";
  return "высокая позитивная";
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
    quickActions: ["Контрацептив", "Медитация", "Йога", "Дыхательная практика"],
  };
}

function seededZones(cycleDay: number, profile: AlmaProfile, offset: number): ZoneValues {
  // This is only a quiet starting contour for an empty prototype. It represents
  // neither a diagnosis nor a prediction: confirmed personal values replace it.
  const phase = getCyclePhase(cycleDay, profile);
  const ovulation = getOvulationDay(profile);
  const texture = (shift: number) => Math.sin((offset + shift) * .43) * 5;
  const base: ZoneValues = phase === "menstruation"
    ? { cognitive: -22, emotional: -14, physical: -26, libido: -35, social: -8 }
    : phase === "follicular"
      ? { cognitive: -4, emotional: 2, physical: 4, libido: 7, social: 3 }
      : phase === "fertile"
        ? { cognitive: 13, emotional: 11, physical: 12, libido: 26, social: 12 }
        : phase === "ovulation"
          ? { cognitive: 21, emotional: 16, physical: 8, libido: 38, social: 16 }
          : { cognitive: 0, emotional: -4, physical: 0, libido: 1, social: -2 };

  // A small post-ovulation carry-over keeps the default contour fluid rather
  // than making a false hard biological step at one exact date.
  const carry = cycleDay > ovulation && cycleDay <= ovulation + 2 ? 9 : 0;
  return {
    cognitive: clamp(Math.round(base.cognitive + texture(1.2) + carry)),
    emotional: clamp(Math.round(base.emotional + texture(.4) + carry * .65)),
    physical: clamp(Math.round(base.physical + texture(2.1))),
    libido: clamp(Math.round(base.libido + texture(-.7) + carry)),
    social: clamp(Math.round(base.social + texture(1.8))),
  };
}

// The integral is deliberately subjective: only cognitive, emotional and libido
// values participate. External environments and physical activity remain layers,
// never causes of the integral state.
export function provisionalIntegral(values: ZoneValues) {
  return Math.round((values.cognitive + values.emotional + values.libido) / 3);
}

export function buildDayModels(profile: AlmaProfile, stateByDate: Record<string, ZoneValues>, currentIso = todayIso(), radius = TIMELINE_RADIUS) {
  return Array.from({ length: radius * 2 + 1 }, (_, index): DayModel => {
    const offset = index - radius;
    const iso = addDays(currentIso, offset);
    const date = dateFromIso(iso);
    const cycleDay = getCycleDay(iso, profile);
    const zones = stateByDate[iso] ?? seededZones(cycleDay, profile, offset);
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
