"use client";

import { useState } from "react";
import type { SymptomEntry } from "../lib/alma";

const ICONS: Record<string, string> = { cognitive: "◉", emotional: "♡", physical: "⌁", libido: "✦", social: "••", general: "+" };

export default function SymptomCheck({ symptoms, onUpdate, onAdd }: { symptoms: SymptomEntry[]; onUpdate: (symptom: SymptomEntry) => void; onAdd: (symptom: SymptomEntry) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [custom, setCustom] = useState("");
  const active = symptoms.find((symptom) => symptom.id === editing);

  function choose(symptom: SymptomEntry) {
    if (symptom.status === "suggested") {
      onUpdate({ ...symptom, status: "confirmed" });
    }
    if (symptom.status !== "dismissed") setEditing(symptom.id);
  }

  function addCustom() {
    const label = custom.trim();
    if (!label) return;
    const symptom: SymptomEntry = {
      id: `custom-${Date.now()}`,
      label,
      zone: "general",
      status: "confirmed",
      intensity: 40,
      suggestedBy: "user",
    };
    onAdd(symptom);
    setCustom("");
    setAdding(false);
    setEditing(symptom.id);
  }

  return <section className="symptom-card glass-card" aria-labelledby="symptoms-title">
    <header className="section-header">
      <div><p className="eyebrow">система предлагает</p><h2 id="symptoms-title">Похоже на сегодня?</h2></div>
      <p>подтвердить или убрать</p>
    </header>
    <div className="symptom-pills">
      {symptoms.map((symptom) => <div key={symptom.id} className={`symptom-pill status-${symptom.status}`}>
        <button className="symptom-choice" type="button" onClick={() => choose(symptom)} aria-pressed={symptom.status === "confirmed"}>
          <i>{ICONS[symptom.zone]}</i><span>{symptom.label}</span>{symptom.status === "confirmed" && <b>✓</b>}
        </button>
        <button className="symptom-dismiss" type="button" aria-label={`Отклонить: ${symptom.label}`} onClick={() => { onUpdate({ ...symptom, status: symptom.status === "dismissed" ? "suggested" : "dismissed" }); setEditing(null); }}>×</button>
      </div>)}
    </div>

    {active && active.status === "confirmed" && <div className="symptom-editor">
      <div><span>Насколько заметно</span><strong>{active.intensity}%</strong></div>
      <input type="range" min="0" max="100" value={active.intensity} aria-label={`Интенсивность: ${active.label}`} onChange={(event) => onUpdate({ ...active, intensity: Number(event.target.value) })} />
      <div className="intensity-labels"><span>едва</span><span>умеренно</span><span>сильно</span></div>
      <button type="button" onClick={() => setEditing(null)}>готово</button>
    </div>}

    {!adding ? <button className="add-observation" type="button" onClick={() => setAdding(true)}>＋ добавить своё ощущение</button> : <div className="custom-observation">
      <input autoFocus value={custom} maxLength={120} placeholder="Например, тяжесть в животе" onChange={(event) => setCustom(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addCustom()} />
      <button type="button" onClick={addCustom}>добавить</button>
      <button type="button" aria-label="Отмена" onClick={() => setAdding(false)}>×</button>
    </div>}
  </section>;
}
