"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { ZONE_META, clamp, type SymptomEntry, type ZoneKey, type ZoneValues } from "../lib/alma";
import { bodySilhouetteAsset } from "../lib/visual-assets";
import { controlAssets } from "../lib/control-assets";

type ActiveControl = "cognitive" | "emotional" | "libido";
type Props = { values: ZoneValues; symptoms: SymptomEntry[]; symptomHistory: SymptomEntry[]; activeZone: ZoneKey | null; onSelect: (zone: ZoneKey) => void; onBeginAdjustment: (zone: ZoneKey) => void; onChange: (zone: ZoneKey, value: number) => void; onCommit: () => void; onAddQuickSymptom: (symptom: SymptomEntry) => void; onUpdateQuickSymptom: (symptom: SymptomEntry) => void; };

const zones: ActiveControl[] = ["cognitive", "emotional", "libido"];
type Band = "negativeLight" | "negativeMedium" | "negativeHigh" | "positiveLight" | "positiveMedium" | "positiveHigh";
type SuggestionSet = { primary: string[]; more: string[] };
type CatalogGroup = { title: string; negative: string[]; positive: string[] };
const suggested: Record<ActiveControl, Record<Band, SuggestionSet>> = {
  cognitive: {
    negativeLight: { primary: ["Легче отвлекаться", "Нужен более медленный старт", "Небольшая ментальная усталость"], more: ["Сложнее переключаться", "Меньше интереса к задачам", "Хочется паузы", "Замедленный темп", "Труднее собраться"] },
    negativeMedium: { primary: ["Труднее сосредоточиться", "Туман в голове", "Забывчивость"], more: ["Сложнее принимать решения", "Ошибки в мелочах", "Мысли расползаются", "Многое ускользает", "Нужна тишина"] },
    negativeHigh: { primary: ["Сильная ментальная усталость", "Очень трудно держать фокус", "Перегруз от информации"], more: ["Трудно воспринимать новое", "Хочется отменить задачи", "Ощущение хаоса в голове", "Тяжело формулировать мысли", "Нужен полный отдых"] },
    positiveLight: { primary: ["Чуть больше ясности", "Легче начать задачу", "Больше интереса"], more: ["Собранность", "Спокойный темп мыслей", "Легче планировать", "Внимательность к деталям", "Есть ресурс думать"] },
    positiveMedium: { primary: ["Устойчивый фокус", "Ясность мыслей", "Легче принимать решения"], more: ["Хорошая память", "Легко структурировать", "Продуктивный темп", "Быстрое переключение", "Интерес к сложному"] },
    positiveHigh: { primary: ["Глубокая концентрация", "Быстрые решения", "Много идей"], more: ["Очень высокая продуктивность", "Легко учиться", "Сильная вовлечённость", "Хочется создавать", "Ясно вижу приоритеты"] },
  },
  emotional: {
    negativeLight: { primary: ["Небольшая чувствительность", "Хочется больше тишины", "Чуть меньше терпения"], more: ["Легко задеться", "Нужна поддержка", "Хочется побыть одной", "Не хочется спешки", "Фон немного тяжёлый"] },
    negativeMedium: { primary: ["Внутреннее напряжение", "Раздражительность", "Тревожный фон"], more: ["Перепады настроения", "Грусть", "Эмоциональная усталость", "Хочется уединиться", "Сложно расслабиться"] },
    negativeHigh: { primary: ["Сильное напряжение", "Очень высокая чувствительность", "Ощущение подавленности"], more: ["Трудно справляться с эмоциями", "Слёзы близко", "Сильная тревога", "Жёсткая самокритика", "Нужна бережность"] },
    positiveLight: { primary: ["Больше спокойствия", "Тёплый фон", "Лёгкость в общении"], more: ["Чуть больше радости", "Есть терпение", "Чувствую устойчивость", "Хочется контакта", "Больше принятия"] },
    positiveMedium: { primary: ["Эмоциональная устойчивость", "Радость", "Внутреннее спокойствие"], more: ["Много тепла", "Легко общаться", "Есть уверенность", "Хорошее настроение", "Чувствую поддержку"] },
    positiveHigh: { primary: ["Сильный подъём", "Много радости", "Очень тёплый эмоциональный фон"], more: ["Воодушевление", "Игривость", "Хочется делиться", "Сильная уверенность", "Много благодарности"] },
  },
  libido: {
    negativeLight: { primary: ["Меньше интереса к близости", "Хочется больше личного пространства", "Спокойный телесный фон"], more: ["Нужна нежность без секса", "Хочется быть одной", "Меньше чувственности", "Телу нужен отдых", "Не хочется инициативы"] },
    negativeMedium: { primary: ["Сниженное желание", "Телесная усталость", "Не хочется контакта"], more: ["Нужна близость с собой", "Не хочется прикосновений", "Сложнее расслабиться", "Сниженная чувственность", "Хочется сна и покоя"] },
    negativeHigh: { primary: ["Нет ресурса на близость", "Сильная телесная усталость", "Очень нужно уединение"], more: ["Контакт сейчас перегружает", "Хочется дистанции", "Тело просит восстановления", "Не до секса", "Нужна безопасность и покой"] },
    positiveLight: { primary: ["Больше чувственности", "Есть интерес к близости", "Хочется нежности"], more: ["Приятно быть в теле", "Хочется прикосновений", "Больше телесного тепла", "Лёгкая игривость", "Есть желание контакта"] },
    positiveMedium: { primary: ["Повышенное желание", "Тяга к близости", "Больше телесной энергии"], more: ["Выраженная чувственность", "Хочется инициативы", "Приятно флиртовать", "Хочется секса", "Уверенность в теле"] },
    positiveHigh: { primary: ["Сильное желание", "Много телесной энергии", "Очень высокая чувственность"], more: ["Сильная тяга к близости", "Хочется ярких ощущений", "Много инициативы", "Хочется игры", "Тело очень отзывчиво"] },
  },
};
const extraCatalog: Record<ActiveControl, CatalogGroup[]> = {
  cognitive: [
    { title: "Голова и ясность", negative: ["Туман в голове", "Ощущение тяжести в голове", "Чувствительность к шуму", "Трудно подобрать слова", "Снижение памяти"], positive: ["Ясность в голове", "Лёгкость в голове", "Легко держать внимание", "Свежесть мыслей"] },
    { title: "Внимание и ритм", negative: ["Сонливость", "Навязчивые мысли", "Неспокойный сон", "Раннее пробуждение", "Нужен дневной отдых"], positive: ["Собранность", "Восстановленный сон", "Хорошо выспалась", "Есть запас сил"] },
  ],
  emotional: [
    { title: "Настроение", negative: ["Перепады настроения", "Грусть", "Тревога", "Апатия", "Растерянность", "Подавленность"], positive: ["Спокойствие", "Радость", "Много энергии", "Игривость", "Воодушевление", "Уверенность"] },
    { title: "Напряжение и отношение к себе", negative: ["Стресс", "Чувство вины", "Навязчивые мысли", "Жёсткая самокритика", "Раздражение"], positive: ["Принятие себя", "Эмоциональная лёгкость", "Чувство опоры", "Тепло к себе"] },
  ],
  libido: [
    { title: "Низ живота и тело", negative: ["Боль внизу живота", "Спазмы внизу живота", "Чувствительная грудь", "Вздутие живота", "Тошнота", "Запор", "Диарея", "Повышенный аппетит", "Прыщи", "Приливы жара", "Ночная потливость"], positive: ["Телесный комфорт", "Лёгкость в теле", "Приятное тепло внизу живота"] },
    { title: "Интимный телесный фон", negative: ["Сухость во влагалище", "Зуд во влагалище", "Выделений нет", "Кровомажущие выделения", "Нетипичные выделения"], positive: ["Кремообразные выделения", "Водянистые выделения", "Липкие выделения", "Слизистые выделения", "Телесная отзывчивость"] },
    { title: "Близость и желание", negative: ["Слабое желание", "Не хочется секса", "Не хочется прикосновений", "Нужна дистанция"], positive: ["Среднее желание", "Сильное желание", "Интимные прикосновения", "Мастурбация", "Оргазм", "Секс с защитой", "Секс без защиты", "Оральный секс", "Анальный секс"] },
  ],
};
const symptomPositions: Record<ActiveControl, Record<"left" | "right", Array<[number, number]>>> = {
  cognitive: { left: [[4, 10], [7, 22], [12, 33], [3, 45], [15, 55]], right: [[64, 9], [71, 21], [61, 34], [68, 46], [59, 57]] },
  emotional: { left: [[4, 25], [10, 36], [3, 49], [13, 60], [5, 70]], right: [[65, 25], [57, 37], [69, 49], [61, 60], [68, 70]] },
  libido: { left: [[5, 48], [13, 59], [3, 69], [15, 79], [6, 86]], right: [[64, 48], [57, 59], [69, 69], [60, 79], [68, 86]] },
};
const centeredPositions = (): Record<ActiveControl, number> => ({ cognitive: 50, emotional: 50, libido: 50 });
const formatValue = (value: number) => value > 0 ? `+${value}` : `${value}`;
const searchTokens = (value: string) => value.toLowerCase().replace(/ё/g, "е").match(/[a-zа-я]+/giu)?.map((token) => token.slice(0, Math.min(token.length, 5))) ?? [];
const matchesSymptom = (label: string, query: string) => {
  const queryTokens = searchTokens(query);
  if (!queryTokens.length) return true;
  const labelTokens = searchTokens(label);
  return queryTokens.every((queryToken) => labelTokens.some((labelToken) => labelToken.includes(queryToken) || queryToken.includes(labelToken)));
};
const describeRange = (value: number) => {
  if (value <= -67) return "высокая негативная";
  if (value <= -34) return "средняя негативная";
  if (value < 0) return "лёгкая негативная";
  if (value === 0) return "нейтрально";
  if (value <= 33) return "лёгкая позитивная";
  if (value <= 66) return "средняя позитивная";
  return "высокая позитивная";
};
const getBand = (value: number): Band => value <= -67 ? "negativeHigh" : value <= -34 ? "negativeMedium" : value < 0 ? "negativeLight" : value <= 33 ? "positiveLight" : value <= 66 ? "positiveMedium" : "positiveHigh";

export default function BodyCheckin({ values, symptoms: confirmedSymptoms, symptomHistory, activeZone: _activeZone, onSelect, onBeginAdjustment, onChange, onCommit, onAddQuickSymptom, onUpdateQuickSymptom }: Props) {
  const [openControl, setOpenControl] = useState<ActiveControl | null>(null);
  const [holding, setHolding] = useState(false);
  const [detailZone, setDetailZone] = useState<ActiveControl | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [customText, setCustomText] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [positions, setPositions] = useState<Record<ActiveControl, number>>(centeredPositions);
  const [visualValues, setVisualValues] = useState<Record<ActiveControl, number>>(() => ({ cognitive: values.cognitive, emotional: values.emotional, libido: values.libido }));
  const controlRefs = useRef<Partial<Record<ActiveControl, HTMLDivElement | null>>>({});
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const didDrag = useRef(false);
  const holdStarted = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (openControl) return;
    setVisualValues({ cognitive: values.cognitive, emotional: values.emotional, libido: values.libido });
  }, [values, openControl]);

  const clearHoldTimer = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  const closeControl = () => {
    if (!openControl) return;
    setPositions((current) => ({ ...current, [openControl]: 50 }));
    setHolding(false);
    setMoreOpen(false);
    setCustomText("");
    setCatalogQuery("");
    setOpenControl(null);
  };
  const updateFromPointer = (event: PointerEvent<HTMLButtonElement>, zone: ActiveControl) => {
    const rect = controlRefs.current[zone]?.getBoundingClientRect();
    if (!rect) return;
    const position = clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100);
    const numeric = clamp(Math.round(position * 2 - 100));
    setPositions((current) => ({ ...current, [zone]: position }));
    setVisualValues((current) => ({ ...current, [zone]: numeric }));
    onChange(zone, numeric);
  };
  const start = (event: PointerEvent<HTMLButtonElement>, zone: ActiveControl) => {
    event.stopPropagation();
    clearHoldTimer();
    if (openControl && openControl !== zone) {
      setPositions((current) => ({ ...current, [openControl]: 50 }));
    }
    setDetailZone(null);
    setMoreOpen(false);
    setCatalogQuery("");
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerStart.current = { x: event.clientX, y: event.clientY };
    didDrag.current = false;
    holdStarted.current = false;
    holdTimer.current = setTimeout(() => {
      holdStarted.current = true;
      setOpenControl(zone);
      setHolding(true);
      setPositions((current) => ({ ...current, [zone]: (visualValues[zone] + 100) / 2 }));
      onSelect(zone);
    }, 180);
  };
  const move = (event: PointerEvent<HTMLButtonElement>, zone: ActiveControl) => {
    const initial = pointerStart.current;
    if (!initial) return;
    if (!didDrag.current && Math.hypot(event.clientX - initial.x, event.clientY - initial.y) < 5) return;
    if (!didDrag.current) {
      clearHoldTimer();
      didDrag.current = true;
      holdStarted.current = true;
      setOpenControl(zone);
      setHolding(true);
      onSelect(zone);
      onBeginAdjustment(zone);
    }
    updateFromPointer(event, zone);
  };
  const finish = (event: PointerEvent<HTMLButtonElement>, zone: ActiveControl) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    clearHoldTimer();
    pointerStart.current = null;
    if (holdStarted.current) {
      setHolding(false);
      onCommit();
    } else {
      setDetailZone(zone);
      setOpenControl(null);
    }
  };
  const value = openControl ? visualValues[openControl] : 0;
  const candidateSet = openControl ? suggested[openControl][getBand(value)] : null;
  const historyCounts = new Map<string, number>();
  if (openControl) symptomHistory.filter((symptom) => symptom.status === "confirmed" && symptom.zone === openControl).forEach((symptom) => historyCounts.set(symptom.label, (historyCounts.get(symptom.label) ?? 0) + 1));
  const unique = (labels: string[]) => Array.from(new Set(labels));
  const rankSymptoms = (labels: string[]) => unique(labels).sort((a, b) => (historyCounts.get(b) ?? 0) - (historyCounts.get(a) ?? 0) || labels.indexOf(a) - labels.indexOf(b));
  const rankedSymptoms = candidateSet ? rankSymptoms([...candidateSet.primary, ...candidateSet.more]) : [];
  const symptoms = rankedSymptoms.slice(0, 3);
  const currentLabels = candidateSet ? unique([...candidateSet.primary, ...candidateSet.more]) : [];
  const direction = value < 0 ? "negative" : "positive";
  const allRangeLabels = openControl ? unique(Object.entries(suggested[openControl])
    .filter(([band]) => band.startsWith(direction))
    .flatMap(([, set]) => [...set.primary, ...set.more])) : [];
  const catalogGroups = openControl && candidateSet ? [
    { title: "Этот диапазон", labels: rankSymptoms(currentLabels) },
    { title: "Другие варианты этой стороны", labels: rankSymptoms(allRangeLabels.filter((label) => !currentLabels.includes(label))) },
    ...extraCatalog[openControl].map((group) => ({ title: group.title, labels: rankSymptoms(group[direction]) })),
  ].filter((group) => group.labels.length) : [];
  const allCatalogLabels = unique(catalogGroups.flatMap((group) => group.labels));
  const catalogMatches = catalogQuery.trim() ? allCatalogLabels.filter((label) => matchesSymptom(label, catalogQuery)) : [];
  const symptomSide = value < 0 ? "right" : "left";
  const chooseSymptom = (label: string, index: number) => {
    if (!openControl) return;
    const existing = confirmedSymptoms.find((symptom) => symptom.zone === openControl && symptom.label === label);
    if (existing) {
      onUpdateQuickSymptom({ ...existing, status: existing.status === "confirmed" ? "dismissed" : "confirmed", intensity: Math.abs(value) });
      return;
    }
    onAddQuickSymptom({ id: `quick-${openControl}-${Date.now()}-${index}`, label, zone: openControl, status: "confirmed", intensity: Math.abs(value), suggestedBy: "system" });
  };
  const submitCustom = () => {
    const label = customText.trim();
    if (!openControl || !label) return;
    chooseSymptom(label, 99);
    setCustomText("");
  };
  const detailValue = detailZone ? visualValues[detailZone] : 0;
  const selectedSymptoms = detailZone ? confirmedSymptoms.filter((symptom) => symptom.zone === detailZone && symptom.status === "confirmed") : [];

  return <section className="body-card gesture-body-card glass-card" aria-labelledby="body-title">
    <header className="section-header state-section-header"><div><h2 id="body-title">Моё состояние</h2></div><button className="section-info-button" type="button" aria-label="Как работает блок «Моё состояние»" aria-expanded={infoOpen} onClick={() => { setDetailZone(null); setInfoOpen((current) => !current); }}>i</button></header>
    <div className="body-stage gesture-scene" onPointerDown={(event) => { if (event.target === event.currentTarget) { setDetailZone(null); setInfoOpen(false); closeControl(); } }}>
      <img className="silhouette-art" src={bodySilhouetteAsset} alt="Нейоновый силуэт в позе лотоса" />
      {zones.map((zone) => {
        const isOpen = openControl === zone;
        return <div key={zone} ref={(node) => { controlRefs.current[zone] = node; }} className={`gesture-control ${zone} ${isOpen ? "is-open" : ""}`} style={{ "--zone-color": ZONE_META[zone].color, "--button-x": `${positions[zone]}%` } as CSSProperties}>
          {isOpen && !detailZone && <div className="gesture-track" aria-hidden="true"><i className="track-line" /><b className="track-zero" /><span className="track-number start">−100</span><span className="track-number middle">0</span><span className="track-number end">+100</span></div>}
          <button className="gesture-button" type="button" aria-label={ZONE_META[zone].label} onPointerDown={(event) => start(event, zone)} onPointerMove={(event) => move(event, zone)} onPointerUp={(event) => finish(event, zone)} onPointerCancel={(event) => finish(event, zone)}>
            <img className="control-image" src={controlAssets[zone]} alt="" />
          </button>
          {isOpen && !detailZone && <><output className="gesture-value"><b>{formatValue(visualValues[zone])}</b></output><span className="gesture-range-label">{describeRange(visualValues[zone])}</span></>}
        </div>;
      })}
      {infoOpen && <aside className="body-info-popover" onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" aria-label="Закрыть" onClick={() => setInfoOpen(false)}>×</button>
        <strong>Как работать с «Моим состоянием»</strong>
        <p>Здесь отмечается личное ощущение дня — не диагноз и не оценка «правильно / неправильно».</p>
        <ul>
          <li><b className="info-cognitive">Мозг</b> — когнитивная нагрузка: ясность, концентрация, ментальная усталость.</li>
          <li><b className="info-emotional">Сердце</b> — эмоциональная нагрузка: спокойствие, чувствительность, напряжение.</li>
          <li><b className="info-libido">Лотос</b> — либидо: желание, телесный ресурс, потребность в близости.</li>
        </ul>
        <p><em>Короткий тап</em> показывает последнее сохранённое значение и выбранные ощущения.</p>
        <p><em>Удержание и движение</em> открывает шкалу: влево — негативная нагрузка, вправо — позитивная. Ноль — нейтральный фон.</p>
        <p>У каждой стороны три равных диапазона: лёгкая, средняя и высокая нагрузка. После отпускания можно выбрать подходящее ощущение или добавить своё.</p>
        <p>Если снова передвинуть ту же кнопку, прошлый набор ощущений этой зоны заменится новым — в отчёте останется актуальная настройка.</p>
      </aside>}
      {detailZone && <aside className="control-detail-popover" onPointerDown={(event) => event.stopPropagation()}><button type="button" aria-label="Закрыть" onClick={() => setDetailZone(null)}>×</button><p className="eyebrow">{ZONE_META[detailZone].label}</p><strong>{describeRange(detailValue)} · {formatValue(detailValue)}</strong><small>{selectedSymptoms.length ? <>Выбрано: {selectedSymptoms.map((symptom) => symptom.label).join(" · ")}</> : "Симптомы пока не выбраны"}</small></aside>}
      {openControl && !holding && !detailZone && <div className={`floating-symptoms ${symptomSide} ${openControl}`} style={{ "--zone-color": ZONE_META[openControl].color } as CSSProperties} aria-label="Подходящие ощущения">
        {symptoms.map((label, index) => { const [left, top] = symptomPositions[openControl][symptomSide][index]; const selected = confirmedSymptoms.some((symptom) => symptom.zone === openControl && symptom.status === "confirmed" && symptom.label === label); return <button key={label} className={selected ? "is-selected" : ""} type="button" style={{ left: `${left}%`, top: `${top}%`, "--delay": `${index * -.7}s` } as CSSProperties} onPointerDown={(event) => event.stopPropagation()} onClick={() => chooseSymptom(label, index)}>{label}</button>; })}
        {(() => { const [left, top] = symptomPositions[openControl][symptomSide][4]; return <button className="more-symptom-trigger" type="button" style={{ left: `${left}%`, top: `${top}%`, "--delay": "-1.8s" } as CSSProperties} onPointerDown={(event) => event.stopPropagation()} onClick={() => { setCatalogQuery(""); setMoreOpen(true); }}>＋ ещё</button>; })()}
      </div>}
      {moreOpen && openControl && !detailZone && <aside className="more-symptoms-panel" style={{ "--zone-color": ZONE_META[openControl].color } as CSSProperties} onPointerDown={(event) => event.stopPropagation()}>
        <button className="more-close" type="button" aria-label="Закрыть дополнительные ощущения" onClick={() => setMoreOpen(false)}>×</button>
        <p className="eyebrow">полный список этой зоны</p><strong>{ZONE_META[openControl].label} · {describeRange(value)}</strong>
        <small>Верхние подсказки — предположение для выбранного диапазона. Здесь — только {direction === "negative" ? "негативные" : "позитивные"} ощущения выбранной стороны; частые личные выборы со временем поднимаются выше.</small>
        <label className="symptom-search"><span>⌕</span><input value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Найти симптом" autoComplete="off" />{catalogQuery && <button type="button" aria-label="Очистить поиск" onClick={() => setCatalogQuery("")}>×</button>}</label>
        {catalogQuery.trim() ? <section className="more-symptom-group search-results"><p>Результаты поиска</p>{catalogMatches.length ? <div className="more-symptom-list">{catalogMatches.map((label, index) => { const selected = confirmedSymptoms.some((symptom) => symptom.zone === openControl && symptom.status === "confirmed" && symptom.label === label); return <button className={selected ? "is-selected" : ""} key={label} type="button" onClick={() => chooseSymptom(label, 700 + index)}>{label}</button>; })}</div> : <div className="search-empty"><span>Похожих симптомов пока нет.</span><button type="button" onClick={() => { chooseSymptom(catalogQuery.trim(), 799); setCatalogQuery(""); }}>＋ Добавить «{catalogQuery.trim()}»</button></div>}</section> : catalogGroups.map((group, groupIndex) => <section className="more-symptom-group" key={group.title}><p>{group.title}</p><div className="more-symptom-list">{group.labels.map((label, index) => { const selected = confirmedSymptoms.some((symptom) => symptom.zone === openControl && symptom.status === "confirmed" && symptom.label === label); return <button className={selected ? "is-selected" : ""} key={label} type="button" onClick={() => chooseSymptom(label, groupIndex * 100 + index + 10)}>{label}</button>; })}</div></section>)}
        <form className="more-custom-entry" onSubmit={(event) => { event.preventDefault(); submitCustom(); }}><input value={customText} onChange={(event) => setCustomText(event.target.value)} placeholder="Добавить своё ощущение" /><button type="submit">Добавить</button></form>
      </aside>}
    </div>
  </section>;
}
