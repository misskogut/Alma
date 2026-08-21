import { metricDefinition } from "../registry/metric-registry";

export interface RussianEntityForms {
  name: string;
  genitive: string;
  instrumental: string;
  increaseLabel: string;
  decreaseLabel: string;
  appearedLabel: string;
}

const FORMS: Record<string, RussianEntityForms> = {
  overall_wellbeing: forms("самочувствие", "самочувствия", "самочувствием", "становилось лучше", "становилось хуже", "менялось"),
  cognitive_load_intensity: forms("когнитивная нагрузка", "когнитивной нагрузки", "когнитивной нагрузкой", "была выше", "была ниже", "возрастала"),
  cognitive_load_response: forms("отклик на когнитивную нагрузку", "отклика на когнитивную нагрузку", "откликом на когнитивную нагрузку", "был легче", "был тяжелее", "менялся"),
  emotional_load_intensity: forms("эмоциональная нагрузка", "эмоциональной нагрузки", "эмоциональной нагрузкой", "была выше", "была ниже", "возрастала"),
  emotional_load_response: forms("отклик на эмоциональную нагрузку", "отклика на эмоциональную нагрузку", "откликом на эмоциональную нагрузку", "был легче", "был тяжелее", "менялся"),
  physical_load_intensity: forms("физическая нагрузка", "физической нагрузки", "физической нагрузкой", "была выше", "была ниже", "возрастала"),
  physical_load_response: forms("отклик на физическую нагрузку", "отклика на физическую нагрузку", "откликом на физическую нагрузку", "был легче", "был тяжелее", "менялся"),
  social_load_intensity: forms("социальная нагрузка", "социальной нагрузки", "социальной нагрузкой", "была выше", "была ниже", "возрастала"),
  social_load_response: forms("отклик на социальную нагрузку", "отклика на социальную нагрузку", "откликом на социальную нагрузку", "был легче", "был тяжелее", "менялся"),
  libido: forms("либидо", "либидо", "либидо", "было выше", "было ниже", "менялось"),
  headache: forms("головная боль", "головной боли", "головной болью", "появлялась чаще", "появлялась реже", "появлялась"),
  nausea: forms("тошнота", "тошноты", "тошнотой", "появлялась чаще", "появлялась реже", "появлялась"),
  fatigue: forms("усталость", "усталости", "усталостью", "была сильнее", "была слабее", "появлялась"),
  calm: forms("спокойствие", "спокойствия", "спокойствием", "было заметнее", "было слабее", "появлялось"),
  joy: forms("радость", "радости", "радостью", "была заметнее", "была слабее", "появлялась"),
  anxiety: forms("тревога", "тревоги", "тревогой", "была сильнее", "была слабее", "появлялась"),
  clarity: forms("ясность", "ясности", "ясностью", "была выше", "была ниже", "появлялась"),
  sleep_duration: forms("продолжительность сна", "продолжительности сна", "продолжительностью сна", "была больше", "была меньше", "менялась"),
  pressure: forms("атмосферное давление", "атмосферного давления", "атмосферным давлением", "повышалось", "снижалось", "менялось"),
  humidity: forms("влажность", "влажности", "влажностью", "повышалась", "снижалась", "менялась"),
  temperature: forms("температура воздуха", "температуры воздуха", "температурой воздуха", "повышалась", "снижалась", "менялась"),
  coffee: forms("кофе", "кофе", "кофе", "было больше", "было меньше", "появлялось"),
  workout: forms("тренировка", "тренировки", "тренировкой", "была интенсивнее", "была легче", "была отмечена"),
};

export function russianForms(definitionId?: string): RussianEntityForms {
  if (!definitionId) return forms("показатель", "показателя", "показателем", "был выше", "был ниже", "менялся");
  const known = FORMS[definitionId];
  if (known) return known;
  const definition = metricDefinition(definitionId);
  const label = definition?.label?.toLocaleLowerCase("ru-RU") ?? definitionId.replaceAll("_", " ");
  return forms(
    label,
    definition?.display.genitive ?? label,
    definition?.display.instrumental ?? label,
    definition?.display.increaseLabel ?? "был выше",
    definition?.display.decreaseLabel ?? "был ниже",
    "менялся",
  );
}

function forms(
  name: string,
  genitive: string,
  instrumental: string,
  increaseLabel: string,
  decreaseLabel: string,
  appearedLabel: string,
): RussianEntityForms {
  return { name, genitive, instrumental, increaseLabel, decreaseLabel, appearedLabel };
}
