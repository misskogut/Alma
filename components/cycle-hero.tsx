"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import type { AlmaProfile, CyclePhase, DayModel } from "../lib/alma";
import { phaseHint, relativeDayLabel } from "../lib/alma";

type LotusStage = { key: "menstruation" | "low" | "follicular" | "ovulation"; label: string; petals: 1 | 3 | 5 | 7; color: string; description: string };
const STAGES: Record<LotusStage["key"], LotusStage> = {
  menstruation: { key: "menstruation", label: "Менструация", petals: 1, color: "#ff435f", description: "Отмеченные дни менструации" },
  low: { key: "low", label: "Низкая вероятность беременности", petals: 3, color: "#4fd39a", description: "Спокойный календарный промежуток цикла" },
  follicular: { key: "follicular", label: "Фолликулярная фаза", petals: 5, color: "#48a8ff", description: "Вероятное фертильное окно приближается" },
  ovulation: { key: "ovulation", label: "Овуляция", petals: 7, color: "#c45cff", description: "Расчётный день овуляции" },
};
const MONTH_SHORT = new Intl.DateTimeFormat("ru-RU", { month: "short", timeZone: "UTC" });
const DOT_STEP = 35;
const DIAL_BUFFER_RADIUS = 24;
const LOTUS_PETAL_PATH = "M190 27 C159 64 141 103 142 138 C143 172 166 200 190 200 C214 200 237 172 238 138 C239 103 221 64 190 27Z";
const LOTUS_PETALS = [
  { id: "outer-left", className: "outer left", layer: "outer", side: -1 }, { id: "outer-right", className: "outer right", layer: "outer", side: 1 },
  { id: "middle-left", className: "middle left", layer: "middle", side: -1 }, { id: "middle-right", className: "middle right", layer: "middle", side: 1 },
  { id: "inner-left", className: "inner left", layer: "inner", side: -1 }, { id: "inner-right", className: "inner right", layer: "inner", side: 1 },
  { id: "center", className: "lotus-drop center", layer: "center", side: 0 },
] as const;
function stageForPhase(phase: CyclePhase) { if (phase === "menstruation") return STAGES.menstruation; if (phase === "ovulation") return STAGES.ovulation; if (phase === "fertile") return STAGES.follicular; return STAGES.low; }
function arcPoint(offset: number) { const normalized = Math.max(-1.08, Math.min(1.08, offset / 6.4)); const angle = normalized * 1.14; return { x: 190 + Math.sin(angle) * 187, y: 27 + (1 - Math.cos(angle)) * 104 }; }
function clampIndex(index: number, days: DayModel[]) { return Math.max(0, Math.min(days.length - 1, index)); }
function petalAngle(layer: (typeof LOTUS_PETALS)[number]["layer"], side: number, petals: LotusStage["petals"]) { if (layer === "center" || petals === 1) return 0; if (petals === 3) return 27 * side; if (petals === 5) return (layer === "inner" ? 27 : 52) * side; return (layer === "inner" ? 27 : layer === "middle" ? 52 : 76) * side; }

export default function CycleHero({ profile, days, activeIndex, onSelectDay, onOpenPeriod }: { profile: AlmaProfile; days: DayModel[]; activeIndex: number; onSelectDay: (index: number) => void; onOpenPeriod: () => void }) {
  const [isDragging, setIsDragging] = useState(false);
  const [previewIndexState, setPreviewIndexState] = useState(activeIndex);
  const dragXRef = useRef(0); const dragStart = useRef<number | null>(null); const dragged = useRef(false); const dragFrame = useRef<number | null>(null);
  const previewIndexRef = useRef(activeIndex); const dialDateRefs = useRef(new Map<number, SVGGElement>());
  const velocityRef = useRef(0); const lastMoveXRef = useRef(0); const lastMoveTimeRef = useRef(0);
  const todayIndex = days.findIndex((item) => item.isToday);
  const previewIndex = isDragging ? clampIndex(previewIndexState, days) : activeIndex;
  const previewDay = days[previewIndex]; const previewStage = stageForPhase(previewDay.phase);
  const lotusPetals = LOTUS_PETALS.map((petal) => ({ ...petal, angle: petalAngle(petal.layer, petal.side, previewStage.petals) }));
  const visibleDays: Array<{ item: DayModel; index: number; offset: number }> = [];
  for (let index = Math.max(0, activeIndex - DIAL_BUFFER_RADIUS); index <= Math.min(days.length - 1, activeIndex + DIAL_BUFFER_RADIUS); index += 1) visibleDays.push({ item: days[index], index, offset: index - activeIndex });

  useEffect(() => { if (!isDragging) { previewIndexRef.current = activeIndex; setPreviewIndexState(activeIndex); } }, [activeIndex, isDragging]);
  useEffect(() => () => { if (dragFrame.current != null) cancelAnimationFrame(dragFrame.current); }, []);

  function paintDial(distance: number) {
    for (const { index, offset } of visibleDays) {
      const element = dialDateRefs.current.get(index); if (!element) continue;
      const visualOffset = offset + distance / DOT_STEP; const isVisible = Math.abs(visualOffset) <= 6.45;
      if (!isVisible) { element.style.opacity = "0"; element.style.visibility = "hidden"; element.style.pointerEvents = "none"; element.setAttribute("tabindex", "-1"); continue; }
      const point = arcPoint(visualOffset); element.setAttribute("transform", `translate(${point.x} ${point.y})`);
      element.style.opacity = String(Math.max(.18, 1 - Math.abs(visualOffset) / 11)); element.style.visibility = "visible"; element.style.pointerEvents = "auto"; element.setAttribute("tabindex", "0");
    }
  }
  function updatePreview(distance: number) {
    const nextIndex = clampIndex(activeIndex + Math.round(-distance / DOT_STEP), days);
    if (nextIndex !== previewIndexRef.current) { previewIndexRef.current = nextIndex; startTransition(() => setPreviewIndexState(nextIndex)); }
  }
  function select(index: number) { onSelectDay(clampIndex(index, days)); }
  function stopMotion() { if (dragFrame.current != null) cancelAnimationFrame(dragFrame.current); dragFrame.current = null; velocityRef.current = 0; }

  function onPointerDown(event: PointerEvent<SVGSVGElement>) {
    event.preventDefault(); stopMotion(); dragStart.current = event.clientX - dragXRef.current; lastMoveXRef.current = event.clientX; lastMoveTimeRef.current = performance.now(); velocityRef.current = 0;
    dragged.current = false; previewIndexRef.current = clampIndex(activeIndex + Math.round(-dragXRef.current / DOT_STEP), days); setPreviewIndexState(previewIndexRef.current); setIsDragging(true); event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    if (dragStart.current == null) return; event.preventDefault();
    const minDistance = -(days.length - 1 - activeIndex) * DOT_STEP; const maxDistance = activeIndex * DOT_STEP;
    const distance = Math.max(minDistance, Math.min(maxDistance, event.clientX - dragStart.current));
    const now = performance.now(); const dt = Math.max(1, now - lastMoveTimeRef.current); const instantVelocity = (event.clientX - lastMoveXRef.current) / dt;
    velocityRef.current = velocityRef.current * .55 + instantVelocity * .45; lastMoveXRef.current = event.clientX; lastMoveTimeRef.current = now;
    if (Math.abs(distance - dragXRef.current) > 1 || Math.abs(distance) > 7) dragged.current = true;
    dragXRef.current = distance; paintDial(distance); updatePreview(distance);
  }
  function settleToNearest() {
    const targetIndex = clampIndex(activeIndex + Math.round(-dragXRef.current / DOT_STEP), days); const targetDistance = -(targetIndex - activeIndex) * DOT_STEP;
    const animate = () => {
      const delta = targetDistance - dragXRef.current;
      if (Math.abs(delta) < .35) { dragXRef.current = targetDistance; paintDial(targetDistance); updatePreview(targetDistance); dragFrame.current = null; setIsDragging(false); if (targetIndex !== activeIndex) select(targetIndex); else dragXRef.current = 0; return; }
      dragXRef.current += delta * .22; paintDial(dragXRef.current); updatePreview(dragXRef.current); dragFrame.current = requestAnimationFrame(animate);
    };
    dragFrame.current = requestAnimationFrame(animate);
  }
  function startMomentum() {
    let velocity = Math.max(-1.45, Math.min(1.45, velocityRef.current)); let previous = performance.now();
    const minDistance = -(days.length - 1 - activeIndex) * DOT_STEP; const maxDistance = activeIndex * DOT_STEP;
    const tick = (now: number) => {
      const dt = Math.min(32, now - previous); previous = now; dragXRef.current = Math.max(minDistance, Math.min(maxDistance, dragXRef.current + velocity * dt));
      paintDial(dragXRef.current); updatePreview(dragXRef.current); velocity *= Math.pow(.945, dt / 16.67);
      const atEdge = dragXRef.current === minDistance || dragXRef.current === maxDistance;
      if (Math.abs(velocity) < .025 || atEdge) { dragFrame.current = null; settleToNearest(); return; }
      dragFrame.current = requestAnimationFrame(tick);
    };
    dragFrame.current = requestAnimationFrame(tick);
  }
  function finishDrag() {
    if (dragStart.current == null) return; dragStart.current = null;
    if (Math.abs(velocityRef.current) > .12) startMomentum(); else settleToNearest();
  }
  function cancelDrag() { stopMotion(); dragStart.current = null; dragXRef.current = 0; dragged.current = false; previewIndexRef.current = activeIndex; paintDial(0); setPreviewIndexState(activeIndex); setIsDragging(false); }
  function onDialKeyDown(event: KeyboardEvent<SVGSVGElement>) { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); select(activeIndex + (event.key === "ArrowRight" ? 1 : -1)); } }
  function selectDot(index: number) { if (dragged.current) { dragged.current = false; return; } select(index); }
  const customStyle = { "--cycle-color": previewStage.color } as CSSProperties;

  return <section className={`cycle-hero lotus-stage-${previewStage.key}${isDragging ? " is-cycle-scrubbing" : ""}`} style={customStyle} aria-labelledby="cycle-title" data-lotus-stage={previewStage.key} data-lotus-petals={previewStage.petals} data-selected-index={activeIndex} data-preview-index={previewIndex}>
    <div className="cosmic-dust" aria-hidden="true">{Array.from({ length: 42 }, (_, index) => <i key={index} />)}</div>
    <svg className={`cycle-dial${isDragging ? " is-dragging" : ""}`} viewBox="0 0 380 142" role="group" tabIndex={0} aria-label={`Календарь цикла. В центре: ${relativeDayLabel(previewDay.iso)}, ${previewDay.cycleDay} день цикла. Двигайте влево или вправо.`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={finishDrag} onPointerCancel={cancelDrag} onKeyDown={onDialKeyDown}>
      <defs><filter id="dial-glow" x="-150%" y="-150%" width="400%" height="400%"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
      {visibleDays.map(({ item, index, offset }) => { const visualOffset = offset + (isDragging ? dragXRef.current / DOT_STEP : 0); const point = arcPoint(visualOffset); const dotStage = stageForPhase(item.phase); const isNear = Math.abs(visualOffset) <= 6.45; const month = item.dayOfMonth === 1 ? MONTH_SHORT.format(item.date).replace(".", "") : ""; return <g key={item.iso} ref={(element) => { if (element) dialDateRefs.current.set(index, element); else dialDateRefs.current.delete(index); }} className={`dial-date${index === previewIndex ? " is-selected" : ""}${item.isToday ? " is-today" : ""}`} transform={`translate(${point.x} ${point.y})`} style={{ "--dot-color": dotStage.color, opacity: isNear ? Math.max(.18, 1 - Math.abs(visualOffset) / 11) : 0, visibility: isNear ? "visible" : "hidden", pointerEvents: isNear ? "auto" : "none" } as CSSProperties} role="button" tabIndex={isNear ? 0 : -1} aria-current={index === previewIndex ? "date" : undefined} aria-label={`${item.dayOfMonth} ${MONTH_SHORT.format(item.date)}, ${item.cycleDay} день цикла`} onClick={() => selectDot(index)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectDot(index); } }}><circle className="dial-date-dot" r={item.marker ? 3.35 : 2.45} />{isNear ? <text className="dial-date-number" y="15" textAnchor="middle">{item.dayOfMonth}</text> : null}{month ? <text className="dial-date-month" y="24" textAnchor="middle">{month}</text> : null}</g>; })}
      <g className="dial-selector" transform="translate(190 29)" style={{ "--selector-color": previewStage.color, pointerEvents: "none" } as CSSProperties} aria-hidden="true"><circle className="dial-selector-aura" r="26" filter="url(#dial-glow)" style={{ fill: "transparent" }} /><circle className="dial-selector-core" r="22" style={{ fill: "transparent" }} /></g>
    </svg>
    <button className="cycle-jump previous" type="button" onClick={() => select(activeIndex - profile.cycleLength)} aria-label="Предыдущий цикл">‹</button>
    <button className="cycle-jump next" type="button" onClick={() => select(activeIndex + profile.cycleLength)} aria-label="Следующий цикл">›</button>
    <div className="phase-badge" aria-live="polite"><span>{relativeDayLabel(previewDay.iso)}</span><strong>{previewDay.dayOfMonth} {MONTH_SHORT.format(previewDay.date).replace(".", "")} · {previewStage.label.toLowerCase()}</strong></div>
    <button className="cycle-settings-button" type="button" onClick={onOpenPeriod} aria-label="Отметить месячные и настроить цикл"><span>{profile.cycleLength} дней</span><i>＋</i></button>
    <button className="cycle-lotus-button" type="button" onClick={onOpenPeriod} aria-label="Открыть календарь и отметить месячные">
      <svg className="cycle-lotus" viewBox="0 0 380 230" role="img" aria-labelledby="cycle-title cycle-description">
        <defs><radialGradient id="lotus-fill"><stop offset="0" stopColor={previewStage.color} stopOpacity=".38" /><stop offset=".62" stopColor={previewStage.color} stopOpacity=".12" /><stop offset="1" stopColor="#030107" stopOpacity="0" /></radialGradient><linearGradient id="petal-fill" x1="0" y1="0" x2="0" y2="1"><stop stopColor={previewStage.color} /><stop offset=".42" stopColor={previewStage.color} /><stop offset=".82" stopColor="#120718" /><stop offset="1" stopColor="#050108" /></linearGradient><radialGradient id="drop-fill" cx="50%" cy="35%" r="72%"><stop stopColor={previewStage.color} /><stop offset=".48" stopColor={previewStage.color} /><stop offset=".82" stopColor="#100817" /><stop offset="1" stopColor="#050108" /></radialGradient><filter id="lotus-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter><filter id="pollen-glow" x="-300%" y="-300%" width="700%" height="700%"><feGaussianBlur stdDeviation="2.8" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
        <g className="lotus-pollen-field" aria-hidden="true" filter="url(#pollen-glow)">{Array.from({ length: 34 }, (_, index) => { const x = 42 + ((index * 79) % 296); const y = 34 + ((index * 53) % 172); const size = .65 + (index % 5) * .34; return <circle key={index} className={`lotus-pollen pollen-${index % 3}`} cx={x} cy={y} r={size} style={{ "--pollen-delay": `${-(index % 11) * .73}s`, "--pollen-duration": `${5.8 + (index % 7) * .72}s`, "--pollen-x": `${((index * 17) % 25) - 12}px`, "--pollen-y": `${-12 - (index % 6) * 4}px` } as CSSProperties} />; })}</g>
        <ellipse className="lotus-aura" cx="190" cy="135" rx="150" ry="108" />
        <g className={`lotus-bloom bloom-${previewStage.petals}`} filter="url(#lotus-glow)" aria-hidden="true">{lotusPetals.map((petal) => <path key={petal.id} className={`lotus-petal ${petal.className}`} style={{ "--petal-angle": `${petal.angle}deg` } as CSSProperties} d={LOTUS_PETAL_PATH} />)}<path className="lotus-drop-shine" d="M171 76 C159 101 155 127 160 151" /></g>
        <g className="lotus-pollen-field is-foreground" aria-hidden="true" filter="url(#pollen-glow)">{Array.from({ length: 18 }, (_, index) => { const x = 126 + ((index * 67) % 132); const y = 55 + ((index * 47) % 132); return <circle key={index} className={`lotus-pollen pollen-${(index + 1) % 3}`} cx={x} cy={y} r={.55 + (index % 4) * .31} style={{ "--pollen-delay": `${-(index % 9) * .81}s`, "--pollen-duration": `${6.4 + (index % 6) * .68}s`, "--pollen-x": `${((index * 13) % 19) - 9}px`, "--pollen-y": `${-10 - (index % 5) * 4}px` } as CSSProperties} />; })}</g>
        <text className="lotus-day" x="190" y="130" textAnchor="middle">{previewDay.cycleDay}</text><text className="lotus-day-label" x="190" y="149" textAnchor="middle">день цикла</text>
      </svg><span className="lotus-tap-hint"><i />нажмите, чтобы отметить месячные</span>
    </button>
    <div className="cycle-copy"><p className="cycle-stage-count">{previewStage.petals} из 7 лепестков</p><h1 id="cycle-title">{previewDay.isToday ? `Сегодня — ${previewStage.label.toLowerCase()}` : `${relativeDayLabel(previewDay.iso)} · ${previewStage.label.toLowerCase()}`}</h1><p id="cycle-description">{previewStage.description}. {phaseHint(previewDay.phase)} — ориентировочный календарный расчёт.</p>{!previewDay.isToday && todayIndex >= 0 ? <button className="return-today" type="button" onClick={() => select(todayIndex)}>вернуться к сегодня</button> : null}</div>
    <div className="cycle-stage-legend" aria-label="Раскрытие лотоса по фазам цикла">{Object.values(STAGES).map((item) => <span key={item.key} className={item.key === previewStage.key ? "is-active" : ""} title={item.label}><i style={{ background: item.color }} /><b>{item.petals}</b></span>)}</div>
  </section>;
}
