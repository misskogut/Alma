"use client";

import { useEffect, useMemo, useState } from "react";
import type { AlmaProfile, DayModel, EnvironmentPayload, SymptomEntry, ZoneKey } from "../lib/alma";
import { ZONE_META, addDays, dateFromIso, daysBetween, feelingLabel, formatShortDate, isoFromDate, phaseLabel, pressureMmHg, relativeDayLabel, todayIso, weatherLabel } from "../lib/alma";

function SheetLayer({ children, onClose, className = "" }: { children: React.ReactNode; onClose: () => void; className?: string }) {
  useEffect(() => {
    function close(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return <div className={`sheet-layer ${className}`} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>{children}</div>;
}

export function DaySheet({ day, environment, symptoms, onClose }: { day: DayModel; environment: EnvironmentPayload | null; symptoms: SymptomEntry[]; onClose: () => void }) {
  const external = environment?.days.find((item) => item.date === day.iso) ?? (environment?.current.date === day.iso ? environment.current : null);
  const confirmed = symptoms.filter((symptom) => symptom.status === "confirmed");
  const zoneOrder: ZoneKey[] = ["cognitive", "emotional", "physical", "libido", "social"];

  return <SheetLayer onClose={onClose}>
    <section className="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="day-sheet-title">
      <div className="sheet-handle" />
      <header className="sheet-header"><div><p className="eyebrow">{relativeDayLabel(day.iso)}</p><h2 id="day-sheet-title">{formatShortDate(day.iso)}</h2></div><button type="button" aria-label="Закрыть" onClick={onClose}>×</button></header>

      <div className={`day-cycle-summary marker-${day.marker ?? "none"}`}>
        <div><strong>{day.cycleDay}</strong><small>день цикла</small></div>
        <p><b>{phaseLabel(day.phase)}</b><span>{day.marker === "menstruation" ? "День менструации отмечен красной бусиной" : day.marker === "ovulation" ? "Расчётная овуляция отмечена светящейся бусиной" : day.marker === "fertile" ? "Вероятное фертильное окно" : "Календарный фон цикла"}</span></p>
      </div>

      {day.isForecast ? <div className="forecast-notice"><i>∿</i><p><strong>Вероятный фон</strong>Это продолжение формы личной волны с учётом последних состояний. Не обещание и не диагноз.</p></div> : <div className="zone-summary-grid">
        {zoneOrder.map((zone) => <article key={zone}><span style={{ background: ZONE_META[zone].color }} /><small>{ZONE_META[zone].short}</small><strong>{day.zones[zone] > 0 ? "+" : ""}{day.zones[zone]}</strong><em>{feelingLabel(day.zones[zone])}</em></article>)}
      </div>}

      <p className="sheet-section-label">Что было вокруг состояния</p>
      <div className="absolute-data-grid">
        <article><small>Температура</small><strong>{external?.temperatureC == null ? "—" : `${Math.round(external.temperatureC)}°`}</strong><em>{weatherLabel(external?.weatherCode ?? null)}</em></article>
        <article><small>Давление</small><strong>{external?.pressureHpa == null ? "—" : `${pressureMmHg(external.pressureHpa)} мм`}</strong><em>{external?.pressureHpa == null ? "история не получена" : `${Math.round(external.pressureHpa)} гПа`}</em></article>
        <article><small>Влажность</small><strong>{external?.humidityPct == null ? "—" : `${Math.round(external.humidityPct)}%`}</strong><em>внешняя среда</em></article>
        <article><small>Световой день</small><strong>{external?.daylightMinutes == null ? "—" : `${Math.floor(external.daylightMinutes / 60)} ч ${external.daylightMinutes % 60} мин`}</strong><em>восход → закат</em></article>
      </div>

      <div className="sheet-symptoms"><p className="sheet-section-label">Симптомы и состояния</p>{confirmed.length ? <div>{confirmed.map((symptom) => <span key={symptom.id}>{symptom.label} · {symptom.intensity}%</span>)}</div> : <p>На этот день ничего не подтверждено.</p>}</div>
      <p className="observation-footnote">Observation, not prescription</p>
    </section>
  </SheetLayer>;
}

const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const MONTH_LONG = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" });

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
  onSave,
  onClose,
}: {
  profile: AlmaProfile;
  activeIso: string;
  onSave: (profile: AlmaProfile, focusIso?: string) => void;
  onClose: () => void;
}) {
  const currentIso = todayIso();
  const initialMonth = activeIso <= currentIso ? activeIso : currentIso;
  const [visibleMonth, setVisibleMonth] = useState(firstOfMonth(initialMonth));
  const [selectedStart, setSelectedStart] = useState(profile.lastPeriodStart);
  const [duration, setDuration] = useState(profile.periodLength);
  const [cycleLength, setCycleLength] = useState(profile.cycleLength);
  const [automaticHighlights, setAutomaticHighlights] = useState(profile.automaticHighlights);
  const days = useMemo(() => calendarDays(visibleMonth), [visibleMonth]);
  const currentMonth = firstOfMonth(currentIso);

  function savePeriod() {
    onSave({
      ...profile,
      lastPeriodStart: selectedStart,
      periodLength: duration,
      cycleLength,
      automaticHighlights,
    }, selectedStart);
  }

  return <SheetLayer onClose={onClose}>
    <section className="bottom-sheet period-sheet" role="dialog" aria-modal="true" aria-labelledby="cycle-settings-title">
      <div className="sheet-handle" />
      <header className="sheet-header"><div><p className="eyebrow">календарь цикла</p><h2 id="cycle-settings-title">Отметить месячные</h2></div><button type="button" aria-label="Закрыть" onClick={onClose}>×</button></header>
      <p className="settings-intro">Выберите первый день, затем укажите длительность кружочками. Лотос и дуга перестроятся сразу после сохранения.</p>

      <div className="period-calendar">
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

      <div className="cycle-length-setting">
        <span><small>Средняя длина цикла</small><strong>{cycleLength} дней</strong></span>
        <div><button type="button" disabled={cycleLength <= 21} onClick={() => setCycleLength((value) => Math.max(21, value - 1))}>−</button><button type="button" disabled={cycleLength >= 45} onClick={() => setCycleLength((value) => Math.min(45, value + 1))}>＋</button></div>
      </div>

      <label className="settings-toggle"><span><b>Автоподсветка фаз</b><small>Дуга показывает расчётные фазы и овуляцию</small></span><input type="checkbox" checked={automaticHighlights} onChange={(event) => setAutomaticHighlights(event.target.checked)} /></label>
      <button className="primary-action period-save" type="button" disabled={!selectedStart || selectedStart > currentIso} onClick={savePeriod}>отметить месячные</button>
      <p className="settings-legal">Фазы, фертильное окно и овуляция рассчитываются ориентировочно. Это календарное наблюдение, не медицинское заключение.</p>
    </section>
  </SheetLayer>;
}

export function ConnectionsSheet({ day, environment, onClose }: { day: DayModel; environment: EnvironmentPayload | null; onClose: () => void }) {
  const [highlight, setHighlight] = useState(true);
  const ordered = (Object.keys(day.zones) as ZoneKey[]).sort((a, b) => day.zones[b] - day.zones[a]);
  const high = ordered[0];
  const low = ordered.at(-1) ?? ordered[0];
  const divergence = day.zones[high] - day.zones[low];

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
      </div>}
      <p className="observation-footnote">Мы ищем повторяемость, а не причину</p>
    </section>
  </SheetLayer>;
}
