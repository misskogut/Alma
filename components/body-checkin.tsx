"use client";

import { useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { ZONE_META, clamp, type SymptomEntry, type ZoneKey, type ZoneValues } from "../lib/alma";
import { bodySilhouetteAsset } from "../lib/visual-assets";
import { controlAssets } from "../lib/control-assets";

type ActiveControl = "cognitive" | "emotional" | "libido";
type Props = { values: ZoneValues; activeZone: ZoneKey | null; onSelect: (zone: ZoneKey) => void; onChange: (zone: ZoneKey, value: number) => void; onCommit: () => void; onAddQuickSymptom: (symptom: SymptomEntry) => void; };

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
const neutralValues = (): Record<ActiveControl, number> => ({ cognitive: 0, emotional: 0, libido: 0 });
const formatValue = (value: number) => value > 0 ? `+${value}` : `${value}`;
const describeRange = (value: number) => {
  if (value <= -67) return "сильно негативно";
  if (value <= -18) return "слегка негативно";
  if (value < 18) return "нейтрально";
  if (value < 67) return "слегка позитивно";
  return "сильно позитивно";
};

export default function BodyCheckin({ values: _values, activeZone: _activeZone, onSelect, onChange, onCommit, onAddQuickSymptom }: Props) {
  const [openControl, setOpenControl] = useState<ActiveControl | null>(null);
  const [dragging, setDragging] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customText, setCustomText] = useState("");
  const [positions, setPositions] = useState<Record<ActiveControl, number>>(centeredPositions);
  const [visualValues, setVisualValues] = useState<Record<ActiveControl, number>>(neutralValues);
  const controlRefs = useRef<Partial<Record<ActiveControl, HTMLDivElement | null>>>({});

  const closeControl = () => {
    if (!openControl) return;
    setPositions((current) => ({ ...current, [openControl]: 50 }));
    setVisualValues((current) => ({ ...current, [openControl]: 0 }));
    setDragging(false);
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
    if (openControl && openControl !== zone) {
      setPositions((current) => ({ ...current, [openControl]: 50 }));
      setVisualValues((current) => ({ ...current, [openControl]: 0 }));
    }
    setOpenControl(zone);
    setDragging(true);
    setCustomMode(false);
    onSelect(zone);
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromPointer(event, zone);
  };
  const finish = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
    onCommit();
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

  return <section className="body-card gesture-body-card glass-card" aria-labelledby="body-title">
    <header className="section-header"><div><p className="eyebrow">одно движение</p><h2 id="body-title">Уточнить состояние</h2></div><small>свайп от центра</small></header>
    <div className="body-stage gesture-scene" onPointerDown={(event) => { if (event.target === event.currentTarget) closeControl(); }}>
      <img className="silhouette-art" src={bodySilhouetteAsset} alt="Нейоновый силуэт в позе лотоса" />
      {zones.map((zone) => {
        const isOpen = openControl === zone;
        return <div key={zone} ref={(node) => { controlRefs.current[zone] = node; }} className={`gesture-control ${zone} ${isOpen ? "is-open" : ""}`} style={{ "--zone-color": ZONE_META[zone].color, "--button-x": `${positions[zone]}%` } as CSSProperties}>
          {isOpen && <div className="gesture-track" aria-hidden="true"><i className="track-line" /><b className="track-zero" /><span className="track-number start">−100</span><span className="track-number middle">0</span><span className="track-number end">+100</span></div>}
          <button className="gesture-button" type="button" aria-label={ZONE_META[zone].label} onPointerDown={(event) => start(event, zone)} onPointerMove={(event) => { if (dragging && openControl === zone) updateFromPointer(event, zone); }} onPointerUp={finish} onPointerCancel={finish}>
            <img className="control-image" src={controlAssets[zone]} alt="" />
            <span>{ZONE_META[zone].short}</span>
          </button>
          {isOpen && <output className="gesture-value"><b>{formatValue(visualValues[zone])}</b><small>{describeRange(visualValues[zone])}</small></output>}
        </div>;
      })}
      {openControl && !dragging && <div className={`floating-symptoms ${symptomSide} ${openControl}`} aria-label="Подходящие ощущения">
        {symptoms.map((label, index) => { const [left, top] = symptomPositions[openControl][symptomSide][index]; return <button key={label} type="button" style={{ left: `${left}%`, top: `${top}%`, "--delay": `${index * -.7}s` } as CSSProperties} onPointerDown={(event) => event.stopPropagation()} onClick={() => chooseSymptom(label, index)}>{label}</button>; })}
        {(() => { const [left, top] = symptomPositions[openControl][symptomSide][4]; return <button className="custom-symptom-trigger" type="button" style={{ left: `${left}%`, top: `${top}%`, "--delay": "-1.8s" } as CSSProperties} onPointerDown={(event) => event.stopPropagation()} onClick={() => setCustomMode(true)}>＋ своё</button>; })()}
        {customMode && <form className="custom-symptom-entry" onPointerDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); submitCustom(); }}><input autoFocus value={customText} onChange={(event) => setCustomText(event.target.value)} placeholder="Своё ощущение" /><button type="submit" aria-label="Добавить ощущение">+</button></form>}
      </div>}
    </div>
  </section>;
}
