"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BodyCheckin from "../components/body-checkin";
import ActivityPanel from "../components/activity-panel";
import CycleHero from "../components/cycle-hero";
import EnvironmentPanel, { ContextStrip } from "../components/environment-panel";
import { ConnectionsSheet, CycleSettingsSheet, DaySheet } from "../components/sheets";
import SymptomCheck from "../components/symptom-check";
import WaveChart from "../components/wave-chart";
import VoiceCheckinSheet, { type VoiceDraft } from "../components/voice-checkin";
import type { AlmaProfile, ContextKey, EnvironmentPayload, SymptomEntry, SyncMode, WaveLayerKey, ZoneKey, ZoneValues } from "../lib/alma";
import { DEFAULT_SYMPTOMS, TIMELINE_RADIUS, ZONE_META, addDays, buildDayModels, defaultProfile, defaultState, formatShortDate, phaseLabel, relativeDayLabel, todayIso } from "../lib/alma";
import { bootstrapCloud, saveCloudEnvironment, saveCloudProfile, saveCloudState, saveCloudSymptom } from "../lib/supabase";

const STORAGE_KEY = "alma-observation-v2";
const TODAY_INDEX = TIMELINE_RADIUS;

type LocalSnapshot = {
  profile: AlmaProfile;
  states: Record<string, ZoneValues>;
  symptoms: Record<string, SymptomEntry[]>;
};

function cloneSuggestions() {
  return DEFAULT_SYMPTOMS.map((symptom) => ({ ...symptom }));
}

function mergeSymptoms(base: SymptomEntry[], incoming: SymptomEntry[]) {
  const map = new Map(base.map((symptom) => [symptom.id, symptom]));
  incoming.forEach((symptom) => map.set(symptom.id, symptom));
  return Array.from(map.values());
}

function parseLocalSnapshot(raw: string | null): LocalSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LocalSnapshot>;
    if (!parsed.profile?.lastPeriodStart || !parsed.states || !parsed.symptoms) return null;
    return parsed as LocalSnapshot;
  } catch {
    return null;
  }
}

function insightFor(day: ReturnType<typeof buildDayModels>[number], symptomsByDate: Record<string, SymptomEntry[]>, environment: EnvironmentPayload | null) {
  if (day.isForecast) {
    const external = environment?.days.find((item) => item.date === day.iso);
    const condition = external?.pressureHpa != null ? `давление около ${Math.round(external.pressureHpa * 0.750062)} мм` : "внешний фон ещё уточняется";
    return { kicker: "мягкий ориентир", title: `${relativeDayLabel(day.iso)} · ${phaseLabel(day.phase).toLowerCase()}`, body: `Завтра ожидается ${condition}. Это только фон дня: когда он наступит, можно будет отметить, как ты себя чувствовала на самом деле.`, tone: "forecast" };
  }

  const confirmed = symptomsByDate[day.iso]?.filter((symptom) => symptom.status === "confirmed") ?? [];
  if (confirmed.length) {
    const focus = confirmed[0];
    const repeats = Object.values(symptomsByDate).filter((items) => items.some((item) => item.id === focus.id && item.status === "confirmed")).length;
    if (repeats >= 3) return { kicker: "личное наблюдение", title: "Похоже, это повторяется", body: `Мы заметили: «${focus.label.toLowerCase()}» уже встречалось в похожие дни. Это не объясняет причину, но может стать полезной подсказкой.`, tone: "pattern" };
    if (repeats === 2) return { kicker: "появляется связь", title: "Это повторилось второй раз", body: `«${focus.label}» снова оказалось рядом с похожим фоном. Это ещё не причина, но уже полезное наблюдение.`, tone: "quiet" };
    return { kicker: "сохраним наблюдение", title: "Отметили на сегодня", body: `«${focus.label}» встретилось впервые. Если это повторится в похожих условиях, ALMA покажет возможную связь.`, tone: "new" };
  }

  const ordered = (Object.keys(day.zones) as ZoneKey[]).sort((a, b) => day.zones[a] - day.zones[b]);
  const low = ordered[0];
  const high = ordered.at(-1) ?? low;
  return { kicker: "сегодняшний ритм", title: "Внутри сегодня разный темп", body: `Сейчас ${ZONE_META[low].label.toLowerCase()} ниже, а ${ZONE_META[high].label.toLowerCase()} выше. Похоже на то, как ты себя чувствуешь?`, tone: "daily" };
}

export default function AlmaPrototype() {
  const currentIso = useMemo(() => todayIso(), []);
  const [profile, setProfile] = useState<AlmaProfile>(() => defaultProfile(currentIso));
  const [stateByDate, setStateByDate] = useState<Record<string, ZoneValues>>(() => defaultState(currentIso));
  const [symptomsByDate, setSymptomsByDate] = useState<Record<string, SymptomEntry[]>>(() => ({ [currentIso]: cloneSuggestions() }));
  const [activeIndex, setActiveIndex] = useState(TODAY_INDEX);
  const [activeZone, setActiveZone] = useState<ZoneKey | null>(null);
  const [activeContexts, setActiveContexts] = useState<Set<ContextKey>>(() => new Set());
  const [internalWaves, setInternalWaves] = useState<Set<ZoneKey>>(() => new Set());
  const [activeLayers, setActiveLayers] = useState<Set<WaveLayerKey>>(() => new Set(["internal"]));
  const [environment, setEnvironment] = useState<EnvironmentPayload | null>(null);
  const [environmentLoading, setEnvironmentLoading] = useState(true);
  const [environmentError, setEnvironmentError] = useState<string | null>(null);
  const [reloadEnvironment, setReloadEnvironment] = useState(0);
  const [syncMode, setSyncMode] = useState<SyncMode>("connecting");
  const [userId, setUserId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [cycleSettingsOpen, setCycleSettingsOpen] = useState(false);
  const [daySheetOpen, setDaySheetOpen] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [voiceCheckinOpen, setVoiceCheckinOpen] = useState(false);
  const pendingValues = useRef<ZoneValues | null>(null);

  const days = useMemo(() => buildDayModels(profile, stateByDate, currentIso), [profile, stateByDate, currentIso]);
  const activeDay = days[activeIndex];
  const activeSymptoms = symptomsByDate[activeDay.iso] ?? [];
  const symptomHistory = useMemo(() => Object.values(symptomsByDate).flat(), [symptomsByDate]);
  const confirmedCount = activeSymptoms.filter((symptom) => symptom.status === "confirmed").length;
  const insight = insightFor(activeDay, symptomsByDate, environment);

  const connectCloud = useCallback(async (local: LocalSnapshot | null = null) => {
    setSyncMode("connecting");
    try {
      const defaults = local?.profile ?? profile;
      const cloud = await bootstrapCloud(defaults, addDays(currentIso, -120), addDays(currentIso, 45));
      const nextProfile = local?.profile ?? cloud.profile;
      setProfile(nextProfile);
      setStateByDate((previous) => ({ ...previous, ...cloud.states, ...(local?.states ?? {}) }));
      setSymptomsByDate((previous) => {
        const next = { ...previous };
        for (const [date, list] of Object.entries(cloud.symptoms)) next[date] = mergeSymptoms(next[date] ?? [], list);
        for (const [date, list] of Object.entries(local?.symptoms ?? {})) next[date] = mergeSymptoms(next[date] ?? [], list);
        next[currentIso] = mergeSymptoms(cloneSuggestions(), next[currentIso] ?? []);
        return next;
      });
      setUserId(cloud.userId);
      setSyncMode("cloud");
      if (local) {
        await Promise.all([
          saveCloudProfile(cloud.userId, nextProfile),
          ...Object.entries(local.states).map(([date, values]) => saveCloudState(cloud.userId, date, values)),
          ...Object.entries(local.symptoms).flatMap(([date, list]) => list
            .filter((symptom) => symptom.status !== "suggested" || symptom.suggestedBy === "user")
            .map((symptom) => saveCloudSymptom(cloud.userId, date, symptom))),
        ]);
      }
    } catch {
      setUserId(null);
      setSyncMode("local");
    }
  }, [currentIso, profile]);

  useEffect(() => {
    const local = parseLocalSnapshot(window.localStorage.getItem(STORAGE_KEY));
    if (local) {
      setProfile(local.profile);
      setStateByDate({ ...defaultState(currentIso), ...local.states });
      setSymptomsByDate({ ...local.symptoms, [currentIso]: mergeSymptoms(cloneSuggestions(), local.symptoms[currentIso] ?? []) });
    }
    setHydrated(true);
    void connectCloud(local);
    // This bootstraps once; manual retries use the status button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const snapshot: LocalSnapshot = { profile, states: stateByDate, symptoms: symptomsByDate };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  }, [hydrated, profile, stateByDate, symptomsByDate]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setEnvironmentLoading(true);
      setEnvironmentError(null);
      try {
        const params = new URLSearchParams({ lat: profile.latitude.toString(), lon: profile.longitude.toString(), name: profile.locationName });
        const response = await fetch(`/api/environment?${params}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Источник не ответил");
        setEnvironment(payload as EnvironmentPayload);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setEnvironmentError((error as Error).message);
      } finally {
        if (!controller.signal.aborted) setEnvironmentLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [profile.latitude, profile.longitude, profile.locationName, reloadEnvironment]);

  useEffect(() => {
    if (!userId || !environment) return;
    saveCloudEnvironment(userId, environment).catch(() => setSyncMode("local"));
  }, [userId, environment]);

  useEffect(() => {
    setActiveZone(null);
    pendingValues.current = null;
  }, [activeIndex]);

  function toggleContext(key: ContextKey) {
    setActiveContexts((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleInternalWave(key: ZoneKey) {
    setInternalWaves((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleLayer(key: WaveLayerKey) {
    setActiveLayers((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function selectDay(index: number) {
    setActiveIndex(Math.max(0, Math.min(days.length - 1, index)));
  }

  function openDay(index: number) {
    selectDay(index);
    setDaySheetOpen(true);
  }

  function changeZone(zone: ZoneKey, value: number) {
    const next = { ...activeDay.zones, [zone]: value };
    pendingValues.current = next;
    setStateByDate((current) => ({ ...current, [activeDay.iso]: next }));
  }

  function commitState() {
    const values = pendingValues.current ?? activeDay.zones;
    if (userId) saveCloudState(userId, activeDay.iso, values).catch(() => setSyncMode("local"));
  }

  function updateSymptom(symptom: SymptomEntry) {
    setSymptomsByDate((current) => {
      const list = current[activeDay.iso] ?? [];
      return { ...current, [activeDay.iso]: list.map((item) => item.id === symptom.id ? symptom : item) };
    });
    if (userId) saveCloudSymptom(userId, activeDay.iso, symptom).catch(() => setSyncMode("local"));
  }

  function addSymptom(symptom: SymptomEntry) {
    setSymptomsByDate((current) => ({ ...current, [activeDay.iso]: [...(current[activeDay.iso] ?? []), symptom] }));
    if (userId) saveCloudSymptom(userId, activeDay.iso, symptom).catch(() => setSyncMode("local"));
  }

  function toggleQuickAction(action: { label: string }) {
    const existing = activeSymptoms.find((item) => item.zone === "general" && item.label === action.label);
    if (existing) {
      updateSymptom({ ...existing, status: existing.status === "confirmed" ? "dismissed" : "confirmed" });
      return;
    }
    addSymptom({ id: `action-${activeDay.iso}-${action.label.toLowerCase().replace(/[^a-zа-яё0-9]+/giu, "-")}`, label: action.label, zone: "general", status: "confirmed", intensity: 0, suggestedBy: "user" });
  }

  // A new drag is a replacement of this zone's last check-in, not another
  // observation layered over it. Historical entries are retained as dismissed
  // in storage, so they cannot reappear after a refresh.
  function beginZoneAdjustment(zone: ZoneKey) {
    setSymptomsByDate((current) => {
      const list = current[activeDay.iso] ?? [];
      const dismissed = list.map((symptom) => symptom.zone === zone && symptom.status === "confirmed" ? { ...symptom, status: "dismissed" as const } : symptom);
      if (userId) dismissed
        .filter((symptom, index) => symptom.zone === zone && symptom.status === "dismissed" && list[index]?.status === "confirmed")
        .forEach((symptom) => saveCloudSymptom(userId, activeDay.iso, symptom).catch(() => setSyncMode("local")));
      return { ...current, [activeDay.iso]: dismissed };
    });
  }

  function saveProfile(next: AlmaProfile, focusIso?: string) {
    setProfile(next);
    if (focusIso) {
      const focusIndex = days.findIndex((item) => item.iso === focusIso);
      if (focusIndex >= 0) setActiveIndex(focusIndex);
    }
    setCycleSettingsOpen(false);
    if (userId) saveCloudProfile(userId, next).catch(() => setSyncMode("local"));
  }

  function updateCycleActions(cycleActions: string[], cycleActionCatalog = profile.cycleActionCatalog) {
    const cycleQuickAccessActions = (profile.cycleQuickAccessActions ?? []).filter((label) => cycleActions.includes(label));
    const next = { ...profile, cycleActions, cycleActionCatalog, cycleQuickAccessActions };
    setProfile(next);
    // The working set is also retained in the local ALMA snapshot. The current
    // cloud profile schema only stores cycle settings, so this remains safely
    // device-local until a dedicated preference field is introduced.
  }

  function updateActivityActions(quickActions: string[], actionCatalog: string[]) {
    setProfile({ ...profile, quickActions, actionCatalog });
  }

  function updateCycleQuickAccess(cycleQuickAccessActions: string[]) {
    setProfile({ ...profile, cycleQuickAccessActions: cycleQuickAccessActions.slice(0, 5) });
  }

  function applyVoiceDraft(draft: VoiceDraft) {
    const nextZones = { ...activeDay.zones, ...draft.zones };
    setStateByDate((current) => ({ ...current, [activeDay.iso]: nextZones }));
    if (userId) saveCloudState(userId, activeDay.iso, nextZones).catch(() => setSyncMode("local"));
    const incoming = [...draft.symptoms, ...draft.actions.map((label) => ({ label, zone: "general" as const, intensity: 0 }))];
    setSymptomsByDate((current) => {
      const existing = current[activeDay.iso] ?? [];
      const next = [...existing];
      incoming.forEach((item) => {
        const found = next.findIndex((symptom) => symptom.label === item.label && symptom.zone === item.zone);
        const symptom: SymptomEntry = { id: found >= 0 ? next[found].id : `voice-${activeDay.iso}-${item.label.toLowerCase().replace(/[^a-zа-яё0-9]+/giu, "-")}`, label: item.label, zone: item.zone, status: "confirmed", intensity: item.intensity, suggestedBy: "user" };
        if (found >= 0) next[found] = symptom; else next.push(symptom);
        if (userId) saveCloudSymptom(userId, activeDay.iso, symptom).catch(() => setSyncMode("local"));
      });
      return { ...current, [activeDay.iso]: next };
    });
  }

  function setLocation(latitude: number, longitude: number, locationName: string) {
    const next = { ...profile, latitude, longitude, locationName };
    setProfile(next);
    if (userId) saveCloudProfile(userId, next).catch(() => setSyncMode("local"));
  }

  return <main className="app-stage">
    <div className="ambient-background" aria-hidden="true" />
    <div className="phone-scene">
      <header className="app-header">
        <div className="brand"><span className="brand-mark">A</span><div><strong>ALMA</strong><small>наблюдение во времени</small></div></div>
        <button className={`sync-status status-${syncMode}`} type="button" onClick={() => syncMode === "local" && void connectCloud({ profile, states: stateByDate, symptoms: symptomsByDate })} aria-label={syncMode === "local" ? "Повторить облачную синхронизацию" : undefined}>
          <i />{syncMode === "connecting" ? "подключение" : syncMode === "cloud" ? "синхронизировано" : "на устройстве"}
        </button>
      </header>

      <CycleHero profile={profile} days={days} activeIndex={activeIndex} quickAccessLabels={profile.cycleQuickAccessActions ?? (profile.cycleActions ?? ["Контрацептив", "Секс", "Тест на овуляцию"]).slice(0, 3)} quickActionLabels={profile.cycleActions ?? ["Контрацептив", "Секс", "Тест на овуляцию"]} selectedQuickActionLabels={activeSymptoms.filter((item) => item.zone === "general" && item.status === "confirmed").map((item) => item.label)} onToggleQuickAccess={(label) => toggleQuickAction({ label })} onUpdateQuickAccess={updateCycleQuickAccess} onSelectDay={selectDay} onOpenPeriod={() => setCycleSettingsOpen(true)} />

      {!activeDay.isForecast && <ActivityPanel actions={(profile.quickActions ?? []).filter((label) => !["Контрацептив", "Секс", "Мастурбация", "Тест на овуляцию"].includes(label))} catalog={profile.actionCatalog} selected={activeSymptoms.filter((item) => item.zone === "general" && item.status === "confirmed").map((item) => item.label)} values={activeDay.zones} onToggle={(label) => toggleQuickAction({ label })} onUpdate={updateActivityActions} onChange={changeZone} onCommit={commitState} />}

      {!activeDay.isForecast ? <BodyCheckin values={activeDay.zones} symptoms={activeSymptoms} symptomHistory={symptomHistory} activeZone={activeZone} onSelect={setActiveZone} onBeginAdjustment={beginZoneAdjustment} onChange={changeZone} onCommit={commitState} onAddQuickSymptom={addSymptom} onUpdateQuickSymptom={updateSymptom} /> : <section className="forecast-card glass-card"><span>∿</span><div><p className="eyebrow">сначала прожить день</p><h2>Это мягкий ориентир</h2><p>День ещё впереди. Посмотри на фон, а когда он наступит — отметь, как тебе было на самом деле.</p></div></section>}

      <section className="wave-section" aria-labelledby="wave-title">
        <header className="wave-section-header">
          <div><p className="eyebrow">{relativeDayLabel(activeDay.iso)} · {formatShortDate(activeDay.iso)}</p><h2 id="wave-title">Субъективная волна</h2></div>
        </header>
        <WaveChart days={days} activeIndex={activeIndex} activeContexts={activeContexts} internalWaves={internalWaves} activeLayers={activeLayers} environment={environment} deviceSignals={null} confirmedCount={confirmedCount} onSelectDay={selectDay} onOpenDay={openDay} />
      </section>

      <ContextStrip environment={environment} activeContexts={activeContexts} internalWaves={internalWaves} activeLayers={activeLayers} onToggleContext={toggleContext} onToggleInternal={toggleInternalWave} onToggleLayer={toggleLayer} />

      <article className={`insight-card insight-${insight.tone}`}>
        <div className="insight-symbol">✦</div><div><p className="eyebrow">{insight.kicker}</p><h2>{insight.title}</h2><p>{insight.body}</p></div>
      </article>

      {!activeDay.isForecast ? <>
        <SymptomCheck symptoms={activeSymptoms} onUpdate={updateSymptom} onAdd={addSymptom} />
      </> : null}

      <EnvironmentPanel environment={environment} loading={environmentLoading} error={environmentError} onReload={() => setReloadEnvironment((value) => value + 1)} onLocation={setLocation} />

      <section className="deep-actions">
        <button type="button" onClick={() => setDaySheetOpen(true)}><i>○</i><span><small>карточка дня</small>{relativeDayLabel(activeDay.iso)} · весь контекст</span><b>›</b></button>
        <button type="button" onClick={() => setConnectionsOpen(true)}><i>⌁</i><span><small>личные наблюдения</small>Посмотреть связи</span><b>›</b></button>
      </section>

      <footer className="app-footer"><p>Наблюдение, а не диагноз</p><span>ALMA помогает замечать повторения и фон дня. Она не заменяет врача.</span><i /></footer>
    </div>

    <button className="floating-voice-trigger" type="button" onClick={() => setVoiceCheckinOpen(true)} aria-label="Рассказать о дне голосом"><svg viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="fixed-voice-rainbow" x1="8" y1="8" x2="40" y2="40"><stop stopColor="#6ce8ff"/><stop offset=".34" stopColor="#a979ff"/><stop offset=".68" stopColor="#ff83c9"/><stop offset="1" stopColor="#ffd176"/></linearGradient></defs><rect x="17" y="7" width="14" height="23" rx="7"/><path d="M12 24a12 12 0 0 0 24 0M24 36v6M17 42h14"/></svg><span>рассказать</span></button>
    {cycleSettingsOpen && <CycleSettingsSheet profile={profile} activeIso={activeDay.iso} selectedActionLabels={activeSymptoms.filter((item) => item.zone === "general" && item.status === "confirmed").map((item) => item.label)} onSave={saveProfile} onToggleQuickAction={toggleQuickAction} onUpdateQuickActions={updateCycleActions} onUpdateQuickAccess={updateCycleQuickAccess} onClose={() => setCycleSettingsOpen(false)} />}
    {daySheetOpen && <DaySheet day={activeDay} environment={environment} symptoms={activeSymptoms} activeContexts={activeContexts} internalWaves={internalWaves} activeLayers={activeLayers} deviceSignals={null} onClose={() => setDaySheetOpen(false)} />}
    {connectionsOpen && <ConnectionsSheet day={activeDay} days={days} environment={environment} onClose={() => setConnectionsOpen(false)} />}
    {voiceCheckinOpen && <VoiceCheckinSheet actionLabels={Array.from(new Set([...(profile.cycleActions ?? ["Контрацептив", "Секс", "Мастурбация", "Тест на овуляцию"]), ...(profile.quickActions ?? ["Йога", "Тренировка", "Прогулка", "Путешествие"])]))} onConfirm={applyVoiceDraft} onClose={() => setVoiceCheckinOpen(false)} />}
  </main>;
}
