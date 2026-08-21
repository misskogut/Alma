"use client";

import { useEffect, useState } from "react";
import type { MainWaveStatus } from "../lib/alma";

function signed(value: number) {
  return value > 0 ? `+${value}` : `${value}`;
}

function label(value: number) {
  if (value <= -67) return "сегодня очень тяжело";
  if (value <= -34) return "сегодня скорее тяжело";
  if (value < 0) return "чуть ниже обычного";
  if (value === 0) return "ровно и нейтрально";
  if (value <= 33) return "чуть лучше обычного";
  if (value <= 66) return "сегодня скорее хорошо";
  return "сегодня очень хорошо";
}

export default function OverallWellbeing({ value, status, onSave }: {
  value: number | null;
  status: MainWaveStatus;
  onSave: (value: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? 0);

  useEffect(() => {
    if (!open) setDraft(value ?? 0);
  }, [open, value]);

  return <section className={`overall-anchor${open ? " is-open" : ""}`} aria-label="Общее самочувствие">
    <button className="overall-anchor-summary" type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
      <span><small>как ты в целом?</small><strong>{value == null ? "Можно добавить одну общую отметку" : label(value)}</strong></span>
      <em>{value == null ? "＋" : signed(value)}</em>
    </button>
    {open && <div className="overall-anchor-editor">
      <p>Это главный фактический ориентир дня. Другие отметки помогают понять, что было рядом, но не заменяют твою общую оценку.</p>
      <input type="range" min="-100" max="100" value={draft} aria-label="Общее самочувствие от минус ста до плюс ста" onChange={(event) => setDraft(Number(event.target.value))} />
      <div><span>тяжело</span><b>{label(draft)} · {signed(draft)}</b><span>хорошо</span></div>
      <button type="button" onClick={() => { onSave(draft); setOpen(false); }}>{status === "user_confirmed" ? "сохранить изменение" : "сохранить отметку"}</button>
    </div>}
  </section>;
}
