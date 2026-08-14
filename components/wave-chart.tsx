"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";
import type { ContextKey, DayModel, DeviceSignals, EnvironmentPayload, WaveLayerKey, ZoneKey } from "../lib/alma";
import { CONTEXT_META, ZONE_META, clamp, relativeDayLabel } from "../lib/alma";

const SPACING = 64;
const CENTER_X = 380;
const PLOT_CENTER_Y = 122;
const PLOT_AMPLITUDE = 86;
const MIN_THROW_VELOCITY = .0022;
const STOP_VELOCITY = .00072;
const FRICTION_PER_MS = .0062;

function normalizedPoint(value: number) { return clamp(value / 100, -1, 1); }
function pointsFor(values: number[], position: number) {
  return values.map((value, index) => ({ x: CENTER_X + (index - position) * SPACING, y: PLOT_CENTER_Y - normalizedPoint(value) * PLOT_AMPLITUDE }));
}
function smoothCurve(points: Array<{ x: number; y: number }>) {
  if (points.length < 2) return "";
  let result = `M ${points[0].x} ${points[0].y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const before = points[index - 1] ?? points[index];
    const current = points[index]; const next = points[index + 1]; const after = points[index + 2] ?? next;
    result += ` C ${current.x + (next.x - before.x) / 6} ${current.y + (next.y - before.y) / 6}, ${next.x - (after.x - current.x) / 6} ${next.y - (after.y - current.y) / 6}, ${next.x} ${next.y}`;
  }
  return result;
}

type PhysicalRange = { min: number; neutral: number; max: number };
const PHYSICAL_RANGES: Partial<Record<ContextKey, PhysicalRange>> = {
  temperature: { min: -40, neutral: 0, max: 40 }, pressure: { min: 950, neutral: 1013, max: 1075 },
  humidity: { min: 0, neutral: 50, max: 100 }, daylight: { min: 0, neutral: 720, max: 1440 }, geomagnetic: { min: 0, neutral: 4.5, max: 9 },
};
function physicalToWave(value: number | null, range: PhysicalRange) {
  if (value == null) return 0;
  const bounded = Math.max(range.min, Math.min(range.max, value));
  if (bounded === range.neutral) return 0;
  return bounded < range.neutral ? -((range.neutral - bounded) / (range.neutral - range.min)) * 100 : ((bounded - range.neutral) / (range.max - range.neutral)) * 100;
}
function contextValues(key: ContextKey, days: DayModel[], environment: EnvironmentPayload | null, deviceSignals: DeviceSignals | null) {
  if (key === "cycle") return days.map((day) => Math.sin(((day.cycleDay - 1) / 28) * Math.PI * 2 - 1.2) * 64);
  const deviceValue = key === "deviceMotion" || key === "movement" ? deviceSignals?.motion ?? null : key === "deviceTilt" ? deviceSignals?.tilt == null ? null : Math.round(((deviceSignals.tilt - 45) / 45) * 100) : key === "phoneActivity" ? Math.min(100, Math.round((deviceSignals?.activeSeconds ?? 0) / 6)) : null;
  if (["screenTime", "nightPhone"].includes(key)) return [];
  if (deviceValue != null) return days.map((day) => day.isToday ? deviceValue : 0);
  if (!environment) return [];
  if (key === "geomagnetic") return days.map((day) => day.isToday ? physicalToWave(environment.geomagnetic?.kp ?? null, PHYSICAL_RANGES.geomagnetic!) : 0);
  const range = PHYSICAL_RANGES[key]; if (!range) return [];
  const byDate = new Map(environment.days.map((day) => [day.date, day]));
  return days.map((day) => {
    const source = byDate.get(day.iso);
    const raw = key === "temperature" ? source?.temperatureC ?? null : key === "pressure" ? source?.pressureHpa ?? null : key === "humidity" ? source?.humidityPct ?? null : source?.daylightMinutes ?? null;
    return physicalToWave(raw, range);
  });
}
function averageWave(series: number[][]) {
  if (!series.length) return [];
  return series[0].map((_, index) => Math.round(series.reduce((sum, values) => sum + values[index], 0) / series.length));
}
function clampIndex(index: number, days: DayModel[]) { return Math.max(0, Math.min(days.length - 1, index)); }
function WaveBead({ day, point }: { day: DayModel; point: { x: number; y: number } }) {
  if (!day.marker) return null;
  if (day.marker === "menstruation") return <g className="wave-bead wave-bead-period" transform={`translate(${point.x} ${point.y})`}><circle r="7" /><circle r="3" /></g>;
  if (day.marker === "fertile") return <g className="wave-bead wave-bead-fertile" transform={`translate(${point.x} ${point.y})`}><circle r="6" /><circle r="2.4" /></g>;
  return <g className="wave-bead wave-bead-ovulation" transform={`translate(${point.x} ${point.y})`}><circle r="8" /><path d="M0 -4 L4 0 0 4 -4 0Z" /></g>;
}

export default function WaveChart({ days, activeIndex, activeContexts, internalWaves, activeLayers, environment, deviceSignals, confirmedCount, onSelectDay, onOpenDay }: {
  days: DayModel[]; activeIndex: number; activeContexts: Set<ContextKey>; internalWaves: Set<ZoneKey>; environment: EnvironmentPayload | null;
  activeLayers: Set<WaveLayerKey>;
  deviceSignals: DeviceSignals | null;
  confirmedCount: number; onSelectDay: (index: number) => void; onOpenDay: (index: number) => void;
}) {
  const [position, setPosition] = useState(activeIndex);
  const [previewIndex, setPreviewIndex] = useState(activeIndex);
  const [isMoving, setIsMoving] = useState(false);
  const positionRef = useRef(activeIndex); const previewRef = useRef(activeIndex);
  const pointerRef = useRef<{ x: number; time: number } | null>(null); const pointerDownRef = useRef(false);
  const velocityRef = useRef(0); const visualFrameRef = useRef<number | null>(null); const physicsFrameRef = useRef<number | null>(null);
  const physicsTimeRef = useRef<number | null>(null); const draggedRef = useRef(false); const parentCommitRef = useRef<number | null>(null);
  const todayIndex = days.findIndex((day) => day.isToday);
  const integral = pointsFor(days.map((day) => day.integral), position);
  const naturalKeys: ContextKey[] = ["temperature", "pressure", "humidity", "geomagnetic", "daylight"];
  const behaviorKeys: ContextKey[] = ["deviceMotion", "deviceTilt", "phoneActivity"];
  const externalWave = averageWave(naturalKeys.map((key) => contextValues(key, days, environment, deviceSignals)));
  const behaviorWave = averageWave(behaviorKeys.map((key) => contextValues(key, days, environment, deviceSignals)).filter((values) => values.length));
  const actual = integral.slice(0, todayIndex + 1); const forecast = integral.slice(todayIndex);
  const activePoint = integral[previewIndex]; const todayPoint = integral[todayIndex];

  useEffect(() => {
    if (parentCommitRef.current === activeIndex) { parentCommitRef.current = null; return; }
    if (pointerDownRef.current || physicsFrameRef.current != null) return;
    positionRef.current = activeIndex; previewRef.current = activeIndex; setPosition(activeIndex); setPreviewIndex(activeIndex);
  }, [activeIndex, days.length]);
  useEffect(() => () => { if (visualFrameRef.current != null) cancelAnimationFrame(visualFrameRef.current); if (physicsFrameRef.current != null) cancelAnimationFrame(physicsFrameRef.current); }, []);

  function updatePosition(next: number) {
    const bounded = clampIndex(next, days); positionRef.current = bounded;
    const index = clampIndex(Math.round(bounded), days);
    if (index !== previewRef.current) { previewRef.current = index; setPreviewIndex(index); }
    setPosition(bounded);
  }
  function scheduleVisual() {
    if (visualFrameRef.current != null) return;
    visualFrameRef.current = requestAnimationFrame(() => { visualFrameRef.current = null; updatePosition(positionRef.current); });
  }
  function settle() {
    const index = clampIndex(Math.round(positionRef.current), days);
    updatePosition(index); velocityRef.current = 0; physicsTimeRef.current = null; setIsMoving(false);
    if (index !== activeIndex) { parentCommitRef.current = index; onSelectDay(index); }
  }
  function startSnap() {
    physicsTimeRef.current = null;
    const tick = (time: number) => {
      const previous = physicsTimeRef.current ?? time; const elapsed = Math.max(1, Math.min(34, time - previous)); physicsTimeRef.current = time;
      const target = clampIndex(Math.round(positionRef.current), days); const distance = target - positionRef.current;
      positionRef.current += distance * (1 - Math.exp(-elapsed * .028)); updatePosition(positionRef.current);
      if (Math.abs(distance) < .0018) { physicsFrameRef.current = null; settle(); return; }
      physicsFrameRef.current = requestAnimationFrame(tick);
    }; physicsFrameRef.current = requestAnimationFrame(tick);
  }
  function startInertia() {
    physicsTimeRef.current = null;
    const tick = (time: number) => {
      const previous = physicsTimeRef.current ?? time; const elapsed = Math.max(1, Math.min(34, time - previous)); physicsTimeRef.current = time;
      const next = clampIndex(positionRef.current + velocityRef.current * elapsed, days); positionRef.current = next;
      if (next === 0 || next === days.length - 1) velocityRef.current = 0; else velocityRef.current *= Math.exp(-FRICTION_PER_MS * elapsed);
      updatePosition(positionRef.current);
      if (Math.abs(velocityRef.current) <= STOP_VELOCITY) { physicsFrameRef.current = null; startSnap(); return; }
      physicsFrameRef.current = requestAnimationFrame(tick);
    }; physicsFrameRef.current = requestAnimationFrame(tick);
  }
  function stopPhysics() { if (physicsFrameRef.current != null) cancelAnimationFrame(physicsFrameRef.current); physicsFrameRef.current = null; physicsTimeRef.current = null; velocityRef.current = 0; }
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    stopPhysics(); pointerDownRef.current = true; pointerRef.current = { x: event.clientX, time: event.timeStamp }; draggedRef.current = false; setIsMoving(true); event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const previous = pointerRef.current; if (!pointerDownRef.current || !previous) return;
    const elapsed = Math.max(1, event.timeStamp - previous.time); const delta = -(event.clientX - previous.x) / SPACING;
    if (delta !== 0) { if (Math.abs(event.clientX - previous.x) > 2) draggedRef.current = true; const next = clampIndex(positionRef.current + delta, days); const movement = next - positionRef.current; positionRef.current = next; velocityRef.current = velocityRef.current * .28 + (movement / elapsed) * .72; scheduleVisual(); }
    pointerRef.current = { x: event.clientX, time: event.timeStamp };
  }
  function finishPointer() { if (!pointerDownRef.current) return; pointerDownRef.current = false; pointerRef.current = null; if (Math.abs(velocityRef.current) >= MIN_THROW_VELOCITY) startInertia(); else startSnap(); }
  function onChartClick(event: MouseEvent<HTMLDivElement>) {
    if (draggedRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect(); const svgX = ((event.clientX - rect.left) / rect.width) * 760;
    onOpenDay(clampIndex(Math.round(positionRef.current + (svgX - CENTER_X) / SPACING), days));
  }
  function keyMove(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault(); stopPhysics(); updatePosition(positionRef.current + (event.key === "ArrowRight" ? 1 : -1)); settle();
  }

  return <div className={`wave-shell${isMoving ? " is-wave-scrubbing" : ""}`} tabIndex={0} role="group" aria-label="Субъективная волна: свайпайте по дням" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={finishPointer} onPointerCancel={finishPointer} onKeyDown={keyMove} onClick={onChartClick}>
    <svg className="wave-chart" viewBox="0 0 760 304" role="img" aria-label="Интегральная субъективная волна по дням цикла">
      <defs>
        <linearGradient id="integral-line" x1="0" x2="1"><stop stopColor="#755dff" /><stop offset=".48" stopColor="#d258ff" /><stop offset="1" stopColor="#ff66c9" /></linearGradient>
        <linearGradient id="integral-area" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#b256ff" stopOpacity=".2" /><stop offset="1" stopColor="#521f86" stopOpacity="0" /></linearGradient>
        <radialGradient id="active-bead"><stop stopColor="#fff" /><stop offset=".18" stopColor="#ffdcfb" /><stop offset=".48" stopColor="#d66aff" /><stop offset="1" stopColor="#50319d" /></radialGradient>
        <filter id="main-wave-glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="6" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      <g className="wave-grid">{days.map((day, index) => <line key={day.iso} x1={CENTER_X + (index - position) * SPACING} x2={CENTER_X + (index - position) * SPACING} y1="26" y2="215" />)}<line className="neutral-axis" x1="0" x2="760" y1={PLOT_CENTER_Y} y2={PLOT_CENTER_Y} /></g>
      <rect className="active-day-column" x="350" y="20" width="60" height="197" rx="30" />
      <g className="wave-layer-labels"><text x="18" y="20">внутренняя</text><text x="100" y="20">внешняя</text></g>
      {Array.from(activeContexts).map((key) => { const values = contextValues(key, days, environment, deviceSignals); return values.length ? <path key={key} className="context-line" style={{ stroke: CONTEXT_META[key].color }} d={smoothCurve(pointsFor(values, position))} /> : null; })}
      {Array.from(internalWaves).map((key) => <path key={key} className="internal-line" style={{ stroke: ZONE_META[key].color }} d={smoothCurve(pointsFor(days.map((day) => day.zones[key]), position))} />)}
      {activeLayers.has("external") && externalWave.length > 0 && <path className="external-wave" d={smoothCurve(pointsFor(externalWave, position))} />}
      {activeLayers.has("behavior") && <path className="behavior-wave" d={smoothCurve(pointsFor(behaviorWave, position))} />}
      {activeLayers.has("internal") && <><path className="integral-area" d={`${smoothCurve(actual)} L ${actual.at(-1)?.x} 205 L ${actual[0].x} 205 Z`} /><path className="integral-line" d={smoothCurve(actual)} /><path className="forecast-line" d={smoothCurve(forecast)} />
      {integral.map((point, index) => <WaveBead key={days[index].iso} day={days[index]} point={point} />)}</>}
      {previewIndex !== todayIndex && <g className="today-ghost"><circle cx={todayPoint.x} cy={todayPoint.y} r="4" /><text x={todayPoint.x} y={todayPoint.y - 12} textAnchor="middle">сегодня</text></g>}
      {activeLayers.has("internal") && <g className="active-wave-bead" filter="url(#main-wave-glow)"><circle className="outer" cx={activePoint.x} cy={activePoint.y} r="17" /><circle cx={activePoint.x} cy={activePoint.y} r="7" fill="url(#active-bead)" /><circle cx={activePoint.x} cy={activePoint.y} r="2.4" fill="#fff" />{confirmedCount > 0 && days[previewIndex].isToday && <circle className="confirmed-ring" cx={activePoint.x} cy={activePoint.y} r="13" />}</g>}
      <g className="wave-day-labels">{days.map((day, index) => { const x = CENTER_X + (index - position) * SPACING; return <g key={day.iso} className={`wave-day${index === previewIndex ? " is-active" : ""}${day.isForecast ? " is-forecast" : ""}`} transform={`translate(${x} 243)`}><text className="calendar-date" textAnchor="middle">{day.dayOfMonth}</text><text className="cycle-date" y="17" textAnchor="middle">д.{day.cycleDay}</text></g>; })}</g>
    </svg>
    <div className="wave-side-fade left" /><div className="wave-side-fade right" /><span className="past-caption">факт</span><span className="future-caption">вероятный фон</span><p className="swipe-caption"><i />свайп по дням<i /></p>
  </div>;
}
