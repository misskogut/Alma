"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { SymptomEntry, ZoneKey, ZoneValues } from "../lib/alma";
import { ZONE_META, feelingLabel } from "../lib/alma";

type VoiceSymptom = Pick<SymptomEntry, "label" | "zone" | "intensity">;
export type VoiceDraft = { transcript: string; zones: Partial<ZoneValues>; symptoms: VoiceSymptom[]; actions: string[] };

type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  start: () => void; stop: () => void;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionFactory = new () => Recognition;

declare global { interface Window { SpeechRecognition?: RecognitionFactory; webkitSpeechRecognition?: RecognitionFactory; } }

const SIGNS: Array<{ words: string[]; zone: ZoneKey; value: number; symptom?: VoiceSymptom }> = [
  { words: ["туман", "тяжелая голова", "тяжёлая голова", "не могу сосредоточ", "трудно сосредоточ", "рассеян"], zone: "cognitive", value: -58, symptom: { label: "Труднее сосредоточиться", zone: "cognitive", intensity: 58 } },
  { words: ["ясная голова", "концентрац", "собран"], zone: "cognitive", value: 56, symptom: { label: "Ясность в голове", zone: "cognitive", intensity: 56 } },
  { words: ["тревог", "раздраж", "груст", "плакс", "тяжело эмоцион"], zone: "emotional", value: -56, symptom: { label: "Эмоциональная чувствительность", zone: "emotional", intensity: 56 } },
  { words: ["спокой", "радост", "легко на душе", "вдохнов"], zone: "emotional", value: 55, symptom: { label: "Эмоциональная устойчивость", zone: "emotional", intensity: 55 } },
  { words: ["устал", "нет сил", "головн", "болит голова", "тело бол"], zone: "physical", value: -52, symptom: { label: "Усталость", zone: "physical", intensity: 52 } },
  { words: ["энерги", "бодр", "много сил"], zone: "physical", value: 54, symptom: { label: "Бодрость", zone: "physical", intensity: 54 } },
  { words: ["не хочу близост", "либидо низк", "нет желания"], zone: "libido", value: -54, symptom: { label: "Снижение желания", zone: "libido", intensity: 54 } },
  { words: ["хочу близост", "возбужд", "либидо высок", "сильное желание"], zone: "libido", value: 58, symptom: { label: "Повышенное желание", zone: "libido", intensity: 58 } },
  { words: ["поддерж", "приятно общаться", "хорошо с людьми"], zone: "social", value: 47, symptom: { label: "Чувство поддержки", zone: "social", intensity: 47 } },
  { words: ["конфликт", "одиноко", "напряжение с людьми"], zone: "social", value: -50, symptom: { label: "Социальное напряжение", zone: "social", intensity: 50 } },
];

const ACTION_ALIASES: Record<string, string[]> = {
  "Контрацептив": ["контрацептив", "таблетк"], "Медитация": ["медитац"], "Йога": ["йог"], "Дыхательная практика": ["дыхательн"], "Тренировка": ["трениров", "спорт"], "Прогулка": ["прогул"], "Путешествие": ["путешеств", "дорог"], "Массаж": ["массаж"], "Алкоголь": ["алкогол"], "Дневник": ["дневник"],
};

function parseDraft(transcript: string, actionLabels: string[]): VoiceDraft {
  const text = transcript.toLowerCase();
  const zones: Partial<ZoneValues> = {};
  const symptoms: VoiceSymptom[] = [];
  SIGNS.forEach((item) => {
    if (!item.words.some((word) => text.includes(word))) return;
    zones[item.zone] = item.value;
    if (item.symptom && !symptoms.some((symptom) => symptom.label === item.symptom!.label)) symptoms.push(item.symptom);
  });
  const actions = actionLabels.filter((label) => (ACTION_ALIASES[label] ?? [label.toLowerCase()]).some((word) => text.includes(word)));
  return { transcript, zones, symptoms, actions };
}

export default function VoiceCheckinSheet({ actionLabels, onConfirm, onClose }: { actionLabels: string[]; onConfirm: (draft: VoiceDraft) => void; onClose: () => void }) {
  const [transcript, setTranscript] = useState("");
  const [mode, setMode] = useState<"recording" | "review">("recording");
  const [notice, setNotice] = useState("Слушаю. Расскажи свободно, как прошёл день.");
  const [draft, setDraft] = useState<VoiceDraft>({ transcript: "", zones: {}, symptoms: [], actions: [] });
  const [customSymptom, setCustomSymptom] = useState("");
  const [isListening, setIsListening] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const closeSheet = () => { recognition.current?.stop(); onClose(); };

  function buildDraft(nextTranscript = transcript) { const next = parseDraft(nextTranscript, actionLabels); setDraft(next); setMode("review"); }
  function startListening() {
    const Factory = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Factory) { setNotice("На этом устройстве распознавание речи недоступно — можно вписать заметку ниже."); return; }
    try {
      const instance = new Factory(); recognition.current = instance; instance.lang = "ru-RU"; instance.continuous = true; instance.interimResults = true;
      instance.onresult = (event) => { let next = ""; for (let index = 0; index < event.results.length; index += 1) next += event.results[index][0].transcript; setTranscript(next.trim()); };
      instance.onerror = (event) => setNotice(event.error === "not-allowed" ? "Нужен доступ к микрофону. Разреши его или введи заметку текстом." : "Не удалось распознать речь. Можно продолжить текстом.");
      instance.onend = () => { recognition.current = null; setIsListening(false); };
      instance.start(); setIsListening(true); setNotice("Запись идёт — можно говорить в обычном темпе.");
    } catch { setNotice("Микрофон уже занят или недоступен. Можно вписать заметку текстом."); }
  }

  useEffect(() => { startListening(); return () => recognition.current?.stop(); }, []);
  useEffect(() => { const y = window.scrollY; const body = document.body; const root = document.documentElement; const previous = { position: body.style.position, top: body.style.top, width: body.style.width, overflow: body.style.overflow, rootOverflow: root.style.overflow }; body.style.position = "fixed"; body.style.top = `-${y}px`; body.style.width = "100%"; body.style.overflow = "hidden"; root.style.overflow = "hidden"; return () => { recognition.current?.stop(); body.style.position = previous.position; body.style.top = previous.top; body.style.width = previous.width; body.style.overflow = previous.overflow; root.style.overflow = previous.rootOverflow; window.scrollTo(0, y); }; }, []);

  const symptoms = draft.symptoms;
  const zoneRows = useMemo(() => Object.entries(draft.zones) as Array<[ZoneKey, number]>, [draft.zones]);
  function setZone(zone: ZoneKey, value: number) { setDraft((current) => ({ ...current, zones: { ...current.zones, [zone]: value } })); }
  function removeSymptom(label: string) { setDraft((current) => ({ ...current, symptoms: current.symptoms.filter((symptom) => symptom.label !== label) })); }
  function toggleAction(label: string) { setDraft((current) => ({ ...current, actions: current.actions.includes(label) ? current.actions.filter((item) => item !== label) : [...current.actions, label] })); }
  function addCustom() { const label = customSymptom.trim(); if (!label) return; setDraft((current) => ({ ...current, symptoms: [...current.symptoms, { label, zone: "general", intensity: 40 }] })); setCustomSymptom(""); }

  return <div className="sheet-layer voice-layer" role="presentation">
    <section className="bottom-sheet voice-sheet" role="dialog" aria-modal="true" aria-labelledby="voice-title">
      <div className="sheet-handle" />
      <header className="sheet-header"><div><p className="eyebrow">быстрый разбор дня</p><h2 id="voice-title">{mode === "recording" ? "Расскажи, как было" : "Проверь, что отметила ALMA"}</h2></div><button type="button" aria-label="Закрыть" onClick={closeSheet}>×</button></header>
      {mode === "recording" ? <>
        <button className={`voice-orb${isListening ? " is-listening" : ""}`} type="button" onClick={() => recognition.current ? recognition.current.stop() : startListening()} aria-label="Начать или остановить запись"><svg viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="voice-orb-rainbow" x1="8" y1="8" x2="40" y2="40"><stop stopColor="#6ce8ff"/><stop offset=".34" stopColor="#a979ff"/><stop offset=".68" stopColor="#ff83c9"/><stop offset="1" stopColor="#ffd176"/></linearGradient></defs><rect x="17" y="7" width="14" height="23" rx="7"/><path d="M12 24a12 12 0 0 0 24 0M24 36v6M17 42h14"/></svg><span>{isListening ? "запись идёт" : "нажми и говори"}</span></button>
        <p className="voice-notice">{notice}</p>
        <textarea className="voice-transcript" value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder="Например: плохо спала, было трудно сосредоточиться, вечером йога" />
        <button className="voice-finish" type="button" onClick={() => { recognition.current?.stop(); buildDraft(); }}>Закончить и разобрать</button>
      </> : <>
        <p className="voice-source">«{draft.transcript || "Заметка не распознана — можно добавить отметки вручную."}»</p>
        <p className="voice-section-label">Состояния</p>
        <div className="voice-zone-list">{zoneRows.length ? zoneRows.map(([zone, value]) => <article key={zone} style={{ "--voice-color": ZONE_META[zone].color } as CSSProperties}><div><span>{ZONE_META[zone].label}</span><b>{value > 0 ? "+" : ""}{value} · {feelingLabel(value)}</b></div><input type="range" min="-100" max="100" value={value} onChange={(event) => setZone(zone, Number(event.target.value))} /><button type="button" onClick={() => setDraft((current) => { const zones = { ...current.zones }; delete zones[zone]; return { ...current, zones }; })}>×</button></article>) : <p className="voice-empty">Не нашла уверенной оценки — можно оставить так или отметить через силуэт.</p>}</div>
        <p className="voice-section-label">Симптомы и ощущения</p>
        <div className="voice-symptoms">{symptoms.map((symptom) => <button key={symptom.label} style={{ "--voice-color": ZONE_META[symptom.zone as ZoneKey]?.color ?? "#b48cff" } as CSSProperties} type="button" onClick={() => removeSymptom(symptom.label)}><i>✓</i>{symptom.label}<b>×</b></button>)}</div>
        <div className="voice-custom"><input value={customSymptom} onChange={(event) => setCustomSymptom(event.target.value)} placeholder="Добавить своё ощущение" /><button type="button" onClick={addCustom}>＋</button></div>
        <p className="voice-section-label">Действия</p>
        <div className="voice-actions">{actionLabels.map((label) => <button key={label} className={draft.actions.includes(label) ? "is-selected" : ""} type="button" onClick={() => toggleAction(label)}><i>{draft.actions.includes(label) ? "✓" : "＋"}</i>{label}</button>)}</div>
        <button className="voice-confirm" type="button" onClick={() => { onConfirm({ ...draft, transcript }); closeSheet(); }}>Подтвердить отметки</button>
      </>}
    </section>
  </div>;
}
