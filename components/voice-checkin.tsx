"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { SymptomEntry, ZoneKey, ZoneValues } from "../lib/alma";
import { ZONE_META, feelingLabel } from "../lib/alma";

type VoiceSymptom = Pick<SymptomEntry, "label" | "zone" | "intensity">;
type VoiceSuggestion = { label: string; kind: "symptom" | "action"; zone?: SymptomEntry["zone"]; intensity?: number };
export type VoiceDraft = { transcript: string; zones: Partial<ZoneValues>; symptoms: VoiceSymptom[]; actions: string[]; suggestions: VoiceSuggestion[] };

type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  start: () => void; stop: () => void;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionFactory = new () => Recognition;

declare global { interface Window { SpeechRecognition?: RecognitionFactory; webkitSpeechRecognition?: RecognitionFactory; } }

const SIGNS: Array<{ words: string[]; zone: Exclude<ZoneKey, "physical">; value: number; symptom?: VoiceSymptom }> = [
  { words: ["много когнитивной нагрузки", "много работал", "много работала", "продуктив", "успела много", "много задач"], zone: "cognitive", value: 76, symptom: { label: "Высокая рабочая нагрузка", zone: "cognitive", intensity: 76 } },
  { words: ["туман", "тяжелая голова", "тяжёлая голова", "не могу сосредоточ", "трудно сосредоточ", "рассеян"], zone: "cognitive", value: -58, symptom: { label: "Труднее сосредоточиться", zone: "cognitive", intensity: 58 } },
  { words: ["ясная голова", "концентрац", "собран"], zone: "cognitive", value: 56, symptom: { label: "Ясность в голове", zone: "cognitive", intensity: 56 } },
  { words: ["плакс", "тяжело эмоцион", "плохо"], zone: "emotional", value: -42, symptom: { label: "Эмоциональная чувствительность", zone: "emotional", intensity: 42 } },
  { words: ["груст"], zone: "emotional", value: -42, symptom: { label: "Грусть", zone: "emotional", intensity: 42 } },
  { words: ["тревог"], zone: "emotional", value: -46, symptom: { label: "Тревога", zone: "emotional", intensity: 46 } },
  { words: ["раздраж"], zone: "emotional", value: -44, symptom: { label: "Раздражительность", zone: "emotional", intensity: 44 } },
  { words: ["поругал", "конфликт", "ссор"], zone: "emotional", value: -28, symptom: { label: "Напряжение после конфликта", zone: "emotional", intensity: 68 } },
  { words: ["счастлив", "радост", "довольн", "спокой", "легко на душе", "вдохнов"], zone: "emotional", value: 72, symptom: { label: "Эмоциональная устойчивость", zone: "emotional", intensity: 72 } },
  { words: ["не хочу близост", "либидо низк", "нет желания"], zone: "libido", value: -54, symptom: { label: "Снижение желания", zone: "libido", intensity: 54 } },
  { words: ["хочу близост", "возбужд", "либидо высок", "сильное желание"], zone: "libido", value: 58, symptom: { label: "Повышенное желание", zone: "libido", intensity: 58 } },
  { words: ["поддерж", "приятно общаться", "хорошо с людьми"], zone: "social", value: 47, symptom: { label: "Чувство поддержки", zone: "social", intensity: 47 } },
  { words: ["конфликт", "одиноко", "напряжение с людьми"], zone: "social", value: -50, symptom: { label: "Социальное напряжение", zone: "social", intensity: 50 } },
];

const ACTION_ALIASES: Record<string, string[]> = {
  "Контрацептив": ["контрацептив", "таблетк"], "Медитация": ["медитац"], "Йога": ["йог"], "Дыхательная практика": ["дыхательн"], "Тренировка": ["трениров", "спорт"], "Прогулка": ["прогул"], "Путешествие": ["путешеств", "дорог"], "Массаж": ["массаж"], "Алкоголь": ["алкогол"], "Дневник": ["дневник"], "Творчество": ["творчеств", "рисова", "зарисов"],
};

const EXTRA_FROM_SPEECH: Array<{ words: string[]; suggestion: VoiceSuggestion }> = [
  { words: ["устал", "устала", "усталость"], suggestion: { kind: "symptom", label: "Усталость", zone: "general", intensity: 45 } },
  { words: ["головн", "болит голова"], suggestion: { kind: "symptom", label: "Головная боль", zone: "cognitive", intensity: 52 } },
  { words: ["тошнот"], suggestion: { kind: "symptom", label: "Тошнота", zone: "libido", intensity: 45 } },
  { words: ["вздут"], suggestion: { kind: "symptom", label: "Вздутие живота", zone: "libido", intensity: 42 } },
  { words: ["болит живот", "боль в животе", "боли в животе", "низ живота"], suggestion: { kind: "symptom", label: "Боль внизу живота", zone: "libido", intensity: 55 } },
  { words: ["выделен"], suggestion: { kind: "symptom", label: "Изменение выделений", zone: "libido", intensity: 35 } },
  { words: ["секс", "близость была"], suggestion: { kind: "action", label: "Секс" } },
  { words: ["мастурбац"], suggestion: { kind: "action", label: "Мастурбация" } },
];

const VOICE_SYMPTOM_CATALOG: VoiceSymptom[] = [
  { label: "Труднее сосредоточиться", zone: "cognitive", intensity: 55 }, { label: "Туман в голове", zone: "cognitive", intensity: 55 }, { label: "Забывчивость", zone: "cognitive", intensity: 48 }, { label: "Головная боль", zone: "cognitive", intensity: 52 }, { label: "Мигрень", zone: "cognitive", intensity: 70 }, { label: "Сонливость", zone: "cognitive", intensity: 42 }, { label: "Бессонница", zone: "cognitive", intensity: 54 },
  { label: "Грусть", zone: "emotional", intensity: 48 }, { label: "Тревога", zone: "emotional", intensity: 56 }, { label: "Раздражительность", zone: "emotional", intensity: 52 }, { label: "Перепады настроения", zone: "emotional", intensity: 48 }, { label: "Апатия", zone: "emotional", intensity: 52 }, { label: "Эмоциональная чувствительность", zone: "emotional", intensity: 45 }, { label: "Напряжение после конфликта", zone: "emotional", intensity: 64 }, { label: "Радость", zone: "emotional", intensity: 56 }, { label: "Спокойствие", zone: "emotional", intensity: 48 },
  { label: "Боль внизу живота", zone: "libido", intensity: 55 }, { label: "Спазмы внизу живота", zone: "libido", intensity: 62 }, { label: "Тошнота", zone: "libido", intensity: 45 }, { label: "Вздутие живота", zone: "libido", intensity: 42 }, { label: "Чувствительная грудь", zone: "libido", intensity: 45 }, { label: "Боль в спине", zone: "libido", intensity: 46 }, { label: "Сухость во влагалище", zone: "libido", intensity: 42 }, { label: "Снижение желания", zone: "libido", intensity: 50 }, { label: "Повышенное желание", zone: "libido", intensity: 50 },
  { label: "Усталость", zone: "general", intensity: 45 }, { label: "Повышенный аппетит", zone: "general", intensity: 34 },
];

const normalize = (value: string) => value.toLowerCase().replace(/ё/g, "е").trim();
const findSymptoms = (query: string) => {
  const needle = normalize(query);
  if (!needle) return [];
  const words = needle.split(/\s+/).filter(Boolean);
  return VOICE_SYMPTOM_CATALOG.filter((item) => words.every((word) => normalize(item.label).includes(word.slice(0, Math.max(3, word.length - 1))) || word.length >= 4 && word.includes(normalize(item.label).slice(0, 4))));
};

function parseDraft(transcript: string, actionLabels: string[]): VoiceDraft {
  const text = transcript.toLowerCase();
  const scores: Partial<Record<Exclude<ZoneKey, "physical">, number>> = {};
  const symptoms: VoiceSymptom[] = [];
  const suggestions: VoiceSuggestion[] = [];
  SIGNS.forEach((item) => {
    if (!item.words.some((word) => text.includes(word))) return;
    scores[item.zone] = (scores[item.zone] ?? 0) + item.value;
    if (item.symptom && !symptoms.some((symptom) => symptom.label === item.symptom!.label)) symptoms.push(item.symptom);
  });
  EXTRA_FROM_SPEECH.forEach((item) => {
    if (!item.words.some((word) => text.includes(word))) return;
    if (!symptoms.some((symptom) => symptom.label === item.suggestion.label) && item.suggestion.kind === "symptom") symptoms.push({ label: item.suggestion.label, zone: item.suggestion.zone ?? "general", intensity: item.suggestion.intensity ?? 40 });
    if (item.suggestion.kind === "action" && !suggestions.some((suggestion) => suggestion.label === item.suggestion.label)) suggestions.push(item.suggestion);
  });
  const knownActions = actionLabels.filter((label) => (ACTION_ALIASES[label] ?? [label.toLowerCase()]).some((word) => text.includes(word)));
  const zones = Object.fromEntries(Object.entries(scores).filter(([, value]) => value).map(([zone, value]) => [zone, Math.max(-100, Math.min(100, value!))])) as Partial<ZoneValues>;
  return { transcript, zones, symptoms, actions: knownActions, suggestions };
}

export default function VoiceCheckinSheet({ actionLabels, onConfirm, onClose }: { actionLabels: string[]; onConfirm: (draft: VoiceDraft) => void; onClose: () => void }) {
  const [transcript, setTranscript] = useState("");
  const [mode, setMode] = useState<"recording" | "review">("recording");
  const [notice, setNotice] = useState("Слушаю. Расскажи свободно, как прошёл день.");
  const [draft, setDraft] = useState<VoiceDraft>({ transcript: "", zones: {}, symptoms: [], actions: [], suggestions: [] });
  const [customSymptom, setCustomSymptom] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [acceptedSuggestions, setAcceptedSuggestions] = useState<string[]>([]);
  const recognition = useRef<Recognition | null>(null);
  const closeSheet = () => { recognition.current?.stop(); onClose(); };

  function buildDraft(nextTranscript = transcript) { const next = parseDraft(nextTranscript, actionLabels); setDraft(next); setAcceptedSuggestions([]); setMode("review"); }
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
  const symptomMatches = useMemo(() => findSymptoms(customSymptom), [customSymptom]);
  const symptomExists = symptomMatches.some((item) => normalize(item.label) === normalize(customSymptom));
  const zoneRows = useMemo(() => Object.entries(draft.zones) as Array<[ZoneKey, number]>, [draft.zones]);
  function setZone(zone: ZoneKey, value: number) { setDraft((current) => ({ ...current, zones: { ...current.zones, [zone]: value } })); }
  function removeSymptom(label: string) { setDraft((current) => ({ ...current, symptoms: current.symptoms.filter((symptom) => symptom.label !== label) })); }
  function toggleAction(label: string) { setDraft((current) => ({ ...current, actions: current.actions.includes(label) ? current.actions.filter((item) => item !== label) : [...current.actions, label] })); }
  function addCustom(symptom?: VoiceSymptom) { const entry = symptom ?? { label: customSymptom.trim(), zone: "general" as const, intensity: 40 }; if (!entry.label) return; setDraft((current) => current.symptoms.some((item) => normalize(item.label) === normalize(entry.label)) ? current : ({ ...current, symptoms: [...current.symptoms, entry] })); setCustomSymptom(""); }
  function toggleSuggestion(label: string) { setAcceptedSuggestions((current) => current.includes(label) ? current.filter((item) => item !== label) : [...current, label]); }
  function confirmDraft() {
    const accepted = draft.suggestions.filter((item) => acceptedSuggestions.includes(item.label));
    const symptoms = [...draft.symptoms, ...accepted.filter((item) => item.kind === "symptom").map((item) => ({ label: item.label, zone: item.zone ?? "general", intensity: item.intensity ?? 40 }))].filter((item, index, list) => list.findIndex((candidate) => candidate.label === item.label) === index);
    const actions = [...new Set([...draft.actions, ...accepted.filter((item) => item.kind === "action").map((item) => item.label)])];
    onConfirm({ ...draft, symptoms, actions }); closeSheet();
  }

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
        <p className="voice-section-label">Нагрузки и либидо</p>
        <div className="voice-zone-list">{zoneRows.length ? zoneRows.map(([zone, value]) => <article key={zone} style={{ "--voice-color": ZONE_META[zone].color } as CSSProperties}><div><span>{ZONE_META[zone].label}</span><b>{value > 0 ? "+" : ""}{value} · {feelingLabel(value)}</b></div><input type="range" min="-100" max="100" value={value} onChange={(event) => setZone(zone, Number(event.target.value))} /><button type="button" onClick={() => setDraft((current) => { const zones = { ...current.zones }; delete zones[zone]; return { ...current, zones }; })}>×</button></article>) : <p className="voice-empty">Не нашла уверенной оценки — можно оставить так или отметить через силуэт.</p>}</div>
        <p className="voice-section-label">Симптомы и ощущения</p>
        <div className="voice-symptoms">{symptoms.map((symptom) => <button key={symptom.label} style={{ "--voice-color": ZONE_META[symptom.zone as ZoneKey]?.color ?? "#b48cff" } as CSSProperties} type="button" onClick={() => removeSymptom(symptom.label)}><i>✓</i>{symptom.label}<b>×</b></button>)}</div>
        {draft.suggestions.some((item) => item.kind === "symptom") && <div className="voice-proposals"><span>Из рассказа — подтвердить при необходимости</span>{draft.suggestions.filter((item) => item.kind === "symptom").map((item) => <button className={acceptedSuggestions.includes(item.label) ? "is-selected" : ""} type="button" key={item.label} onClick={() => toggleSuggestion(item.label)}><i>{acceptedSuggestions.includes(item.label) ? "✓" : "＋"}</i>{item.label}</button>)}</div>}
        <div className="voice-custom"><span>⌕</span><input value={customSymptom} onChange={(event) => setCustomSymptom(event.target.value)} placeholder="Найти или добавить симптом" /></div>
        {customSymptom.trim() && <div className="voice-symptom-search">{symptomMatches.length ? <>{symptomMatches.map((symptom) => <button type="button" key={symptom.label} onClick={() => addCustom(symptom)}><i>＋</i>{symptom.label}</button>)}</> : <button className="voice-add-new" type="button" onClick={() => addCustom()}>＋ Добавить «{customSymptom.trim()}»</button>}{!symptomExists && symptomMatches.length > 0 && <button className="voice-add-new" type="button" onClick={() => addCustom()}>＋ Добавить «{customSymptom.trim()}»</button>}</div>}
        <p className="voice-section-label">Действия</p>
        <div className="voice-actions">{actionLabels.map((label) => <button key={label} className={draft.actions.includes(label) ? "is-selected" : ""} type="button" onClick={() => toggleAction(label)}><i>{draft.actions.includes(label) ? "✓" : "＋"}</i>{label}</button>)}</div>
        {draft.suggestions.some((item) => item.kind === "action") && <div className="voice-proposals voice-action-proposals"><span>Новые действия из рассказа</span>{draft.suggestions.filter((item) => item.kind === "action").map((item) => <button className={acceptedSuggestions.includes(item.label) ? "is-selected" : ""} type="button" key={item.label} onClick={() => toggleSuggestion(item.label)}><i>{acceptedSuggestions.includes(item.label) ? "✓" : "＋"}</i>{item.label}</button>)}</div>}
        <button className="voice-confirm" type="button" onClick={confirmDraft}>Подтвердить отметки</button>
      </>}
    </section>
  </div>;
}
