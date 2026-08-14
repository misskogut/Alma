"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { AlmaProfile, ContextKey, DayModel, DeviceSignals, EnvironmentPayload, SymptomEntry, WaveLayerKey, ZoneKey } from "../lib/alma";
import { CONTEXT_META, ZONE_META, addDays, dateFromIso, daysBetween, feelingLabel, findDirectionalCoincidence, formatShortDate, isoFromDate, phaseLabel, pressureMmHg, relativeDayLabel, todayIso, weatherLabel } from "../lib/alma";

function SheetLayer({ children, onClose, className = "" }: { children: React.ReactNode; onClose: () => void; className?: string }) {
  useEffect(() => {
    function close(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  useEffect(() => {
    // iOS can otherwise pass a vertical gesture through a fixed sheet to the
    // document beneath it. Keep the page in place and let the sheet own scroll.
    const scrollY = window.scrollY;
    const body = document.body;
    const root = document.documentElement;
    const previous = { position: body.style.position, top: body.style.top, width: body.style.width, overflow: body.style.overflow, rootOverflow: root.style.overflow };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
    root.style.overflow = "hidden";
    return () => {
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.width = previous.width;
      body.style.overflow = previous.overflow;
      root.style.overflow = previous.rootOverflow;
      window.scrollTo(0, scrollY);
    };
  }, []);

  return <div className={`sheet-layer ${className}`} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>{children}</div>;
}

export function DaySheet({ day, environment, symptoms, activeContexts, internalWaves, activeLayers, deviceSignals, onClose }: {
  day: DayModel; environment: EnvironmentPayload | null; symptoms: SymptomEntry[]; activeContexts: Set<ContextKey>; internalWaves: Set<ZoneKey>; activeLayers: Set<WaveLayerKey>; deviceSignals: DeviceSignals | null; onClose: () => void;
}) {
  const external = environment?.days.find((item) => item.date === day.iso) ?? (environment?.current.date === day.iso ? environment.current : null);
  const confirmed = symptoms.filter((symptom) => symptom.status === "confirmed");
  const visibleInternal = (Array.from(internalWaves) as ZoneKey[]).filter((key) => ["cognitive", "emotional", "libido", "social"].includes(key));
  const externalRows: Array<{ key: ContextKey; value: string; detail: string }> = [
    { key: "temperature", value: external?.temperatureC == null ? "—" : `${Math.round(external.temperatureC)}°`, detail: weatherLabel(external?.weatherCode ?? null) },
    { key: "pressure", value: external?.pressureHpa == null ? "—" : `${pressureMmHg(external.pressureHpa)} мм`, detail: external?.pressureHpa == null ? "история не получена" : `${Math.round(external.pressureHpa)} гПа` },
    { key: "humidity", value: external?.humidityPct == null ? "—" : `${Math.round(external.humidityPct)}%`, detail: "внешняя среда" },
    { key: "daylight", value: external?.daylightMinutes == null ? "—" : `${Math.floor(external.daylightMinutes / 60)} ч ${external.daylightMinutes % 60} мин`, detail: "восход → закат" },
    { key: "geomagnetic", value: environment?.geomagnetic ? `Kp ${environment.geomagnetic.kp.toFixed(1)}` : "—", detail: "геомагнитный фон" },
  ];
  const visibleExternal = externalRows.filter((row) => activeContexts.has(row.key));
  const visibleBehavior = (["screenTime", "nightPhone", "movement", "phoneActivity"] as ContextKey[]).filter((key) => activeContexts.has(key));
  const allContextReport = external ? `Во внешней среде: ${external.temperatureC == null ? "температура уточняется" : `${Math.round(external.temperatureC)}°`}, ${external.pressureHpa == null ? "давление уточняется" : `${pressureMmHg(external.pressureHpa)} мм`}, влажность ${external.humidityPct == null ? "уточняется" : `${Math.round(external.humidityPct)}%`}.` : "Внешние данные ещё загружаются; внутреннее состояние остаётся отдельной волной.";
  const ordered = (Object.keys(day.zones) as ZoneKey[]).sort((a, b) => day.zones[a] - day.zones[b]);
  const report = `${ZONE_META[ordered[0]].short} сейчас ниже, ${ZONE_META[ordered.at(-1) ?? ordered[0]].short} выше. ${allContextReport} Это контекст для наблюдения, а не вывод о причине.`;

  return <SheetLayer onClose={onClose}>
    <section className="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="day-sheet-title">
      <div className="sheet-handle" />
      <header className="sheet-header"><div><p className="eyebrow">{relativeDayLabel(day.iso)}</p><h2 id="day-sheet-title">{formatShortDate(day.iso)}</h2></div><button type="button" aria-label="Закрыть" onClick={onClose}>×</button></header>

      <div className={`day-cycle-summary marker-${day.marker ?? "none"}`}>
        <div><strong>{day.cycleDay}</strong><small>день цикла</small></div>
        <p><b>{phaseLabel(day.phase)}</b><span>{day.marker === "menstruation" ? "День менструации отмечен красной бусиной" : day.marker === "ovulation" ? "Расчётная овуляция отмечена светящейся бусиной" : day.marker === "fertile" ? "Вероятное фертильное окно" : "Календарный фон цикла"}</span></p>
      </div>

      <article className="day-report"><p className="eyebrow">краткий отчёт</p><p>{report}</p></article>

      <p className="sheet-section-label">Включённые слои</p>
      {activeLayers.has("internal") && <div className="absolute-data-grid layer-data"><article><small>Внутренняя среда</small><strong>{day.integral > 0 ? "+" : ""}{day.integral}</strong><em>средняя волна</em></article>{visibleInternal.map((zone) => <article key={zone}><small>{ZONE_META[zone].short}</small><strong>{day.zones[zone] > 0 ? "+" : ""}{day.zones[zone]}</strong><em>{feelingLabel(day.zones[zone])}</em></article>)}</div>}
      {activeLayers.has("external") && <div className="active-layer-note"><i style={{ background: "#65d6ef" }} /><span>Внешняя среда</span><small>средняя волна включена</small></div>}
      {visibleExternal.length > 0 && <div className="absolute-data-grid layer-data">{visibleExternal.map((row) => <article key={row.key}><small>{CONTEXT_META[row.key].label}</small><strong>{row.value}</strong><em>{row.detail}</em></article>)}</div>}
      {activeLayers.has("behavior") && <div className="active-layer-note"><i style={{ background: "#ffd06c" }} /><span>Поведенческая среда</span><small>средняя волна включена</small></div>}
      {visibleBehavior.length > 0 && <div className="absolute-data-grid layer-data">{visibleBehavior.map((key) => {
        const value = key === "deviceMotion" || key === "movement" ? deviceSignals?.motion == null ? "—" : `${deviceSignals.motion}` : key === "deviceTilt" ? deviceSignals?.tilt == null ? "—" : `${deviceSignals.tilt}°` : key === "phoneActivity" ? deviceSignals ? `${Math.round(deviceSignals.activeSeconds / 60)} мин` : "—" : "—";
        const detail = key === "deviceMotion" ? "ускорение телефона" : key === "deviceTilt" ? deviceSignals?.orientation === "landscape" ? "горизонтально" : "вертикально" : key === "phoneActivity" ? "активность страницы" : "требует нативного приложения";
        return <article key={key}><small>{CONTEXT_META[key].label}</small><strong>{value}</strong><em>{detail}</em></article>;
      })}</div>}
      {!activeLayers.size && !visibleInternal.length && !visibleExternal.length && !visibleBehavior.length && <p className="no-layer-data">Включи среднюю волну или отдельную метрику под графиком — здесь останутся только выбранные данные.</p>}

      <div className="sheet-symptoms"><p className="sheet-section-label">Симптомы и состояния</p>{confirmed.length ? <div>{confirmed.map((symptom) => <span key={symptom.id}>{symptom.label} · {symptom.intensity}%</span>)}</div> : <p>На этот день ничего не подтверждено.</p>}</div>
      <p className="observation-footnote">Observation, not prescription</p>
    </section>
  </SheetLayer>;
}

const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const MONTH_LONG = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" });
type QuickAction = { label: string; icon: string; group: "Бережный ритм" | "Тело и контекст" };
const DEFAULT_QUICK_ACTIONS: QuickAction[] = [
  { label: "Контрацептив", icon: "◌", group: "Тело и контекст" },
  { label: "Медитация", icon: "✦", group: "Бережный ритм" },
  { label: "Йога", icon: "⌁", group: "Бережный ритм" },
  { label: "Дыхательная практика", icon: "◒", group: "Бережный ритм" },
];
const EXTRA_QUICK_ACTIONS: QuickAction[] = [
  { label: "Прогулка", icon: "↗", group: "Бережный ритм" },
  { label: "Дневник", icon: "▤", group: "Бережный ритм" },
  { label: "Тренировка", icon: "◈", group: "Тело и контекст" },
  { label: "Массаж", icon: "〰", group: "Тело и контекст" },
  { label: "Алкоголь", icon: "◐", group: "Тело и контекст" },
  { label: "Путешествие", icon: "⌖", group: "Тело и контекст" },
  { label: "Болезнь или травма", icon: "＋", group: "Тело и контекст" },
];
const ALL_QUICK_ACTIONS = [...DEFAULT_QUICK_ACTIONS, ...EXTRA_QUICK_ACTIONS];

function quickActionFor(label: string): QuickAction {
  return ALL_QUICK_ACTIONS.find((action) => action.label === label) ?? { label, icon: "＋", group: "Тело и контекст" };
}

function firstOfMonth(iso: string) {
  return `${iso.slice(0, 7)}-01`;
}

function shiftMonth(iso: string, amount: number) {
  const date = dateFromIso(firstOfMonth(iso));
  date.setUTCMonth(date.getUTCMonth() + amount);
  return isoFromDate(date);
}

function calendarDays(monthIso: string) {
  const first = dateFromIso(firstOfMonth(monthIso));
  const mondayOffset = (first.getUTCDay() + 6) % 7;
  const gridStart = addDays(isoFromDate(first), -mondayOffset);
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

export function CycleSettingsSheet({
  profile,
  activeIso,
  selectedActionLabels,
  onSave,
  onToggleQuickAction,
  onUpdateQuickActions,
  onUpdateQuickAccess,
  onClose,
}: {
  profile: AlmaProfile;
  activeIso: string;
  selectedActionLabels: string[];
  onSave: (profile: AlmaProfile, focusIso?: string) => void;
  onToggleQuickAction: (action: QuickAction) => void;
  onUpdateQuickActions: (actions: string[], actionCatalog?: string[]) => void;
  onUpdateQuickAccess: (actions: string[]) => void;
  onClose: () => void;
}) {
  const currentIso = todayIso();
  const initialMonth = activeIso <= currentIso ? activeIso : currentIso;
  const [visibleMonth, setVisibleMonth] = useState(firstOfMonth(initialMonth));
  const [selectedStart, setSelectedStart] = useState(profile.lastPeriodStart);
  const [duration, setDuration] = useState(profile.periodLength);
  const [automaticHighlights, setAutomaticHighlights] = useState(profile.automaticHighlights);
  const [periodFormOpen, setPeriodFormOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [customAction, setCustomAction] = useState("");
  const [draggedAction, setDraggedAction] = useState<string | null>(null);
  const [dragPoint, setDragPoint] = useState<{ x: number; y: number } | null>(null);
  const dragStart = useRef<{ x: number; y: number; label: string } | null>(null);
  const didDrag = useRef(false);
  const suppressNextTap = useRef(false);
  const lastHoverTarget = useRef<string | null>(null);
  const days = useMemo(() => calendarDays(visibleMonth), [visibleMonth]);
  const currentMonth = firstOfMonth(currentIso);
  const quickActionLabels = profile.quickActions ?? DEFAULT_QUICK_ACTIONS.map((action) => action.label);
  const quickActions = quickActionLabels.map(quickActionFor);
  const allActionLabels = Array.from(new Set([...ALL_QUICK_ACTIONS.map((action) => action.label), ...(profile.actionCatalog ?? [])]));
  const catalogActions = allActionLabels.filter((label) => !quickActionLabels.includes(label)).map(quickActionFor);
  // Configuration and the day's markers are separate: only an action that is
  // still in the working set can be presented as selected in this compact UI.
  const selectedWorkingActionLabels = selectedActionLabels.filter((label) => quickActionLabels.includes(label));
  const quickAccessLabels = (profile.quickAccessActions ?? []).filter((label) => quickActionLabels.includes(label));

  function toggleQuickAccess(label: string) {
    if (quickAccessLabels.includes(label)) {
      onUpdateQuickAccess(quickAccessLabels.filter((item) => item !== label));
      return;
    }
    if (quickAccessLabels.length < 5) onUpdateQuickAccess([...quickAccessLabels, label]);
  }

  function addQuickAction(label: string) {
    const normalized = label.trim().replace(/\s+/g, " ");
    if (!normalized || quickActionLabels.includes(normalized)) return;
    const nextCatalog = ALL_QUICK_ACTIONS.some((action) => action.label === normalized) || profile.actionCatalog?.includes(normalized)
      ? profile.actionCatalog
      : [...(profile.actionCatalog ?? []), normalized];
    onUpdateQuickActions([...quickActionLabels, normalized], nextCatalog);
    setCustomAction("");
  }

  function moveQuickAction(source: string, target: string) {
    if (source === target) return;
    const next = [...quickActionLabels];
    const sourceIndex = next.indexOf(source);
    const targetIndex = next.indexOf(target);
    if (sourceIndex < 0 || targetIndex < 0) return;
    next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, source);
    onUpdateQuickActions(next);
  }

  function beginDrag(event: ReactPointerEvent<HTMLElement>, label: string) {
    if (!actionsOpen) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = { x: event.clientX, y: event.clientY, label };
    didDrag.current = false;
    lastHoverTarget.current = null;
  }

  function continueDrag(event: ReactPointerEvent<HTMLElement>) {
    const start = dragStart.current;
    if (!start) return;
    if (!draggedAction && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) {
      didDrag.current = true;
      setDraggedAction(start.label);
      setDragPoint({ x: event.clientX, y: event.clientY });
      return;
    }
    if (!draggedAction) return;
    setDragPoint({ x: event.clientX, y: event.clientY });
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-quick-action]")?.dataset.quickAction;
    if (target && target !== draggedAction && target !== lastHoverTarget.current) {
      moveQuickAction(draggedAction, target);
      lastHoverTarget.current = target;
    }
  }

  function finishDrag(event: ReactPointerEvent<HTMLElement>) {
    if (!dragStart.current) return;
    const label = draggedAction;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-quick-zone]")?.dataset.quickZone;
    const actionTarget = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-quick-action]")?.dataset.quickAction;
    if (label && target) {
      const isActive = quickActionLabels.includes(label);
      if (target === "active" && !isActive) onUpdateQuickActions([...quickActionLabels, label]);
      if (target === "catalog" && isActive) onUpdateQuickActions(quickActionLabels.filter((item) => item !== label));
      if (target === "active" && isActive && actionTarget && actionTarget !== label) moveQuickAction(label, actionTarget);
    }
    dragStart.current = null;
    suppressNextTap.current = didDrag.current;
    setDraggedAction(null);
    setDragPoint(null);
    lastHoverTarget.current = null;
  }

  function savePeriod() {
    onSave({
      ...profile,
      lastPeriodStart: selectedStart,
      periodLength: duration,
      automaticHighlights,
    }, selectedStart);
  }

  function confirmSheet() {
    if (periodFormOpen) {
      savePeriod();
      return;
    }
    onClose();
  }

  return <SheetLayer onClose={onClose} className={`period-layer${periodFormOpen ? " is-expanded" : " is-compact"}`}>
    <section className="bottom-sheet period-sheet" role="dialog" aria-modal="true" aria-labelledby="cycle-settings-title">
      <div className="sheet-handle" />
      <header className="sheet-header"><div><p className="eyebrow">отметки дня</p><h2 id="cycle-settings-title">Цикл и действия</h2></div><button type="button" aria-label="Закрыть" onClick={onClose}>×</button></header>
      <p className="settings-intro">Отметь только то, что действительно было сегодня. Длина цикла постепенно уточняется по отмеченным началам.</p>

      <section className="quick-actions-block" aria-label="Быстрые отметки">
        <div className="quick-actions-heading"><div><p className="eyebrow">быстрая отметка</p><strong>Что было сегодня?</strong><small>{actionsOpen ? "Удержи и перетяни действие между наборами." : "Нажми, чтобы отметить действие сегодня."}</small></div><span>{selectedWorkingActionLabels.length ? `${selectedWorkingActionLabels.length} выбрано` : "по желанию"}</span></div>
        <div className={`quick-actions-grid quick-actions-active${actionsOpen ? " is-editing" : ""}`} data-quick-zone="active">
          {quickActions.map((action) => <div className={`quick-action-card${draggedAction === action.label ? " is-dragging" : ""}`} data-quick-action={action.label} key={action.label}>
            <button className="quick-action-main" type="button" aria-pressed={selectedWorkingActionLabels.includes(action.label)} onClick={() => { if (actionsOpen || suppressNextTap.current) { suppressNextTap.current = false; return; } onToggleQuickAction(action); }} onPointerDown={(event) => beginDrag(event, action.label)} onPointerMove={continueDrag} onPointerUp={finishDrag} onPointerCancel={() => { dragStart.current = null; setDraggedAction(null); }}><i>{action.icon}</i><span>{action.label}</span></button>
            {actionsOpen && <button className="quick-action-remove" type="button" aria-label={`Убрать ${action.label} из быстрого набора`} onClick={() => onUpdateQuickActions(quickActionLabels.filter((item) => item !== action.label))}>×</button>}
          </div>)}
          {!quickActions.length && <p className="quick-actions-empty">Добавь действия из каталога ниже.</p>}
        </div>
        {draggedAction && dragPoint && <div className="quick-action-ghost" style={{ left: dragPoint.x, top: dragPoint.y }} aria-hidden="true"><i>{quickActionFor(draggedAction).icon}</i><span>{draggedAction}</span></div>}
        <button type="button" className={`quick-actions-more${actionsOpen ? " is-open" : ""}`} onClick={() => setActionsOpen((value) => !value)}>{actionsOpen ? "Скрыть каталог" : "＋ добавить"}</button>
        {actionsOpen && <div className="quick-access-editor"><div><p className="eyebrow">на главном экране</p><strong>Быстрый доступ · до 5</strong></div><p>Выбери действия, которые хочешь отмечать прямо под цветком.</p><div>{quickActions.map((action) => <button key={action.label} className={quickAccessLabels.includes(action.label) ? "is-selected" : ""} type="button" aria-pressed={quickAccessLabels.includes(action.label)} onClick={() => toggleQuickAccess(action.label)}><i>{quickAccessLabels.includes(action.label) ? "✓" : "＋"}</i><span>{action.label}</span></button>)}</div></div>}
        {actionsOpen && <div className="quick-actions-extra quick-actions-catalog" data-quick-zone="catalog"><p className="quick-actions-catalog-intro">Нажми ＋, чтобы вернуть действие наверх. Удерживай рабочую кнопку и перетаскивай её для нового порядка.</p>{(["Бережный ритм", "Тело и контекст"] as const).map((group) => <section key={group}><p>{group}</p><div>{catalogActions.filter((action) => action.group === group).map((action) => <button key={action.label} type="button" onClick={() => addQuickAction(action.label)}><i>{action.icon}</i><span>{action.label}</span><b>＋</b></button>)}</div></section>)}<form className="quick-action-custom" onSubmit={(event) => { event.preventDefault(); addQuickAction(customAction); }}><input value={customAction} onChange={(event) => setCustomAction(event.target.value)} placeholder="Своё действие" maxLength={48} /><button type="submit" disabled={!customAction.trim()}>добавить</button></form></div>}
      </section>

      <button className={`period-expand-trigger${periodFormOpen ? " is-open" : ""}`} type="button" aria-expanded={periodFormOpen} onClick={() => setPeriodFormOpen((value) => !value)}><span><i>●</i><b>{periodFormOpen ? "Отметка месячных" : "Отметить месячные"}</b><small>{periodFormOpen ? "выбери первый день и длительность" : "откроется календарь и выбор дней"}</small></span><em>{periodFormOpen ? "−" : "＋"}</em></button>

      {periodFormOpen && <><div className="period-calendar">
        <header className="calendar-header">
          <button type="button" onClick={() => setVisibleMonth(shiftMonth(visibleMonth, -1))} aria-label="Предыдущий месяц">‹</button>
          <strong>{MONTH_LONG.format(dateFromIso(visibleMonth))}</strong>
          <button type="button" disabled={visibleMonth >= currentMonth} onClick={() => setVisibleMonth(shiftMonth(visibleMonth, 1))} aria-label="Следующий месяц">›</button>
        </header>
        <div className="calendar-weekdays" aria-hidden="true">{WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}</div>
        <div className="calendar-grid" role="grid" aria-label="Выберите первый день месячных">
          {days.map((iso) => {
            const delta = daysBetween(selectedStart, iso);
            const isPeriod = delta >= 0 && delta < duration;
            const isStart = iso === selectedStart;
            const isToday = iso === currentIso;
            const isOutside = firstOfMonth(iso) !== visibleMonth;
            const isFuture = iso > currentIso;
            return <button
              key={iso}
              type="button"
              role="gridcell"
              disabled={isFuture}
              aria-selected={isStart}
              aria-label={`${formatShortDate(iso)}${isPeriod ? ", день менструации" : ""}`}
              className={`${isOutside ? " is-outside" : ""}${isPeriod ? " is-period" : ""}${isStart ? " is-start" : ""}${isToday ? " is-today" : ""}`}
              onClick={() => setSelectedStart(iso)}
            >
              <span>{dateFromIso(iso).getUTCDate()}</span><i />
            </button>;
          })}
        </div>
      </div>

      <div className="period-selection-summary">
        <span><small>первый день</small><strong>{formatShortDate(selectedStart)}</strong></span>
        <i />
        <span><small>длительность</small><strong>{duration} {duration === 1 ? "день" : duration < 5 ? "дня" : "дней"}</strong></span>
      </div>

      <fieldset className="period-duration">
        <legend>Количество дней</legend>
        <div>{Array.from({ length: 10 }, (_, index) => {
          const value = index + 1;
          return <button key={value} type="button" className={value <= duration ? "is-filled" : ""} aria-label={`${value} дней`} aria-pressed={value === duration} onClick={() => setDuration(value)}><i /><span>{value}</span></button>;
        })}</div>
      </fieldset>

      <label className="settings-toggle"><span><b>Автоподсветка фаз</b><small>Дуга показывает расчётные фазы и овуляцию</small></span><input type="checkbox" checked={automaticHighlights} onChange={(event) => setAutomaticHighlights(event.target.checked)} /></label>
      <p className="settings-legal">Фазы, фертильное окно и овуляция рассчитываются ориентировочно. Это календарное наблюдение, не медицинское заключение.</p></>}
      <button className="primary-action period-save" type="button" disabled={periodFormOpen && (!selectedStart || selectedStart > currentIso)} onClick={confirmSheet}>подтвердить</button>
    </section>
  </SheetLayer>;
}

export function ConnectionsSheet({ day, days, environment, onClose }: { day: DayModel; days: DayModel[]; environment: EnvironmentPayload | null; onClose: () => void }) {
  const [highlight, setHighlight] = useState(true);
  const ordered = (Object.keys(day.zones) as ZoneKey[]).sort((a, b) => day.zones[b] - day.zones[a]);
  const high = ordered[0];
  const low = ordered.at(-1) ?? ordered[0];
  const divergence = day.zones[high] - day.zones[low];
  const internal = days.map((item) => item.integral);
  const temperatureByDate = new Map(environment?.days.map((item) => [item.date, item.temperatureC]) ?? []);
  const temperature = days.map((item) => temperatureByDate.get(item.iso) ?? null);
  const coincidence = findDirectionalCoincidence(internal, temperature);
  const coincidenceCopy = coincidence.matches === 0 ? null
    : coincidence.matches === 1 ? "Первое совпадение: изменения внутренней волны и температуры шли в одну сторону. Это мягкая гипотеза для наблюдения."
    : `${coincidence.matches} из ${coincidence.observed} наблюдаемых изменений внутренней волны и температуры были однонаправленными${coincidence.direction ? ` (${coincidence.direction})` : ""}.`;

  return <SheetLayer onClose={onClose} className="connections-layer">
    <section className="connections-sheet" role="dialog" aria-modal="true" aria-labelledby="connections-title">
      <header className="sheet-header"><div><p className="eyebrow">исследовательский режим</p><h2 id="connections-title">Показать связи</h2></div><button type="button" aria-label="Закрыть" onClick={onClose}>×</button></header>
      <p className="connections-intro">Сравниваем форму внутренних волн и среды. Совпадение не означает причинность.</p>
      <div className="connection-bars">
        {(Object.keys(day.zones) as ZoneKey[]).map((zone) => <div key={zone}><span>{ZONE_META[zone].short}</span><i><b style={{ width: `${Math.abs(day.zones[zone])}%`, background: ZONE_META[zone].color, marginLeft: day.zones[zone] < 0 ? `${50 - Math.abs(day.zones[zone]) / 2}%` : "50%" }} /></i><strong>{day.zones[zone] > 0 ? "+" : ""}{day.zones[zone]}</strong></div>)}
      </div>
      <button className={`highlight-toggle${highlight ? " is-on" : ""}`} type="button" onClick={() => setHighlight(!highlight)}><i />автоподсветка <span>{highlight ? "включена" : "выключена"}</span></button>
      {highlight && <div className="connection-findings">
        <article><p className="eyebrow">структурное расхождение</p><strong>{ZONE_META[high].short} выше, {ZONE_META[low].short} ниже</strong><p>Разница между внутренними волнами — {divergence} пунктов. Это самостоятельный сигнал для наблюдения.</p></article>
        {environment && <article><p className="eyebrow">внешний фон</p><strong>Давление и влажность наложены отдельно</strong><p>Их форма видна на графике, но она не участвует в расчёте общей субъективной волны.</p></article>}
        {coincidenceCopy && <article><p className="eyebrow">динамика · температура</p><strong>{coincidence.matches === 1 ? "Возможное совпадение" : "Повторяемость динамики"}</strong><p>{coincidenceCopy}</p></article>}
        {environment && !coincidenceCopy && <article><p className="eyebrow">динамика среды</p><strong>История ещё накапливается</strong><p>ALMA покажет первую мягкую гипотезу после первого совпадения изменений, а частоту — когда таких дней станет больше.</p></article>}
      </div>}
      <p className="observation-footnote">Мы ищем повторяемость, а не причину</p>
    </section>
  </SheetLayer>;
}
