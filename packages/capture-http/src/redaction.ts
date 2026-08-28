import type { ScenarioV1 } from '@runtime-evidence/evidence-schema';

import { sanitizeBody } from './body-redaction.ts';
import { captureError } from './diagnostics.ts';
import type { CapturedHttpScenarioInput } from './input.ts';
import { compareCodeUnits, createRedactionState, redactionMetadata } from './redaction-state.ts';
import { sanitizeHeaders, sanitizeQuery } from './request-redaction.ts';
import { containsKnownSecret, sanitizeKnownSecrets } from './text-redaction.ts';
import type { CaptureRedactionPolicy, CapturedScenarioRedaction } from './types.ts';

function sanitizeTags(
  tags: readonly string[] | undefined,
  state: ReturnType<typeof createRedactionState>,
): string[] | undefined {
  if (tags === undefined) {
    return undefined;
  }
  return [...new Set(tags.map((tag) => sanitizeKnownSecrets(tag, state)))].sort(compareCodeUnits);
}

export interface SanitizedCaptureParts {
  readonly description?: string;
  readonly name: string;
  readonly redaction: CapturedScenarioRedaction;
  readonly request: ScenarioV1['request'];
  readonly safety: ScenarioV1['safety'];
  readonly tags?: string[];
}

export function redactCapture(
  input: CapturedHttpScenarioInput,
  policy: CaptureRedactionPolicy,
): SanitizedCaptureParts {
  if (containsKnownSecret(input.id)) {
    throw captureError(
      'CAPTURE_REDACTION_FAILED',
      'Capture identifier matched a secret format and could not be persisted safely.',
      '/id',
    );
  }

  const state = createRedactionState();
  const body = sanitizeBody(input.request.body, policy.jsonPaths, state);
  const headers = sanitizeHeaders(input.id, input.request.headers, policy, state);
  const query = sanitizeQuery(input.request.query, state);
  const tags = sanitizeTags(input.tags, state);
  const description =
    input.description === undefined ? undefined : sanitizeKnownSecrets(input.description, state);
  const name = sanitizeKnownSecrets(input.name, state);
  const rationale = sanitizeKnownSecrets(input.safety.rationale, state);

  return {
    ...(description === undefined ? {} : { description }),
    name,
    redaction: redactionMetadata(state),
    request: {
      method: input.request.method,
      path: input.request.path,
      ...(Object.keys(headers).length === 0 ? {} : { headers }),
      ...(Object.keys(query).length === 0 ? {} : { query }),
      ...(body === undefined ? {} : { body }),
    },
    safety: { classification: input.safety.classification, rationale },
    ...(tags === undefined ? {} : { tags }),
  };
}

export { REDACTED_CAPTURE_VALUE } from './text-redaction.ts';
