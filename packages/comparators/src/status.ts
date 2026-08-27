import type { HttpObservation } from '@runtime-evidence/replay-http';

import { difference, result, type ComparatorResult } from './types.ts';

export function compareStatus(
  baseline: HttpObservation,
  candidate: HttpObservation,
): ComparatorResult {
  return baseline.response.statusCode === candidate.response.statusCode
    ? result([])
    : result([
        difference(
          'status',
          '/response/statusCode',
          'HTTP status code changed.',
          baseline.response.statusCode,
          candidate.response.statusCode,
        ),
      ]);
}
