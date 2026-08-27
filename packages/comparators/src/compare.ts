import { compareHeaders } from './headers.ts';
import { compareBody } from './json.ts';
import { normalizeComparisonPolicy } from './json-path.ts';
import { compareLatency } from './latency.ts';
import { compareStatus } from './status.ts';
import type {
  ComparatorResult,
  ComparisonPolicy,
  ComparisonResult,
  ComparisonSeverity,
  ObservationPair,
} from './types.ts';

const severityRank: Readonly<Record<ComparisonSeverity, number>> = {
  info: 0,
  warning: 1,
  error: 2,
};

export function combineComparatorResults(results: readonly ComparatorResult[]): ComparisonResult {
  const differences = Object.freeze(results.flatMap((result) => result.differences));
  const maximumSeverity = differences.reduce(
    (maximum, item) => Math.max(maximum, severityRank[item.severity]),
    -1,
  );
  return Object.freeze({
    differences,
    status:
      maximumSeverity >= severityRank.error
        ? 'fail'
        : maximumSeverity >= severityRank.warning
          ? 'advisory'
          : 'pass',
  });
}

export function compareHttpObservations(
  observations: ObservationPair,
  policy: ComparisonPolicy,
): ComparisonResult {
  const normalizedPolicy = normalizeComparisonPolicy(policy);
  return combineComparatorResults([
    compareStatus(observations.baseline, observations.candidate),
    compareHeaders(observations.baseline, observations.candidate),
    compareBody(observations.baseline, observations.candidate, normalizedPolicy),
    compareLatency(observations.baseline, observations.candidate, normalizedPolicy),
  ]);
}
