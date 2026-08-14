"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { ZONE_META, clamp, type SymptomEntry, type ZoneKey, type ZoneValues } from "../lib/alma";
import { bodySilhouetteAsset } from "../lib/visual-assets";
import { controlAssets } from "../lib/control-assets";

type ActiveControl = "cognitive" | "emotional" | "libido";
type Props = { values: ZoneValues; symptoms: SymptomEntry[]; activeZone: ZoneKey | null; onSelect: (zone: ZoneKey) => void; onBeginAdjustment: (zone: ZoneKey) => void; onChange: (zone: ZoneKey, value: number) => void; onCommit: () => void; onAddQuickSymptom: (symptom: SymptomEntry) => void; };

const zones: ActiveControl[] = ["cognitive", "emotional", "libido"];
const suggested: Record<ActiveControl, { negative: string[]; positive: string[] }> = {
  cognitive: { negative: ["Туман в голове", "Труднее сосредоточиться", "Забывчивость", "Ментальная усталость"], positive: ["Ясность мыслей", "Легче держать фокус", "Быстрые решения", "Интерес к задачам"] },
  emotional: { negative: ["Эмоциональная чувствительность", "Внутреннее напряжение", "Раздражительность", "Хочется уединиться"], positive: ["Спокойствие", "Тёплый эмоциональный фон", "Устойчивость", "Лёгкость в общении"] },
  libido: { negative: ["Сниженное желание", "Нужна близость с собой", "Телесная усталость", "Не хочется контакта"], positive: ["Повышенное желание", "Больше телесной энергии", "Чувственность", "Тяга к близости"] },
};
const symptomPositions: Record<ActiveControl, Record<"left" | "right", Array<[number, number]>>> = {
  cognitive: { left: [[4, 10], [7, 22], [12, 33], [3, 45], [15, 55]], right: [[64, 9], [71, 21], [61, 34], [68, 46], [59, 57]] },
  emotional: { left: [[4, 25], [10, 36], [3, 49], [13, 60], [5, 70]], right: [[65, 25], [57, 37], [69, 49], [61, 60], [68, 70]] },
  libido: { left: [[5, 48], [13, 59], [3, 69], [15, 79], [6, 86]], right: [[64, 48], [57, 59], [69, 69], [60, 79], [68, 86]] },
};
const centeredPositions = (): Record<ActiveControl, number> => ({ cognitive: 50, emotional: 50, libido: 50 });
const formatValue = (value: number) => value > 0 ? `+${value}` : `${value}`;
const describeRange = (value: number) => {
  if (value <= -67) return "высокая негативная";
  if (value <= -34) return "средняя негативная";
  if (value < 0) return "лёгкая негативная";
  if (value === 0) return "нейтрально";
  if (value <= 33) return "лёгкая позитивная";
  if (value <= 66) return "средняя позитивная";
  return "высокая позитивная";
};

export default function BodyCheckin({ values, symptoms: confirmedSymptoms, activeZone: _activeZone, onSelect, onBeginAdjustment, onChange, onCommit, onAddQuickSymptom }: Props) {
  const [openControl, setOpenControl] = useState<ActiveControl | null>(null);
  const [holding, setHolding] = useState(false);
  const [detailZone, setDetailZone] = useState<ActiveControl | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customText, setCustomText] = useState("");
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
    setCustomMode(false);
    setCustomText("");
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
    setCustomMode(false);
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
  const symptoms = openControl ? (value < 0 ? suggested[openControl].negative : suggested[openControl].positive) : [];
  const symptomSide = value < 0 ? "right" : "left";
  const chooseSymptom = (label: string, index: number) => {
    if (!openControl) return;
    onAddQuickSymptom({ id: `quick-${openControl}-${Date.now()}-${index}`, label, zone: openControl, status: "confirmed", intensity: Math.abs(value), suggestedBy: "system" });
    closeControl();
  };
  const submitCustom = () => {
    const label = customText.trim();
    if (!openControl || !label) return;
    chooseSymptom(label, 99);
  };
  const detailValue = detailZone ? visualValues[detailZone] : 0;
  const selectedSymptoms = detailZone ? confirmedSymptoms.filter((symptom) => symptom.zone === detailZone && symptom.status === "confirmed") : [];

  return <section className="body-card gesture-body-card glass-card" aria-labelledby="body-title">
    <header className="section-header"><div><p className="eyebrow">одно движение</p><h2 id="body-title">Уточнить состояние</h2></div><small>свайп от центра</small></header>
    <div className="body-stage gesture-scene" onPointerDown={(event) => { if (event.target === event.currentTarget) { setDetailZone(null); setInfoOpen(false); closeControl(); } }}>
      <img className="silhouette-art" src={bodySilhouetteAsset} alt="Нейоновый силуэт в позе лотоса" />
      <button className="body-info-button" type="button" aria-label="Как работает ввод состояния" onPointerDown={(event) => event.stopPropagation()} onClick={() => { setDetailZone(null); setInfoOpen((current) => !current); }}>i</button>
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
        <strong>Как работает этот блок</strong>
        <p>Здесь отмечается личное ощущение дня — не диагноз и не оценка «правильно / неправильно».</p>
        <ul>
          <li><b className="info-cognitive">Мозг</b> — когнитивная нагрузка: ясность, концентрация, ментальная усталость.</li>
          <li><b className="info-emotional">Сердце</b> — эмоциональное состояние: спокойствие, чувствительность, напряжение.</li>
          <li><b className="info-libido">Лотос</b> — либидо: желание, телесный ресурс, потребность в близости.</li>
        </ul>
        <p><em>Короткий тап</em> показывает последнее сохранённое значение и выбранные ощущения.</p>
        <p><em>Удержание и движение</em> открывает шкалу: влево — негативная нагрузка, вправо — позитивная. Ноль — нейтральный фон.</p>
        <p>У каждой стороны три равных диапазона: лёгкая, средняя и высокая нагрузка. После отпускания можно выбрать подходящее ощущение или добавить своё.</p>
        <p>Если снова передвинуть ту же кнопку, прошлый набор ощущений этой зоны заменится новым — в отчёте останется актуальная настройка.</p>
      </aside>}
      {detailZone && <aside className="control-detail-popover" onPointerDown={(event) => event.stopPropagation()}><button type="button" aria-label="Закрыть" onClick={() => setDetailZone(null)}>×</button><p className="eyebrow">{ZONE_META[detailZone].label}</p><strong>{describeRange(detailValue)} · {formatValue(detailValue)}</strong><small>{selectedSymptoms.length ? <>Выбрано: {selectedSymptoms.map((symptom) => symptom.label).join(" · ")}</> : "Симптомы пока не выбраны"}</small></aside>}
      {openControl && !holding && !detailZone && <div className={`floating-symptoms ${symptomSide} ${openControl}`} style={{ "--zone-color": ZONE_META[openControl].color } as CSSProperties} aria-label="Подходящие ощущения">
        {symptoms.map((label, index) => { const [left, top] = symptomPositions[openControl][symptomSide][index]; return <button key={label} type="button" style={{ left: `${left}%`, top: `${top}%`, "--delay": `${index * -.7}s` } as CSSProperties} onPointerDown={(event) => event.stopPropagation()} onClick={() => chooseSymptom(label, index)}>{label}</button>; })}
        {(() => { const [left, top] = symptomPositions[openControl][symptomSide][4]; return <button className="custom-symptom-trigger" type="button" style={{ left: `${left}%`, top: `${top}%`, "--delay": "-1.8s" } as CSSProperties} onPointerDown={(event) => event.stopPropagation()} onClick={() => setCustomMode(true)}>＋ своё</button>; })()}
        {customMode && <form className="custom-symptom-entry" onPointerDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); submitCustom(); }}><input autoFocus value={customText} onChange={(event) => setCustomText(event.target.value)} placeholder="Своё ощущение" /><button type="submit" aria-label="Добавить ощущение">+</button></form>}
      </div>}
    </div>
  </section>;
}
