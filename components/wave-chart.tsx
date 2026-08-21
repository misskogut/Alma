"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";
import type { ContextKey, DayModel, DeviceSignals, EnvironmentPayload, TimelineMarker, WaveLayerKey, ZoneKey } from "../lib/alma";
import { CONTEXT_META, ZONE_META, clamp } from "../lib/alma";

const SPACING = 64;
const CENTER_X = 380;
const PLOT_CENTER_Y = 122;
const PLOT_AMPLITUDE = 86;
const MIN_THROW_VELOCITY = .0022;
const STOP_VELOCITY = .00072;
const FRICTION_PER_MS = .0062;

type PlotPoint = { x: number; y: number; index: number; value: number };

const CONTEXT_DEFINITIONS: Partial<Record<ContextKey, string>> = {
  temperature: "temperature",
  pressure: "pressure",
  humidity: "humidity",
  geomagnetic: "geomagnetic_kp",
  daylight: "daylight",
  screenTime: "screen_time",
  nightPhone: "night_phone_use",
};

const ZONE_DEFINITIONS: Record<ZoneKey, string> = {
  cognitive: "cognitive_load_response",
  emotional: "emotional_load_response",
  physical: "physical_load_response",
  libido: "libido",
  social: "social_load_response",
};

function normalizedPoint(value: number) {
  return clamp(value / 100, -1, 1);
}

function pointFor(value: number, index: number, position: number): PlotPoint {
  return {
    x: CENTER_X + (index - position) * SPACING,
    y: PLOT_CENTER_Y - normalizedPoint(value) * PLOT_AMPLITUDE,
    index,
    value,
  };
}

function smoothCurve(points: PlotPoint[]) {
  if (points.length < 2) return "";
  let result = `M ${points[0].x} ${points[0].y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const before = points[index - 1] ?? points[index];
    const current = points[index];
    const next = points[index + 1];
    const after = points[index + 2] ?? next;
    result += ` C ${current.x + (next.x - before.x) / 6} ${current.y + (next.y - before.y) / 6}, ${next.x - (after.x - current.x) / 6} ${next.y - (after.y - current.y) / 6}, ${next.x} ${next.y}`;
  }
  return result;
}

function segmentsFor(values: Array<number | null>, position: number) {
  const segments: PlotPoint[][] = [];
  let current: PlotPoint[] = [];
  values.forEach((value, index) => {
    if (value == null) {
      if (current.length) segments.push(current);
      current = [];
      return;
    }
    current.push(pointFor(value, index, position));
  });
  if (current.length) segments.push(current);
  return segments;
}

function normalizeObserved(values: Array<number | null>) {
  const available = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!available.length) return values.map(() => null);
  const min = Math.min(...available);
  const max = Math.max(...available);
  if (min === max) return values.map((value) => value == null ? null : 0);
  const midpoint = (min + max) / 2;
  const radius = Math.max(max - midpoint, midpoint - min);
  return values.map((value) => value == null ? null : clamp(((value - midpoint) / radius) * 82));
}

function contextValues(key: ContextKey, days: DayModel[], environment: EnvironmentPayload | null, deviceSignals: DeviceSignals | null) {
  if (key === "cycle" || key === "screenTime" || key === "nightPhone") return days.map(() => null);
  if (key === "deviceMotion" || key === "movement" || key === "deviceTilt" || key === "phoneActivity") {
    const value = key === "deviceMotion" || key === "movement"
      ? deviceSignals?.motion ?? null
      : key === "deviceTilt"
        ? deviceSignals?.tilt ?? null
        : deviceSignals == null
          ? null
          : Math.round(deviceSignals.activeSeconds / 60);
    return normalizeObserved(days.map((day) => day.isToday ? value : null));
  }
  if (!environment) return days.map(() => null);
  if (key === "geomagnetic") {
    return normalizeObserved(days.map((day) => day.isToday ? environment.geomagnetic?.kp ?? null : null));
  }
  const byDate = new Map(environment.days.map((day) => [day.date, day]));
  return normalizeObserved(days.map((day) => {
    const source = byDate.get(day.iso);
    if (key === "temperature") return source?.temperatureC ?? null;
    if (key === "pressure") return source?.pressureHpa ?? null;
    if (key === "humidity") return source?.humidityPct ?? null;
    if (key === "daylight") return source?.daylightMinutes ?? null;
    return null;
  }));
}

function relationshipClass(definitionId: string | undefined, selectedDefinitionId: string | null, establishedDefinitionIds: Set<string>, hypothesizedDefinitionIds: Set<string>) {
  if (!selectedDefinitionId || !definitionId) return "";
  if (definitionId === selectedDefinitionId) return " is-selected-relation";
  if (establishedDefinitionIds.has(definitionId)) return " is-established-relation";
  if (hypothesizedDefinitionIds.has(definitionId)) return " is-hypothesized-relation";
  return " is-unrelated-relation";
}

function Series({ values, position, className }: { values: Array<number | null>; position: number; className: string }) {
  const segments = segmentsFor(values, position);
  return <>{segments.map((segment, index) => segment.length > 1
    ? <path key={`${className}-${index}`} className={className} d={smoothCurve(segment)} />
    : <circle key={`${className}-${index}`} className={`${className} wave-single-point`} cx={segment[0].x} cy={segment[0].y} r="2.8" />)}</>;
}

function CycleBead({ day, x }: { day: DayModel; x: number }) {
  if (!day.marker) return null;
  const statusClass = day.markerStatus === "factual" ? " is-factual" : " is-predicted";
  if (day.marker === "menstruation") return <g className={`wave-bead wave-bead-period${statusClass}`} transform={`translate(${x} 35)`}><circle r="7" /><circle r="3" /></g>;
  if (day.marker === "fertile") return <g className={`wave-bead wave-bead-fertile${statusClass}`} transform={`translate(${x} 35)`}><circle r="6" /><circle r="2.4" /></g>;
  return <g className={`wave-bead wave-bead-ovulation${statusClass}`} transform={`translate(${x} 35)`}><circle r="8" /><path d="M0 -4 L4 0 0 4 -4 0Z" /></g>;
}

const CYCLE_DEFINITIONS = ["menstruation", "menstruation_start", "ovulation_observation", "fertile_window_observation", "estimated_ovulation", "estimated_fertile_window"];

function eventForDay(day: DayModel, selectedDefinitionId: string | null) {
  const nonCycle = day.evidence.markers.filter((marker) => !CYCLE_DEFINITIONS.includes(marker.definitionId));
  return nonCycle.find((marker) => marker.definitionId === selectedDefinitionId) ?? nonCycle[0] ?? null;
}

function EventBead({ marker, count, x, selected, onSelect }: { marker: TimelineMarker; count: number; x: number; selected: boolean; onSelect: (definitionId: string) => void }) {
  const statusClass = marker.status === "factual" ? "is-factual" : marker.status === "inferred" ? "is-inferred" : marker.status === "planned" ? "is-planned" : "is-predicted";
  return <g
    className={`timeline-event-bead ${statusClass}${selected ? " is-selected" : ""}`}
    transform={`translate(${x} 203)`}
    role="button"
    tabIndex={0}
    aria-label={`${marker.label}${count > 1 ? `, ещё ${count - 1}` : ""}`}
    onPointerDown={(event) => event.stopPropagation()}
    onClick={(event) => { event.stopPropagation(); onSelect(marker.definitionId); }}
    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(marker.definitionId); } }}
  >
    <circle r="7.5" />
    <path d="M-2.8 0h5.6M0-2.8v5.6" />
    {count > 1 && <text x="9" y="-5">{count}</text>}
  </g>;
}

function evidenceStatuses(day: DayModel) {
  return [
    day.evidence.factualCount > 0 ? "factual" : null,
    day.evidence.inferredCount > 0 ? "inferred" : null,
    day.evidence.plannedCount > 0 ? "planned" : null,
    day.evidence.predictedCount > 0 ? "predicted" : null,
  ].filter((status): status is "factual" | "inferred" | "planned" | "predicted" => status != null);
}

function clampIndex(index: number, days: DayModel[]) {
  return Math.max(0, Math.min(days.length - 1, index));
}

export default function WaveChart({ days, activeIndex, activeContexts, internalWaves, activeLayers, environment, deviceSignals, confirmedCount, selectedDefinitionId, establishedDefinitionIds, hypothesizedDefinitionIds, onSelectMarker, onSelectDay, onOpenDay }: {
  days: DayModel[];
  activeIndex: number;
  activeContexts: Set<ContextKey>;
  internalWaves: Set<ZoneKey>;
  environment: EnvironmentPayload | null;
  activeLayers: Set<WaveLayerKey>;
  deviceSignals: DeviceSignals | null;
  confirmedCount: number;
  selectedDefinitionId: string | null;
  establishedDefinitionIds: Set<string>;
  hypothesizedDefinitionIds: Set<string>;
  onSelectMarker: (definitionId: string | null) => void;
  onSelectDay: (index: number) => void;
  onOpenDay: (index: number) => void;
}) {
  const [position, setPosition] = useState(activeIndex);
  const [previewIndex, setPreviewIndex] = useState(activeIndex);
  const [isMoving, setIsMoving] = useState(false);
  const positionRef = useRef(activeIndex);
  const previewRef = useRef(activeIndex);
  const pointerRef = useRef<{ x: number; time: number } | null>(null);
  const pointerDownRef = useRef(false);
  const velocityRef = useRef(0);
  const visualFrameRef = useRef<number | null>(null);
  const physicsFrameRef = useRef<number | null>(null);
  const physicsTimeRef = useRef<number | null>(null);
  const draggedRef = useRef(false);
  const parentCommitRef = useRef<number | null>(null);
  const todayIndex = days.findIndex((day) => day.isToday);
  const mainValues = days.map((day) => day.integral);
  const confirmedValues = days.map((day) => day.integralStatus === "user_confirmed" ? day.integral : null);
  const inferredValues = days.map((day) => day.integralStatus === "inferred" ? day.integral : null);
  const forecastValues = days.map((day) => day.integralStatus === "predicted" ? day.integral : null);
  const activeDay = days[previewIndex];
  const activePoint = activeDay.integral == null ? null : pointFor(activeDay.integral, previewIndex, position);
  const todayDay = days[todayIndex];
  const todayPoint = todayDay?.integral == null ? null : pointFor(todayDay.integral, todayIndex, position);
  const hasMainWave = mainValues.some((value) => value != null);

  useEffect(() => {
    if (parentCommitRef.current === activeIndex) {
      parentCommitRef.current = null;
      return;
    }
    if (pointerDownRef.current || physicsFrameRef.current != null) return;
    positionRef.current = activeIndex;
    previewRef.current = activeIndex;
    setPosition(activeIndex);
    setPreviewIndex(activeIndex);
  }, [activeIndex, days.length]);

  useEffect(() => () => {
    if (visualFrameRef.current != null) cancelAnimationFrame(visualFrameRef.current);
    if (physicsFrameRef.current != null) cancelAnimationFrame(physicsFrameRef.current);
  }, []);

  function updatePosition(next: number) {
    const bounded = clampIndex(next, days);
    positionRef.current = bounded;
    const index = clampIndex(Math.round(bounded), days);
    if (index !== previewRef.current) {
      previewRef.current = index;
      setPreviewIndex(index);
    }
    setPosition(bounded);
  }

  function scheduleVisual() {
    if (visualFrameRef.current != null) return;
    visualFrameRef.current = requestAnimationFrame(() => {
      visualFrameRef.current = null;
      updatePosition(positionRef.current);
    });
  }

  function settle() {
    const index = clampIndex(Math.round(positionRef.current), days);
    updatePosition(index);
    velocityRef.current = 0;
    physicsTimeRef.current = null;
    setIsMoving(false);
    if (index !== activeIndex) {
      parentCommitRef.current = index;
      onSelectDay(index);
    }
  }

  function startSnap() {
    physicsTimeRef.current = null;
    const tick = (time: number) => {
      const previous = physicsTimeRef.current ?? time;
      const elapsed = Math.max(1, Math.min(34, time - previous));
      physicsTimeRef.current = time;
      const target = clampIndex(Math.round(positionRef.current), days);
      const distance = target - positionRef.current;
      positionRef.current += distance * (1 - Math.exp(-elapsed * .028));
      updatePosition(positionRef.current);
      if (Math.abs(distance) < .0018) {
        physicsFrameRef.current = null;
        settle();
        return;
      }
      physicsFrameRef.current = requestAnimationFrame(tick);
    };
    physicsFrameRef.current = requestAnimationFrame(tick);
  }

  function startInertia() {
    physicsTimeRef.current = null;
    const tick = (time: number) => {
      const previous = physicsTimeRef.current ?? time;
      const elapsed = Math.max(1, Math.min(34, time - previous));
      physicsTimeRef.current = time;
      const next = clampIndex(positionRef.current + velocityRef.current * elapsed, days);
      positionRef.current = next;
      if (next === 0 || next === days.length - 1) velocityRef.current = 0;
      else velocityRef.current *= Math.exp(-FRICTION_PER_MS * elapsed);
      updatePosition(positionRef.current);
      if (Math.abs(velocityRef.current) <= STOP_VELOCITY) {
        physicsFrameRef.current = null;
        startSnap();
        return;
      }
      physicsFrameRef.current = requestAnimationFrame(tick);
    };
    physicsFrameRef.current = requestAnimationFrame(tick);
  }

  function stopPhysics() {
    if (physicsFrameRef.current != null) cancelAnimationFrame(physicsFrameRef.current);
    physicsFrameRef.current = null;
    physicsTimeRef.current = null;
    velocityRef.current = 0;
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    stopPhysics();
    pointerDownRef.current = true;
    pointerRef.current = { x: event.clientX, time: event.timeStamp };
    draggedRef.current = false;
    setIsMoving(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const previous = pointerRef.current;
    if (!pointerDownRef.current || !previous) return;
    const elapsed = Math.max(1, event.timeStamp - previous.time);
    const delta = -(event.clientX - previous.x) / SPACING;
    if (delta !== 0) {
      if (Math.abs(event.clientX - previous.x) > 2) draggedRef.current = true;
      const next = clampIndex(positionRef.current + delta, days);
      const movement = next - positionRef.current;
      positionRef.current = next;
      velocityRef.current = velocityRef.current * .28 + (movement / elapsed) * .72;
      scheduleVisual();
    }
    pointerRef.current = { x: event.clientX, time: event.timeStamp };
  }

  function finishPointer() {
    if (!pointerDownRef.current) return;
    pointerDownRef.current = false;
    pointerRef.current = null;
    if (Math.abs(velocityRef.current) >= MIN_THROW_VELOCITY) startInertia();
    else startSnap();
  }

  function onChartClick(event: MouseEvent<HTMLDivElement>) {
    if (draggedRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - rect.left) / rect.width) * 760;
    onOpenDay(clampIndex(Math.round(positionRef.current + (svgX - CENTER_X) / SPACING), days));
  }

  function keyMove(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    stopPhysics();
    updatePosition(positionRef.current + (event.key === "ArrowRight" ? 1 : -1));
    settle();
  }

  return <div className={`wave-shell${isMoving ? " is-wave-scrubbing" : ""}`} tabIndex={0} role="group" aria-label="Общая волна: свайпайте по дням" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={finishPointer} onPointerCancel={finishPointer} onKeyDown={keyMove} onClick={onChartClick}>
    <svg className="wave-chart" viewBox="0 0 760 304" role="img" aria-label="Общее самочувствие, персональные прогнозы и события по дням">
      <defs>
        <linearGradient id="integral-line" x1="0" x2="1"><stop stopColor="#755dff" /><stop offset=".48" stopColor="#d258ff" /><stop offset="1" stopColor="#ff66c9" /></linearGradient>
        <radialGradient id="active-bead"><stop stopColor="#fff" /><stop offset=".18" stopColor="#ffdcfb" /><stop offset=".48" stopColor="#d66aff" /><stop offset="1" stopColor="#50319d" /></radialGradient>
        <filter id="main-wave-glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="6" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      <g className="wave-grid">{days.map((day, index) => <line key={day.iso} x1={CENTER_X + (index - position) * SPACING} x2={CENTER_X + (index - position) * SPACING} y1="26" y2="215" />)}<line className="neutral-axis" x1="0" x2="760" y1={PLOT_CENTER_Y} y2={PLOT_CENTER_Y} /></g>
      <rect className="active-day-column" x="350" y="20" width="60" height="197" rx="30" />
      <g className="wave-layer-labels"><text x="18" y="20">самочувствие</text><text x="105" y="20">выбранный фон</text></g>

      {activeLayers.has("internal") && days.map((day, index) => {
        if (day.dailyMin == null || day.dailyMax == null || day.dailyMin === day.dailyMax) return null;
        const x = CENTER_X + (index - position) * SPACING;
        const top = pointFor(day.dailyMax, index, position).y;
        const bottom = pointFor(day.dailyMin, index, position).y;
        return <rect key={`range-${day.iso}`} className="intraday-wave-range" x={x - 8} y={top} width="16" height={Math.max(4, bottom - top)} rx="8" />;
      })}

      {Array.from(activeContexts).map((key) => {
        const definitionId = CONTEXT_DEFINITIONS[key];
        const values = contextValues(key, days, environment, deviceSignals);
        const relation = relationshipClass(definitionId, selectedDefinitionId, establishedDefinitionIds, hypothesizedDefinitionIds);
        return <g key={key} className={`related-wave${relation}`} style={{ color: CONTEXT_META[key].color }}><Series values={values} position={position} className="context-line" /></g>;
      })}

      {Array.from(internalWaves).map((key) => {
        const definitionId = ZONE_DEFINITIONS[key];
        const relation = relationshipClass(definitionId, selectedDefinitionId, establishedDefinitionIds, hypothesizedDefinitionIds);
        const values = days.map((day) => day.hasZoneObservations ? day.zones[key] : null);
        return <g key={key} className={`related-wave${relation}`} style={{ color: ZONE_META[key].color }}><Series values={values} position={position} className="internal-line" /></g>;
      })}

      {activeLayers.has("internal") && <>
        <Series values={confirmedValues} position={position} className="integral-line" />
        <Series values={inferredValues} position={position} className="inferred-line" />
        <Series values={forecastValues} position={position} className="forecast-line" />
      </>}

      {!hasMainWave && activeLayers.has("internal") && <text className="wave-empty-copy" x="380" y="116" textAnchor="middle">Общая отметка пока не добавлена</text>}

      {days.map((day, index) => {
        const x = CENTER_X + (index - position) * SPACING;
        const marker = eventForDay(day, selectedDefinitionId);
        const matchingCount = marker ? day.evidence.markers.filter((item) => selectedDefinitionId ? item.definitionId === marker.definitionId : !CYCLE_DEFINITIONS.includes(item.definitionId)).length : 0;
        return <g key={`markers-${day.iso}`}>
          <CycleBead day={day} x={x} />
          {marker && <EventBead marker={marker} count={matchingCount} x={x} selected={marker.definitionId === selectedDefinitionId} onSelect={(definitionId) => onSelectMarker(definitionId === selectedDefinitionId ? null : definitionId)} />}
        </g>;
      })}

      {previewIndex !== todayIndex && todayPoint && <g className="today-ghost"><circle cx={todayPoint.x} cy={todayPoint.y} r="4" /><text x={todayPoint.x} y={todayPoint.y - 12} textAnchor="middle">сегодня</text></g>}
      {activeLayers.has("internal") && activePoint && <g className={`active-wave-bead status-${activeDay.integralStatus}`} filter="url(#main-wave-glow)"><circle className="outer" cx={activePoint.x} cy={activePoint.y} r="17" /><circle cx={activePoint.x} cy={activePoint.y} r="7" fill="url(#active-bead)" /><circle cx={activePoint.x} cy={activePoint.y} r="2.4" fill="#fff" />{confirmedCount > 0 && activeDay.isToday && <circle className="confirmed-ring" cx={activePoint.x} cy={activePoint.y} r="13" />}</g>}

      <g className="wave-day-labels">{days.map((day, index) => {
        const x = CENTER_X + (index - position) * SPACING;
        const statuses = evidenceStatuses(day);
        return <g key={day.iso} className={`wave-day${index === previewIndex ? " is-active" : ""}${day.isForecast ? " is-forecast" : ""}`} transform={`translate(${x} 243)`}>
          <text className="calendar-date" textAnchor="middle">{day.dayOfMonth}</text>
          <text className="cycle-date" y="17" textAnchor="middle">д.{day.cycleDay}</text>
          <g className="evidence-dots" transform="translate(0 26)">{statuses.map((status, statusIndex) => <circle key={status} className={`evidence-dot is-${status}`} cx={(statusIndex - (statuses.length - 1) / 2) * 5} r={status === "factual" ? 1.8 : 1.4} />)}</g>
        </g>;
      })}</g>
    </svg>
    <div className="wave-side-fade left" /><div className="wave-side-fade right" />
    <span className="past-caption">наблюдения</span><span className="future-caption">только сохранённый прогноз</span>
    <p className="swipe-caption"><i />свайп по дням<i /></p>
  </div>;
}
