"use client";

import { useMemo, useState } from "react";

const DEFAULT_ACTIONS = ["Йога", "Тренировка", "Прогулка", "Путешествие"];
const CATALOG = ["Тренировка", "Йога", "Прогулка", "Путешествие", "Медитация", "Дыхательная практика", "Массаж", "Дневник", "Творчество", "Болезнь или травма", "Алкоголь"];
const ICONS: Record<string, string> = { "Йога": "⌁", "Тренировка": "◈", "Прогулка": "↗", "Путешествие": "⌖", "Медитация": "✦", "Дыхательная практика": "◒", "Массаж": "〰", "Дневник": "▤", "Творчество": "◌", "Болезнь или травма": "＋", "Алкоголь": "◐" };

export default function ActivityPanel({ actions, catalog, selected, onToggle, onUpdate }: { actions?: string[]; catalog?: string[]; selected: string[]; onToggle: (label: string) => void; onUpdate: (actions: string[], catalog: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const working = actions?.length ? actions : DEFAULT_ACTIONS;
  const all = useMemo(() => Array.from(new Set([...CATALOG, ...(catalog ?? [])])), [catalog]);
  const available = all.filter((item) => !working.includes(item));
  function add(label: string) { if (!working.includes(label)) onUpdate([...working, label], all.includes(label) ? (catalog ?? []) : [...(catalog ?? []), label]); }
  function remove(label: string) { onUpdate(working.filter((item) => item !== label), catalog ?? []); }
  function addCustom() { const label = custom.trim().replace(/\s+/g, " "); if (!label) return; add(label); setCustom(""); }
  return <section className="activity-panel glass-card" aria-labelledby="activity-title">
    <header className="activity-heading"><div><p className="eyebrow">моя активность</p><h2 id="activity-title">Что было сегодня?</h2><p>Отмечай ритм, действия и контекст дня отдельно от цикла.</p></div><button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>{open ? "готово" : "＋ настроить"}</button></header>
    <div className="activity-actions">{working.map((label) => <button type="button" key={label} className={selected.includes(label) ? "is-selected" : ""} aria-pressed={selected.includes(label)} onClick={() => open ? remove(label) : onToggle(label)}><i>{ICONS[label] ?? "✦"}</i><span>{label}</span>{open && <b>×</b>}</button>)}</div>
    {open && <div className="activity-catalog"><p>Добавь в свой рабочий набор — потом эти действия будут отмечаться одним тапом.</p><div>{available.map((label) => <button type="button" key={label} onClick={() => add(label)}><i>{ICONS[label] ?? "✦"}</i>{label}<b>＋</b></button>)}</div><form onSubmit={(event) => { event.preventDefault(); addCustom(); }}><input value={custom} onChange={(event) => setCustom(event.target.value)} placeholder="Своё действие" maxLength={48} /><button type="submit" disabled={!custom.trim()}>добавить</button></form></div>}
  </section>;
}
