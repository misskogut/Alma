import type { ZoneKey } from "./alma";

export type SymptomDirection = "negative" | "positive";
export type SymptomCatalogGroup = {
  title: string;
  negative: string[];
  positive: string[];
};

type SymptomZone = ZoneKey;

/**
 * A single, human-readable routing catalogue. A symptom belongs to the area
 * where a person would naturally look for it; it is never shown in an
 * opposite side of a load scale.
 */
export const ZONE_SYMPTOM_CATALOG: Record<SymptomZone, SymptomCatalogGroup[]> = {
  cognitive: [
    { title: "Внимание и мышление", negative: ["Туман в голове", "Труднее сосредоточиться", "Забывчивость", "Растерянность", "Мысленная перегрузка"], positive: ["Ясность в голове", "Собранность", "Легко сосредоточиться", "Быстрое мышление", "Продуктивность"] },
    { title: "Ритм и идеи", negative: ["Сонливость", "Навязчивые мысли", "Головная боль", "Бессонница"], positive: ["Вдохновение", "Творческий поток", "Любопытство", "Удовольствие от задач"] },
  ],
  emotional: [
    { title: "Настроение", negative: ["Грусть", "Тревога", "Раздражительность", "Перепады настроения", "Подавленность"], positive: ["Радость", "Спокойствие", "Эмоциональная устойчивость", "Лёгкость", "Игривость"] },
    { title: "Переживания", negative: ["Апатия", "Эмоциональная чувствительность", "Чувство вины", "Жёсткая самокритика", "Напряжение после конфликта"], positive: ["Уверенность", "Благодарность", "Воодушевление", "Теплота", "Чувство безопасности"] },
  ],
  physical: [
    { title: "Силы и восстановление", negative: ["Усталость", "Мало сил", "Тяжесть в теле", "Сонливость", "Мышечное напряжение"], positive: ["Есть силы", "Бодрость", "Телесная лёгкость", "Восстановление", "Желание двигаться"] },
    { title: "Телесные ощущения", negative: ["Боль в суставах", "Боль в спине", "Головная боль", "Одышка", "Тошнота", "Бессонница"], positive: ["Приятная усталость", "Расслабление", "Сила в теле", "Свободное дыхание", "Хороший сон"] },
  ],
  libido: [
    { title: "Интимное самочувствие", negative: ["Снижение желания", "Сухость во влагалище", "Зуд во влагалище", "Нужен отдых", "Чувствительная грудь"], positive: ["Повышенное желание", "Среднее желание", "Возбуждение", "Чувственность", "Телесная близость"] },
    { title: "Низ живота и цикл", negative: ["Боль внизу живота", "Спазмы внизу живота", "Вздутие живота", "Тошнота", "Боль в спине"], positive: ["Интимные прикосновения", "Оргазм", "Уверенность в теле", "Комфорт в теле"] },
  ],
  social: [
    { title: "Контакт с людьми", negative: ["Социальная усталость", "Напряжение после общения", "Хочется побыть одной", "Неловкость", "Перегруз от людей"], positive: ["Поддержка", "Тёплое общение", "Лёгкость в контакте", "Чувство близости", "Радость от общения"] },
    { title: "Среда и границы", negative: ["Конфликт", "Ощущение одиночества", "Нехватка поддержки", "Трудно сказать «нет»"], positive: ["Понимание", "Безопасность рядом с людьми", "Вдохновляющая встреча", "Можно быть собой"] },
  ],
};

export function symptomsForZone(zone: SymptomZone, direction: SymptomDirection) {
  return ZONE_SYMPTOM_CATALOG[zone].flatMap((group) => group[direction]);
}

export function quickSymptomsForLoad(zone: SymptomZone, value: number) {
  const direction: SymptomDirection = value < 0 ? "negative" : "positive";
  const options = symptomsForZone(zone, direction);
  const intensity = Math.abs(value);
  const offset = intensity >= 67 ? 3 : intensity >= 34 ? 1 : 0;
  return Array.from(new Set([...options.slice(offset, offset + 3), ...options])).slice(0, 3);
}
