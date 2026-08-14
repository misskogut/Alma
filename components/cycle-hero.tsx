"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import type { AlmaProfile, CyclePhase, DayModel } from "../lib/alma";
import { cycleTimingLabel, getFertilityContext, getOvulationDay, phaseLabel, relativeDayLabel } from "../lib/alma";

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
const MIN_THROW_VELOCITY = .0024;
const STOP_VELOCITY = .00072;
const FRICTION_PER_MS = .0065;
const LOTUS_PETAL_PATH = "M190 27 C159 64 141 103 142 138 C143 172 166 200 190 200 C214 200 237 172 238 138 C239 103 221 64 190 27Z";
const LOTUS_PETALS = [
  { id: "outer-left", className: "outer left", layer: "outer", side: -1 },
  { id: "outer-right", className: "outer right", layer: "outer", side: 1 },
  { id: "middle-left", className: "middle left", layer: "middle", side: -1 },
  { id: "middle-right", className: "middle right", layer: "middle", side: 1 },
  { id: "inner-left", className: "inner left", layer: "inner", side: -1 },
  { id: "inner-right", className: "inner right", layer: "inner", side: 1 },
  { id: "center", className: "lotus-drop center", layer: "center", side: 0 },
] as const;
function stageForPhase(phase: CyclePhase, cycleDay?: number, profile?: AlmaProfile) {
  if (phase === "menstruation") return STAGES.menstruation;
  if (phase === "ovulation") return STAGES.ovulation;
  // The visual flower holds five petals through the two calendar days after
  // ovulation, while the phase label has already changed to luteal.
  if (phase === "luteal" && cycleDay != null && profile && cycleDay <= getOvulationDay(profile) + 2) return STAGES.follicular;
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

function petalAngle(layer: (typeof LOTUS_PETALS)[number]["layer"], side: number, petals: LotusStage["petals"]) {
  if (layer === "center" || petals === 1) return 0;
  if (petals === 3) return 27 * side;
  if (petals === 5) return (layer === "inner" ? 27 : 52) * side;
  return (layer === "inner" ? 27 : layer === "middle" ? 52 : 76) * side;
}

export default function CycleHero({
  profile,
  days,
  activeIndex,
  workingQuickActionLabels,
  quickAccessLabels,
  selectedQuickActionLabels,
  onToggleQuickAccess,
  onUpdateQuickAccess,
  onOpenVoice,
  onSelectDay,
  onOpenPeriod,
}: {
  profile: AlmaProfile;
  days: DayModel[];
  activeIndex: number;
  workingQuickActionLabels: string[];
  quickAccessLabels: string[];
  selectedQuickActionLabels: string[];
  onToggleQuickAccess: (label: string) => void;
  onUpdateQuickAccess: (labels: string[]) => void;
  onOpenVoice: () => void;
  onSelectDay: (index: number) => void;
  onOpenPeriod: () => void;
}) {
  const [isDialInMotion, setIsDialInMotion] = useState(false);
  const [quickAccessPickerOpen, setQuickAccessPickerOpen] = useState(false);
  const [previewIndexState, setPreviewIndexState] = useState(activeIndex);
  const positionRef = useRef(activeIndex);
  const velocityRef = useRef(0);
  const pointerRef = useRef<{ x: number; time: number } | null>(null);
  const isPointerDownRef = useRef(false);
  const visualFrameRef = useRef<number | null>(null);
  const physicsFrameRef = useRef<number | null>(null);
  const physicsTimeRef = useRef<number | null>(null);
  const previewIndexRef = useRef(activeIndex);
  const dialCommitRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const dialDateRefs = useRef(new Map<number, SVGGElement>());
  const todayIndex = days.findIndex((item) => item.isToday);
  const previewIndex = clampIndex(previewIndexState, days);
  const previewDay = days[previewIndex];
  const previewStage = stageForPhase(previewDay.phase, previewDay.cycleDay, profile);
  const fertility = getFertilityContext(previewDay.cycleDay, profile);
  const lotusPetals = LOTUS_PETALS.map((petal) => ({
    ...petal,
    angle: petalAngle(petal.layer, petal.side, previewStage.petals),
  }));
  const dialDays = days.map((item, index) => ({ item, index }));

  useEffect(() => {
    if (dialCommitRef.current === activeIndex) {
      dialCommitRef.current = null;
      return;
    }

    if (isPointerDownRef.current || physicsFrameRef.current != null) return;
    positionRef.current = activeIndex;
    velocityRef.current = 0;
    previewIndexRef.current = activeIndex;
    setPreviewIndexState(activeIndex);
    requestAnimationFrame(() => paintDial(positionRef.current));
  // The parent can select a day from another control; only that external selection recentres the disk.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, days.length]);

  useEffect(() => () => {
    if (visualFrameRef.current != null) cancelAnimationFrame(visualFrameRef.current);
    if (physicsFrameRef.current != null) cancelAnimationFrame(physicsFrameRef.current);
    if (audioContextRef.current) void audioContextRef.current.close();
  }, []);

  function getAudioContext() {
    if (typeof window === "undefined") return null;
    const AudioContextClass = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!audioContextRef.current) audioContextRef.current = new AudioContextClass();
    if (audioContextRef.current.state === "suspended") void audioContextRef.current.resume();
    return audioContextRef.current;
  }

  function scheduleDateClick(delay = 0) {
    const context = getAudioContext();
    if (!context) return;
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(920, start);
    oscillator.frequency.exponentialRampToValueAtTime(460, start + .026);
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.exponentialRampToValueAtTime(.032, start + .002);
    gain.gain.exponentialRampToValueAtTime(.0001, start + .034);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + .036);
  }

  function clickCrossedDates(fromIndex: number, toIndex: number) {
    const crossings = Math.min(24, Math.abs(toIndex - fromIndex));
    for (let index = 0; index < crossings; index += 1) scheduleDateClick(index * .014);
  }

  function paintDial(position: number) {
    for (const { index } of dialDays) {
      const element = dialDateRefs.current.get(index);
      if (!element) continue;
      const visualOffset = index - position;
      const isVisible = Math.abs(visualOffset) <= 6.45;
      if (!isVisible) {
        element.style.opacity = "0";
        element.style.visibility = "hidden";
        element.style.pointerEvents = "none";
        element.setAttribute("tabindex", "-1");
        continue;
      }
      const point = arcPoint(visualOffset);
      element.setAttribute("transform", `translate(${point.x} ${point.y})`);
      element.style.opacity = String(Math.max(.18, 1 - Math.abs(visualOffset) / 11));
      element.style.visibility = "visible";
      element.style.pointerEvents = "auto";
      element.setAttribute("tabindex", "0");
    }
  }

  function updatePreview(position: number, withClick = true) {
    const nextIndex = clampIndex(Math.round(position), days);
    if (nextIndex === previewIndexRef.current) return;
    if (withClick) clickCrossedDates(previewIndexRef.current, nextIndex);
    previewIndexRef.current = nextIndex;
    setPreviewIndexState(nextIndex);
  }

  function renderPosition(position: number, withClick = true) {
    paintDial(position);
    updatePreview(position, withClick);
  }

  function scheduleVisualUpdate() {
    if (visualFrameRef.current != null) return;
    visualFrameRef.current = requestAnimationFrame(() => {
      visualFrameRef.current = null;
      renderPosition(positionRef.current);
    });
  }

  function settle() {
    const settledIndex = clampIndex(Math.round(positionRef.current), days);
    positionRef.current = settledIndex;
    velocityRef.current = 0;
    physicsTimeRef.current = null;
    renderPosition(positionRef.current, false);
    setIsDialInMotion(false);
    if (settledIndex !== activeIndex) {
      dialCommitRef.current = settledIndex;
      onSelectDay(settledIndex);
    }
  }

  function startSnap() {
    physicsTimeRef.current = null;
    const tick = (time: number) => {
      const previousTime = physicsTimeRef.current ?? time;
      const elapsed = Math.min(34, Math.max(1, time - previousTime));
      physicsTimeRef.current = time;
      const target = clampIndex(Math.round(positionRef.current), days);
      const distance = target - positionRef.current;
      positionRef.current += distance * (1 - Math.exp(-elapsed * .028));
      renderPosition(positionRef.current);
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
      const previousTime = physicsTimeRef.current ?? time;
      const elapsed = Math.min(34, Math.max(1, time - previousTime));
      physicsTimeRef.current = time;
      const before = positionRef.current;
      const next = clampIndex(before + velocityRef.current * elapsed, days);
      positionRef.current = next;
      if (next === 0 || next === days.length - 1) velocityRef.current = 0;
      else velocityRef.current *= Math.exp(-FRICTION_PER_MS * elapsed);
      renderPosition(positionRef.current);
      if (Math.abs(velocityRef.current) <= STOP_VELOCITY) {
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

  // Explicit controls are allowed to choose a day; the dial itself never calls this
  // while a date merely passes under the fixed centre ring.
  function select(index: number) {
    stopPhysics();
    positionRef.current = clampIndex(index, days);
    renderPosition(positionRef.current, false);
    settle();
  }

  function onPointerDown(event: PointerEvent<SVGSVGElement>) {
    event.preventDefault();
    stopPhysics();
    getAudioContext();
    isPointerDownRef.current = true;
    pointerRef.current = { x: event.clientX, time: event.timeStamp };
    setIsDialInMotion(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const previous = pointerRef.current;
    if (!isPointerDownRef.current || !previous) return;
    event.preventDefault();
    const elapsed = Math.max(1, event.timeStamp - previous.time);
    const delta = -(event.clientX - previous.x) / DOT_STEP;
    if (delta !== 0) {
      const nextPosition = clampIndex(positionRef.current + delta, days);
      const movement = nextPosition - positionRef.current;
      positionRef.current = nextPosition;
      velocityRef.current = velocityRef.current * .28 + (movement / elapsed) * .72;
      scheduleVisualUpdate();
    }
    pointerRef.current = { x: event.clientX, time: event.timeStamp };
  }

  function finishPointer() {
    if (!isPointerDownRef.current) return;
    isPointerDownRef.current = false;
    pointerRef.current = null;
    if (Math.abs(velocityRef.current) >= MIN_THROW_VELOCITY) startInertia();
    else startSnap();
  }

  function cancelPointer() {
    if (!isPointerDownRef.current) return;
    isPointerDownRef.current = false;
    pointerRef.current = null;
    startSnap();
  }

  function onDialKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    stopPhysics();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    positionRef.current = clampIndex(positionRef.current + direction, days);
    scheduleDateClick();
    renderPosition(positionRef.current, false);
    settle();
  }

  const customStyle = {
    "--cycle-color": previewStage.color,
  } as CSSProperties;

  function toggleQuickAccessSlot(label: string) {
    if (quickAccessLabels.includes(label)) {
      onUpdateQuickAccess(quickAccessLabels.filter((item) => item !== label));
      return;
    }
    if (quickAccessLabels.length < 5) onUpdateQuickAccess([...quickAccessLabels, label]);
  }

  return <section
    className={`cycle-hero lotus-stage-${previewStage.key}${isDialInMotion ? " is-cycle-scrubbing" : ""}`}
    style={customStyle}
    aria-labelledby="cycle-title"
    data-lotus-stage={previewStage.key}
    data-lotus-petals={previewStage.petals}
    data-selected-index={activeIndex}
    data-preview-index={previewIndex}
  >
    <div className="cosmic-dust" aria-hidden="true">{Array.from({ length: 42 }, (_, index) => <i key={index} />)}</div>

    <svg
      className={`cycle-dial${isPointerDownRef.current ? " is-dragging" : ""}`}
      viewBox="0 0 380 142"
      role="group"
      tabIndex={0}
      aria-label={`Календарь цикла. В центре: ${relativeDayLabel(previewDay.iso)}, ${previewDay.cycleDay} день цикла. Двигайте влево или вправо.`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={cancelPointer}
      onKeyDown={onDialKeyDown}
    >
      <defs>
        <filter id="dial-glow" x="-150%" y="-150%" width="400%" height="400%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {dialDays.map(({ item, index }) => {
        const visualOffset = index - positionRef.current;
        const point = arcPoint(visualOffset);
        const dotStage = stageForPhase(item.phase, item.cycleDay, profile);
        const isNear = Math.abs(visualOffset) <= 6.45;
        const month = item.dayOfMonth === 1 ? MONTH_SHORT.format(item.date).replace(".", "") : "";
        return <g
          key={item.iso}
          ref={(element) => {
            if (element) dialDateRefs.current.set(index, element);
            else dialDateRefs.current.delete(index);
          }}
          className={`dial-date${index === previewIndex ? " is-selected" : ""}${item.isToday ? " is-today" : ""}`}
          transform={`translate(${point.x} ${point.y})`}
          style={{
            "--dot-color": dotStage.color,
            opacity: isNear ? Math.max(.18, 1 - Math.abs(visualOffset) / 11) : 0,
            visibility: isNear ? "visible" : "hidden",
            pointerEvents: isNear ? "auto" : "none",
          } as CSSProperties}
          role="presentation"
          tabIndex={-1}
          aria-current={index === previewIndex ? "date" : undefined}
          aria-label={`${item.dayOfMonth} ${MONTH_SHORT.format(item.date)}, ${item.cycleDay} день цикла`}
        >
          <circle className="dial-date-dot" r={item.marker ? 3.35 : 2.45} />
          {isNear ? <text className="dial-date-number" y="15" textAnchor="middle">{item.dayOfMonth}</text> : null}
          {month ? <text className="dial-date-month" y="24" textAnchor="middle">{month}</text> : null}
        </g>;
      })}
      <g className="dial-selector" transform="translate(190 29)" style={{ "--selector-color": previewStage.color } as CSSProperties} aria-hidden="true">
        <circle className="dial-selector-aura" r="26" filter="url(#dial-glow)" />
        <circle className="dial-selector-core" r="22" />
      </g>
    </svg>

    <button className="cycle-jump previous" type="button" onClick={() => select(activeIndex - profile.cycleLength)} aria-label="Предыдущий цикл">‹</button>
    <button className="cycle-jump next" type="button" onClick={() => select(activeIndex + profile.cycleLength)} aria-label="Следующий цикл">›</button>

    <div className="phase-badge" aria-live="polite">
      <span>{cycleTimingLabel(previewDay.cycleDay, profile)}</span>
      <strong>{phaseLabel(previewDay.phase)}</strong>
    </div>

    <button className="cycle-settings-button" type="button" onClick={onOpenPeriod} aria-label="Открыть отметки цикла и дня">
      <span>отметить</span><i>＋</i>
    </button>

    <button className="cycle-lotus-button" type="button" onClick={onOpenPeriod} aria-label="Открыть календарь и отметить месячные">
      <svg className="cycle-lotus" viewBox="0 0 380 230" role="img" aria-labelledby="cycle-title cycle-description">
        <defs>
          <radialGradient id="lotus-fill">
            <stop offset="0" stopColor={previewStage.color} stopOpacity=".38" />
            <stop offset=".62" stopColor={previewStage.color} stopOpacity=".12" />
            <stop offset="1" stopColor="#030107" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="petal-fill" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor={previewStage.color} />
            <stop offset=".42" stopColor={previewStage.color} />
            <stop offset=".82" stopColor="#120718" />
            <stop offset="1" stopColor="#050108" />
          </linearGradient>
          <radialGradient id="drop-fill" cx="50%" cy="35%" r="72%">
            <stop stopColor={previewStage.color} />
            <stop offset=".48" stopColor={previewStage.color} />
            <stop offset=".82" stopColor="#100817" />
            <stop offset="1" stopColor="#050108" />
          </radialGradient>
          <filter id="lotus-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="pollen-glow" x="-300%" y="-300%" width="700%" height="700%">
            <feGaussianBlur stdDeviation="2.8" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <g className="lotus-pollen-field" aria-hidden="true" filter="url(#pollen-glow)">
          {Array.from({ length: 34 }, (_, index) => {
            const x = 42 + ((index * 79) % 296);
            const y = 34 + ((index * 53) % 172);
            const size = .65 + (index % 5) * .34;
            return <circle
              key={index}
              className={`lotus-pollen pollen-${index % 3}`}
              cx={x}
              cy={y}
              r={size}
              style={{
                "--pollen-delay": `${-(index % 11) * .73}s`,
                "--pollen-duration": `${5.8 + (index % 7) * .72}s`,
                "--pollen-x": `${((index * 17) % 25) - 12}px`,
                "--pollen-y": `${-12 - (index % 6) * 4}px`,
              } as CSSProperties}
            />;
          })}
        </g>
        <ellipse className="lotus-aura" cx="190" cy="135" rx="150" ry="108" />
        <g className={`lotus-bloom bloom-${previewStage.petals}`} filter="url(#lotus-glow)" aria-hidden="true">
          {lotusPetals.map((petal) => <path
            key={petal.id}
            className={`lotus-petal ${petal.className}`}
            style={{ "--petal-angle": `${petal.angle}deg` } as CSSProperties}
            d={LOTUS_PETAL_PATH}
          />)}
          <path className="lotus-drop-shine" d="M171 76 C159 101 155 127 160 151" />
        </g>
        <g className="lotus-pollen-field is-foreground" aria-hidden="true" filter="url(#pollen-glow)">
          {Array.from({ length: 18 }, (_, index) => {
            const x = 126 + ((index * 67) % 132);
            const y = 55 + ((index * 47) % 132);
            return <circle
              key={index}
              className={`lotus-pollen pollen-${(index + 1) % 3}`}
              cx={x}
              cy={y}
              r={.55 + (index % 4) * .31}
              style={{
                "--pollen-delay": `${-(index % 9) * .81}s`,
                "--pollen-duration": `${6.4 + (index % 6) * .68}s`,
                "--pollen-x": `${((index * 13) % 19) - 9}px`,
                "--pollen-y": `${-10 - (index % 5) * 4}px`,
              } as CSSProperties}
            />;
          })}
        </g>
        <text className="lotus-day" x="190" y="130" textAnchor="middle">{previewDay.cycleDay}</text>
        <text className="lotus-day-label" x="190" y="149" textAnchor="middle">день цикла</text>
      </svg>
      <span className="lotus-tap-hint"><i />нажмите, чтобы отметить месячные</span>
    </button>

    <div className="cycle-copy">
      <p className="cycle-stage-count">{previewStage.petals} из 7 лепестков</p>
      <h1 id="cycle-title">{fertility.label}</h1>
      <p id="cycle-description">{fertility.hint}. Календарный ориентир, не определяет безопасные дни.</p>
      {!previewDay.isToday && todayIndex >= 0 ? <button className="return-today" type="button" onClick={() => select(todayIndex)}>вернуться к сегодня</button> : null}
    </div>

    <button className="voice-trigger" type="button" onClick={onOpenVoice}><i><svg viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="voice-rainbow" x1="8" y1="8" x2="40" y2="40"><stop stopColor="#6ce8ff"/><stop offset=".34" stopColor="#a979ff"/><stop offset=".68" stopColor="#ff83c9"/><stop offset="1" stopColor="#ffd176"/></linearGradient></defs><rect x="17" y="7" width="14" height="23" rx="7"/><path d="M12 24a12 12 0 0 0 24 0M24 36v6M17 42h14"/></svg></i><span>рассказать о дне</span></button>
    <div className="cycle-quick-access" aria-label="Быстрые действия">
      {quickAccessLabels.map((label) => <button key={label} className={selectedQuickActionLabels.includes(label) ? "is-selected" : ""} type="button" aria-pressed={selectedQuickActionLabels.includes(label)} onClick={() => onToggleQuickAccess(label)}><i>✦</i><span>{label}</span></button>)}
      <button className={`cycle-quick-access-add${quickAccessPickerOpen ? " is-open" : ""}`} type="button" onClick={() => setQuickAccessPickerOpen((value) => !value)} aria-expanded={quickAccessPickerOpen} aria-label="Настроить быстрые действия">＋</button>
      {quickAccessPickerOpen && <div className="cycle-quick-picker" role="dialog" aria-label="Выбор быстрых действий"><div><p>быстрый доступ</p><button type="button" aria-label="Закрыть" onClick={() => setQuickAccessPickerOpen(false)}>×</button></div><span>Выбери до 5 действий из рабочего набора</span><section>{workingQuickActionLabels.map((label) => <button key={label} className={quickAccessLabels.includes(label) ? "is-selected" : ""} type="button" aria-pressed={quickAccessLabels.includes(label)} disabled={!quickAccessLabels.includes(label) && quickAccessLabels.length >= 5} onClick={() => toggleQuickAccessSlot(label)}><i>{quickAccessLabels.includes(label) ? "✓" : "＋"}</i>{label}</button>)}</section></div>}
    </div>
  </section>;
}
