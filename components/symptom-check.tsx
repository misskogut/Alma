"use client";

import { useState } from "react";
import type { SymptomEntry } from "../lib/alma";

const ICONS: Record<string, string> = { cognitive: "◉", emotional: "♡", physical: "⌁", libido: "✦", social: "••", general: "+" };

export default function SymptomCheck({ symptoms, onUpdate, onAdd }: { symptoms: SymptomEntry[]; onUpdate: (symptom: SymptomEntry) => void; onAdd: (symptom: SymptomEntry) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [custom, setCustom] = useState("");
  const active = symptoms.find((symptom) => symptom.id === editing);
  const confirmed = symptoms.filter((symptom) => symptom.status === "confirmed");

  function choose(symptom: SymptomEntry) {
    setEditing(editing === symptom.id ? null : symptom.id);
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
      <div><p className="eyebrow">отмечено за сегодня</p><h2 id="symptoms-title">Симптомы и ощущения</h2></div>
      <p>{confirmed.length ? `${confirmed.length} отмечено` : "пока пусто"}</p>
    </header>
    <div className="symptom-pills">
      {confirmed.map((symptom) => <div key={symptom.id} className={`symptom-pill status-${symptom.status}`}>
        <button className="symptom-choice" type="button" onClick={() => choose(symptom)} aria-pressed={symptom.status === "confirmed"}>
          <i>{ICONS[symptom.zone]}</i><span>{symptom.label}</span>{symptom.status === "confirmed" && <b>✓</b>}
        </button>
        <button className="symptom-dismiss" type="button" aria-label={`Убрать: ${symptom.label}`} onClick={() => { onUpdate({ ...symptom, status: "dismissed" }); setEditing(null); }}>×</button>
        {active?.id === symptom.id && <div className="symptom-editor symptom-editor-inline">
          <div><span>Насколько заметно</span><strong>{symptom.intensity}%</strong></div>
          <input type="range" min="0" max="100" value={symptom.intensity} aria-label={`Интенсивность: ${symptom.label}`} onChange={(event) => onUpdate({ ...symptom, intensity: Number(event.target.value) })} />
          <div className="intensity-labels"><span>едва</span><span>умеренно</span><span>сильно</span></div>
        </div>}
      </div>)}
    </div>

    {!adding ? <button className="add-observation" type="button" onClick={() => setAdding(true)}>＋ добавить симптом или ощущение</button> : <div className="custom-observation">
      <input autoFocus value={custom} maxLength={120} placeholder="Например, тяжесть в животе" onChange={(event) => setCustom(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addCustom()} />
      <button type="button" onClick={addCustom}>добавить</button>
      <button type="button" aria-label="Отмена" onClick={() => setAdding(false)}>×</button>
    </div>}
  </section>;
}
