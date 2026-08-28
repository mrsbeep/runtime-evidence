import { createHash } from 'node:crypto';

import {
  canonicalizeJson,
  ScenarioSchemaV1,
  type ScenarioV1,
} from '@runtime-evidence/evidence-schema';
import Compile from 'typebox/compile';

import { CaptureError, captureError } from './diagnostics.ts';
import { validateCapturedHttpScenarioInput } from './input.ts';
import { markPrepared } from './prepared.ts';
import { redactCapture } from './redaction.ts';
import type { CaptureRedactionPolicy, SanitizedCaptureDraft } from './types.ts';

const scenarioValidator = Compile(ScenarioSchemaV1);

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
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

/** Applies the mandatory redaction boundary and returns an immutable, persistence-safe preview. */
export function prepareSanitizedCapture(
  value: unknown,
  policy: CaptureRedactionPolicy,
): SanitizedCaptureDraft {
  try {
    const input = validateCapturedHttpScenarioInput(value);
    const sanitized = redactCapture(input, policy);
    const sourceDigest = sha256(
      canonicalizeJson({ id: input.id, request: sanitized.request, safety: sanitized.safety }),
    );
    const scenario: ScenarioV1 = {
      schemaVersion: 1,
      id: input.id,
      name: sanitized.name,
      ...(sanitized.description === undefined ? {} : { description: sanitized.description }),
      ...(sanitized.tags === undefined ? {} : { tags: sanitized.tags }),
      provenance: {
        source: 'local-capture',
        sha256: sourceDigest,
        redaction: sanitized.redaction,
      },
      safety: sanitized.safety,
      request: sanitized.request,
    };
    if (!scenarioValidator.Check(scenario)) {
      throw captureError(
        'CAPTURE_REDACTION_FAILED',
        'Sanitized capture did not produce a valid version 1 scenario.',
      );
    }

    const canonical = canonicalizeJson(scenario);
    const frozenScenario = freezeValue(JSON.parse(canonical) as ScenarioV1);
    const frozenRedaction = frozenScenario.provenance.redaction;
    if (frozenRedaction === undefined) {
      throw captureError(
        'CAPTURE_REDACTION_FAILED',
        'Sanitized capture is missing required redaction provenance.',
      );
    }
    const draft = Object.freeze({
      preview: `${JSON.stringify(frozenScenario, null, 2)}\n`,
      redaction: frozenRedaction,
      scenario: frozenScenario,
    });
    return markPrepared(draft);
  } catch (error) {
    if (error instanceof CaptureError) {
      throw error;
    }
    throw captureError(
      'CAPTURE_REDACTION_FAILED',
      'Mandatory capture redaction could not complete safely.',
    );
  }
}
