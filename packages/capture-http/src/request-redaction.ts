import { createHash } from 'node:crypto';
import { validateHeaderName } from 'node:http';

import type { ScenarioV1 } from '@runtime-evidence/evidence-schema';

import { captureError } from './diagnostics.ts';
import { compareCodeUnits, recordRedaction, type RedactionState } from './redaction-state.ts';
import {
  assertSafeFieldKey,
  isSensitiveFieldName,
  REDACTED_CAPTURE_VALUE,
  sanitizeKnownSecrets,
} from './text-redaction.ts';
import type { CaptureRedactionPolicy } from './types.ts';

type ScenarioHeaders = NonNullable<ScenarioV1['request']['headers']>;
type ScenarioQuery = NonNullable<ScenarioV1['request']['query']>;

const sensitiveHeaders = new Set([
  'authorization',
  'cookie',
  'proxy-authenticate',
  'proxy-authorization',
  'set-cookie',
  'www-authenticate',
  'x-api-key',
]);

function environmentReference(scenarioId: string, headerName: string): { readonly env: string } {
  const identifier = scenarioId.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const header = headerName.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const identifierSuffix = createHash('sha256')
    .update(scenarioId, 'utf8')
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();
  const headerSuffix = createHash('sha256')
    .update(headerName, 'utf8')
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();
  return {
    env: `RUNTIME_EVIDENCE_${identifier}_${identifierSuffix}_HEADER_${header}_${headerSuffix}`,
  };
}

function configuredSensitiveHeaders(headers: readonly string[]): ReadonlySet<string> {
  const configured = new Set(sensitiveHeaders);
  for (const header of headers) {
    const normalized = header.toLowerCase();
    try {
      validateHeaderName(normalized);
    } catch {
      throw captureError(
        'CAPTURE_REDACTION_FAILED',
        'Configured redaction policy contains an invalid HTTP header name.',
        '/redaction/headers',
      );
    }
    configured.add(normalized);
  }
  return configured;
}

export function sanitizeHeaders(
  scenarioId: string,
  headers: Readonly<Record<string, string>> | undefined,
  policy: CaptureRedactionPolicy,
  state: RedactionState,
): ScenarioHeaders {
  const sensitive = configuredSensitiveHeaders(policy.headers);
  return Object.fromEntries(
    Object.entries(headers ?? {})
      .map(([name, value]) => {
        assertSafeFieldKey(name, '/request/headers');
        return [name.toLowerCase(), value] as const;
      })
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([name, value]) => {
        if (sensitive.has(name) || isSensitiveFieldName(name)) {
          recordRedaction(state, `header:${name}`);
          return [name, environmentReference(scenarioId, name)];
        }
        const sanitized = sanitizeKnownSecrets(value, state);
        return [name, sanitized === value ? sanitized : environmentReference(scenarioId, name)];
      }),
  );
}

export function sanitizeQuery(
  query: Readonly<Record<string, string>> | undefined,
  state: RedactionState,
): ScenarioQuery {
  return Object.fromEntries(
    Object.entries(query ?? {})
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([name, value]) => {
        assertSafeFieldKey(name, '/request/query');
        if (isSensitiveFieldName(name)) {
          recordRedaction(state, `query:${name.toLowerCase()}`);
          return [name, REDACTED_CAPTURE_VALUE];
        }
        return [name, sanitizeKnownSecrets(value, state)];
      }),
  );
}
