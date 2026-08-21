"use client";

import { useMemo, useState } from "react";
import { metricDefinition } from "../lib/alma-core";
import type { NutritionEntry } from "../lib/canonical-prototype-store";

type IntakeDraft = {
  definitionId: string;
  label: string;
  quantity?: number;
  unit?: string;
  dayPart?: NutritionEntry["dayPart"];
};

const QUICK_INTAKES = [
  { definitionId: "coffee", label: "Кофе", icon: "◒" },
  { definitionId: "water", label: "Вода", icon: "◌" },
] as const;

const DAY_PARTS: Array<{ value: NonNullable<NutritionEntry["dayPart"]>; label: string }> = [
  { value: "morning", label: "утро" },
  { value: "day", label: "день" },
  { value: "evening", label: "вечер" },
  { value: "night", label: "ночь" },
];

export default function NutritionPanel({
  entries,
  onAdd,
  onRemove,
  onResearch,
}: {
  entries: NutritionEntry[];
  onAdd: (draft: IntakeDraft) => void;
  onRemove: (id: string) => void;
  onResearch: (entry: NutritionEntry) => void;
}) {
  const [infoOpen, setInfoOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("порция");
  const [dayPart, setDayPart] = useState<NutritionEntry["dayPart"]>();
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const sortedEntries = useMemo(
    () => [...entries].sort((left, right) => dayPartOrder(left.dayPart) - dayPartOrder(right.dayPart)),
    [entries],
  );

  function addCustom() {
    const cleanLabel = label.trim().replace(/\s+/g, " ");
    if (!cleanLabel) return;
    onAdd({
      definitionId: "food_item",
      label: cleanLabel,
      quantity: quantity ? Number(quantity) : undefined,
      unit: quantity ? unit.trim() || "порция" : undefined,
      dayPart,
    });
    setLabel("");
    setQuantity("");
    setDayPart(undefined);
    setFormOpen(false);
  }

  return <section className="nutrition-panel glass-card" aria-labelledby="nutrition-title">
    <header className="alma-block-header">
      <div><h2 id="nutrition-title">Моё питание</h2></div>
      <button className="section-info-button" type="button" aria-label="Как работает блок «Моё питание»" aria-expanded={infoOpen} onClick={() => setInfoOpen((current) => !current)}>i</button>
    </header>

    {infoOpen && <aside className="alma-info-popover nutrition-info-popover">
      <button type="button" aria-label="Закрыть" onClick={() => setInfoOpen(false)}>×</button>
      <strong>Питание без обязательного дневника</strong>
      <p>Отмечай только то, что важно именно сейчас: например, кофе, воду или отдельный продукт. Количество и время можно не указывать.</p>
      <p>Любую отметку можно превратить в личный вопрос — ALMA будет постепенно сравнивать её с твоим самочувствием, не выдавая совпадение за причину.</p>
    </aside>}

    <div className="nutrition-quick-row" aria-label="Быстрые отметки питания">
      {QUICK_INTAKES.map((item) => <button key={item.definitionId} type="button" onClick={() => onAdd({ definitionId: item.definitionId, label: item.label })}>
        <i>{item.icon}</i><span>{item.label}</span><b>＋</b>
      </button>)}
      <button className="nutrition-custom-trigger" type="button" aria-expanded={formOpen} onClick={() => setFormOpen((current) => !current)}><i>✦</i><span>Добавить своё</span></button>
    </div>

    {formOpen && <form className="nutrition-form" onSubmit={(event) => { event.preventDefault(); addCustom(); }}>
      <label><span>Что было?</span><input autoFocus value={label} maxLength={80} placeholder="Например, шоколад" onChange={(event) => setLabel(event.target.value)} /></label>
      <div className="nutrition-form-row">
        <label><span>Количество — необязательно</span><input type="number" min="0" step="0.1" inputMode="decimal" value={quantity} placeholder="—" onChange={(event) => setQuantity(event.target.value)} /></label>
        <label><span>Единица</span><input value={unit} maxLength={20} onChange={(event) => setUnit(event.target.value)} /></label>
      </div>
      <fieldset><legend>Когда — необязательно</legend><div>{DAY_PARTS.map((part) => <button className={dayPart === part.value ? "is-selected" : ""} key={part.value} type="button" aria-pressed={dayPart === part.value} onClick={() => setDayPart(dayPart === part.value ? undefined : part.value)}>{part.label}</button>)}</div></fieldset>
      <div className="nutrition-form-actions"><button type="button" onClick={() => setFormOpen(false)}>отмена</button><button type="submit" disabled={!label.trim()}>сохранить</button></div>
    </form>}

    <div className="nutrition-day-list">
      {sortedEntries.length === 0 ? <p className="alma-empty-state">Сегодня здесь пока пусто — это нормально. ALMA не требует заполнять питание каждый день.</p> : sortedEntries.map((entry) => {
        const open = selectedEntry === entry.id;
        return <article className={open ? "is-open" : ""} key={entry.id}>
          <button className="nutrition-entry-main" type="button" onClick={() => setSelectedEntry(open ? null : entry.id)} aria-expanded={open}>
            <i>✦</i><span><b>{entry.label}</b><small>{entryDescription(entry)}</small></span><em>›</em>
          </button>
          {open && <div className="nutrition-entry-actions">
            <button type="button" onClick={() => onResearch(entry)}>проверить связь с самочувствием</button>
            <button type="button" onClick={() => { onRemove(entry.id); setSelectedEntry(null); }}>убрать отметку</button>
          </div>}
        </article>;
      })}
    </div>
  </section>;
}

function entryDescription(entry: NutritionEntry) {
  const parts: string[] = [];
  if (entry.quantity != null) parts.push(`${entry.quantity} ${entry.unit ?? metricDefinition(entry.definitionId)?.unit ?? ""}`.trim());
  const dayPart = DAY_PARTS.find((part) => part.value === entry.dayPart)?.label;
  if (dayPart) parts.push(dayPart);
  return parts.length ? parts.join(" · ") : "отмечено сегодня";
}

function dayPartOrder(value?: NutritionEntry["dayPart"]) {
  return value ? DAY_PARTS.findIndex((part) => part.value === value) : DAY_PARTS.length;
}
