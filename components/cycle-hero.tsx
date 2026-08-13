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
const LOTUS_PETAL_PATH = "M190 27 C159 64 141 103 142 138 C143 172 166 200 190 200 C214 200 237 172 238 138 C239 103 221 64 190 27Z";
const SELECTOR_PHASE: Record<LotusStage["key"], string> = {
  menstruation: "Месячные",
  low: "Низкая фаза",
  follicular: "Фолликул.",
  ovulation: "Овуляция",
};

function stageForPhase(phase: CyclePhase) {
  if (phase === "menstruation") return STAGES.menstruation;
  if (phase === "ovulation") return STAGES.ovulation;
  if (phase === "fertile") return STAGES.follicular;
  return STAGES.low;
}

function arcPoint(offset: number) {
  const normalized = Math.max(-1.08, Math.min(1.08, offset / 6.4));
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
  const dragFrame = useRef<number | null>(null);
  const todayIndex = days.findIndex((item) => item.isToday);
  const previewShift = Math.round(-dragX / DOT_STEP);
  const previewIndex = clampIndex(activeIndex + previewShift, days);
  const previewDay = days[previewIndex];
  const previewStage = stageForPhase(previewDay.phase);
  const visibleDays = [];
  for (let index = Math.max(0, previewIndex - 8); index <= Math.min(days.length - 1, previewIndex + 8); index += 1) {
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
    const rawDistance = event.clientX - dragStart.current;
    const minDistance = -(days.length - 1 - activeIndex) * DOT_STEP;
    const maxDistance = activeIndex * DOT_STEP;
    const distance = Math.max(minDistance, Math.min(maxDistance, rawDistance));
    if (Math.abs(distance) > 7) dragged.current = true;
    dragXRef.current = distance;
    if (dragFrame.current == null) {
      dragFrame.current = requestAnimationFrame(() => {
        setDragX(dragXRef.current);
        dragFrame.current = null;
      });
    }
  }

  function finishDrag() {
    if (dragStart.current == null) return;
    const shift = Math.round(-dragXRef.current / DOT_STEP);
    if (dragFrame.current != null) cancelAnimationFrame(dragFrame.current);
    dragFrame.current = null;
    dragStart.current = null;
    dragXRef.current = 0;
    setDragX(0);
    if (shift !== 0) select(activeIndex + shift);
  }

  function cancelDrag() {
    if (dragFrame.current != null) cancelAnimationFrame(dragFrame.current);
    dragFrame.current = null;
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
        <filter id="dial-glow" x="-150%" y="-150%" width="400%" height="400%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {visibleDays.map(({ item, index, offset }) => {
        const visualOffset = offset + dragX / DOT_STEP;
        if (Math.abs(visualOffset) > 6.45) return null;
        const point = arcPoint(visualOffset);
        const dotStage = stageForPhase(item.phase);
        const isNear = Math.abs(visualOffset) <= 6.45;
        const month = item.dayOfMonth === 1 ? MONTH_SHORT.format(item.date).replace(".", "") : "";
        return <g
          key={item.iso}
          className={`dial-date${index === activeIndex ? " is-selected" : ""}${item.isToday ? " is-today" : ""}`}
          transform={`translate(${point.x} ${point.y})`}
          style={{ "--dot-color": dotStage.color, opacity: Math.max(.18, 1 - Math.abs(visualOffset) / 11) } as CSSProperties}
          role="button"
          tabIndex={isNear ? 0 : -1}
          aria-current={index === activeIndex ? "date" : undefined}
          aria-label={`${item.dayOfMonth} ${MONTH_SHORT.format(item.date)}, ${item.cycleDay} день цикла`}
          onClick={() => selectDot(index)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              selectDot(index);
            }
          }}
        >
          <circle className="dial-date-dot" r={item.marker ? 3.35 : 2.45} />
          {isNear ? <text className="dial-date-number" y="15" textAnchor="middle">{item.dayOfMonth}</text> : null}
          {month ? <text className="dial-date-month" y="24" textAnchor="middle">{month}</text> : null}
        </g>;
      })}
      <g className="dial-selector" transform="translate(190 29)" style={{ "--selector-color": previewStage.color } as CSSProperties} aria-hidden="true">
        <circle className="dial-selector-aura" r="26" filter="url(#dial-glow)" />
        <circle className="dial-selector-core" r="22" />
        <text className="dial-selector-date" y="-9" textAnchor="middle">{previewDay.isToday ? "Сегодня" : `${previewDay.dayOfMonth} ${MONTH_SHORT.format(previewDay.date).replace(".", "")}`}</text>
        <text className="dial-selector-phase" y="2" textAnchor="middle">{SELECTOR_PHASE[previewStage.key]}</text>
        <text className="dial-selector-cycle" y="12" textAnchor="middle">день цикла {previewDay.cycleDay}</text>
      </g>
    </svg>

    <button className="cycle-jump previous" type="button" onClick={() => select(activeIndex - profile.cycleLength)} aria-label="Предыдущий цикл">‹</button>
    <button className="cycle-jump next" type="button" onClick={() => select(activeIndex + profile.cycleLength)} aria-label="Следующий цикл">›</button>

    <div className="phase-badge" aria-live="polite">
      <span>{relativeDayLabel(day.iso)}</span>
      <strong>{day.dayOfMonth} {MONTH_SHORT.format(day.date).replace(".", "")} · {stage.label.toLowerCase()}</strong>
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
            <stop stopColor={stage.color} />
            <stop offset=".42" stopColor={stage.color} />
            <stop offset=".82" stopColor="#120718" />
            <stop offset="1" stopColor="#050108" />
          </linearGradient>
          <radialGradient id="drop-fill" cx="50%" cy="35%" r="72%">
            <stop stopColor={stage.color} />
            <stop offset=".48" stopColor={stage.color} />
            <stop offset=".82" stopColor="#100817" />
            <stop offset="1" stopColor="#050108" />
          </radialGradient>
          <filter id="lotus-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <ellipse className="lotus-aura" cx="190" cy="135" rx="150" ry="108" />
        <g className={`lotus-bloom bloom-${stage.petals}`} filter="url(#lotus-glow)" aria-hidden="true">
          <path className={`lotus-petal outer left${stage.petals >= 7 ? " is-visible" : ""}`} d={LOTUS_PETAL_PATH} />
          <path className={`lotus-petal outer right${stage.petals >= 7 ? " is-visible" : ""}`} d={LOTUS_PETAL_PATH} />
          <path className={`lotus-petal middle left${stage.petals >= 5 ? " is-visible" : ""}`} d={LOTUS_PETAL_PATH} />
          <path className={`lotus-petal middle right${stage.petals >= 5 ? " is-visible" : ""}`} d={LOTUS_PETAL_PATH} />
          <path className={`lotus-petal inner left${stage.petals >= 3 ? " is-visible" : ""}`} d={LOTUS_PETAL_PATH} />
          <path className={`lotus-petal inner right${stage.petals >= 3 ? " is-visible" : ""}`} d={LOTUS_PETAL_PATH} />
          <path className="lotus-petal lotus-drop center is-visible" d={LOTUS_PETAL_PATH} />
          <path className="lotus-drop-shine" d="M171 76 C159 101 155 127 160 151" />
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
