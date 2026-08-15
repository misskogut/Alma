"use client";

import { useMemo, useState, type CSSProperties } from "react";
import type { ZoneKey, ZoneValues } from "../lib/alma";
import { ZONE_META, feelingLabel, type SymptomEntry } from "../lib/alma";
import { quickSymptomsForLoad, symptomsForZone } from "../lib/symptom-catalog";

const DEFAULT_ACTIONS = ["Йога", "Тренировка", "Прогулка", "Путешествие"];
const CATALOG = ["Тренировка", "Йога", "Прогулка", "Путешествие", "Медитация", "Дыхательная практика", "Массаж", "Дневник", "Творчество", "Болезнь или травма", "Алкоголь"];
const ICONS: Record<string, string> = { "Йога": "⌁", "Тренировка": "◈", "Прогулка": "↗", "Путешествие": "⌖", "Медитация": "✦", "Дыхательная практика": "◒", "Массаж": "〰", "Дневник": "▤", "Творчество": "◌", "Болезнь или травма": "＋", "Алкоголь": "◐" };
const LOADS: Array<{ key: Extract<ZoneKey, "physical" | "social">; icon: string; hint: string }> = [
  { key: "physical", icon: "◉", hint: "движение, усталость и телесный ресурс" },
  { key: "social", icon: "✦", hint: "общение, поддержка и напряжение" },
];
function formatValue(value: number) {
  return `${value > 0 ? "+" : ""}${value}`;
}

export default function ActivityPanel({ actions, catalog, selected, values, symptoms, onToggle, onUpdate, onChange, onCommit, onAddSymptom, onUpdateSymptom }: { actions?: string[]; catalog?: string[]; selected: string[]; values: ZoneValues; symptoms: SymptomEntry[]; onToggle: (label: string) => void; onUpdate: (actions: string[], catalog: string[]) => void; onChange: (zone: ZoneKey, value: number) => void; onCommit: () => void; onAddSymptom: (symptom: SymptomEntry) => void; onUpdateSymptom: (symptom: SymptomEntry) => void }) {
  const [open, setOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const [activeLoad, setActiveLoad] = useState<Extract<ZoneKey, "physical" | "social"> | null>(null);
  const [moreLoad, setMoreLoad] = useState<Extract<ZoneKey, "physical" | "social"> | null>(null);
  const working = actions?.length ? actions : DEFAULT_ACTIONS;
  const all = useMemo(() => Array.from(new Set([...CATALOG, ...(catalog ?? [])])), [catalog]);
  const available = all.filter((item) => !working.includes(item));
  function add(label: string) { if (!working.includes(label)) onUpdate([...working, label], all.includes(label) ? (catalog ?? []) : [...(catalog ?? []), label]); }
  function remove(label: string) { onUpdate(working.filter((item) => item !== label), catalog ?? []); }
  function addCustom() { const label = custom.trim().replace(/\s+/g, " "); if (!label) return; add(label); setCustom(""); }
  function toggleLoadSymptom(zone: Extract<ZoneKey, "physical" | "social">, label: string) {
    const current = symptoms.find((item) => item.zone === zone && item.label === label);
    if (current) { onUpdateSymptom({ ...current, status: current.status === "confirmed" ? "dismissed" : "confirmed", intensity: Math.abs(values[zone]) }); return; }
    onAddSymptom({ id: `activity-${zone}-${label.toLowerCase().replace(/[^a-zа-яё0-9]+/giu, "-")}`, label, zone, status: "confirmed", intensity: Math.abs(values[zone]), suggestedBy: "system" });
  }
  return <section className="activity-panel glass-card" aria-labelledby="activity-title">
    <header className="activity-heading"><div><h2 id="activity-title">Моя активность</h2></div><button className="activity-info-button" type="button" aria-label="Как работает блок «Моя активность»" aria-expanded={infoOpen} onClick={() => setInfoOpen((value) => !value)}>i</button></header>
    {infoOpen && <aside className="activity-info-popover"><button type="button" aria-label="Закрыть" onClick={() => setInfoOpen(false)}>×</button><strong>Как работать с «Моей активностью»</strong><p>Нажимай на быстрые действия, чтобы отметить или отменить их для выбранного дня.</p><p>Физическая и социальная нагрузка помогают показать, сколько в дне было движения, общения, поддержки или напряжения. Нажми на кнопку нагрузки и выбери ощущение по шкале.</p><p>«Настроить» открывает каталог: там можно добавить действия в рабочий набор, поменять его состав и создать своё действие. Настройка сама по себе ничего не отмечает.</p></aside>}
    <p className="activity-intro">Ритм, движение и контекст дня — отдельно от отметок цикла.</p>
    <div className="activity-workspace-heading"><p className="activity-question">Что было сегодня?</p><button className="activity-configure-button" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>{open ? "готово" : "＋ настроить"}</button></div>
    <div className="activity-actions">{working.map((label) => <button type="button" key={label} className={selected.includes(label) ? "is-selected" : ""} aria-pressed={selected.includes(label)} onClick={() => open ? remove(label) : onToggle(label)}><i>{ICONS[label] ?? "✦"}</i><span>{label}</span>{open && <b>×</b>}</button>)}</div>
    {open && <div className="activity-catalog"><p>Добавь в свой рабочий набор — потом эти действия будут отмечаться одним тапом.</p><div>{available.map((label) => <button type="button" key={label} onClick={() => add(label)}><i>{ICONS[label] ?? "✦"}</i>{label}<b>＋</b></button>)}</div><form onSubmit={(event) => { event.preventDefault(); addCustom(); }}><input value={custom} onChange={(event) => setCustom(event.target.value)} placeholder="Своё действие" maxLength={48} /><button type="submit" disabled={!custom.trim()}>добавить</button></form></div>}
    <div className="activity-loads" aria-label="Нагрузка дня">
      <div className="activity-loads-heading"><div><p className="eyebrow">нагрузка дня</p><strong>Как прошёл день?</strong></div><small>от −100 до +100</small></div>
      <div className="activity-load-grid">
        {LOADS.map((load) => {
          const value = values[load.key];
          const active = activeLoad === load.key;
          const meta = ZONE_META[load.key];
          return <article className={`activity-load${active ? " is-open" : ""}`} key={load.key} style={{ "--load-color": meta.color } as CSSProperties}>
            <button className="activity-load-button" type="button" onClick={() => { setActiveLoad(active ? null : load.key); setMoreLoad(null); }} aria-expanded={active}>
              <i>{load.icon}</i><span><b>{meta.label}</b><small>{active ? feelingLabel(value) : load.hint}</small></span><em>{formatValue(value)}</em>
            </button>
            {active && <div className="activity-load-editor">
              <input aria-label={meta.label} type="range" min="-100" max="100" value={value} onChange={(event) => onChange(load.key, Number(event.target.value))} onPointerUp={onCommit} onKeyUp={onCommit} />
              <div className="activity-load-scale"><span>−100</span><b>{feelingLabel(value)}</b><span>+100</span></div>
              <div className="activity-load-symptoms" aria-label={`Подходящие ощущения: ${meta.label}`}>
                {quickSymptomsForLoad(load.key, value).map((label) => {
                  const selected = symptoms.some((item) => item.zone === load.key && item.label === label && item.status === "confirmed");
                  return <button className={selected ? "is-selected" : ""} key={label} type="button" onClick={() => toggleLoadSymptom(load.key, label)}>{label}</button>;
                })}
              </div>
              <button className="activity-load-more-trigger" type="button" onClick={() => setMoreLoad(moreLoad === load.key ? null : load.key)} aria-expanded={moreLoad === load.key}>＋ ещё подходящие ощущения</button>
              {moreLoad === load.key && <div className="activity-load-more-panel" aria-label={`Все подходящие ощущения: ${meta.label}`}>
                <p>Все {value < 0 ? "неприятные" : "поддерживающие"} ощущения для этой нагрузки</p>
                <div>{symptomsForZone(load.key, value < 0 ? "negative" : "positive").map((label) => {
                  const selected = symptoms.some((item) => item.zone === load.key && item.label === label && item.status === "confirmed");
                  return <button className={selected ? "is-selected" : ""} key={label} type="button" onClick={() => toggleLoadSymptom(load.key, label)}>{label}</button>;
                })}</div>
              </div>}
              <button type="button" onClick={() => { onCommit(); setActiveLoad(null); }}>готово</button>
            </div>}
          </article>;
        })}
      </div>
    </div>
  </section>;
}
