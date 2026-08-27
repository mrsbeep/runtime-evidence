import type { ConfigV1 } from '@runtime-evidence/evidence-schema';
import type { HttpObservation } from '@runtime-evidence/replay-http';

export type ComparatorName =
  | 'body.exact'
  | 'header'
  | 'json.structure'
  | 'json.validity'
  | 'latency.absolute'
  | 'latency.relative'
  | 'status';
export type ComparisonSeverity = 'error' | 'info' | 'warning';

export interface ComparisonDifference {
  readonly baseline: unknown;
  readonly candidate: unknown;
  readonly comparator: ComparatorName;
  readonly message: string;
  readonly path: string;
  readonly severity: ComparisonSeverity;
}

export interface ComparatorResult {
  readonly differences: readonly ComparisonDifference[];
}

export type ComparisonPolicy = ConfigV1['comparison'];

export interface ComparisonResult {
  readonly differences: readonly ComparisonDifference[];
  readonly status: 'advisory' | 'fail' | 'pass';
}

export interface ObservationPair {
  readonly baseline: HttpObservation;
  readonly candidate: HttpObservation;
}

export const MissingComparisonValue = Object.freeze({ state: 'missing' }) as Readonly<{
  state: 'missing';
}>;

export function difference(
  comparator: ComparatorName,
  path: string,
  message: string,
  baseline: unknown,
  candidate: unknown,
  severity: ComparisonSeverity = 'error',
): ComparisonDifference {
  return Object.freeze({ baseline, candidate, comparator, message, path, severity });
}

export function result(differences: readonly ComparisonDifference[]): ComparatorResult {
  return Object.freeze({ differences: Object.freeze([...differences]) });
}
