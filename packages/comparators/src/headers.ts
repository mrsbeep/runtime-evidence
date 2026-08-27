import type { HttpObservation } from '@runtime-evidence/replay-http';

import { difference, MissingComparisonValue, result, type ComparatorResult } from './types.ts';

function escapePointerSegment(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizeHeaders(
  headers: Readonly<Record<string, readonly string[]>>,
): ReadonlyMap<string, readonly string[]> {
  return new Map(Object.entries(headers).map(([name, values]) => [name.toLowerCase(), values]));
}

export function compareHeaders(
  baseline: HttpObservation,
  candidate: HttpObservation,
): ComparatorResult {
  const baselineHeaders = normalizeHeaders(baseline.response.headers);
  const candidateHeaders = normalizeHeaders(candidate.response.headers);
  const names = [...new Set([...baselineHeaders.keys(), ...candidateHeaders.keys()])].sort();
  const differences = names.flatMap((name) => {
    const baselineValue = baselineHeaders.get(name);
    const candidateValue = candidateHeaders.get(name);
    if (
      baselineValue !== undefined &&
      candidateValue !== undefined &&
      sameValues(baselineValue, candidateValue)
    ) {
      return [];
    }
    return [
      difference(
        'header',
        `/response/headers/${escapePointerSegment(name)}`,
        'Selected HTTP response header changed.',
        baselineValue ?? MissingComparisonValue,
        candidateValue ?? MissingComparisonValue,
      ),
    ];
  });
  return result(differences);
}
