import type { HttpObservation, HttpResponseBody } from '@runtime-evidence/replay-http';

import { difference, result, type ComparatorResult } from './types.ts';

export function bodyBytes(body: HttpResponseBody): Buffer {
  return body.encoding === 'utf8'
    ? Buffer.from(body.content, 'utf8')
    : Buffer.from(body.content, 'base64');
}

export function compareExactBody(
  baseline: HttpObservation,
  candidate: HttpObservation,
): ComparatorResult {
  return bodyBytes(baseline.response.body).equals(bodyBytes(candidate.response.body))
    ? result([])
    : result([
        difference(
          'body.exact',
          '/response/body',
          'HTTP response body changed.',
          baseline.response.body,
          candidate.response.body,
        ),
      ]);
}
