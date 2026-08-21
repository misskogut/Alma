import type { DataForm, DomainKey, EntityKind, JsonValue } from "../data-model/types";

export type ValueType = "number" | "boolean" | "string" | "category" | "object";

export type NormalizationStrategy =
  | "none"
  | "signed_unit"
  | "unit_interval"
  | "personal_baseline_zscore"
  | "personal_baseline_ratio"
  | "category_encoding";

export type BaselineStrategy =
  | "none"
  | "rolling_personal"
  | "user_declared"
  | "comfortable_personal"
  | "population_then_personal";

export interface MetricDisplayMetadata {
  color: string;
  shortLabel?: string;
  icon?: string;
  increaseLabel?: string;
  decreaseLabel?: string;
  genitive?: string;
  instrumental?: string;
}

export interface MetricDefinition {
  id: string;
  label: string;
  kind: EntityKind;
  domain: DomainKey;
  dataForm: DataForm;
  unit?: string;
  valueType: ValueType;
  normalizationStrategy: NormalizationStrategy;
  baselineStrategy: BaselineStrategy;
  allowedAttributes: Record<string, JsonValue>;
  patternEligible: boolean;
  forecastEligible: boolean;
  display: MetricDisplayMetadata;
  sourcePriority: string[];
  registryVersion: string;
  available: boolean;
  unavailableReason?: string;
}

export interface SourceDefinition {
  id: string;
  label: string;
  sourceType: "manual" | "voice" | "sensor" | "api" | "import" | "inference" | "migration";
  availability: "available" | "interface_only" | "unavailable";
  measuredByDefault: boolean;
  priority: number;
  privacyClass: "ordinary" | "sensitive" | "precise_location";
  adapterId?: string;
}

