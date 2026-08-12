"use client";

import { useRef } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";
import type { ContextKey, DayModel, EnvironmentPayload, ZoneKey } from "../lib/alma";
import { CONTEXT_META, ZONE_META, relativeDayLabel } from "../lib/alma";

const SPACING = 64;
const CENTER_X = 380;

function pointsFor(values: number[], activeIndex: number) {
  return values.map((value, index) => ({ x: CENTER_X + (index - activeIndex) * SPACING, y: 130 - value * 0.72 }));
}

function smoothCurve(points: Array<{ x: number; y: number }>) {
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

function normalize(values: Array<number | null>, scale = 38) {
  const real = values.filter((value): value is number => typeof value === "number");
  if (!real.length) return [];
  const min = Math.min(...real);
  const max = Math.max(...real);
  const middle = (min + max) / 2;
  const spread = Math.max(1, max - min);
  return values.map((value) => value == null ? 0 : ((value - middle) / spread) * scale * 2);
}

function contextValues(key: ContextKey, days: DayModel[], environment: EnvironmentPayload | null) {
  if (key === "cycle") {
    return days.map((day) => Math.sin(((day.cycleDay - 1) / Math.max(1, 28)) * Math.PI * 2 - 1.2) * 31);
  }
  if (!environment) return [];
  if (key === "geomagnetic") {
    const kp = environment.geomagnetic?.kp;
    return days.map((day) => day.isToday && kp != null ? (kp - 4.5) * 9 : 0);
  }
  const byDate = new Map(environment.days.map((day) => [day.date, day]));
  const raw = days.map((day) => {
    const item = byDate.get(day.iso);
    if (!item) return null;
    if (key === "temperature") return item.temperatureC;
    if (key === "pressure") return item.pressureHpa;
    if (key === "humidity") return item.humidityPct;
    return item.daylightMinutes;
  });
  return normalize(raw, key === "daylight" ? 28 : 38);
}

function CycleRailMarker({ day, x }: { day: DayModel; x: number }) {
  if (day.marker === "menstruation") return <g className="rail-marker rail-period" transform={`translate(${x} 215)`}><path d="M0 -6 C4 -2 5 2 0 7 C-5 2 -4 -2 0 -6Z" /><circle r="10" /></g>;
  if (day.marker === "fertile") return <g className="rail-marker rail-fertile" transform={`translate(${x} 215)`}><circle r="4" /><circle className="halo" r="10" /></g>;
  if (day.marker === "ovulation") return <g className="rail-marker rail-ovulation" transform={`translate(${x} 215)`}><path d="M0 -8 C4 -5 5 -1 3 3 C1 6 -1 6 -3 3 C-5 -1 -4 -5 0 -8Z" /><circle className="halo" r="13" /></g>;
  return <circle className="rail-empty" cx={x} cy="215" r="1.4" />;
}

export default function WaveChart({
  days,
  activeIndex,
  activeContexts,
  internalWaves,
  environment,
  confirmedCount,
  onSelectDay,
  onOpenDay,
}: {
  days: DayModel[];
  activeIndex: number;
  activeContexts: Set<ContextKey>;
  internalWaves: Set<ZoneKey>;
  environment: EnvironmentPayload | null;
  confirmedCount: number;
  onSelectDay: (index: number) => void;
  onOpenDay: (index: number) => void;
}) {
  const dragStart = useRef<number | null>(null);
  const dragged = useRef(false);
  const todayIndex = days.findIndex((day) => day.isToday);
  const integral = pointsFor(days.map((day) => day.integral), activeIndex);
  const actual = integral.slice(0, todayIndex + 1);
  const forecast = integral.slice(todayIndex);
  const activePoint = integral[activeIndex];
  const todayPoint = integral[todayIndex];

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    dragStart.current = event.clientX;
    dragged.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (dragStart.current != null && Math.abs(event.clientX - dragStart.current) > 12) dragged.current = true;
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (dragStart.current == null) return;
    const distance = event.clientX - dragStart.current;
    dragStart.current = null;
    if (Math.abs(distance) < 32) return;
    onSelectDay(Math.max(0, Math.min(days.length - 1, activeIndex + (distance < 0 ? 1 : -1))));
  }

  function keyOpen(event: KeyboardEvent<SVGGElement>, index: number) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpenDay(index);
    }
  }

  function onChartClick(event: MouseEvent<HTMLDivElement>) {
    if (dragged.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - rect.left) / rect.width) * 760;
    const offset = Math.round((svgX - CENTER_X) / SPACING);
    const index = activeIndex + offset;
    if (index >= 0 && index < days.length) onOpenDay(index);
  }

  return <div className="wave-shell" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onClick={onChartClick}>
    <svg className="wave-chart" viewBox="0 0 760 304" role="img" aria-label="Интегральная субъективная волна по дням цикла">
      <defs>
        <linearGradient id="integral-line" x1="0" x2="1"><stop stopColor="#755dff" /><stop offset=".48" stopColor="#d258ff" /><stop offset="1" stopColor="#ff66c9" /></linearGradient>
        <linearGradient id="integral-area" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#b256ff" stopOpacity=".2" /><stop offset="1" stopColor="#521f86" stopOpacity="0" /></linearGradient>
        <radialGradient id="active-bead"><stop stopColor="#fff" /><stop offset=".18" stopColor="#ffdcfb" /><stop offset=".48" stopColor="#d66aff" /><stop offset="1" stopColor="#50319d" /></radialGradient>
        <filter id="main-wave-glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="6" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>

      <g className="wave-grid">
        {days.map((day, index) => <line key={day.iso} x1={CENTER_X + (index - activeIndex) * SPACING} x2={CENTER_X + (index - activeIndex) * SPACING} y1="26" y2="225" />)}
        <line className="neutral-axis" x1="0" x2="760" y1="130" y2="130" />
      </g>
      <rect className="active-day-column" x="350" y="20" width="60" height="207" rx="30" />

      {Array.from(activeContexts).map((key) => {
        const values = contextValues(key, days, environment);
        return values.length ? <path key={key} className="context-line" style={{ stroke: CONTEXT_META[key].color }} d={smoothCurve(pointsFor(values, activeIndex))} /> : null;
      })}
      {Array.from(internalWaves).map((key) => <path key={key} className="internal-line" style={{ stroke: ZONE_META[key].color }} d={smoothCurve(pointsFor(days.map((day) => day.zones[key]), activeIndex))} />)}

      <path className="integral-area" d={`${smoothCurve(actual)} L ${actual.at(-1)?.x} 205 L ${actual[0].x} 205 Z`} />
      <path className="integral-line" d={smoothCurve(actual)} />
      <path className="forecast-line" d={smoothCurve(forecast)} />

      {activeIndex !== todayIndex && <g className="today-ghost"><circle cx={todayPoint.x} cy={todayPoint.y} r="4" /><text x={todayPoint.x} y={todayPoint.y - 12} textAnchor="middle">сегодня</text></g>}
      <g className="active-wave-bead" filter="url(#main-wave-glow)">
        <circle className="outer" cx={activePoint.x} cy={activePoint.y} r="17" />
        <circle cx={activePoint.x} cy={activePoint.y} r="7" fill="url(#active-bead)" />
        <circle cx={activePoint.x} cy={activePoint.y} r="2.4" fill="#fff" />
        {confirmedCount > 0 && days[activeIndex].isToday && <circle className="confirmed-ring" cx={activePoint.x} cy={activePoint.y} r="13" />}
      </g>

      <g className="cycle-rail">
        <line x1="0" x2="760" y1="215" y2="215" />
        {days.map((day, index) => <CycleRailMarker key={day.iso} day={day} x={CENTER_X + (index - activeIndex) * SPACING} />)}
      </g>

      <g className="wave-day-labels">
        {days.map((day, index) => {
          const x = CENTER_X + (index - activeIndex) * SPACING;
          return <g key={day.iso} className={`wave-day${index === activeIndex ? " is-active" : ""}${day.isForecast ? " is-forecast" : ""}`} transform={`translate(${x} 253)`} role="button" tabIndex={0} aria-label={`${relativeDayLabel(day.iso)}, ${day.cycleDay} день цикла`} onKeyDown={(event) => keyOpen(event, index)}>
            <rect x="-29" y="-25" width="58" height="52" fill="transparent" />
            <text className="calendar-date" textAnchor="middle">{day.dayOfMonth}</text>
            <text className="cycle-date" y="17" textAnchor="middle">д.{day.cycleDay}</text>
          </g>;
        })}
      </g>
    </svg>
    <div className="wave-side-fade left" /><div className="wave-side-fade right" />
    <span className="past-caption">факт</span><span className="future-caption">вероятный фон</span>
    <p className="swipe-caption"><i />свайп по дням<i /></p>
  </div>;
}
