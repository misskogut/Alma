import { NARRATIVE_TEMPLATE_VERSION } from "../data-model/versions";
import { russianForms } from "./language-dictionary";
import type { NarrativeCopy, StructuredInsight } from "./types";

const NBSP = "\u00a0";

export function renderNarrative(insight: StructuredInsight): NarrativeCopy {
  const target = russianForms(insight.targetDefinitionId);
  const factors = (insight.factorDefinitionIds ?? []).map(russianForms);
  const factor = factors[0] ?? russianForms();
  const modifiers = (insight.modifierDefinitionIds ?? []).map(russianForms);
  const compensators = (insight.compensatorDefinitionIds ?? []).map(russianForms);
  const support = insight.support ?? 0;
  const counterexamples = insight.counterexamples ?? 0;
  const change = insight.factorChange === "decrease" ? factor.decreaseLabel : factor.increaseLabel;
  const uncertainty = uncertaintyNote(insight.stage, insight.evidenceScore);
  const relation = `${capitalize(target.name)} ${target.appearedLabel} в наблюдениях, когда ${factor.name} ${change}`;

  switch (insight.type) {
    case "first_coincidence":
      return copy(
        "Первое совпадение",
        `Сегодня ${target.name} совпала с изменением показателя «${factor.name}». Одного случая недостаточно для вывода — ALMA просто запомнит его и проверит дальше.`,
        `ALMA запомнила первое совпадение: ${target.name} и ${factor.name}.`,
      );
    case "possible_relationship":
      return copy(
        "Возможная связь",
        `${relation}. Пока это возможная связь: она повторилась ${times(support)}, но данных ещё недостаточно, чтобы считать её устойчивой.${counterexampleSentence(counterexamples)}`,
        `В ваших наблюдениях ${target.name} несколько раз совпала с изменением ${factor.genitive}.`,
        uncertainty,
      );
    case "repeated_pattern":
      return copy(
        "Повторяющееся наблюдение",
        `${relation}. Это повторялось ${times(support)}.${counterexampleSentence(counterexamples)} ALMA продолжит проверять связь на новых днях.`,
        `Связь между ${target.instrumental} и ${factor.instrumental} продолжает повторяться.`,
        uncertainty,
      );
    case "established_personal_pattern":
      return copy(
        "Ваш устойчивый паттерн",
        `${relation}. Наблюдение повторилось ${times(support)} из ${times(insight.opportunities ?? support)} и сейчас выглядит устойчивым именно в вашей истории.${counterexampleSentence(counterexamples)}`,
        `В вашей истории устойчиво повторяется связь: ${target.name} и ${factor.name}.`,
        "Это персональная закономерность в наблюдениях, а не доказательство причины.",
      );
    case "counterexample":
    case "exception":
      return copy(
        "Полезное исключение",
        `В этот раз ${factor.name} ${change}, но ожидаемого изменения ${target.genitive} не было. Такой день помогает понять, когда прежняя версия не работает.`,
        "Появился полезный контрпример к одной из версий.",
      );
    case "weakening_pattern":
      return copy(
        "Связь стала слабее",
        `Раньше связь между ${target.instrumental} и ${factor.instrumental} повторялась чаще. В последних наблюдениях стало больше исключений, поэтому ALMA снизила уверенность, но пока не отбросила паттерн.`,
        "Ранее устойчивое наблюдение в последнее время повторяется реже.",
      );
    case "disappeared_pattern":
      return copy(
        "Связь больше не наблюдается",
        `Связь между ${target.instrumental} и ${factor.instrumental}, которая раньше повторялась, в новых данных больше не поддерживается. Старое наблюдение сохранено в истории.`,
        "Ранее замеченная связь больше не повторяется.",
      );
    case "refined_pattern":
      return copy(
        "Наблюдение стало точнее",
        `ALMA уточнила прежнее наблюдение: связь между ${target.instrumental} и ${factor.instrumental} заметнее ${modifierPhrase(modifiers)}. Предыдущая версия сохранена в истории.`,
        "ALMA нашла условие, при котором прежняя связь заметнее.",
      );
    case "lagged_relationship":
      return copy(
        "Связь с задержкой",
        `${relation}. Чаще всего изменение ${target.genitive} появлялось ${formatLag(insight)}. Связь повторилась ${times(support)}.${counterexampleSentence(counterexamples)}`,
        `Изменение ${target.genitive} чаще появлялось ${formatLag(insight)} после изменения ${factor.genitive}.`,
        uncertainty,
      );
    case "cumulative_relationship":
      return copy(
        "Накопительный эффект",
        `${capitalize(target.name)} менялась чаще после того, как ${factor.name} ${change} несколько дней подряд — обычно около ${insight.cumulativeWindowDays ?? 2}${NBSP}${dayWord(insight.cumulativeWindowDays ?? 2)}. ALMA продолжит проверять, важна ли именно длительность.`,
        `Похоже, для ${target.genitive} может быть важна накопленная за несколько дней ${factor.name}.`,
        uncertainty,
      );
    case "inverse_relationship":
      return copy(
        "Противоположное движение",
        `Когда ${factor.name} ${change}, ${target.name} чаще менялась в противоположную сторону. Это описание вашей истории, а не вывод о причине.${counterexampleSentence(counterexamples)}`,
        `${capitalize(target.name)} и ${factor.name} несколько раз двигались в разные стороны.`,
        uncertainty,
      );
    case "interaction":
      return copy(
        "Важна комбинация",
        `${capitalize(target.name)} менялась заметнее, когда одновременно совпадали ${joinNames(factors)}${modifiers.length ? ` и ${joinNames(modifiers)}` : ""}. По отдельности эти условия были связаны слабее.`,
        "Комбинация нескольких условий оказалась информативнее каждого по отдельности.",
        uncertainty,
      );
    case "compensation":
      return copy(
        "Что могло смягчить отклик",
        `В похожих условиях ${target.name} менялась слабее, когда была отмечена ${joinNames(compensators)}. Это персональное наблюдение, которое ещё нужно проверять.`,
        `${capitalize(joinNames(compensators))} могла смягчать отклик в похожих условиях.`,
        uncertainty,
      );
    case "new_hypothesis":
      return copy(
        "Новая версия для проверки",
        `ALMA увидела несколько совпадений между ${target.instrumental} и ${joinNames(factors)}. Пока это только версия: система предложит минимальный дополнительный ввод, если он действительно поможет её проверить.`,
        "Появилась новая версия, которую можно проверить без полного дневника.",
      );
    case "competing_hypotheses":
      return copy(
        "Есть несколько возможных объяснений",
        `Пока данные одинаково поддерживают несколько версий: ${formatHypotheses(insight.hypothesisLabels)}. ALMA не будет выбирать одну раньше времени и попросит только наиболее полезное уточнение.`,
        "Для наблюдения пока есть несколько правдоподобных версий.",
      );
    case "experiment_proposal":
      return copy(
        "Небольшая проверка",
        `Можно аккуратно проверить, меняется ли ${target.name} вместе с ${factor.instrumental}. Это не медицинская рекомендация: вы сами решаете, подходит ли действие и хотите ли его пробовать.`,
        "ALMA предлагает небольшой персональный эксперимент.",
      );
    case "experiment_result":
      return experimentCopy(insight, target.name, factor.instrumental);
    case "forecast":
      return copy(
        "Что вероятно дальше",
        `По вашим устойчивым наблюдениям вероятность события «${target.name}» в выбранном окне сейчас около ${formatProbability(insight.probability)}. Прогноз будет проверен по факту и может ошибаться.`,
        `Сейчас вероятность «${target.name}» — около ${formatProbability(insight.probability)}.`,
        "Будущее значение — прогноз, а не факт.",
      );
    case "forecast_miss":
      return copy(
        "Прогноз не подтвердился",
        `Прогноз для «${target.name}» не совпал с тем, что произошло. ALMA учтёт ошибку при следующей калибровке вместо того, чтобы скрывать её.`,
        "Прогноз не подтвердился — это учтено в модели.",
      );
    case "recommendation":
      return copy(
        "Возможный персональный шаг",
        `В ваших наблюдениях действие «${russianForms(insight.actionDefinitionId).name}» несколько раз совпадало с более комфортным изменением ${target.genitive}. Вы можете попробовать его снова, если это уместно и безопасно для вас.`,
        "Это предложение основано на вашей истории, а не медицинское назначение.",
      );
    case "baseline_change":
      return copy(
        "Ваш привычный уровень изменился",
        `За последнее время привычный уровень показателя «${target.name}» заметно изменился. ALMA начнёт сравнивать новые дни с актуальным уровнем, сохранив прежний период в истории.`,
        `Привычный уровень ${target.genitive} изменился.`,
      );
    case "life_context_change":
      return copy(
        "Похоже, режим изменился",
        "Последние наблюдения выглядят иначе, чем раньше. Возможно, изменился ваш распорядок или жизненный контекст — ALMA попросит подтвердить это и ничего не перепишет автоматически.",
        "Возможно, ваш режим изменился — ALMA попросит подтверждение.",
      );
    case "insufficient_evidence":
      return copy(
        "Пока рано делать вывод",
        `ALMA пока не видит устойчивой связи для «${target.name}». Это нормальный результат: система продолжит наблюдать фон и задаст вопрос только тогда, когда ответ действительно поможет.`,
        "Устойчивой связи пока нет — продолжать полный дневник не нужно.",
      );
  }
}

export function narrativeTemplateVersion() {
  return NARRATIVE_TEMPLATE_VERSION;
}

function copy(title: string, body: string, shortBody: string, uncertaintyNote?: string): NarrativeCopy {
  return { title, body, shortBody, uncertaintyNote };
}

function experimentCopy(insight: StructuredInsight, target: string, factor: string): NarrativeCopy {
  if (insight.experimentResult === "helped") {
    return copy("Результат вашей проверки", `В период эксперимента ${target} чаще менялась в более комфортную сторону вместе с ${factor}. Результат полезен лично для вас, но его стоит проверять дальше.`, "Проверяемое действие совпало с более комфортным откликом.");
  }
  if (insight.experimentResult === "did_not_help") {
    return copy("Результат вашей проверки", `В этот период действие, связанное с ${factor}, не совпало с заметным улучшением ${target}. Это тоже полезный персональный результат.`, "В этой проверке ожидаемого улучшения не было.");
  }
  return copy("Результат вашей проверки", "Данных эксперимента пока недостаточно для уверенного вывода. ALMA сохранит результат как неопределённый, а не будет угадывать.", "Результат пока неопределён.");
}

function counterexampleSentence(count: number) {
  return count > 0 ? ` При этом было ${times(count)} без ожидаемого совпадения.` : "";
}

function times(value: number) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  const word = mod10 === 1 && mod100 !== 11 ? "раз" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "раза" : "раз";
  return `${value}${NBSP}${word}`;
}

function dayWord(value: number) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return "дня";
  return "дней";
}

function formatLag(insight: StructuredInsight) {
  const range = insight.lagRangeMinutes;
  if (range) return rangeToWords(range);
  const minutes = insight.lagMinutes ?? 0;
  if (minutes < 90) return `примерно через ${Math.max(1, Math.round(minutes))}${NBSP}мин`;
  if (minutes < 36 * 60) return `примерно через ${Math.round(minutes / 60)}${NBSP}ч`;
  return `примерно через ${Math.round(minutes / 1440)}${NBSP}${dayWord(Math.round(minutes / 1440))}`;
}

function rangeToWords(range: [number, number]) {
  if (range[1] <= 36 * 60) return `в течение следующих ${Math.max(1, Math.round(range[1] / 60))}${NBSP}ч`;
  return `в течение следующих ${Math.max(1, Math.round(range[1] / 1440))}${NBSP}${dayWord(Math.round(range[1] / 1440))}`;
}

function modifierPhrase(modifiers: ReturnType<typeof russianForms>[]) {
  return modifiers.length ? `при условии «${joinNames(modifiers)}»` : "в определённых условиях";
}

function joinNames(items: ReturnType<typeof russianForms>[]) {
  const names = items.map((item) => item.name);
  if (!names.length) return "дополнительное условие";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} и ${names.at(-1)}`;
}

function formatHypotheses(labels?: string[]) {
  if (!labels?.length) return "несколько факторов";
  return labels.map((label) => `«${label}»`).join(", ");
}

function formatProbability(probability?: number) {
  if (typeof probability !== "number") return "не определена";
  return `${Math.round(Math.max(0, Math.min(1, probability)) * 100)}${NBSP}%`;
}

function uncertaintyNote(stage?: StructuredInsight["stage"], score?: number) {
  if (stage === "established_personal_pattern" && (score ?? 0) >= 0.75) {
    return "Связь устойчива в вашей истории, но сама по себе не доказывает причину.";
  }
  return "Это наблюдаемое совпадение, а не доказательство причины.";
}

function capitalize(value: string) {
  return value.charAt(0).toLocaleUpperCase("ru-RU") + value.slice(1);
}
