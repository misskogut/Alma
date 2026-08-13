"use client";

import { useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import type { AlmaProfile, CyclePhase, DayModel } from "../lib/alma";
import { phaseHint, relativeDayLabel } from "../lib/alma";

type LotusStage = {
  key: "menstruation" | "low" | "follicular" | "ovulation";
  label: string;
  petals: 1 | 3 | 5 | 7;
  color: string;
  description: string;
};

const STAGES: Record<LotusStage["key"], LotusStage> = {
  menstruation: {
    key: "menstruation",
    label: "Менструация",
    petals: 1,
    color: "#ff435f",
    description: "Отмеченные дни менструации",
  },
  low: {
    key: "low",
    label: "Низкая вероятность беременности",
    petals: 3,
    color: "#4fd39a",
    description: "Спокойный календарный промежуток цикла",
  },
  follicular: {
    key: "follicular",
    label: "Фолликулярная фаза",
    petals: 5,
    color: "#48a8ff",
    description: "Вероятное фертильное окно приближается",
  },
  ovulation: {
    key: "ovulation",
    label: "Овуляция",
    petals: 7,
    color: "#c45cff",
    description: "Расчётный день овуляции",
  },
};

const MONTH_SHORT = new Intl.DateTimeFormat("ru-RU", { month: "short", timeZone: "UTC" });
const DOT_STEP = 35;
const MAX_DRAG = DOT_STEP * 6;

function stageForPhase(phase: CyclePhase) {
  if (phase === "menstruation") return STAGES.menstruation;
  if (phase === "ovulation") return STAGES.ovulation;
  if (phase === "fertile") return STAGES.follicular;
  return STAGES.low;
}

function arcPoint(offset: number) {
  const normalized = Math.max(-1.08, Math.min(1.08, offset / 8.8));
  const angle = normalized * 1.14;
  return {
    x: 190 + Math.sin(angle) * 187,
    y: 27 + (1 - Math.cos(angle)) * 104,
  };
}

function clampIndex(index: number, days: DayModel[]) {
  return Math.max(0, Math.min(days.length - 1, index));
}

export default function CycleHero({
  profile,
  days,
  activeIndex,
  onSelectDay,
  onOpenPeriod,
}: {
  profile: AlmaProfile;
  days: DayModel[];
  activeIndex: number;
  onSelectDay: (index: number) => void;
  onOpenPeriod: () => void;
}) {
  const day = days[activeIndex];
  const stage = stageForPhase(day.phase);
  const [dragX, setDragX] = useState(0);
  const dragXRef = useRef(0);
  const dragStart = useRef<number | null>(null);
  const dragged = useRef(false);
  const todayIndex = days.findIndex((item) => item.isToday);
  const visibleDays = [];
  for (let index = Math.max(0, activeIndex - 10); index <= Math.min(days.length - 1, activeIndex + 10); index += 1) {
    visibleDays.push({ item: days[index], index, offset: index - activeIndex });
  }

  function select(index: number) {
    onSelectDay(clampIndex(index, days));
  }

  function onPointerDown(event: PointerEvent<SVGSVGElement>) {
    dragStart.current = event.clientX;
    dragged.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    if (dragStart.current == null) return;
    const distance = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, event.clientX - dragStart.current));
    if (Math.abs(distance) > 7) dragged.current = true;
    dragXRef.current = distance;
    setDragX(distance);
  }

  function finishDrag() {
    if (dragStart.current == null) return;
    const shift = Math.round(-dragXRef.current / DOT_STEP);
    dragStart.current = null;
    dragXRef.current = 0;
    setDragX(0);
    if (shift !== 0) select(activeIndex + shift);
  }

  function cancelDrag() {
    dragStart.current = null;
    dragXRef.current = 0;
    dragged.current = false;
    setDragX(0);
  }

  function onDialKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      select(activeIndex + (event.key === "ArrowRight" ? 1 : -1));
    }
  }

  function selectDot(index: number) {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    select(index);
  }

  const customStyle = {
    "--cycle-color": stage.color,
    "--dial-offset": `${activeIndex * .72 - dragX * .075}`,
  } as CSSProperties;

  return <section className={`cycle-hero lotus-stage-${stage.key}`} style={customStyle} aria-labelledby="cycle-title" data-lotus-stage={stage.key} data-lotus-petals={stage.petals}>
    <div className="cosmic-dust" aria-hidden="true">{Array.from({ length: 42 }, (_, index) => <i key={index} />)}</div>

    <svg
      className={`cycle-dial${dragX ? " is-dragging" : ""}`}
      viewBox="0 0 380 142"
      role="group"
      tabIndex={0}
      aria-label={`Календарь цикла. Выбрано: ${relativeDayLabel(day.iso)}, ${day.cycleDay} день цикла. Двигайте влево или вправо.`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={cancelDrag}
      onKeyDown={onDialKeyDown}
    >
      <defs>
        <linearGradient id="dial-gradient" x1="0" x2="1">
          <stop stopColor="#ff435f" />
          <stop offset=".34" stopColor="#4fd39a" />
          <stop offset=".66" stopColor="#48a8ff" />
          <stop offset="1" stopColor="#c45cff" />
        </linearGradient>
        <filter id="dial-glow" x="-150%" y="-150%" width="400%" height="400%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <path className="cycle-dial-track" d="M-7 119 C68 -7 312 -7 387 119" pathLength="100" />
      {visibleDays.map(({ item, index, offset }) => {
        const visualOffset = offset + dragX / DOT_STEP;
        if (Math.abs(visualOffset) > 9.1) return null;
        const point = arcPoint(visualOffset);
        const dotStage = stageForPhase(item.phase);
        const isActive = index === activeIndex && dragX === 0;
        const isNear = Math.abs(visualOffset) <= 5.2;
        const month = item.dayOfMonth === 1 ? MONTH_SHORT.format(item.date).replace(".", "") : "";
        return <g
          key={item.iso}
          className={`dial-date${isActive ? " is-active" : ""}${item.isToday ? " is-today" : ""}`}
          transform={`translate(${point.x} ${point.y})`}
          style={{ "--dot-color": dotStage.color, opacity: Math.max(.18, 1 - Math.abs(visualOffset) / 11) } as CSSProperties}
          role="button"
          tabIndex={isNear ? 0 : -1}
          aria-label={`${item.dayOfMonth} ${MONTH_SHORT.format(item.date)}, ${item.cycleDay} день цикла`}
          onClick={() => selectDot(index)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              selectDot(index);
            }
          }}
        >
          {isActive ? <circle className="dial-active-halo" r="13" filter="url(#dial-glow)" /> : null}
          <circle className="dial-date-dot" r={isActive ? 4.8 : item.marker ? 3.1 : 2.05} />
          {isNear ? <text className="dial-date-number" y="15" textAnchor="middle">{item.dayOfMonth}</text> : null}
          {month ? <text className="dial-date-month" y="24" textAnchor="middle">{month}</text> : null}
        </g>;
      })}
      <path className="dial-center-pointer" d="M190 50 l-4 7 h8Z" />
    </svg>

    <button className="cycle-jump previous" type="button" onClick={() => select(activeIndex - profile.cycleLength)} aria-label="Предыдущий цикл">‹</button>
    <button className="cycle-jump next" type="button" onClick={() => select(activeIndex + profile.cycleLength)} aria-label="Следующий цикл">›</button>

    <div className="phase-badge" aria-live="polite">
      <span>{relativeDayLabel(day.iso)}</span>
      <strong>{day.dayOfMonth} {MONTH_SHORT.format(day.date).replace(".", "")} · день {day.cycleDay}</strong>
    </div>

    <button className="cycle-settings-button" type="button" onClick={onOpenPeriod} aria-label="Отметить месячные и настроить цикл">
      <span>{profile.cycleLength} дней</span><i>＋</i>
    </button>

    <button className="cycle-lotus-button" type="button" onClick={onOpenPeriod} aria-label="Открыть календарь и отметить месячные">
      <svg className="cycle-lotus" viewBox="0 0 380 230" role="img" aria-labelledby="cycle-title cycle-description">
        <defs>
          <radialGradient id="lotus-fill">
            <stop offset="0" stopColor={stage.color} stopOpacity=".38" />
            <stop offset=".62" stopColor={stage.color} stopOpacity=".12" />
            <stop offset="1" stopColor="#030107" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="petal-fill" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor={stage.color} stopOpacity=".28" />
            <stop offset="1" stopColor={stage.color} stopOpacity=".035" />
          </linearGradient>
          <radialGradient id="drop-fill" cx="50%" cy="35%" r="72%">
            <stop stopColor={stage.color} stopOpacity=".48" />
            <stop offset=".52" stopColor={stage.color} stopOpacity=".2" />
            <stop offset="1" stopColor={stage.color} stopOpacity=".055" />
          </radialGradient>
          <filter id="lotus-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <ellipse className="lotus-aura" cx="190" cy="135" rx="150" ry="108" />
        <g className={`lotus-bloom bloom-${stage.petals}`} filter="url(#lotus-glow)" aria-hidden="true">
          <path className={`lotus-petal outer left${stage.petals >= 7 ? " is-visible" : ""}`} d="M190 192 C138 214 82 207 40 173 C94 151 151 163 190 192Z" />
          <path className={`lotus-petal outer right${stage.petals >= 7 ? " is-visible" : ""}`} d="M190 192 C242 214 298 207 340 173 C286 151 229 163 190 192Z" />
          <path className={`lotus-petal middle left${stage.petals >= 5 ? " is-visible" : ""}`} d="M190 191 C138 197 91 170 72 126 C121 119 167 148 190 191Z" />
          <path className={`lotus-petal middle right${stage.petals >= 5 ? " is-visible" : ""}`} d="M190 191 C242 197 289 170 308 126 C259 119 213 148 190 191Z" />
          <path className={`lotus-petal inner left${stage.petals >= 3 ? " is-visible" : ""}`} d="M190 190 C148 180 118 137 126 89 C165 101 188 141 190 190Z" />
          <path className={`lotus-petal inner right${stage.petals >= 3 ? " is-visible" : ""}`} d="M190 190 C232 180 262 137 254 89 C215 101 192 141 190 190Z" />
          <path className="lotus-petal lotus-drop center is-visible" d="M190 37 C190 37 143 95 143 140 C143 174 164 200 190 200 C216 200 237 174 237 140 C237 95 190 37 190 37Z" />
          <path className="lotus-drop-shine" d="M170 87 C160 105 157 123 160 139" />
        </g>
        <text className="lotus-day" x="190" y="130" textAnchor="middle">{day.cycleDay}</text>
        <text className="lotus-day-label" x="190" y="149" textAnchor="middle">день цикла</text>
      </svg>
      <span className="lotus-tap-hint"><i />нажмите, чтобы отметить месячные</span>
    </button>

    <div className="cycle-copy">
      <p className="cycle-stage-count">{stage.petals} из 7 лепестков</p>
      <h1 id="cycle-title">{day.isToday ? `Сегодня — ${stage.label.toLowerCase()}` : `${relativeDayLabel(day.iso)} · ${stage.label.toLowerCase()}`}</h1>
      <p id="cycle-description">{stage.description}. {phaseHint(day.phase)} — ориентировочный календарный расчёт.</p>
      {!day.isToday && todayIndex >= 0 ? <button className="return-today" type="button" onClick={() => select(todayIndex)}>вернуться к сегодня</button> : null}
    </div>

    <div className="cycle-stage-legend" aria-label="Раскрытие лотоса по фазам цикла">
      {Object.values(STAGES).map((item) => <span key={item.key} className={item.key === stage.key ? "is-active" : ""} title={item.label}><i style={{ background: item.color }} /><b>{item.petals}</b></span>)}
    </div>
  </section>;
}
