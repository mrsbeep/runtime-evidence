import { validateHeaderName, validateHeaderValue } from 'node:http';

import type { ScenarioV1 } from '@runtime-evidence/evidence-schema';

import { HttpRequestPreparationError } from './diagnostics.ts';
import type { PreparedHttpRequest } from './types.ts';

function escapePointerSegment(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertHeader(name: string, value: string, path: string): void {
  try {
    validateHeaderName(name);
    validateHeaderValue(name, value);
  } catch {
    throw new HttpRequestPreparationError(
      'HTTP_REQUEST_HEADER_INVALID',
      'Scenario request contains an invalid header.',
      path,
    );
  }
}

function resolveHeaders(
  headers: ScenarioV1['request']['headers'],
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const resolved = new Map<string, string>();

  for (const [name, configuredValue] of Object.entries(headers ?? {})) {
    const normalizedName = name.toLowerCase();
    const path = `/request/headers/${escapePointerSegment(name)}`;
    if (resolved.has(normalizedName)) {
      throw new HttpRequestPreparationError(
        'HTTP_REQUEST_HEADER_INVALID',
        'Scenario request contains duplicate case-insensitive header names.',
        path,
      );
    }

    const value =
      typeof configuredValue === 'string'
        ? configuredValue
        : Object.hasOwn(environment, configuredValue.env)
          ? environment[configuredValue.env]
          : undefined;
    if (value === undefined) {
      throw new HttpRequestPreparationError(
        'HTTP_REQUEST_ENV_MISSING',
        'A required request environment reference is not set.',
        path,
      );
    }

    assertHeader(normalizedName, value, path);
    resolved.set(normalizedName, value);
  }

  return Object.fromEntries(
    [...resolved.entries()].sort(([left], [right]) => compareCodeUnits(left, right)),
  );
}

function preparePath(request: ScenarioV1['request']): string {
  if (!request.path.startsWith('/') || request.path.includes('#')) {
    throw new HttpRequestPreparationError(
      'HTTP_REQUEST_PATH_INVALID',
      'Scenario request path must be absolute and must not contain a fragment.',
      '/request/path',
    );
  }

  let url: URL;
  try {
    url = new URL(request.path, 'http://runtime-evidence.invalid');
  } catch {
    throw new HttpRequestPreparationError(
      'HTTP_REQUEST_PATH_INVALID',
      'Scenario request path is invalid.',
      '/request/path',
    );
  }

  for (const [name, value] of Object.entries(request.query ?? {}).sort(([left], [right]) =>
    compareCodeUnits(left, right),
  )) {
    url.searchParams.set(name, value);
  }

  return `${url.pathname}${url.search}`;
}

function prepareBody(body: unknown): { readonly body?: string; readonly isJson: boolean } {
  if (body === undefined) {
    return { isJson: false };
  }
  if (typeof body === 'string') {
    return { body, isJson: false };
  }

  try {
    const serialized = JSON.stringify(body);
    if (serialized === undefined) {
      throw new Error('Body is not serializable');
    }
    return { body: serialized, isJson: true };
  } catch {
    throw new HttpRequestPreparationError(
      'HTTP_REQUEST_BODY_INVALID',
      'Scenario request body must be JSON-serializable.',
      '/request/body',
    );
  }
}

/** Resolves a validated scenario once so both targets receive the same request definition. */
export function prepareScenarioRequest(
  scenario: ScenarioV1,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): PreparedHttpRequest {
  const headers = resolveHeaders(scenario.request.headers, environment);
  const preparedBody = prepareBody(scenario.request.body);
  if (
    preparedBody.isJson &&
    !Object.keys(headers).some((name) => name.toLowerCase() === 'content-type')
  ) {
    headers['content-type'] = 'application/json';
  }

  return Object.freeze({
    ...(preparedBody.body === undefined ? {} : { body: preparedBody.body }),
    headers: Object.freeze(headers),
    method: scenario.request.method,
    path: preparePath(scenario.request),
  });
}
