import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AlmaProfile, EnvironmentPayload, SymptomEntry, ZoneValues } from "./alma";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://cneioixtqjncjzgtyhdk.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_KoG_6vK0nRhsnLntJf-TNA_4yXIAKo8";

let browserClient: SupabaseClient | null = null;

function client() {
  if (typeof window === "undefined") return null;
  if (!browserClient) {
    browserClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return browserClient;
}

function profileToRow(profile: AlmaProfile, userId: string) {
  return {
    user_id: userId,
    cycle_length: profile.cycleLength,
    period_length: profile.periodLength,
    last_period_start: profile.lastPeriodStart,
    location_name: profile.locationName,
    latitude: profile.latitude,
    longitude: profile.longitude,
    automatic_highlights: profile.automaticHighlights,
    updated_at: new Date().toISOString(),
  };
}

function rowToProfile(row: Record<string, unknown>): AlmaProfile {
  return {
    cycleLength: Number(row.cycle_length),
    periodLength: Number(row.period_length),
    lastPeriodStart: String(row.last_period_start),
    locationName: String(row.location_name),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    automaticHighlights: Boolean(row.automatic_highlights),
  };
}

export type CloudBootstrap = {
  userId: string;
  profile: AlmaProfile;
  states: Record<string, ZoneValues>;
  symptoms: Record<string, SymptomEntry[]>;
};

export async function bootstrapCloud(defaults: AlmaProfile, fromIso: string, toIso: string): Promise<CloudBootstrap> {
  const supabase = client();
  if (!supabase) throw new Error("Cloud sync is only available in the browser");

  const sessionResult = await supabase.auth.getSession();
  if (sessionResult.error) throw sessionResult.error;
  let user = sessionResult.data.session?.user ?? null;

  if (!user) {
    const anonymousResult = await supabase.auth.signInAnonymously();
    if (anonymousResult.error) throw anonymousResult.error;
    user = anonymousResult.data.user;
  }
  if (!user) throw new Error("Anonymous session was not created");

  const profileResult = await supabase
    .from("alma_profiles")
    .select("cycle_length, period_length, last_period_start, location_name, latitude, longitude, automatic_highlights")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profileResult.error) throw profileResult.error;

  let profile = defaults;
  if (!profileResult.data) {
    const insertResult = await supabase.from("alma_profiles").insert(profileToRow(defaults, user.id));
    if (insertResult.error) throw insertResult.error;
  } else {
    profile = rowToProfile(profileResult.data as Record<string, unknown>);
  }

  const [statesResult, symptomsResult] = await Promise.all([
    supabase
      .from("alma_daily_states")
      .select("observed_on, cognitive, emotional, physical, libido, social")
      .eq("user_id", user.id)
      .gte("observed_on", fromIso)
      .lte("observed_on", toIso),
    supabase
      .from("alma_symptom_entries")
      .select("observed_on, symptom_key, label, zone, status, intensity, suggested_by")
      .eq("user_id", user.id)
      .gte("observed_on", fromIso)
      .lte("observed_on", toIso),
  ]);
  if (statesResult.error) throw statesResult.error;
  if (symptomsResult.error) throw symptomsResult.error;

  const states: Record<string, ZoneValues> = {};
  for (const row of statesResult.data ?? []) {
    states[row.observed_on] = {
      cognitive: row.cognitive,
      emotional: row.emotional,
      physical: row.physical,
      libido: row.libido,
      social: row.social,
    };
  }

  const symptoms: Record<string, SymptomEntry[]> = {};
  for (const row of symptomsResult.data ?? []) {
    const day = symptoms[row.observed_on] ?? [];
    day.push({
      id: row.symptom_key,
      label: row.label,
      zone: row.zone as SymptomEntry["zone"],
      status: row.status as SymptomEntry["status"],
      intensity: row.intensity,
      suggestedBy: row.suggested_by as SymptomEntry["suggestedBy"],
    });
    symptoms[row.observed_on] = day;
  }

  return { userId: user.id, profile, states, symptoms };
}

export async function saveCloudProfile(userId: string, profile: AlmaProfile) {
  const supabase = client();
  if (!supabase) return false;
  const result = await supabase.from("alma_profiles").upsert(profileToRow(profile, userId), { onConflict: "user_id" });
  if (result.error) throw result.error;
  return true;
}

export async function saveCloudState(userId: string, observedOn: string, values: ZoneValues) {
  const supabase = client();
  if (!supabase) return false;
  const result = await supabase.from("alma_daily_states").upsert({
    user_id: userId,
    observed_on: observedOn,
    ...values,
    source: "check_in",
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,observed_on" });
  if (result.error) throw result.error;
  return true;
}

export async function saveCloudSymptom(userId: string, observedOn: string, symptom: SymptomEntry) {
  const supabase = client();
  if (!supabase) return false;
  const result = await supabase.from("alma_symptom_entries").upsert({
    user_id: userId,
    observed_on: observedOn,
    symptom_key: symptom.id,
    label: symptom.label,
    zone: symptom.zone,
    status: symptom.status,
    intensity: symptom.intensity,
    suggested_by: symptom.suggestedBy,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,observed_on,symptom_key" });
  if (result.error) throw result.error;
  return true;
}

export async function saveCloudEnvironment(userId: string, environment: EnvironmentPayload) {
  const supabase = client();
  if (!supabase) return false;
  const current = environment.current;
  const result = await supabase.from("alma_environment_snapshots").upsert({
    user_id: userId,
    observed_on: current.date,
    observed_at: current.observedAt,
    latitude: environment.location.latitude,
    longitude: environment.location.longitude,
    location_name: environment.location.name,
    temperature_c: current.temperatureC,
    humidity_pct: current.humidityPct,
    pressure_hpa: current.pressureHpa,
    wind_kph: current.windKph,
    weather_code: current.weatherCode,
    daylight_minutes: current.daylightMinutes,
    geomagnetic_kp: environment.geomagnetic?.kp ?? null,
    sources: Object.fromEntries(environment.sources.map((source) => [source.name, source.url])),
  }, { onConflict: "user_id,observed_on,latitude,longitude" });
  if (result.error) throw result.error;
  return true;
}
