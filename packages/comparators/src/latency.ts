import type { HttpObservation } from '@runtime-evidence/replay-http';

import type { NormalizedComparisonPolicy } from './json-path.ts';
import { difference, result, type ComparatorResult } from './types.ts';

export function compareLatency(
  baseline: HttpObservation,
  candidate: HttpObservation,
  policy: NormalizedComparisonPolicy,
): ComparatorResult {
  const regressionMs = candidate.latencyMs - baseline.latencyMs;
  if (regressionMs <= 0) {
    return result([]);
  }

  const differences = [];
  const relativeLimitMs = baseline.latencyMs * (policy.maxLatencyRegressionPercent / 100);
  if (regressionMs > relativeLimitMs) {
    differences.push(
      difference(
        'latency.relative',
        '/latencyMs',
        'Candidate latency regression exceeds the configured relative limit.',
        baseline.latencyMs,
        candidate.latencyMs,
      ),
    );
  }
  if (policy.maxLatencyRegressionMs !== undefined && regressionMs > policy.maxLatencyRegressionMs) {
    differences.push(
      difference(
        'latency.absolute',
        '/latencyMs',
        'Candidate latency regression exceeds the configured absolute limit.',
        baseline.latencyMs,
        candidate.latencyMs,
      ),
    );
  }
  return result(differences);
}
