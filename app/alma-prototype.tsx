"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BodyCheckin from "../components/body-checkin";
import ActivityPanel from "../components/activity-panel";
import CycleHero from "../components/cycle-hero";
import EnvironmentPanel, { ContextStrip } from "../components/environment-panel";
import OverallWellbeing from "../components/overall-wellbeing";
import NutritionPanel from "../components/nutrition-panel";
import QuickDock from "../components/quick-dock";
import ResearchPanel from "../components/research-panel";
import { ConnectionsSheet, CycleSettingsSheet, DaySheet } from "../components/sheets";
import SymptomCheck from "../components/symptom-check";
import WaveChart from "../components/wave-chart";
import VoiceCheckinSheet, { type VoiceDraft } from "../components/voice-checkin";
import type { AlmaProfile, ContextKey, DayEvidence, EnvironmentPayload, MainWaveDatum, PatternSummary, SymptomEntry, SyncMode, WaveLayerKey, ZoneKey, ZoneValues } from "../lib/alma";
import { DEFAULT_SYMPTOMS, TIMELINE_RADIUS, buildDayModels, defaultProfile, formatShortDate, relativeDayLabel, todayIso } from "../lib/alma";
import { immediateInputFeedback, metricDefinition } from "../lib/alma-core";
import { CanonicalPrototypeStore, createBrowserCanonicalStore, parseLegacyPrototypeSnapshot, type PrototypeProjection } from "../lib/canonical-prototype-store";
import { ensureCloudUser } from "../lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

const STORAGE_KEY = "alma-observation-v2";
const TODAY_INDEX = TIMELINE_RADIUS;

function cloneSuggestions() {
  return DEFAULT_SYMPTOMS.map((symptom) => ({ ...symptom }));
}

function mergeSymptoms(base: SymptomEntry[], incoming: SymptomEntry[]) {
  const map = new Map(base.map((symptom) => [symptom.id, symptom]));
  incoming.forEach((symptom) => map.set(symptom.id, symptom));
  return Array.from(map.values());
}

function withCurrentSuggestions(entries: Record<string, SymptomEntry[]>, currentIso: string) {
  return {
    ...entries,
    [currentIso]: mergeSymptoms(cloneSuggestions(), entries[currentIso] ?? []),
  };
}

function insightFor(
  day: ReturnType<typeof buildDayModels>[number],
  symptomsByDate: Record<string, SymptomEntry[]>,
  hasPersonalState: boolean,
) {
  if (day.isForecast && day.integralStatus === "predicted" && day.integral != null) {
    return { kicker: "персональный прогноз", title: `${relativeDayLabel(day.iso)} · ${day.integral > 0 ? "+" : ""}${day.integral}`, body: "Это вероятный ориентир из сохранённого прогноза ALMA, а не факт. Когда день наступит, система предложит подтвердить, что произошло на самом деле.", tone: "forecast" };
  }

  if (day.isForecast) {
    return { kicker: "день ещё впереди", title: "Персонального прогноза пока нет", body: "ALMA не дорисовывает будущее без достаточных персональных оснований. Автоматический фон можно посмотреть отдельно, но он не считается твоим будущим состоянием.", tone: "forecast" };
  }

  const confirmed = symptomsByDate[day.iso]?.filter((symptom) => symptom.status === "confirmed") ?? [];
  if (confirmed.length) {
    const feedback = immediateInputFeedback("useful_control_day");
    return { kicker: "наблюдение сохранено", title: feedback.title, body: feedback.body, tone: "new" };
  }

  if (hasPersonalState) {
    const feedback = immediateInputFeedback("unchanged");
    return { kicker: "сегодняшняя отметка", title: feedback.title, body: feedback.body, tone: "daily" };
  }
  return { kicker: "ALMA наблюдает фон", title: "Можно ничего не заполнять", body: "Если захочется уточнить день, достаточно одной короткой отметки. ALMA попросит дополнительные данные только тогда, когда они действительно помогут проверить персональную версию.", tone: "daily" };
}

export default function AlmaPrototype() {
  const currentIso = useMemo(() => todayIso(), []);
  const [profile, setProfile] = useState<AlmaProfile>(() => defaultProfile(currentIso));
  const [stateByDate, setStateByDate] = useState<Record<string, ZoneValues>>({});
  const [loadIntensityByDate, setLoadIntensityByDate] = useState<PrototypeProjection["loadIntensityByDate"]>({});
  const [mainWaveByDate, setMainWaveByDate] = useState<Record<string, MainWaveDatum>>({});
  const [evidenceByDate, setEvidenceByDate] = useState<Record<string, DayEvidence>>({});
  const [patterns, setPatterns] = useState<PatternSummary[]>([]);
  const [nutritionByDate, setNutritionByDate] = useState<PrototypeProjection["nutritionByDate"]>({});
  const [researchQuests, setResearchQuests] = useState<PrototypeProjection["researchQuests"]>([]);
  const [inputRequests, setInputRequests] = useState<PrototypeProjection["inputRequests"]>([]);
  const [outputFeed, setOutputFeed] = useState<PrototypeProjection["outputFeed"]>([]);
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
  const [hasStoredProfile, setHasStoredProfile] = useState(false);
  const [cycleSettingsOpen, setCycleSettingsOpen] = useState(false);
  const [daySheetOpen, setDaySheetOpen] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [voiceCheckinOpen, setVoiceCheckinOpen] = useState(false);
  const [selectedTimelineDefinitionId, setSelectedTimelineDefinitionId] = useState<string | null>(null);
  const pendingValues = useRef<ZoneValues | null>(null);
  const pendingZone = useRef<ZoneKey | null>(null);
  const canonicalStore = useRef<CanonicalPrototypeStore | null>(null);
  const cloudConnection = useRef<{ client: SupabaseClient; userId: string } | null>(null);
  const syncRunning = useRef(false);
  const syncRequested = useRef(false);
  const bootStarted = useRef(false);
  const profileRef = useRef(profile);

  const days = useMemo(() => buildDayModels(profile, stateByDate, currentIso, TIMELINE_RADIUS, {
    mainWaveByDate,
    evidenceByDate,
    cycleProfileConfirmed: hasStoredProfile,
  }), [profile, stateByDate, currentIso, mainWaveByDate, evidenceByDate, hasStoredProfile]);
  const activeDay = days[activeIndex];
  const activeSymptoms = symptomsByDate[activeDay.iso] ?? [];
  const symptomHistory = useMemo(() => Object.values(symptomsByDate).flat(), [symptomsByDate]);
  const confirmedCount = activeSymptoms.filter((symptom) => symptom.status === "confirmed").length;
  const insight = insightFor(activeDay, symptomsByDate, Boolean(stateByDate[activeDay.iso]));
  const selectedMarker = useMemo(() => selectedTimelineDefinitionId
    ? days.flatMap((day) => day.evidence.markers).find((marker) => marker.definitionId === selectedTimelineDefinitionId)
    : undefined, [days, selectedTimelineDefinitionId]);
  const relationshipFilter = useMemo(() => {
    const established = new Set<string>();
    const hypothesized = new Set<string>();
    if (!selectedTimelineDefinitionId) return { established, hypothesized };
    for (const pattern of patterns) {
      const definitions = new Set([pattern.targetDefinitionId, ...pattern.factorDefinitionIds, ...pattern.modifierDefinitionIds]);
      if (!definitions.has(selectedTimelineDefinitionId)) continue;
      const target = pattern.stage === "established_personal_pattern" ? established : hypothesized;
      definitions.forEach((definitionId) => {
        if (definitionId !== selectedTimelineDefinitionId) target.add(definitionId);
      });
    }
    return { established, hypothesized };
  }, [patterns, selectedTimelineDefinitionId]);

  const applyProjection = useCallback((projection: PrototypeProjection) => {
    profileRef.current = projection.profile;
    setProfile(projection.profile);
    setHasStoredProfile(projection.hasStoredProfile);
    setStateByDate(projection.states);
    setLoadIntensityByDate(projection.loadIntensityByDate);
    setMainWaveByDate(projection.mainWaveByDate);
    setEvidenceByDate(projection.evidenceByDate);
    setPatterns(projection.patterns);
    setNutritionByDate(projection.nutritionByDate);
    setResearchQuests(projection.researchQuests);
    setInputRequests(projection.inputRequests);
    setOutputFeed(projection.outputFeed);
    setSymptomsByDate(withCurrentSuggestions(projection.entries, currentIso));
  }, [currentIso]);

  const runCanonicalSync = useCallback(async () => {
    const store = canonicalStore.current;
    const cloud = cloudConnection.current;
    if (!store || !cloud) return;
    syncRequested.current = true;
    if (syncRunning.current) return;
    syncRunning.current = true;
    try {
      while (syncRequested.current) {
        syncRequested.current = false;
        await store.sync(cloud.client, cloud.userId);
      }
      setSyncMode("cloud");
    } catch {
      setSyncMode("local");
    } finally {
      syncRunning.current = false;
      // A local mutation can arrive after the loop has observed `false` but
      // before this runner releases the lock. Restart in that narrow window so
      // an acknowledged UI action is never left waiting for another gesture.
      if (syncRequested.current) void runCanonicalSync();
    }
  }, []);

  const persistCanonical = useCallback((operation: (store: CanonicalPrototypeStore) => Promise<unknown>) => {
    const store = canonicalStore.current;
    if (!store) return;
    void operation(store)
      .then(() => runCanonicalSync())
      .catch(() => setSyncMode("local"));
  }, [runCanonicalSync]);

  const persistAndRefresh = useCallback((operation: (store: CanonicalPrototypeStore) => Promise<unknown>) => {
    const store = canonicalStore.current;
    if (!store) return;
    void operation(store)
      .then(async () => {
        applyProjection(await store.loadProjection(profileRef.current));
        await runCanonicalSync();
        applyProjection(await store.loadProjection(profileRef.current));
      })
      .catch(() => setSyncMode("local"));
  }, [applyProjection, runCanonicalSync]);

  const connectCloud = useCallback(async (fallbackProfile = profileRef.current) => {
    const store = canonicalStore.current;
    if (!store) return;
    setSyncMode("connecting");
    try {
      const cloud = await ensureCloudUser();
      cloudConnection.current = { client: cloud.supabase, userId: cloud.user.id };
      setUserId(cloud.user.id);
      await store.sync(cloud.supabase, cloud.user.id);
      const projection = await store.loadProjection(fallbackProfile);
      applyProjection(projection);
      setSyncMode("cloud");
    } catch {
      cloudConnection.current = null;
      setUserId(null);
      setSyncMode("local");
    }
  }, [applyProjection]);

  useEffect(() => {
    if (bootStarted.current) return;
    bootStarted.current = true;
    let cancelled = false;
    async function bootstrapCanonical() {
      const store = createBrowserCanonicalStore();
      canonicalStore.current = store;
      const legacy = parseLegacyPrototypeSnapshot(window.localStorage.getItem(STORAGE_KEY));
      await store.migrateLegacyIfNeeded(legacy);
      const projection = await store.loadProjection(profileRef.current);
      if (cancelled) return;
      applyProjection(projection);
      await connectCloud(projection.profile);
    }
    void bootstrapCanonical().catch(() => setSyncMode("local"));
    return () => { cancelled = true; };
  }, [applyProjection, connectCloud]);

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
    if (!hasStoredProfile || !environment) return;
    persistCanonical((store) => store.recordEnvironment(environment, userId ?? undefined));
  }, [environment, hasStoredProfile, persistCanonical, userId]);

  useEffect(() => {
    setActiveZone(null);
    pendingValues.current = null;
    pendingZone.current = null;
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
    pendingZone.current = zone;
    setStateByDate((current) => ({ ...current, [activeDay.iso]: next }));
  }

  function commitState() {
    const zone = pendingZone.current;
    if (!zone) return;
    const values = pendingValues.current ?? activeDay.zones;
    pendingZone.current = null;
    persistCanonical((store) => store.saveZoneResponse({
      localDate: activeDay.iso,
      zone,
      value: values[zone],
      userId: userId ?? undefined,
    }));
  }

  function changeLoadIntensity(zone: Exclude<ZoneKey, "libido">, value: number) {
    setLoadIntensityByDate((current) => ({
      ...current,
      [activeDay.iso]: { ...(current[activeDay.iso] ?? {}), [zone]: value },
    }));
  }

  function commitLoadIntensity(zone: Exclude<ZoneKey, "libido">) {
    const value = loadIntensityByDate[activeDay.iso]?.[zone];
    if (value == null) return;
    persistCanonical((store) => store.saveLoadIntensity({ localDate: activeDay.iso, zone, value, userId: userId ?? undefined }));
  }

  function saveOverallWellbeing(value: number) {
    const hadFactualAnchor = mainWaveByDate[activeDay.iso]?.status === "user_confirmed";
    setMainWaveByDate((current) => ({
      ...current,
      [activeDay.iso]: { value: value / 100, status: "user_confirmed", dailyMin: value / 100, dailyMax: value / 100 },
    }));
    if (!hadFactualAnchor) {
      setEvidenceByDate((current) => {
        const existing = current[activeDay.iso] ?? { factualCount: 0, inferredCount: 0, plannedCount: 0, predictedCount: 0, markers: [] };
        return { ...current, [activeDay.iso]: { ...existing, factualCount: existing.factualCount + 1 } };
      });
    }
    persistCanonical((store) => store.saveOverallWellbeing({ localDate: activeDay.iso, value, userId: userId ?? undefined }));
  }

  function updateSymptom(symptom: SymptomEntry) {
    setSymptomsByDate((current) => {
      const list = current[activeDay.iso] ?? [];
      return { ...current, [activeDay.iso]: list.map((item) => item.id === symptom.id ? symptom : item) };
    });
    persistCanonical((store) => store.saveEntry({ localDate: activeDay.iso, entry: symptom, userId: userId ?? undefined }));
  }

  function addSymptom(symptom: SymptomEntry) {
    setSymptomsByDate((current) => ({ ...current, [activeDay.iso]: [...(current[activeDay.iso] ?? []), symptom] }));
    persistCanonical((store) => store.saveEntry({ localDate: activeDay.iso, entry: symptom, userId: userId ?? undefined }));
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
      dismissed
        .filter((symptom, index) => symptom.zone === zone && symptom.status === "dismissed" && list[index]?.status === "confirmed")
        .forEach((symptom) => persistCanonical((store) => store.saveEntry({ localDate: activeDay.iso, entry: symptom, userId: userId ?? undefined })));
      return { ...current, [activeDay.iso]: dismissed };
    });
  }

  function persistProfile(next: AlmaProfile) {
    profileRef.current = next;
    setProfile(next);
    setHasStoredProfile(true);
    persistCanonical((store) => store.saveProfile(next, userId ?? undefined));
  }

  function saveProfile(next: AlmaProfile, focusIso?: string) {
    profileRef.current = next;
    setProfile(next);
    setHasStoredProfile(true);
    persistCanonical(async (store) => {
      await store.saveProfile(next, userId ?? undefined);
      if (focusIso) await store.recordMenstruationInterval({ startDate: focusIso, durationDays: next.periodLength, userId: userId ?? undefined });
    });
    if (focusIso) {
      const focusIndex = days.findIndex((item) => item.iso === focusIso);
      if (focusIndex >= 0) setActiveIndex(focusIndex);
    }
    setCycleSettingsOpen(false);
  }

  function updateCycleActions(cycleActions: string[], cycleActionCatalog = profile.cycleActionCatalog) {
    const cycleQuickAccessActions = (profile.cycleQuickAccessActions ?? []).filter((label) => cycleActions.includes(label));
    const next = { ...profile, cycleActions, cycleActionCatalog, cycleQuickAccessActions };
    persistProfile(next);
  }

  function updateActivityActions(quickActions: string[], actionCatalog: string[]) {
    persistProfile({ ...profile, quickActions, actionCatalog });
  }

  function updateCycleQuickAccess(cycleQuickAccessActions: string[]) {
    persistProfile({ ...profile, cycleQuickAccessActions: cycleQuickAccessActions.slice(0, 5) });
  }

  function addNutrition(input: { definitionId: string; label: string; quantity?: number; unit?: string; dayPart?: "morning" | "day" | "evening" | "night" }) {
    persistAndRefresh((store) => store.saveIntake({ localDate: activeDay.iso, ...input, userId: userId ?? undefined }));
  }

  function removeNutrition(id: string) {
    persistAndRefresh((store) => store.removeIntake(id));
  }

  function startResearch(input: { title: string; targetDefinitionId: string; factorDefinitionIds: string[] }) {
    persistAndRefresh((store) => store.startResearch({ ...input, userId: userId ?? undefined }));
  }

  function researchNutrition(entry: PrototypeProjection["nutritionByDate"][string][number]) {
    startResearch({
      title: `Меняется ли самочувствие в дни, когда отмечен ${entry.label.toLocaleLowerCase("ru-RU")}?`,
      targetDefinitionId: "overall_wellbeing",
      factorDefinitionIds: [entry.definitionId],
    });
  }

  function answerInput(input: { requestId: string; present?: boolean; value?: number; quantity?: number }) {
    persistAndRefresh((store) => store.answerInputRequest({ ...input, localDate: activeDay.iso, userId: userId ?? undefined }));
  }

  function markOutputRead(id: string) {
    persistAndRefresh((store) => store.markOutputRead(id));
  }

  function applyVoiceDraft(draft: VoiceDraft) {
    const nextZones = { ...activeDay.zones, ...draft.zones };
    setStateByDate((current) => ({ ...current, [activeDay.iso]: nextZones }));
    for (const [zone, value] of Object.entries(draft.zones) as Array<[ZoneKey, number]>) {
      persistCanonical((store) => store.saveZoneResponse({ localDate: activeDay.iso, zone, value, userId: userId ?? undefined }));
    }
    const incoming = [
      ...draft.symptoms.map((item) => ({ ...item, zone: item.zone === "general" ? "physical" as const : item.zone })),
      ...draft.actions.map((label) => ({ label, zone: "general" as const, intensity: 0 })),
    ];
    const savedEntries: SymptomEntry[] = incoming.map((item) => {
      const found = activeSymptoms.find((symptom) => symptom.label === item.label && symptom.zone === item.zone);
      return {
        id: found?.id ?? `voice-${activeDay.iso}-${item.label.toLowerCase().replace(/[^a-zа-яё0-9]+/giu, "-")}`,
        label: item.label,
        zone: item.zone,
        status: "confirmed",
        intensity: item.intensity,
        suggestedBy: "user",
      };
    });
    setSymptomsByDate((current) => {
      const existing = current[activeDay.iso] ?? [];
      const next = [...existing];
      savedEntries.forEach((entry) => {
        const found = next.findIndex((symptom) => symptom.label === entry.label && symptom.zone === entry.zone);
        if (found >= 0) next[found] = entry; else next.push(entry);
      });
      return { ...current, [activeDay.iso]: next };
    });
    savedEntries.forEach((entry) => persistCanonical((store) => store.saveEntry({ localDate: activeDay.iso, entry, userId: userId ?? undefined })));
  }

  function setLocation(latitude: number, longitude: number, locationName: string) {
    const next = { ...profile, latitude, longitude, locationName };
    persistProfile(next);
  }

  return <main className="app-stage">
    <div className="ambient-background" aria-hidden="true" />
    <div className="phone-scene">
      <header className="app-header">
        <div className="brand"><span className="brand-mark">A</span><div><strong>ALMA</strong><small>наблюдение во времени</small></div></div>
        <button className={`sync-status status-${syncMode}`} type="button" onClick={() => syncMode === "local" && void connectCloud()} aria-label={syncMode === "local" ? "Повторить облачную синхронизацию" : undefined}>
          <i />{syncMode === "connecting" ? "подключение" : syncMode === "cloud" ? "синхронизировано" : "на устройстве"}
        </button>
      </header>

      <CycleHero profile={profile} days={days} activeIndex={activeIndex} quickAccessLabels={profile.cycleQuickAccessActions ?? (profile.cycleActions ?? ["Контрацептив", "Секс", "Тест на овуляцию"]).slice(0, 3)} quickActionLabels={profile.cycleActions ?? ["Контрацептив", "Секс", "Тест на овуляцию"]} selectedQuickActionLabels={activeSymptoms.filter((item) => item.zone === "general" && item.status === "confirmed").map((item) => item.label)} onToggleQuickAccess={(label) => toggleQuickAction({ label })} onUpdateQuickAccess={updateCycleQuickAccess} onSelectDay={selectDay} onOpenPeriod={() => setCycleSettingsOpen(true)} />

      {!activeDay.isForecast && <ActivityPanel actions={(profile.quickActions ?? []).filter((label) => !["Контрацептив", "Секс", "Мастурбация", "Тест на овуляцию"].includes(label))} catalog={profile.actionCatalog} selected={activeSymptoms.filter((item) => item.zone === "general" && item.status === "confirmed").map((item) => item.label)} values={activeDay.zones} loadIntensities={loadIntensityByDate[activeDay.iso] ?? {}} symptoms={activeSymptoms} onToggle={(label) => toggleQuickAction({ label })} onUpdate={updateActivityActions} onChange={changeZone} onCommit={commitState} onChangeLoadIntensity={changeLoadIntensity} onCommitLoadIntensity={commitLoadIntensity} onAddSymptom={addSymptom} onUpdateSymptom={updateSymptom} />}

      {!activeDay.isForecast ? <BodyCheckin values={activeDay.zones} loadIntensities={loadIntensityByDate[activeDay.iso] ?? {}} symptoms={activeSymptoms} symptomHistory={symptomHistory} activeZone={activeZone} onSelect={setActiveZone} onBeginAdjustment={beginZoneAdjustment} onChange={changeZone} onCommit={commitState} onChangeLoadIntensity={changeLoadIntensity} onCommitLoadIntensity={commitLoadIntensity} onAddQuickSymptom={addSymptom} onUpdateQuickSymptom={updateSymptom} /> : <section className="forecast-card glass-card"><span>∿</span><div><p className="eyebrow">{activeDay.integralStatus === "predicted" ? "персональный прогноз" : "день ещё впереди"}</p><h2>{activeDay.integralStatus === "predicted" ? "Вероятный ориентир" : "Прогноз пока не сформирован"}</h2><p>{activeDay.integralStatus === "predicted" ? "Это сохранённый прогноз, а не факт. После этого дня ALMA проверит, совпал ли он с реальностью." : "ALMA не дорисовывает состояние без достаточных персональных оснований."}</p></div></section>}

      {!activeDay.isForecast && <NutritionPanel entries={nutritionByDate[activeDay.iso] ?? []} onAdd={addNutrition} onRemove={removeNutrition} onResearch={researchNutrition} />}

      <section className="wave-section" aria-labelledby="wave-title">
        <header className="wave-section-header">
          <div><p className="eyebrow">{relativeDayLabel(activeDay.iso)} · {formatShortDate(activeDay.iso)}</p><h2 id="wave-title">Субъективная волна</h2></div>
        </header>
        {!activeDay.isForecast && <OverallWellbeing value={activeDay.integral} status={activeDay.integralStatus} onSave={saveOverallWellbeing} />}
        {selectedTimelineDefinitionId && <div className="wave-focus-banner"><span><small>смотрим историю</small><b>{selectedMarker?.label ?? metricDefinition(selectedTimelineDefinitionId)?.label ?? "Выбранное событие"}</b></span><button type="button" onClick={() => setSelectedTimelineDefinitionId(null)}>показать всё ×</button></div>}
        <WaveChart days={days} activeIndex={activeIndex} activeContexts={activeContexts} internalWaves={internalWaves} activeLayers={activeLayers} environment={environment} deviceSignals={null} confirmedCount={confirmedCount} selectedDefinitionId={selectedTimelineDefinitionId} establishedDefinitionIds={relationshipFilter.established} hypothesizedDefinitionIds={relationshipFilter.hypothesized} onSelectMarker={setSelectedTimelineDefinitionId} onSelectDay={selectDay} onOpenDay={openDay} />
      </section>

      <ContextStrip environment={environment} activeContexts={activeContexts} internalWaves={internalWaves} activeLayers={activeLayers} onToggleContext={toggleContext} onToggleInternal={toggleInternalWave} onToggleLayer={toggleLayer} />

      <article className={`insight-card insight-${insight.tone}`}>
        <div className="insight-symbol">✦</div><div><p className="eyebrow">{insight.kicker}</p><h2>{insight.title}</h2><p>{insight.body}</p></div>
      </article>

      <ResearchPanel quests={researchQuests} onStart={startResearch} />

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

    <QuickDock requests={inputRequests} outputFeed={outputFeed} onAnswer={answerInput} onMarkRead={markOutputRead} onVoice={() => setVoiceCheckinOpen(true)} />
    {cycleSettingsOpen && <CycleSettingsSheet profile={profile} activeIso={activeDay.iso} selectedActionLabels={activeSymptoms.filter((item) => item.zone === "general" && item.status === "confirmed").map((item) => item.label)} onSave={saveProfile} onToggleQuickAction={toggleQuickAction} onUpdateQuickActions={updateCycleActions} onUpdateQuickAccess={updateCycleQuickAccess} onClose={() => setCycleSettingsOpen(false)} />}
    {daySheetOpen && <DaySheet day={activeDay} environment={environment} symptoms={activeSymptoms} activeContexts={activeContexts} internalWaves={internalWaves} activeLayers={activeLayers} deviceSignals={null} onClose={() => setDaySheetOpen(false)} />}
    {connectionsOpen && <ConnectionsSheet day={activeDay} patterns={patterns} selectedDefinitionId={selectedTimelineDefinitionId} onSelectDefinition={(definitionId) => { setSelectedTimelineDefinitionId(definitionId); setConnectionsOpen(false); }} onClose={() => setConnectionsOpen(false)} />}
    {voiceCheckinOpen && <VoiceCheckinSheet actionLabels={Array.from(new Set([...(profile.cycleActions ?? ["Контрацептив", "Секс", "Мастурбация", "Тест на овуляцию"]), ...(profile.quickActions ?? ["Йога", "Тренировка", "Прогулка", "Путешествие"])]))} onConfirm={applyVoiceDraft} onClose={() => setVoiceCheckinOpen(false)} />}
  </main>;
}
