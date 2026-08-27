import type { HttpObservation, HttpResponseBody } from '@runtime-evidence/replay-http';

import { bodyBytes, compareExactBody } from './body.ts';
import { type JsonPathSegment, jsonPathKey, type NormalizedComparisonPolicy } from './json-path.ts';
import {
  difference,
  MissingComparisonValue,
  result,
  type ComparisonDifference,
  type ComparatorResult,
} from './types.ts';

type JsonPrimitive = boolean | null | number | string;
type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };

interface ParsedJson {
  readonly valid: boolean;
  readonly value?: JsonValue;
}

interface ComparisonFrame {
  readonly baseline: JsonValue | undefined;
  readonly baselineExists: boolean;
  readonly candidate: JsonValue | undefined;
  readonly candidateExists: boolean;
  readonly path: readonly JsonPathSegment[];
}

function contentType(observation: HttpObservation): string | undefined {
  const entry = Object.entries(observation.response.headers).find(
    ([name]) => name.toLowerCase() === 'content-type',
  );
  return entry?.[1][0];
}

function declaresJson(observation: HttpObservation): boolean {
  const mediaType = contentType(observation)?.split(';', 1)[0]?.trim().toLowerCase();
  return mediaType === 'application/json' || mediaType?.endsWith('+json') === true;
}

function decodeUtf8(body: HttpResponseBody): string | undefined {
  if (body.encoding === 'utf8') {
    return body.content;
  }
  if (
    body.content.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.content)
  ) {
    return undefined;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bodyBytes(body));
  } catch {
    return undefined;
  }
}

function parseJson(body: HttpResponseBody): ParsedJson {
  const source = decodeUtf8(body);
  if (source === undefined) {
    return { valid: false };
  }
  try {
    return { valid: true, value: JSON.parse(source) as JsonValue };
  } catch {
    return { valid: false };
  }
}

function valueKind(value: JsonValue): string {
  if (value === null) {
    return 'null';
  }
  return Array.isArray(value) ? 'array' : typeof value;
}

function isJsonObject(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pointerPath(segments: readonly JsonPathSegment[]): string {
  const suffix = segments
    .map((segment) => String(segment).replaceAll('~', '~0').replaceAll('/', '~1'))
    .join('/');
  return suffix.length === 0 ? '/response/body' : `/response/body/${suffix}`;
}

function compareJsonValues(
  baseline: JsonValue,
  candidate: JsonValue,
  policy: NormalizedComparisonPolicy,
): readonly ComparisonDifference[] {
  const differences: ComparisonDifference[] = [];
  const pending: ComparisonFrame[] = [
    {
      baseline,
      baselineExists: true,
      candidate,
      candidateExists: true,
      path: [],
    },
  ];

  while (pending.length > 0) {
    const frame = pending.pop();
    if (frame === undefined) {
      break;
    }
    const pathKey = jsonPathKey(frame.path);
    if (policy.ignoredJsonPaths.has(pathKey)) {
      continue;
    }
    if (!frame.baselineExists || !frame.candidateExists) {
      differences.push(
        difference(
          'json.structure',
          pointerPath(frame.path),
          'JSON value is missing from one response.',
          frame.baselineExists ? frame.baseline : MissingComparisonValue,
          frame.candidateExists ? frame.candidate : MissingComparisonValue,
        ),
      );
      continue;
    }
    if (policy.normalizedJsonPaths.has(pathKey)) {
      continue;
    }

    const baselineValue = frame.baseline as JsonValue;
    const candidateValue = frame.candidate as JsonValue;
    const baselineKind = valueKind(baselineValue);
    const candidateKind = valueKind(candidateValue);
    if (baselineKind !== candidateKind) {
      differences.push(
        difference(
          'json.structure',
          pointerPath(frame.path),
          'JSON value type changed.',
          baselineValue,
          candidateValue,
        ),
      );
      continue;
    }

    if (Array.isArray(baselineValue) && Array.isArray(candidateValue)) {
      const length = Math.max(baselineValue.length, candidateValue.length);
      for (let index = length - 1; index >= 0; index -= 1) {
        pending.push({
          baseline: baselineValue[index],
          baselineExists: index < baselineValue.length,
          candidate: candidateValue[index],
          candidateExists: index < candidateValue.length,
          path: [...frame.path, index],
        });
      }
      continue;
    }

    if (isJsonObject(baselineValue) && isJsonObject(candidateValue)) {
      const keys = [
        ...new Set([...Object.keys(baselineValue), ...Object.keys(candidateValue)]),
      ].sort();
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        const key = keys[index];
        if (key === undefined) {
          continue;
        }
        pending.push({
          baseline: baselineValue[key],
          baselineExists: Object.hasOwn(baselineValue, key),
          candidate: candidateValue[key],
          candidateExists: Object.hasOwn(candidateValue, key),
          path: [...frame.path, key],
        });
      }
      continue;
    }

    if (baselineValue !== candidateValue) {
      differences.push(
        difference(
          'json.structure',
          pointerPath(frame.path),
          'JSON value changed.',
          baselineValue,
          candidateValue,
        ),
      );
    }
  }

  return Object.freeze(differences);
}

export function compareBody(
  baseline: HttpObservation,
  candidate: HttpObservation,
  policy: NormalizedComparisonPolicy,
): ComparatorResult {
  if (!declaresJson(baseline) && !declaresJson(candidate)) {
    return compareExactBody(baseline, candidate);
  }

  const baselineJson = parseJson(baseline.response.body);
  const candidateJson = parseJson(candidate.response.body);
  if (!baselineJson.valid || !candidateJson.valid) {
    const validityDifference = difference(
      'json.validity',
      '/response/body',
      'JSON comparison is required, but at least one response body is not valid JSON.',
      { valid: baselineJson.valid },
      { valid: candidateJson.valid },
    );
    return result([validityDifference, ...compareExactBody(baseline, candidate).differences]);
  }

  return result(
    compareJsonValues(baselineJson.value as JsonValue, candidateJson.value as JsonValue, policy),
  );
}
