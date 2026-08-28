import { canonicalizeJson } from '@runtime-evidence/evidence-schema';

import { parseJsonPath, type JsonPathSegment } from './json-path.ts';
import { compareCodeUnits, recordRedaction, type RedactionState } from './redaction-state.ts';
import {
  assertSafeFieldKey,
  isSensitiveFieldName,
  REDACTED_CAPTURE_VALUE,
  sanitizeKnownSecrets,
} from './text-redaction.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function applyJsonPath(
  value: unknown,
  segments: readonly JsonPathSegment[],
  state: RedactionState,
  rule: string,
): unknown {
  if (segments.length === 0) {
    if (value !== undefined && value !== REDACTED_CAPTURE_VALUE) {
      recordRedaction(state, rule);
      return REDACTED_CAPTURE_VALUE;
    }
    return value;
  }

  let current = value;
  for (const [index, segment] of segments.entries()) {
    const final = index === segments.length - 1;
    if (typeof segment === 'number') {
      if (!Array.isArray(current) || !Object.hasOwn(current, segment)) {
        return value;
      }
      if (final) {
        if (current[segment] !== REDACTED_CAPTURE_VALUE) {
          current[segment] = REDACTED_CAPTURE_VALUE;
          recordRedaction(state, rule);
        }
        return value;
      }
      current = current[segment];
      continue;
    }
    if (!isRecord(current) || !Object.hasOwn(current, segment)) {
      return value;
    }
    if (final) {
      if (current[segment] !== REDACTED_CAPTURE_VALUE) {
        current[segment] = REDACTED_CAPTURE_VALUE;
        recordRedaction(state, rule);
      }
      return value;
    }
    current = current[segment];
  }
  return value;
}

function sanitizeJsonValue(value: unknown, state: RedactionState): unknown {
  if (typeof value === 'string') {
    return value === REDACTED_CAPTURE_VALUE ? value : sanitizeKnownSecrets(value, state);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonValue(item, state));
  }
  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([key, item]) => {
        assertSafeFieldKey(key, '/request/body');
        if (isSensitiveFieldName(key) && item !== REDACTED_CAPTURE_VALUE) {
          recordRedaction(state, `json-key:${key.toLowerCase()}`);
          return [key, REDACTED_CAPTURE_VALUE];
        }
        return [key, sanitizeJsonValue(item, state)];
      }),
  );
}

function cloneBody(body: unknown): unknown {
  return body === undefined ? undefined : (JSON.parse(canonicalizeJson(body)) as unknown);
}

export function sanitizeBody(
  body: unknown,
  jsonPaths: readonly string[],
  state: RedactionState,
): unknown {
  let sanitized = cloneBody(body);
  const paths = [...new Map(jsonPaths.map((expression, index) => [expression, index])).entries()]
    .map(([expression, index]) => ({ expression, index }))
    .sort((left, right) => compareCodeUnits(left.expression, right.expression));
  for (const { expression, index } of paths) {
    sanitized = applyJsonPath(
      sanitized,
      parseJsonPath(expression, index),
      state,
      `jsonpath:${expression}`,
    );
  }
  return sanitizeJsonValue(sanitized, state);
}
