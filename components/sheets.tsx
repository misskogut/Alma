"use client";

import { useEffect, useState } from "react";
import type { AlmaProfile, DayModel, EnvironmentPayload, SymptomEntry, ZoneKey } from "../lib/alma";
import { ZONE_META, feelingLabel, formatShortDate, phaseLabel, pressureMmHg, relativeDayLabel, todayIso, weatherLabel } from "../lib/alma";

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

export function CycleSettingsSheet({ profile, onSave, onClose }: { profile: AlmaProfile; onSave: (profile: AlmaProfile) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(profile);
  return <SheetLayer onClose={onClose}>
    <section className="bottom-sheet settings-sheet" role="dialog" aria-modal="true" aria-labelledby="cycle-settings-title">
      <div className="sheet-handle" />
      <header className="sheet-header"><div><p className="eyebrow">календарная память</p><h2 id="cycle-settings-title">Настроить цикл</h2></div><button type="button" aria-label="Закрыть" onClick={onClose}>×</button></header>
      <p className="settings-intro">Эти значения двигают лотос, фазы и бусины. Они не меняют субъективную волну автоматически.</p>
      <label className="settings-field"><span>Первый день последних месячных</span><input type="date" max={todayIso()} value={draft.lastPeriodStart} onChange={(event) => setDraft({ ...draft, lastPeriodStart: event.target.value })} /></label>
      <label className="settings-field"><span>Средняя длина цикла <b>{draft.cycleLength} дней</b></span><input type="range" min="21" max="45" value={draft.cycleLength} onChange={(event) => setDraft({ ...draft, cycleLength: Number(event.target.value) })} /><small>21</small><small>45</small></label>
      <label className="settings-field"><span>Обычно идут месячные <b>{draft.periodLength} дней</b></span><input type="range" min="1" max="10" value={draft.periodLength} onChange={(event) => setDraft({ ...draft, periodLength: Number(event.target.value) })} /><small>1</small><small>10</small></label>
      <label className="settings-toggle"><span><b>Автоподсветка совпадений</b><small>Можно отключить в любой момент</small></span><input type="checkbox" checked={draft.automaticHighlights} onChange={(event) => setDraft({ ...draft, automaticHighlights: event.target.checked })} /></label>
      <button className="primary-action" type="button" disabled={!draft.lastPeriodStart} onClick={() => onSave(draft)}>сохранить и перестроить</button>
      <p className="settings-legal">Овуляция и фертильное окно рассчитываются ориентировочно. Для медицинских решений этот расчёт не предназначен.</p>
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
