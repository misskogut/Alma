import type { SourceDefinition } from "./types";

export const SOURCE_REGISTRY = {
  manual: {
    id: "manual",
    label: "Отмечено вручную",
    sourceType: "manual",
    availability: "available",
    measuredByDefault: false,
    priority: 100,
    privacyClass: "sensitive",
  },
  voice: {
    id: "voice",
    label: "Предложено по голосовой записи",
    sourceType: "voice",
    availability: "available",
    measuredByDefault: false,
    priority: 80,
    privacyClass: "sensitive",
    adapterId: "voice-proposal-adapter",
  },
  open_meteo: {
    id: "open_meteo",
    label: "Open-Meteo",
    sourceType: "api",
    availability: "available",
    measuredByDefault: true,
    priority: 70,
    privacyClass: "precise_location",
    adapterId: "open-meteo-adapter",
  },
  noaa_swpc: {
    id: "noaa_swpc",
    label: "NOAA SWPC",
    sourceType: "api",
    availability: "available",
    measuredByDefault: true,
    priority: 70,
    privacyClass: "ordinary",
    adapterId: "noaa-swpc-adapter",
  },
  legacy_local: {
    id: "legacy_local",
    label: "Перенесено из прежней версии",
    sourceType: "migration",
    availability: "available",
    measuredByDefault: false,
    priority: 10,
    privacyClass: "sensitive",
    adapterId: "legacy-v1-adapter",
  },
  legacy_cloud: {
    id: "legacy_cloud",
    label: "Перенесено из прежней облачной схемы",
    sourceType: "migration",
    availability: "available",
    measuredByDefault: false,
    priority: 10,
    privacyClass: "sensitive",
    adapterId: "legacy-supabase-adapter",
  },
  model_inference: {
    id: "model_inference",
    label: "Расчёт ALMA",
    sourceType: "inference",
    availability: "available",
    measuredByDefault: false,
    priority: 1,
    privacyClass: "sensitive",
  },
  apple_health: {
    id: "apple_health",
    label: "Apple Health",
    sourceType: "sensor",
    availability: "interface_only",
    measuredByDefault: true,
    priority: 75,
    privacyClass: "sensitive",
    adapterId: "apple-health-adapter",
  },
  oura: {
    id: "oura",
    label: "Oura",
    sourceType: "sensor",
    availability: "interface_only",
    measuredByDefault: true,
    priority: 75,
    privacyClass: "sensitive",
    adapterId: "oura-adapter",
  },
  android_usage: {
    id: "android_usage",
    label: "Android Usage Access",
    sourceType: "sensor",
    availability: "interface_only",
    measuredByDefault: true,
    priority: 70,
    privacyClass: "sensitive",
    adapterId: "android-usage-adapter",
  },
} as const satisfies Record<string, SourceDefinition>;

export type SourceId = keyof typeof SOURCE_REGISTRY;

export function sourceDefinition(sourceId: string): SourceDefinition | undefined {
  return SOURCE_REGISTRY[sourceId as SourceId];
}

