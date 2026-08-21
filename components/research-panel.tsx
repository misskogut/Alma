"use client";

import { useMemo, useState } from "react";
import { metricDefinition } from "../lib/alma-core";
import type { ResearchQuestRecord } from "../lib/alma-core";

type ResearchDraft = {
  title: string;
  targetDefinitionId: string;
  factorDefinitionIds: string[];
};

const TARGETS = [
  "overall_wellbeing",
  "cognitive_load_response",
  "emotional_load_response",
  "libido",
  "headache",
  "fatigue",
] as const;

const FACTORS = [
  "coffee",
  "food_item",
  "sleep_duration",
  "physical_load_intensity",
  "social_load_intensity",
  "pressure",
  "humidity",
  "menstruation",
] as const;

export default function ResearchPanel({
  quests,
  onStart,
}: {
  quests: ResearchQuestRecord[];
  onStart: (draft: ResearchDraft) => void;
}) {
  const [infoOpen, setInfoOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [target, setTarget] = useState<string>("overall_wellbeing");
  const [factor, setFactor] = useState<string>("pressure");
  const visibleQuests = useMemo(() => quests.filter((quest) => quest.status !== "completed").slice(0, 4), [quests]);
  const hasPressureQuest = quests.some((quest) => quest.targetDefinitionId === "overall_wellbeing" && quest.hypotheses.some((hypothesis) => hypothesis.factorDefinitionIds.includes("pressure")) && quest.status !== "completed");

  function startCustom() {
    const targetLabel = labelFor(target);
    const factorLabel = labelFor(factor).toLocaleLowerCase("ru-RU");
    onStart({
      title: `Меняется ли ${targetLabel.toLocaleLowerCase("ru-RU")} вместе с ${factorLabel}?`,
      targetDefinitionId: target,
      factorDefinitionIds: [factor],
    });
    setCustomOpen(false);
  }

  return <section className="research-panel glass-card" aria-labelledby="research-title">
    <header className="alma-block-header">
      <div><p className="eyebrow">личные вопросы</p><h2 id="research-title">Мои исследования</h2></div>
      <button className="section-info-button" type="button" aria-label="Как работают исследования" aria-expanded={infoOpen} onClick={() => setInfoOpen((current) => !current)}>i</button>
    </header>

    {infoOpen && <aside className="alma-info-popover research-info-popover">
      <button type="button" aria-label="Закрыть" onClick={() => setInfoOpen(false)}>×</button>
      <strong>ALMA проверяет, а не угадывает</strong>
      <p>Исследование начинается с вопроса. Затем ALMA использует уже доступный фон и просит только те короткие уточнения, которые действительно помогают сравнить дни.</p>
      <p>Совпадение не считается причиной: вывод появится только после повторений, сравнений и полезных исключений.</p>
    </aside>}

    {!hasPressureQuest && <article className="research-suggestion">
      <i>?</i><div><small>идея для наблюдения</small><strong>Меняется ли ваше самочувствие вместе с атмосферным давлением?</strong><p>Это вопрос, а не готовый вывод. Погодный фон ALMA уже получает автоматически; иногда понадобится лишь коротко уточнить самочувствие.</p></div>
      <button type="button" onClick={() => onStart({ title: "Меняется ли самочувствие вместе с атмосферным давлением?", targetDefinitionId: "overall_wellbeing", factorDefinitionIds: ["pressure"] })}>начать</button>
    </article>}

    {visibleQuests.length > 0 && <div className="research-list" aria-label="Текущие исследования">
      {visibleQuests.map((quest) => <article key={quest.id}>
        <div className="research-status-row"><span>{statusLabel(quest.status)}</span><b>{Math.round(quest.progress.evidenceCoverage * 100)}%</b></div>
        <h3>{quest.title}</h3>
        <div className="research-progress" aria-label={`Доступность нужных данных ${Math.round(quest.progress.evidenceCoverage * 100)} процентов`}><i style={{ width: `${Math.round(quest.progress.evidenceCoverage * 100)}%` }} /></div>
        <p>{quest.progress.enoughData ? "Данных уже достаточно, чтобы внимательно сверить версии." : quest.progress.knownOpportunities > 0 ? `Есть ${quest.progress.knownOpportunities} ${dayWord(quest.progress.knownOpportunities)} для сравнения. ALMA продолжает наблюдать.` : "Исследование началось. Первый полезный результат появится по мере накопления сравнимых дней."}</p>
      </article>)}
    </div>}

    <button className="research-custom-trigger" type="button" aria-expanded={customOpen} onClick={() => setCustomOpen((current) => !current)}>＋ задать свой вопрос</button>
    {customOpen && <form className="research-form" onSubmit={(event) => { event.preventDefault(); startCustom(); }}>
      <label><span>Что наблюдаем?</span><select value={target} onChange={(event) => setTarget(event.target.value)}>{TARGETS.map((id) => <option key={id} value={id}>{labelFor(id)}</option>)}</select></label>
      <label><span>С чем сравниваем?</span><select value={factor} onChange={(event) => setFactor(event.target.value)}>{FACTORS.map((id) => <option key={id} value={id}>{labelFor(id)}</option>)}</select></label>
      <p>ALMA будет искать повторения в ваших наблюдениях и показывать степень уверенности — без медицинских утверждений.</p>
      <div><button type="button" onClick={() => setCustomOpen(false)}>отмена</button><button type="submit">начать исследование</button></div>
    </form>}
  </section>;
}

function labelFor(definitionId: string) {
  return metricDefinition(definitionId)?.label ?? definitionId;
}

function statusLabel(status: ResearchQuestRecord["status"]) {
  const labels: Record<ResearchQuestRecord["status"], string> = {
    suggested: "предложено",
    active: "идёт наблюдение",
    paused: "на паузе",
    sufficient_result: "можно посмотреть результат",
    completed: "завершено",
    background_monitoring: "наблюдение в фоне",
    reactivated: "наблюдение продолжено",
  };
  return labels[status];
}

function dayWord(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "дня";
  return "дней";
}
