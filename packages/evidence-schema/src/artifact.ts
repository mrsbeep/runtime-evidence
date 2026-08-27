import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { TLocalizedValidationError } from 'typebox/error';
import Compile from 'typebox/compile';

import { EvidenceArtifactError } from './artifact-diagnostics.ts';
import { canonicalizeJson } from './canonical-json.ts';
import { EvidenceSchemaV1, type EvidenceV1 } from './evidence.ts';
import { isRedactedEvidenceValue } from './presentation.ts';

export const EVIDENCE_FILE_NAME = 'evidence.json' as const;

export type EvidencePayloadV1 = Omit<EvidenceV1, 'integrity'>;

export interface WriteEvidenceArtifactOptions {
  readonly outputDirectory: string;
  readonly payload: EvidencePayloadV1;
}

export interface WrittenEvidenceArtifact {
  readonly evidence: EvidenceV1;
  readonly path: string;
}

const evidenceValidator = Compile(EvidenceSchemaV1);

function escapePointerSegment(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

function childPath(parent: string, segment: string): string {
  const escaped = escapePointerSegment(segment);
  return parent === '/' ? `/${escaped}` : `${parent}/${escaped}`;
}

function validationPath(error: TLocalizedValidationError): string {
  const basePath = error.instancePath || '/';
  if (error.keyword === 'additionalProperties') {
    const property = error.params.additionalProperties[0];
    return property === undefined ? basePath : childPath(basePath, property);
  }
  if (error.keyword === 'required') {
    const property = error.params.requiredProperties[0];
    return property === undefined ? basePath : childPath(basePath, property);
  }
  return basePath;
}

function assertSchema(value: unknown): asserts value is EvidenceV1 {
  const error = evidenceValidator.Errors(value)[0];
  if (error !== undefined) {
    throw new EvidenceArtifactError(
      'EVIDENCE_SCHEMA_INVALID',
      'Evidence failed version 1 schema validation.',
      validationPath(error),
    );
  }
}

function assertRedactionMarker(value: unknown, path: string, ancestors: Set<object>): void {
  if (value === null || typeof value !== 'object') {
    return;
  }
  if (isRedactedEvidenceValue(value)) {
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== 'state') {
      throw new EvidenceArtifactError(
        'EVIDENCE_REDACTION_MARKER_INVALID',
        'A redacted evidence value must not retain its original value or metadata.',
        path,
      );
    }
    return;
  }
  if (ancestors.has(value)) {
    return;
  }

  ancestors.add(value);
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertRedactionMarker(item, childPath(path, String(index)), ancestors);
    }
  } else {
    for (const [key, item] of Object.entries(value)) {
      assertRedactionMarker(item, childPath(path, key), ancestors);
    }
  }
  ancestors.delete(value);
}

function assertSafeRedactionMarkers(evidence: EvidenceV1): void {
  for (const [resultIndex, result] of evidence.results.entries()) {
    for (const [differenceIndex, difference] of result.differences.entries()) {
      for (const side of ['baseline', 'candidate'] as const) {
        if (Object.hasOwn(difference, side)) {
          assertRedactionMarker(
            difference[side],
            `/results/${resultIndex}/differences/${differenceIndex}/${side}`,
            new Set<object>(),
          );
        }
      }
    }
  }
}

function canonicalPayload(evidence: EvidenceV1): string {
  const payload = Object.fromEntries(
    Object.entries(evidence).filter(([key]) => key !== 'integrity'),
  );
  return canonicalizeJson(payload);
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) {
      deepFreeze(item);
    }
    Object.freeze(value);
  }
  return value;
}

function canonicalClone(canonical: string): EvidenceV1 {
  return deepFreeze(JSON.parse(canonical) as EvidenceV1);
}

export function createEvidenceArtifact(payload: EvidencePayloadV1): EvidenceV1 {
  let canonical: string;
  try {
    canonical = canonicalizeJson(payload);
  } catch {
    throw new EvidenceArtifactError(
      'EVIDENCE_JSON_INCOMPATIBLE',
      'Evidence must contain only finite, acyclic JSON values.',
    );
  }

  const canonicalPayloadValue = JSON.parse(canonical) as EvidencePayloadV1;
  return validateEvidenceArtifact({
    ...canonicalPayloadValue,
    integrity: { algorithm: 'sha256', digest: sha256(canonical) },
  });
}

/** Validates schema, redaction-marker safety, JSON compatibility, and payload integrity. */
export function validateEvidenceArtifact(value: unknown): EvidenceV1 {
  assertSchema(value);
  assertSafeRedactionMarkers(value);

  let expectedDigest: string;
  let canonical: string;
  try {
    expectedDigest = sha256(canonicalPayload(value));
    canonical = canonicalizeJson(value);
  } catch {
    throw new EvidenceArtifactError(
      'EVIDENCE_JSON_INCOMPATIBLE',
      'Evidence must contain only finite, acyclic JSON values.',
    );
  }
  if (value.integrity.digest !== expectedDigest) {
    throw new EvidenceArtifactError(
      'EVIDENCE_INTEGRITY_MISMATCH',
      'Evidence integrity verification failed.',
      '/integrity/digest',
    );
  }

  return canonicalClone(canonical);
}

export function serializeEvidenceArtifact(value: unknown): string {
  return `${canonicalizeJson(validateEvidenceArtifact(value))}\n`;
}

export async function readEvidenceArtifact(filePath: string): Promise<EvidenceV1> {
  let source: string;
  try {
    source = await readFile(filePath, 'utf8');
  } catch {
    throw new EvidenceArtifactError('EVIDENCE_READ_FAILED', 'Evidence could not be read.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new EvidenceArtifactError('EVIDENCE_PARSE_FAILED', 'Evidence JSON could not be parsed.');
  }
  return validateEvidenceArtifact(parsed);
}

/** Creates and atomically writes canonical `evidence.json` in the requested directory. */
export async function writeEvidenceArtifact(
  options: WriteEvidenceArtifactOptions,
): Promise<WrittenEvidenceArtifact> {
  const evidence = createEvidenceArtifact(options.payload);
  const serialized = serializeEvidenceArtifact(evidence);
  const outputDirectory = resolve(options.outputDirectory);
  const destination = join(outputDirectory, EVIDENCE_FILE_NAME);
  const temporary = join(
    outputDirectory,
    `.${EVIDENCE_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    await mkdir(outputDirectory, { recursive: true });
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, destination);
  } catch {
    await unlink(temporary).catch(() => undefined);
    throw new EvidenceArtifactError('EVIDENCE_WRITE_FAILED', 'Evidence could not be written.');
  }

  return Object.freeze({ evidence, path: destination });
}
