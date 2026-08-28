import { validateHeaderName, validateHeaderValue } from 'node:http';

import { canonicalizeJson } from '@runtime-evidence/evidence-schema';
import Type, { type Static } from 'typebox';
import type { TLocalizedValidationError } from 'typebox/error';
import Compile from 'typebox/compile';

import { captureError } from './diagnostics.ts';

export const CapturedHttpScenarioInputSchema = Type.Object(
  {
    id: Type.String({ maxLength: 128, pattern: '^[a-z0-9][a-z0-9._-]*$' }),
    name: Type.String({ minLength: 1, maxLength: 200 }),
    description: Type.Optional(Type.String({ minLength: 1, maxLength: 2_000 })),
    tags: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 100 }), {
        maxItems: 100,
        uniqueItems: true,
      }),
    ),
    safety: Type.Object(
      {
        classification: Type.Enum(['safe', 'mocked', 'read-only', 'state-changing']),
        rationale: Type.String({ minLength: 1, maxLength: 1_000 }),
      },
      { additionalProperties: false },
    ),
    request: Type.Object(
      {
        method: Type.Enum(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE']),
        path: Type.String({ maxLength: 8_192, pattern: '^/' }),
        headers: Type.Optional(Type.Record(Type.String(), Type.String())),
        query: Type.Optional(Type.Record(Type.String(), Type.String())),
        body: Type.Optional(Type.Unknown()),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export type CapturedHttpScenarioInput = Static<typeof CapturedHttpScenarioInputSchema>;

const inputValidator = Compile(CapturedHttpScenarioInputSchema);
const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype']);

function escapePointerSegment(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

function childPath(path: string, segment: string): string {
  return `${path === '/' ? '' : path}/${escapePointerSegment(segment)}`;
}

function validationPath(error: TLocalizedValidationError): string {
  const basePath = error.instancePath || '/';
  if (error.keyword === 'additionalProperties') {
    return safeDiagnosticPath(basePath);
  }
  if (error.keyword === 'required') {
    const property = error.params.requiredProperties[0];
    return safeDiagnosticPath(property === undefined ? basePath : childPath(basePath, property));
  }
  return safeDiagnosticPath(basePath);
}

function safeDiagnosticPath(path: string): string {
  if (path.startsWith('/request/headers/')) {
    return '/request/headers';
  }
  if (path.startsWith('/request/query/')) {
    return '/request/query';
  }
  if (path.startsWith('/request/body/')) {
    return '/request/body';
  }
  return /^\/(?:id|name|description|tags(?:\/\d+)?|safety(?:\/(?:classification|rationale))?|request(?:\/(?:method|path|headers|query|body))?)?$/.test(
    path,
  )
    ? path
    : '/';
}

function assertSafeKeys(value: unknown): void {
  if (value === null || typeof value !== 'object') {
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (unsafeKeys.has(key)) {
      throw captureError('CAPTURE_INPUT_INVALID', 'Capture input contains an unsafe object key.');
    }
    assertSafeKeys(item);
  }
}

function assertHeaders(headers: Readonly<Record<string, string>> | undefined): void {
  const normalized = new Set<string>();
  for (const [name, value] of Object.entries(headers ?? {})) {
    const lowerName = name.toLowerCase();
    try {
      validateHeaderName(lowerName);
      validateHeaderValue(lowerName, value);
    } catch {
      throw captureError(
        'CAPTURE_INPUT_INVALID',
        'Capture input contains an invalid HTTP header name or value.',
        '/request/headers',
      );
    }
    if (normalized.has(lowerName)) {
      throw captureError(
        'CAPTURE_INPUT_INVALID',
        'Capture input contains duplicate case-insensitive header names.',
        '/request/headers',
      );
    }
    normalized.add(lowerName);
  }
}

function freezeValue<Value>(value: Value): Value {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) {
      freezeValue(item);
    }
    Object.freeze(value);
  }
  return value;
}

/** Validates and clones an untrusted in-memory capture without echoing its values in errors. */
export function validateCapturedHttpScenarioInput(value: unknown): CapturedHttpScenarioInput {
  let cloned: unknown;
  try {
    cloned = JSON.parse(canonicalizeJson(value)) as unknown;
  } catch {
    throw captureError(
      'CAPTURE_INPUT_INVALID',
      'Capture input must contain only finite, acyclic JSON data properties.',
    );
  }

  assertSafeKeys(cloned);
  const validationError = inputValidator.Errors(cloned)[0];
  if (validationError !== undefined) {
    throw captureError(
      'CAPTURE_INPUT_INVALID',
      'Capture input does not match the supported HTTP capture contract.',
      validationPath(validationError),
    );
  }
  const input = cloned as CapturedHttpScenarioInput;
  if (input.request.path.includes('?') || input.request.path.includes('#')) {
    throw captureError(
      'CAPTURE_INPUT_INVALID',
      'Capture request path must not contain a query string or fragment.',
      '/request/path',
    );
  }
  assertHeaders(input.request.headers);
  return freezeValue(input);
}
